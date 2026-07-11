import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
let vendorId = "";
let liveSlug = "";

test.beforeAll(async ({}, workerInfo) => {
  const suffix = `${workerInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const vendor = await db.vendor.create({
    data: {
      name: "賀成交選品直播",
      slug: `visual-vendor-${suffix}`,
      email: `visual-${suffix}@example.test`,
      passwordHash: "test",
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
    },
  });
  const product = await db.product.create({
    data: {
      vendorId: vendor.id,
      name: "直播限定保養組",
      slug: `visual-product-${suffix}`,
      description: "今晚限定組合，適合第一次體驗的顧客。",
      priceCents: 168000,
      compareAtCents: 228000,
      inventory: 20,
      isActive: true,
    },
  });
  const video = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "夏日保養直播畫面",
      sourceType: "cloudflare_stream",
      videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      status: "ready",
      cloudflareReadyToStream: true,
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      title: "夏日保養成交夜",
      slug: `visual-live-${suffix}`,
      description: "跟著官方顧問完成今晚的保養選品。",
      accentCopy: "直播限定優惠",
      status: "live",
      scheduledAt: new Date("2026-07-10T12:00:00.000Z"),
      products: { create: [{ productId: product.id, sortOrder: 1, isPinned: true, offerLabel: "限時組合" }] },
    },
  });
  vendorId = vendor.id;
  liveSlug = live.slug;
});

test.afterAll(async () => {
  if (vendorId) await db.vendor.deleteMany({ where: { id: vendorId } });
  await db.$disconnect();
});

test("public live commerce visual baseline", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const analyticsResponse = page.waitForResponse((response) => response.url().includes("/api/analytics") && response.request().method() === "POST");
  await page.goto(`/live/${liveSlug}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("夏日保養成交夜")).toBeVisible();
  await expect((await analyticsResponse).status()).toBe(200);
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await video.evaluate(async (element) => {
    const media = element as HTMLVideoElement;
    if (media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Visual fixture video did not load")), 15_000);
        media.addEventListener("loadeddata", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
        media.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("Visual fixture video failed")); }, { once: true });
      });
    }
    media.pause();
    const target = Number.isFinite(media.duration) ? Math.min(1, Math.max(0, media.duration - 0.1)) : 1;
    if (Math.abs(media.currentTime - target) > 0.05) {
      await new Promise<void>((resolve) => {
        media.addEventListener("seeked", () => resolve(), { once: true });
        media.currentTime = target;
      });
    }
  });
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("public-live-page.png", {
    fullPage: true,
    animations: "disabled",
    caret: "initial",
    stylePath: "tests/visual/snapshot.css",
    maxDiffPixelRatio: 0.015,
  });
});
