import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp39SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

test("owner cannot open another vendor live analytics route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP39 Owner ${suffix}`, slug: `wp39-owner-${suffix}`, email: `wp39-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP39 Foreign ${suffix}`, slug: `wp39-foreign-${suffix}`, email: `wp39-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownLive, foreignLive] = await Promise.all([
    db.user.create({ data: { email: `wp39-owner-${suffix}@celebratedeal.test`, name: "WP39 Owner", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "owner", status: "active" } } } }),
    db.live.create({ data: { vendorId: ownerVendor.id, title: `WP39 Own Live ${suffix}`, slug: `wp39-own-live-${suffix}`, scheduledAt: new Date("2026-01-01T00:00:00.000Z") } }),
    db.live.create({ data: { vendorId: foreignVendor.id, title: `WP39 Foreign Live ${suffix}`, slug: `wp39-foreign-live-${suffix}`, scheduledAt: new Date("2026-01-01T00:00:00.000Z") } }),
  ]);
  const ownVisitor = `wp39-own-visitor-${suffix}`;
  const foreignVisitor = `wp39-foreign-visitor-${suffix}`;
  const ownReferral = `wp39-own-referral-${suffix}`;
  const foreignReferral = `wp39-foreign-referral-${suffix}`;
  const [, foreignEvent] = await Promise.all([
    db.analyticsEvent.create({ data: { vendorId: ownerVendor.id, liveId: ownLive.id, eventType: "page_view", visitorId: ownVisitor, trustLevel: "ADMITTED_LIVE_SESSION" } }),
    db.analyticsEvent.create({ data: { vendorId: foreignVendor.id, liveId: foreignLive.id, eventType: "page_view", visitorId: foreignVisitor, trustLevel: "ADMITTED_LIVE_SESSION" } }),
  ]);
  const [, foreignClick] = await Promise.all([
    db.affiliateClick.create({ data: { vendorId: ownerVendor.id, liveId: ownLive.id, referralCode: ownReferral, visitorId: `wp39-own-click-${suffix}`, landingPath: `/wp39-own-${suffix}` } }),
    db.affiliateClick.create({ data: { vendorId: foreignVendor.id, liveId: foreignLive.id, referralCode: foreignReferral, visitorId: `wp39-foreign-click-${suffix}`, landingPath: `/wp39-foreign-${suffix}` } }),
  ]);
  const snapshot = async () => Promise.all([
    db.live.findUniqueOrThrow({ where: { vendorId_id: { vendorId: ownerVendor.id, id: ownLive.id } } }),
    db.live.findUniqueOrThrow({ where: { vendorId_id: { vendorId: foreignVendor.id, id: foreignLive.id } } }),
    db.analyticsEvent.findMany({ where: { liveId: ownLive.id }, orderBy: { id: "asc" } }),
    db.analyticsEvent.findMany({ where: { liveId: foreignLive.id }, orderBy: { id: "asc" } }),
    db.affiliateClick.findMany({ where: { liveId: ownLive.id }, orderBy: { id: "asc" } }),
    db.affiliateClick.findMany({ where: { liveId: foreignLive.id }, orderBy: { id: "asc" } }),
    db.analyticsEvent.count({ where: { liveId: ownLive.id } }),
    db.analyticsEvent.count({ where: { liveId: foreignLive.id } }),
    db.affiliateClick.count({ where: { liveId: ownLive.id } }),
    db.affiliateClick.count({ where: { liveId: foreignLive.id } }),
  ]);
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const before = await snapshot();

    const ownPath = `/lives/${ownLive.id}/analytics`;
    const ownResponse = await page.goto(ownPath);
    expect(ownResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${ownPath}$`));
    await expect(page.getByRole("heading", { name: `${ownLive.title} 分析` })).toBeVisible();
    for (const heading of ["轉換漏斗", "最近事件", "聯盟來源"]) await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByText(`${ownVisitor.slice(0, 12)}…`)).toBeVisible();
    await expect(page.getByText(ownVisitor, { exact: true })).toHaveCount(0);
    await expect(page.getByText(ownReferral, { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^觀看：1，/)).toBeVisible();

    const foreignPath = `/lives/${foreignLive.id}/analytics`;
    const foreignCanaries = [foreignLive.title, foreignVisitor, foreignReferral, foreignEvent.id, foreignClick.id];
    await navigateAndAssertDirectUrlGuard({
      page,
      path: foreignPath,
      routeIdentityCanaries: [foreignLive.id],
      protectedPayloadCanaries: foreignCanaries,
      documentCanaries: foreignCanaries,
      finalUrl: new RegExp(`${foreignPath}$`),
      transport: {
        kind: "streaming-not-found",
        status: 200,
      },
      finalStatus: 200,
    });
    for (const heading of [`${foreignLive.title} 分析`, "最近事件", "聯盟來源"]) await expect(page.getByRole("heading", { name: heading })).toHaveCount(0);
    for (const value of foreignCanaries) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    const documentContent = await page.content();
    for (const value of foreignCanaries) expect(documentContent).not.toContain(value);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
