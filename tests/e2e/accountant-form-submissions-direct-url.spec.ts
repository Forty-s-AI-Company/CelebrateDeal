import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp55SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied same-vendor form submissions through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const canary = `wp55-${suffix}`;
  const vendor = await db.vendor.create({ data: { name: `WP55 ${suffix}`, slug: canary, email: `${canary}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } });
  const user = await db.user.create({ data: { email: `accountant-${canary}@celebratedeal.test`, name: "WP55 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } } } });
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: `WP55 Form ${suffix}`, slug: `form-${canary}`, headline: "WP55", fields: [], isActive: true } });
  const submission = await db.formSubmission.create({ data: { formId: form.id, name: canary, email: `${canary}@example.test`, phone: "0900000055" } });
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const before = await Promise.all([db.registrationForm.findUniqueOrThrow({ where: { id: form.id } }), db.formSubmission.findUniqueOrThrow({ where: { id: submission.id } }), db.registrationForm.count({ where: { vendorId: vendor.id } }), db.formSubmission.count({ where: { formId: form.id } })]);
    const path = `/forms/${form.id}/submissions`;
    const routeIdentityCanaries = [form.id, path];
    const sensitiveCanaries = [canary, `${canary}@example.test`, "0900000055"];
    const posts: string[] = [];
    const onRequest = (request: { method(): string; url(): string }) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
    };
    page.on("request", onRequest);
    try {
      const { finalResponse, protectedDocumentHtml } = await navigateAndAssertDirectUrlGuard({
        page,
        path,
        routeIdentityCanaries,
        protectedPayloadCanaries: sensitiveCanaries,
        documentCanaries: sensitiveCanaries,
        transport: {
          kind: "streaming-redirect",
          status: 200,
          redirectMarker: "NEXT_REDIRECT",
          redirectTargetMarker: "/dashboard?error=insufficient_role",
        },
        finalUrl: /\/dashboard\?error=insufficient_role$/,
        finalStatus: 200,
      });
      expect(protectedDocumentHtml).not.toBeNull();
      expect(protectedDocumentHtml).toContain("NEXT_REDIRECT");
      expect(protectedDocumentHtml).toContain("/dashboard?error=insufficient_role");
      expect(finalResponse?.status()).toBe(200);
      await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      const bodyText = await page.locator("body").innerText();
      const pageHtml = await page.content();
      for (const value of sensitiveCanaries) {
        expect(bodyText).not.toContain(value);
        expect(pageHtml).not.toContain(value);
      }
      await expect(page.getByRole("heading", { name: `${form.name} 名單` })).toHaveCount(0);
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect.poll(() => Promise.all([db.registrationForm.findUniqueOrThrow({ where: { id: form.id } }), db.formSubmission.findUniqueOrThrow({ where: { id: submission.id } }), db.registrationForm.count({ where: { vendorId: vendor.id } }), db.formSubmission.count({ where: { formId: form.id } })])).toEqual(before);
      expect(posts).toEqual([]);
    } finally {
      page.off("request", onRequest);
    }
  } finally { await db.vendor.deleteMany({ where: { id: vendor.id } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
