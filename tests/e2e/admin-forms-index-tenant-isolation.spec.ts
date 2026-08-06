import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp35SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("admin forms index does not expose another vendor forms or submission counts", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP35 Owner ${suffix}`, slug: `wp35-owner-${suffix}`, email: `wp35-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP35 Foreign ${suffix}`, slug: `wp35-foreign-${suffix}`, email: `wp35-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const fields = [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }];
  const [user, ownForm, foreignForm] = await Promise.all([
    db.user.create({ data: { email: `wp35-admin-${suffix}@celebratedeal.test`, name: "WP35 Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "admin", status: "active" } } } }),
    db.registrationForm.create({ data: { vendorId: ownerVendor.id, name: `WP35 Own ${suffix}`, slug: `wp35-own-${suffix}`, headline: "Own", fields, isActive: true } }),
    db.registrationForm.create({ data: { vendorId: foreignVendor.id, name: `WP35 Foreign ${suffix}`, slug: `wp35-foreign-${suffix}`, headline: "Foreign", fields, isActive: true } }),
  ]);
  const ownCanary = `wp35-own-${suffix}`; const foreignCanary = `wp35-foreign-${suffix}`;
  await Promise.all([
    db.formSubmission.create({ data: { formId: ownForm.id, name: ownCanary, email: `${ownCanary}@example.test`, phone: "0900000001" } }),
    db.formSubmission.createMany({ data: [{ formId: foreignForm.id, name: `${foreignCanary}-one`, email: `${foreignCanary}-one@example.test`, phone: "0900000002" }, { formId: foreignForm.id, name: `${foreignCanary}-two`, email: `${foreignCanary}-two@example.test`, phone: "0900000003" }] }),
  ]);
  const snapshot = async () => Promise.all([
    db.registrationForm.findUniqueOrThrow({ where: { id: ownForm.id } }), db.registrationForm.findUniqueOrThrow({ where: { id: foreignForm.id } }),
    db.formSubmission.findMany({ where: { formId: ownForm.id }, orderBy: { id: "asc" } }), db.formSubmission.findMany({ where: { formId: foreignForm.id }, orderBy: { id: "asc" } }),
    db.registrationForm.count({ where: { vendorId: ownerVendor.id } }), db.registrationForm.count({ where: { vendorId: foreignVendor.id } }),
    db.formSubmission.count({ where: { formId: ownForm.id } }), db.formSubmission.count({ where: { formId: foreignForm.id } }),
  ]);
  const before = await snapshot();
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const response = await page.goto("/forms"); expect(response?.status()).toBe(200); await expect(page).toHaveURL(/\/forms$/); await expect(page.getByRole("heading", { name: "報名表管理" })).toBeVisible(); await expect(page.getByText(ownForm.name, { exact: true })).toBeVisible(); await expect(page.getByText(`/form/${ownForm.slug}`, { exact: true })).toBeVisible(); await expect(page.locator(`a[href="/forms/${ownForm.id}/edit"]`)).toHaveCount(1); await expect(page.locator(`a[href="/forms/${ownForm.id}/submissions"]`)).toHaveCount(1); await expect(page.getByText("1 名單", { exact: true })).toHaveCount(1);
    for (const value of [foreignForm.name, `/form/${foreignForm.slug}`, foreignForm.id, foreignForm.slug, "2 名單", `${foreignCanary}-one`, `${foreignCanary}-two`, `${foreignCanary}-one@example.test`, `${foreignCanary}-two@example.test`, "0900000002", "0900000003"]) await expect(page.getByText(value, { exact: true })).toHaveCount(0); await expect(page.locator(`a[href="/forms/${foreignForm.id}/edit"]`)).toHaveCount(0); await expect(page.locator(`a[href="/forms/${foreignForm.id}/submissions"]`)).toHaveCount(0);
    await expect.poll(snapshot).toEqual(before);
  } finally { await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
