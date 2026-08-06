import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp30SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied the platform finance route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const vendor = await db.vendor.create({
    data: { name: `WP30 Accountant Vendor ${suffix}`, slug: `wp30-accountant-${suffix}`, email: `wp30-accountant-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } },
  });
  const user = await db.user.create({
    data: { email: `wp30-accountant-user-${suffix}@celebratedeal.test`, name: "WP30 Active Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } } },
  });
  const billingBefore = await Promise.all([db.paymentTransaction.count(), db.settlement.count(), db.payoutBatch.count()]);
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/admin/billing/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page).not.toHaveURL(/\/mfa/);
    await expect(page.getByRole("heading", { name: "財務總覽" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect.poll(() => Promise.all([db.paymentTransaction.count(), db.settlement.count(), db.payoutBatch.count()])).toEqual(billingBefore);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
