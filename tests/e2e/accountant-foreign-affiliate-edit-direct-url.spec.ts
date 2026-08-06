import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp47SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied a foreign affiliate editor before tenant lookup", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP36 Owner ${suffix}`, slug: `wp36-owner-${suffix}`, email: `wp36-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP36 Foreign ${suffix}`, slug: `wp36-foreign-${suffix}`, email: `wp36-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownAffiliate, foreignAffiliate] = await Promise.all([
    db.user.create({ data: { email: `wp47-accountant-${suffix}@celebratedeal.test`, name: "WP47 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "accountant", status: "active" } } } }),
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
    const requests: string[] = []; const responses: { url: string; status: number; location: string | null }[] = [];
    page.on("request", (request) => requests.push(request.url())); page.on("response", (response) => responses.push({ url: response.url(), status: response.status(), location: response.headers()["location"] ?? null }));
    const foreignPath = `/affiliates/${foreignAffiliate.id}/edit`; const response = await page.goto(foreignPath); const guard = responses.find((entry) => new URL(entry.url).pathname === foreignPath);
    expect(guard).toMatchObject({ status: 307, location: "/dashboard?error=insufficient_role" }); expect(response?.status()).toBe(200); await expect(page).toHaveURL("/dashboard?error=insufficient_role"); await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    for (const heading of ["編輯聯盟夥伴", "最近來源事件"]) await expect(page.getByRole("heading", { name: heading })).toHaveCount(0); for (const label of ["夥伴名稱", "來源渠道", "聯絡 Email", "佣金 BPS"]) await expect(page.getByLabel(label)).toHaveCount(0); await expect(page.getByRole("textbox", { name: "推廣碼", exact: true })).toHaveCount(0); for (const value of [foreignAffiliate.name, foreignAffiliate.code, foreignAffiliate.source ?? "", foreignAffiliate.contactEmail ?? "", foreignPathCanary]) await expect(page.getByText(value, { exact: true })).toHaveCount(0); expect(requests.some((url) => /^https:\/\/(?!127\.0\.0\.1|localhost)/i.test(url) || /resend|payuni|cloudflare|sentry|posthog/i.test(url))).toBe(false);
    await expect.poll(snapshot).toEqual(before);
  } finally { await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
