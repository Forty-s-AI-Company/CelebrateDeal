import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const AUTH_COOKIE = "celebrate_session";
let vendorId = "";
let userId = "";
let planId = "";
let sessionId = "";
let sessionToken = "";

test.beforeAll(async ({}, workerInfo) => {
  const suffix = `${workerInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `visual-owner-${suffix}@example.test`;
  const plan = await db.billingPlan.create({
    data: { name: "Growth", code: `visual-ops-plan-${suffix}`, includedEvents: 20, includedAffiliates: 20, includedCredits: 1000, includedNotificationEmails: 100 },
  });
  const user = await db.user.create({ data: { email, name: "林營運", passwordHash: "visual-fixture-only" } });
  const vendor = await db.vendor.create({
    data: {
      name: "賀成交品牌營運中心",
      slug: `visual-ops-vendor-${suffix}`,
      email: `visual-ops-${suffix}@example.test`,
      passwordHash: "test",
      onboardingStatus: "completed",
      onboardingCompletedAt: new Date("2026-07-01T00:00:00Z"),
      members: { create: { userId: user.id, role: "owner", status: "active" } },
      subscriptions: { create: { planId: plan.id, status: "active", startedAt: new Date("2026-07-01T00:00:00Z") } },
      usageLimit: { create: { billingPlanId: plan.id, streamMinutesLimit: 2000, storageMinutesLimit: 500, creditsLimit: 1000, creditsUsed: 320, notificationEmailsLimit: 100, notificationEmailsUsed: 24, resetAt: new Date("2026-08-01T00:00:00Z") } },
    },
  });
  const [form, product, video] = await Promise.all([
    db.registrationForm.create({ data: { vendorId: vendor.id, name: "新品說明會報名", slug: `visual-ops-form-${suffix}`, headline: "預約新品說明會", fields: [] } }),
    db.product.create({ data: { vendorId: vendor.id, name: "品牌成交實戰方案", slug: `visual-ops-product-${suffix}`, priceCents: 680000, inventory: 50 } }),
    db.video.create({ data: { vendorId: vendor.id, title: "品牌銷講主片", videoUrl: "https://example.test/video.mp4", status: "ready" } }),
  ]);
  await Promise.all([
    db.live.create({ data: { vendorId: vendor.id, formId: form.id, videoId: video.id, title: "七月新品成交場", slug: `visual-ops-live-a-${suffix}`, scheduledAt: new Date("2026-07-25T12:00:00Z"), status: "scheduled", products: { create: { productId: product.id, sortOrder: 1 } } } }),
    db.live.create({ data: { vendorId: vendor.id, title: "六月會員回放", slug: `visual-ops-live-b-${suffix}`, scheduledAt: new Date("2026-06-20T12:00:00Z"), status: "ended" } }),
    db.affiliate.create({ data: { vendorId: vendor.id, name: "社群推廣夥伴", code: `VOPS${suffix}`.toUpperCase(), commissionRateBps: 800 } }),
    db.course.create({ data: { vendorId: vendor.id, registrationFormId: form.id, defaultProductId: product.id, title: "直播成交系統課", slug: `visual-ops-course-${suffix}`, description: "從報名到商品 CTA 的營運流程。", status: "draft", createdAt: new Date("2026-07-05T00:00:00Z"), updatedAt: new Date("2026-07-05T00:00:00Z") } }),
  ]);
  await db.analyticsEvent.createMany({ data: Array.from({ length: 8 }, (_, index) => ({ vendorId: vendor.id, eventType: index < 5 ? "page_view" : "product_click", visitorId: `visual-${index}`, createdAt: new Date("2026-07-10T00:00:00Z") })) });
  sessionToken = randomBytes(32).toString("base64url");
  const session = await db.userSession.create({
    data: {
      userId: user.id,
      vendorId: vendor.id,
      tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  vendorId = vendor.id;
  userId = user.id;
  planId = plan.id;
  sessionId = session.id;
});

test.afterAll(async () => {
  if (sessionId) await db.userSession.deleteMany({ where: { id: sessionId } });
  if (vendorId) {
    await db.auditLog.deleteMany({ where: { vendorId } });
    await db.vendor.deleteMany({ where: { id: vendorId } });
  }
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  if (planId) await db.billingPlan.deleteMany({ where: { id: planId } });
  await db.$disconnect();
});

test.beforeEach(async ({ context, baseURL, page }) => {
  await context.addCookies([{
    name: AUTH_COOKIE,
    value: sessionToken,
    url: baseURL ?? "http://127.0.0.1:31023",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const route of ["/dashboard", "/settings/team", "/courses"] as const) {
  test(`${route} operations visual baseline`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot(`${route.slice(1).replaceAll("/", "-")}-page.png`, {
      fullPage: true,
      animations: "disabled",
      caret: "initial",
      stylePath: "tests/visual/snapshot.css",
      maxDiffPixelRatio: 0.015,
      mask: [
        page.getByText(/visual-owner-/).first(),
        page.getByText(/VOPS/).first(),
      ],
      maskColor: "#e2e8f0",
    });
  });
}
