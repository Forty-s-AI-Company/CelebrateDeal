import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";

// WP-05: a rejected native (no-JavaScript) registration returns to its source
// page with the visitor's fields restored from an encrypted, short-lived draft,
// and the later successful resubmission creates exactly one submission.
// Synthetic loopback data only; no email provider is configured for this server.
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
const db = new PrismaClient();
const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const vendor = { id: "" };
// toSlug() keeps CJK characters, so a CJK slug is a supported public URL.
const cases = [
  // The ASCII case arrives with an affiliate `ref`, which must survive the retry.
  { label: "ASCII slug", slug: `wp05-retry-${runId}`, formId: "", email: `wp05-a-${runId}@celebratedeal.local`, ref: "wp05-synthetic-ref" },
  { label: "CJK slug", slug: `夏季-新品-${runId}`, formId: "", email: `wp05-c-${runId}@celebratedeal.local`, ref: "" },
];
const visitorName = "合成訪客";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const created = await db.vendor.create({ data: {
    name: "WP05 合成商家", slug: `wp05-vendor-${runId}`, email: `wp05-vendor-${runId}@celebratedeal.local`, passwordHash: "synthetic-unused",
  } });
  vendor.id = created.id;
  for (const entry of cases) {
    const form = await db.registrationForm.create({ data: {
      vendorId: created.id, name: "WP05 重試表單", slug: entry.slug, headline: "WP05 重試表單",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    } });
    entry.formId = form.id;
    // A blocked identity is a server-side 403 that browser validation cannot pre-empt.
    await db.blacklist.create({ data: { vendorId: created.id, identifier: entry.email, identifierType: "email", reason: "wp05 synthetic retry" } });
  }
});

test.afterAll(async () => {
  if (vendor.id) await db.vendor.deleteMany({ where: { id: vendor.id } });
  await db.$disconnect();
});

const pathRegex = (slug: string, query: string) => new RegExp(`/form/${encodeURIComponent(slug)}\\?${query}$`, "u");

for (const entry of cases) {
  test(`no-JavaScript native POST keeps fields after a server rejection and resubmits once (${entry.label})`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto(`/form/${encodeURIComponent(entry.slug)}${entry.ref ? `?ref=${entry.ref}` : ""}`);
      await page.getByLabel("姓名").fill(visitorName);
      await page.getByLabel("Email").fill(entry.email);
      await page.getByRole("button", { name: "送出報名" }).click();

      await expect(page).toHaveURL(pathRegex(entry.slug, `${entry.ref ? `ref=${entry.ref}&` : ""}registrationRetry=403`));
      await expect(page.locator('input[name="referralCode"]')).toHaveValue(entry.ref);
      expect(page.url()).not.toContain(encodeURIComponent(entry.email));
      await expect(page.getByRole("alert").filter({ hasText: "這次送出未通過安全檢查" })).toBeVisible();
      await expect(page.getByLabel("姓名")).toHaveValue(visitorName);
      await expect(page.getByLabel("Email")).toHaveValue(entry.email);
      // The draft is single use: consumed by the prefill render above.
      expect(await db.registrationFormRetryDraft.count({ where: { formId: entry.formId } })).toBe(0);
      expect(await db.formSubmission.count({ where: { formId: entry.formId } })).toBe(0);

      await db.blacklist.updateMany({ where: { vendorId: vendor.id, identifier: entry.email }, data: { isActive: false } });
      await page.getByRole("button", { name: "送出報名" }).click();

      await expect(page).toHaveURL(pathRegex(entry.slug, "submitted=verification_required"));
      await expect(page.getByText("請到 Email 開啟確認連結")).toBeVisible();
      await expect(page.getByLabel("Email")).toHaveCount(0);
      expect(await db.formSubmission.count({ where: { formId: entry.formId } })).toBe(1);
      expect(await db.registrationFormRetryDraft.count({ where: { formId: entry.formId } })).toBe(0);
    } finally {
      await context.close();
    }
  });
}

test("a shared result URL proves nothing in a fresh browser", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const [entry] = cases;
  try {
    await page.goto(`/form/${entry.slug}?submitted=verification_required`);
    await expect(page.getByLabel("Email")).toBeEditable();
    await expect(page.getByText("請到 Email 開啟確認連結")).toHaveCount(0);

    await page.goto(`/form/${entry.slug}?registrationRetry=503`);
    await expect(page.getByRole("alert").filter({ hasText: "無法確認先前的送出結果" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("a cross-site native POST keeps nothing and lands on the fixed error page", async ({ request }) => {
  const [entry] = cases;
  const response = await request.post("/api/form-submissions", {
    headers: { origin: "https://attacker.example.test" },
    form: { formId: entry.formId, name: visitorName, email: entry.email, __registrationReturnPath: `/form/${entry.slug}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(new URL(response.headers().location!).pathname).toBe("/registration-error");
  expect(response.headers()["set-cookie"] ?? "").not.toContain("registration_retry");
  expect(await db.registrationFormRetryDraft.count({ where: { formId: entry.formId } })).toBe(0);
});
