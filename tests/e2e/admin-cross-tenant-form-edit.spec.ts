import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp34SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("admin cannot open another vendor form edit route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const fields = [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }];
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP34 Owner ${suffix}`, slug: `wp34-owner-${suffix}`, email: `wp34-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP34 Foreign ${suffix}`, slug: `wp34-foreign-${suffix}`, email: `wp34-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownForm, foreignForm] = await Promise.all([
    db.user.create({ data: { email: `wp34-admin-${suffix}@celebratedeal.test`, name: "WP34 Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "admin", status: "active" } } } }),
    db.registrationForm.create({ data: { vendorId: ownerVendor.id, name: `WP34 Own ${suffix}`, slug: `wp34-own-${suffix}`, headline: `WP34 Own Headline ${suffix}`, description: `WP34 Own Description ${suffix}`, submitLabel: `WP34 Own Submit ${suffix}`, successMessage: `WP34 Own Success ${suffix}`, fields, isActive: true } }),
    db.registrationForm.create({ data: { vendorId: foreignVendor.id, name: `WP34 Foreign ${suffix}`, slug: `wp34-foreign-form-${suffix}`, headline: `WP34 Foreign Headline ${suffix}`, description: `WP34 Foreign Description ${suffix}`, submitLabel: `WP34 Foreign Submit ${suffix}`, successMessage: `WP34 Foreign Success ${suffix}`, fields, isActive: true } }),
  ]);
  const [ownBefore, foreignBefore, ownerCount, foreignCount] = await Promise.all([db.registrationForm.findUniqueOrThrow({ where: { id: ownForm.id } }), db.registrationForm.findUniqueOrThrow({ where: { id: foreignForm.id } }), db.registrationForm.count({ where: { vendorId: ownerVendor.id } }), db.registrationForm.count({ where: { vendorId: foreignVendor.id } })]);
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const ownPath = `/forms/${ownForm.id}/edit`; const ownResponse = await page.goto(ownPath); expect(ownResponse?.status()).toBe(200); await expect(page).toHaveURL(new RegExp(`${ownPath}$`)); await expect(page.getByRole("heading", { name: "編輯報名表" })).toBeVisible(); await expect(page.getByLabel("表單名稱")).toHaveValue(ownBefore.name); await expect(page.getByLabel("Slug")).toHaveValue(ownBefore.slug); await expect(page.getByLabel("公開標題")).toHaveValue(ownBefore.headline); await expect(page.getByLabel("欄位 JSON")).toHaveValue(JSON.stringify(ownBefore.fields, null, 2));
    const foreignPath = `/forms/${foreignForm.id}/edit`; const foreignResponse = await page.goto(foreignPath); expect(foreignResponse?.status()).toBe(404); await expect(page).toHaveURL(new RegExp(`${foreignPath}$`)); await expect(page.getByRole("heading", { name: "編輯報名表" })).toHaveCount(0); for (const label of ["表單名稱", "Slug", "公開標題", "說明文字", "欄位 JSON", "送出按鈕文字", "成功訊息"]) await expect(page.getByLabel(label)).toHaveCount(0); for (const value of [foreignBefore.name, foreignBefore.slug, foreignBefore.headline, foreignBefore.description ?? "", JSON.stringify(foreignBefore.fields, null, 2)]) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    await expect.poll(async () => Promise.all([db.registrationForm.findUniqueOrThrow({ where: { id: ownForm.id } }), db.registrationForm.findUniqueOrThrow({ where: { id: foreignForm.id } }), db.registrationForm.count({ where: { vendorId: ownerVendor.id } }), db.registrationForm.count({ where: { vendorId: foreignVendor.id } })])).toEqual([ownBefore, foreignBefore, ownerCount, foreignCount]);
  } finally { await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
