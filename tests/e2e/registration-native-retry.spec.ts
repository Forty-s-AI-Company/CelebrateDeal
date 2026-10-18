import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// WP-05: a rejected native (no-JavaScript) registration returns to its source
// page with the visitor's fields restored from an encrypted, short-lived draft,
// and the later successful resubmission creates exactly one submission.
// Synthetic loopback data only; no email provider is configured for this server.
const db = new PrismaClient();
const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const visitor = { name: "合成訪客", email: `wp05-${runId}@celebratedeal.local` };
const fixture = { vendorId: "", formId: "", slug: `wp05-retry-${runId}` };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const vendor = await db.vendor.create({ data: {
    name: "WP05 合成商家", slug: `wp05-vendor-${runId}`, email: `wp05-vendor-${runId}@celebratedeal.local`, passwordHash: "synthetic-unused",
  } });
  fixture.vendorId = vendor.id;
  const form = await db.registrationForm.create({ data: {
    vendorId: vendor.id, name: "WP05 重試表單", slug: fixture.slug, headline: "WP05 重試表單",
    fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ],
  } });
  fixture.formId = form.id;
  // A blocked identity is a server-side 403 that browser validation cannot pre-empt.
  await db.blacklist.create({ data: { vendorId: vendor.id, identifier: visitor.email, identifierType: "email", reason: "wp05 synthetic retry" } });
});

test.afterAll(async () => {
  if (fixture.vendorId) await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  await db.$disconnect();
});

test("no-JavaScript native POST keeps fields after a server rejection and resubmits once", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`/form/${fixture.slug}`);
    await page.getByLabel("姓名").fill(visitor.name);
    await page.getByLabel("Email").fill(visitor.email);
    await page.getByRole("button", { name: "送出報名" }).click();

    await expect(page).toHaveURL(new RegExp(`/form/${fixture.slug}\\?registrationRetry=403$`, "u"));
    expect(page.url()).not.toContain(encodeURIComponent(visitor.email));
    await expect(page.getByRole("alert").filter({ hasText: "這次送出未通過安全檢查" })).toBeVisible();
    await expect(page.getByLabel("姓名")).toHaveValue(visitor.name);
    await expect(page.getByLabel("Email")).toHaveValue(visitor.email);
    expect(await db.registrationFormRetryDraft.count({ where: { formId: fixture.formId } })).toBe(1);
    expect(await db.formSubmission.count({ where: { formId: fixture.formId } })).toBe(0);

    await db.blacklist.updateMany({ where: { vendorId: fixture.vendorId }, data: { isActive: false } });
    await page.getByRole("button", { name: "送出報名" }).click();

    await expect(page).toHaveURL(new RegExp(`/form/${fixture.slug}\\?submitted=verification_required$`, "u"));
    await expect(page.getByText("請到 Email 開啟確認連結")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
    expect(await db.formSubmission.count({ where: { formId: fixture.formId } })).toBe(1);
    expect(await db.registrationFormRetryDraft.count({ where: { formId: fixture.formId } })).toBe(0);
  } finally {
    await context.close();
  }
});

test("a shared result URL proves nothing in a fresh browser", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`/form/${fixture.slug}?submitted=verification_required`);
    await expect(page.getByLabel("Email")).toBeEditable();
    await expect(page.getByText("請到 Email 開啟確認連結")).toHaveCount(0);

    await page.goto(`/form/${fixture.slug}?registrationRetry=503`);
    await expect(page.getByRole("alert").filter({ hasText: "無法確認先前的送出結果" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("a cross-site native POST keeps nothing and lands on the fixed error page", async ({ request }) => {
  const response = await request.post("/api/form-submissions", {
    headers: { origin: "https://attacker.example.test" },
    form: { formId: fixture.formId, name: visitor.name, email: visitor.email, __registrationReturnPath: `/form/${fixture.slug}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(new URL(response.headers().location!).pathname).toBe("/registration-error");
  expect(response.headers()["set-cookie"] ?? "").not.toContain("registration_retry");
  expect(await db.registrationFormRetryDraft.count({ where: { formId: fixture.formId } })).toBe(0);
});
