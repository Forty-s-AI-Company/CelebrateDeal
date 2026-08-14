import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp54SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied a same-vendor form edit route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const fields = [{ key: "name", label: "姓名", type: "text", required: true }];
  const vendor = await db.vendor.create({ data: { name: `WP54 Vendor ${suffix}`, slug: `wp54-${suffix}`, email: `wp54-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } });
  const user = await db.user.create({ data: { email: `wp54-accountant-${suffix}@celebratedeal.test`, name: "WP54 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } } } });
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: `WP54 Form ${suffix}`, slug: `wp54-form-${suffix}`, headline: `WP54 Headline ${suffix}`, description: `WP54 Description ${suffix}`, submitLabel: "送出", fields, isActive: true } });
  const before = await db.registrationForm.findUniqueOrThrow({ where: { id: form.id } });
  const countBefore = await db.registrationForm.count({ where: { vendorId: vendor.id } });
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const path = `/forms/${form.id}/edit`;
    const originalResponse = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.status() === 307);
    const finalResponse = await page.goto(path);
    const response = await originalResponse;
    expect(response.status()).toBe(307);
    expect(finalResponse?.status()).toBe(200);
    const location = new URL(response.headers().location ?? "", "http://127.0.0.1");
    expect(`${location.pathname}${location.search}`).toBe("/dashboard?error=insufficient_role");
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "編輯報名表" })).toHaveCount(0);
    for (const label of ["表單名稱", "公開網址", "公開標題", "說明文字", "顯示名稱", "送出按鈕文字", "成功訊息"]) await expect(page.getByLabel(label)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新增欄位" })).toHaveCount(0);
    await expect(page.locator('input[name="fields"]')).toHaveCount(0);
    for (const value of [before.name, before.slug, before.headline, before.description ?? ""]) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    await expect.poll(async () => [await db.registrationForm.findUniqueOrThrow({ where: { id: form.id } }), await db.registrationForm.count({ where: { vendorId: vendor.id } })]).toEqual([before, countBefore]);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
