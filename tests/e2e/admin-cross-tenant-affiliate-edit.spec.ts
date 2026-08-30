import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp36SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("admin cannot open another vendor affiliate edit route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP36 Owner ${suffix}`, slug: `wp36-owner-${suffix}`, email: `wp36-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP36 Foreign ${suffix}`, slug: `wp36-foreign-${suffix}`, email: `wp36-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownAffiliate, foreignAffiliate] = await Promise.all([
    db.user.create({ data: { email: `wp36-admin-${suffix}@celebratedeal.test`, name: "WP36 Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "admin", status: "active" } } } }),
    db.affiliate.create({ data: { vendorId: ownerVendor.id, name: `WP36 Own ${suffix}`, code: `wp36own${suffix}`, source: `own-source-${suffix}`, contactEmail: `wp36-own-${suffix}@example.test`, commissionRateBps: 321, isActive: true } }),
    db.affiliate.create({ data: { vendorId: foreignVendor.id, name: `WP36 Foreign ${suffix}`, code: `wp36foreign${suffix}`, source: `foreign-source-${suffix}`, contactEmail: `wp36-foreign-${suffix}@example.test`, commissionRateBps: 987, isActive: true } }),
  ]);
  const ownPathCanary = `/wp36-own-${suffix}`; const foreignPathCanary = `/wp36-foreign-${suffix}`;
  await Promise.all([
    db.affiliateClick.create({ data: { vendorId: ownerVendor.id, affiliateId: ownAffiliate.id, referralCode: ownAffiliate.code, visitorId: `wp36-own-visitor-${suffix}`, landingPath: ownPathCanary } }),
    db.affiliateClick.create({ data: { vendorId: foreignVendor.id, affiliateId: foreignAffiliate.id, referralCode: foreignAffiliate.code, visitorId: `wp36-foreign-visitor-${suffix}`, landingPath: foreignPathCanary } }),
  ]);
  const snapshot = async () => Promise.all([db.affiliate.findUniqueOrThrow({ where: { id: ownAffiliate.id } }), db.affiliate.findUniqueOrThrow({ where: { id: foreignAffiliate.id } }), db.affiliateClick.findMany({ where: { affiliateId: ownAffiliate.id }, orderBy: { id: "asc" } }), db.affiliateClick.findMany({ where: { affiliateId: foreignAffiliate.id }, orderBy: { id: "asc" } }), db.affiliate.count({ where: { vendorId: ownerVendor.id } }), db.affiliate.count({ where: { vendorId: foreignVendor.id } }), db.affiliateClick.count({ where: { affiliateId: ownAffiliate.id } }), db.affiliateClick.count({ where: { affiliateId: foreignAffiliate.id } })]);
  const before = await snapshot();
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const ownPath = `/affiliates/${ownAffiliate.id}/edit`; const ownResponse = await page.goto(ownPath); expect(ownResponse?.status()).toBe(200); await expect(page).toHaveURL(new RegExp(`${ownPath}$`)); await expect(page.getByRole("heading", { name: "編輯聯盟夥伴" })).toBeVisible(); await expect(page.getByLabel("夥伴名稱")).toHaveValue(ownAffiliate.name); await expect(page.getByRole("textbox", { name: "推廣碼", exact: true })).toHaveValue(ownAffiliate.code); await expect(page.getByLabel("來源渠道")).toHaveValue(ownAffiliate.source ?? ""); await expect(page.getByLabel("聯絡 Email")).toHaveValue(ownAffiliate.contactEmail ?? ""); await expect(page.getByLabel("佣金 BPS")).toHaveValue(String(ownAffiliate.commissionRateBps)); await expect(page.getByText(ownPathCanary, { exact: true })).toBeVisible();
    const foreignPath = `/affiliates/${foreignAffiliate.id}/edit`;
    const foreignCanaries = [foreignAffiliate.name, foreignAffiliate.code, foreignAffiliate.source ?? "", foreignAffiliate.contactEmail ?? "", foreignPathCanary];
    const { finalResponse: foreignResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path: foreignPath,
      routeIdentityCanaries: [foreignAffiliate.id, foreignPath],
      protectedPayloadCanaries: foreignCanaries,
      documentCanaries: foreignCanaries,
      finalUrl: new RegExp(`${foreignPath}$`),
      transport: { kind: "streaming-not-found", status: 200 },
      finalStatus: 200,
    });
    expect(foreignResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${foreignPath}$`));
    for (const heading of ["編輯聯盟夥伴", "最近來源事件"]) await expect(page.getByRole("heading", { name: heading })).toHaveCount(0); for (const label of ["夥伴名稱", "來源渠道", "聯絡 Email", "佣金 BPS"]) await expect(page.getByLabel(label)).toHaveCount(0); await expect(page.getByRole("textbox", { name: "推廣碼", exact: true })).toHaveCount(0); for (const value of foreignCanaries) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    await expect.poll(snapshot).toEqual(before);
  } finally { await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
