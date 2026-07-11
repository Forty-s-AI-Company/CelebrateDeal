import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
let vendorId = "";
let planId = "";
let courseSlug = "";

test.beforeAll(async ({}, workerInfo) => {
  const suffix = `${workerInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const plan = await db.billingPlan.create({
    data: { name: "Visual Course Plan", code: `visual-course-plan-${suffix}`, includedNotificationEmails: 20 },
  });
  const vendor = await db.vendor.create({
    data: {
      name: "賀成交學院",
      slug: `visual-course-vendor-${suffix}`,
      email: `visual-course-${suffix}@example.test`,
      passwordHash: "test",
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      subscriptions: { create: { planId: plan.id, status: "active" } },
      usageLimit: { create: { billingPlanId: plan.id, notificationEmailsLimit: 20, resetAt: new Date(Date.now() + 86_400_000) } },
    },
  });
  const [form, product, video] = await Promise.all([
    db.registrationForm.create({ data: { vendorId: vendor.id, name: "課程報名", slug: `visual-course-form-${suffix}`, headline: "立即報名", submitLabel: "保留名額", successMessage: "已收到你的課程報名", fields: [] } }),
    db.product.create({ data: { vendorId: vendor.id, name: "直播成交實戰班", slug: `visual-course-product-${suffix}`, priceCents: 1280000, inventory: 30, isActive: true } }),
    db.video.create({ data: { vendorId: vendor.id, title: "課程預覽", videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", status: "ready" } }),
  ]);
  const course = await db.course.create({
    data: {
      vendorId: vendor.id,
      registrationFormId: form.id,
      defaultProductId: product.id,
      title: "把直播流量變成可追蹤的成交流程",
      slug: `visual-course-${suffix}`,
      description: "從銷講節奏、名單收集到商品 CTA 與聯盟歸因，建立一套可以重複執行的直播導購系統。",
      status: "published",
      publishedAt: new Date("2026-07-11T00:00:00Z"),
      lessons: {
        create: [
          { videoId: video.id, title: "01｜設計一場能轉換的銷講", description: "拆解開場、價值鋪陳與 CTA 節奏。", sortOrder: 1, status: "published", isPreview: true },
          { title: "02｜名單、歸因與通知自動化", description: "把每一次報名與來源保留下來。", sortOrder: 2, status: "published" },
          { title: "03｜商品浮出與成交後對帳", description: "從商品點擊一路追到付款與退款。", sortOrder: 3, status: "published" },
        ],
      },
      sessions: {
        create: { title: "七月實戰場", startsAt: new Date("2026-07-25T12:00:00Z"), status: "scheduled", capacity: 50 },
      },
    },
  });
  vendorId = vendor.id;
  planId = plan.id;
  courseSlug = course.slug;
});

test.afterAll(async () => {
  if (vendorId) await db.vendor.deleteMany({ where: { id: vendorId } });
  if (planId) await db.billingPlan.deleteMany({ where: { id: planId } });
  await db.$disconnect();
});

test("public course sales page visual baseline", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/course/${courseSlug}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "把直播流量變成可追蹤的成交流程" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("public-course-page.png", {
    fullPage: true,
    animations: "disabled",
    caret: "initial",
    stylePath: "tests/visual/snapshot.css",
    maxDiffPixelRatio: 0.015,
  });
});
