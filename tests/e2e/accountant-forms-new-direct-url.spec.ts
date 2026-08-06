import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp33SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied the forms-new route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const vendor = await db.vendor.create({ data: { name: `WP33 Vendor ${suffix}`, slug: `wp33-${suffix}`, email: `wp33-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } });
  const user = await db.user.create({ data: { email: `wp33-accountant-${suffix}@celebratedeal.test`, name: "WP33 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } } } });
  const formsBefore = await db.registrationForm.count({ where: { vendorId: vendor.id } });
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const originalResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/forms/new" && response.status() === 307);
    const finalResponse = await page.goto("/forms/new");
    const response = await originalResponse;
    expect(response.status()).toBe(307);
    expect(finalResponse).not.toBeNull();
    expect(finalResponse?.status()).toBe(200);
    expect(new URL(response?.headers().location ?? "", "http://127.0.0.1").pathname + new URL(response?.headers().location ?? "", "http://127.0.0.1").search).toBe("/dashboard?error=insufficient_role");
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "新增報名表" })).toHaveCount(0);
    await expect(page.getByLabel("表單名稱")).toHaveCount(0);
    await expect(page.getByLabel("Slug")).toHaveCount(0);
    await expect(page.getByLabel("公開標題")).toHaveCount(0);
    await expect(page.getByLabel("欄位 JSON")).toHaveCount(0);
    await expect.poll(() => db.registrationForm.count({ where: { vendorId: vendor.id } })).toBe(formsBefore);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
