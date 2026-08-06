import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp32SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("admin cannot open another vendor form submissions through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const createVendor = (kind: string) => db.vendor.create({ data: { name: `WP32 ${kind} ${suffix}`, slug: `wp32-${kind}-${suffix}`, email: `wp32-${kind}-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } });
  const [ownerVendor, foreignVendor] = await Promise.all([createVendor("owner"), createVendor("foreign")]);
  const [user, ownForm, foreignForm] = await Promise.all([
    db.user.create({ data: { email: `wp32-admin-${suffix}@celebratedeal.test`, name: "WP32 Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "admin", status: "active" } } } }),
    db.registrationForm.create({ data: { vendorId: ownerVendor.id, name: `WP32 Own Form ${suffix}`, slug: `wp32-own-${suffix}`, headline: "Own", fields: [], isActive: true } }),
    db.registrationForm.create({ data: { vendorId: foreignVendor.id, name: `WP32 Foreign Form ${suffix}`, slug: `wp32-foreign-${suffix}`, headline: "Foreign", fields: [], isActive: true } }),
  ]);
  const ownCanary = `wp32-own-${suffix}`;
  const foreignCanary = `wp32-foreign-${suffix}`;
  await Promise.all([
    db.formSubmission.create({ data: { formId: ownForm.id, name: ownCanary, email: `${ownCanary}@example.test`, phone: "0900000001" } }),
    db.formSubmission.create({ data: { formId: foreignForm.id, name: foreignCanary, email: `${foreignCanary}@example.test`, phone: "0900000002" } }),
  ]);
  const before = await Promise.all([db.registrationForm.count({ where: { vendorId: ownerVendor.id } }), db.registrationForm.count({ where: { vendorId: foreignVendor.id } }), db.formSubmission.count({ where: { formId: ownForm.id } }), db.formSubmission.count({ where: { formId: foreignForm.id } })]);
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const ownPath = `/forms/${ownForm.id}/submissions`; const ownResponse = await page.goto(ownPath); expect(ownResponse?.status()).toBe(200); await expect(page.getByRole("heading", { name: `${ownForm.name} 名單` })).toBeVisible(); await expect(page.getByRole("cell", { name: ownCanary, exact: true })).toBeVisible();
    const foreignPath = `/forms/${foreignForm.id}/submissions`; const foreignResponse = await page.goto(foreignPath); expect(foreignResponse?.status()).toBe(404); await expect(page).toHaveURL(new RegExp(`${foreignPath}$`)); await expect(page.getByRole("heading", { name: `${foreignForm.name} 名單` })).toHaveCount(0); await expect(page.getByRole("table")).toHaveCount(0); await expect(page.getByText(foreignCanary)).toHaveCount(0); await expect(page.getByText(`${foreignCanary}@example.test`)).toHaveCount(0); await expect(page.getByText("0900000002")).toHaveCount(0);
    await expect.poll(() => Promise.all([db.registrationForm.count({ where: { vendorId: ownerVendor.id } }), db.registrationForm.count({ where: { vendorId: foreignVendor.id } }), db.formSubmission.count({ where: { formId: ownForm.id } }), db.formSubmission.count({ where: { formId: foreignForm.id } })])).toEqual(before);
  } finally { await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
