import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Synthetic public replay only; no checkout, payment or sign-in is exercised.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);

const fixtureVideo = path.join(process.cwd(), "scripts/fixtures/staging-stream-one-second.mp4");
const screenshotDir = process.env.LIVE_PLAYBACK_SCREENSHOT_DIR;
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

test("replay viewers can reach play/pause above the chat and tabs, and the timed product appears", async ({ page }) => {
  const db = new PrismaClient({ log: [] });
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "合成回放工作室", slug: `replay-controls-${suffix}`,
    email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  try {
    const product = await db.product.create({ data: { vendorId: vendor.id, name: "回放合成商品", slug: `replay-product-${suffix}`,
      priceCents: 990, isActive: true, fulfillmentTypeConfirmed: true, fulfillmentType: "physical", commerceDomain: "merchant" } });
    const video = await db.video.create({ data: { vendorId: vendor.id, title: "合成回放影片", videoUrl: "https://video.example.test/replay.mp4",
      sourceType: "url", status: "ready", durationSec: 1 } });
    const script = await db.interactionScript.create({ data: { vendorId: vendor.id, name: "合成回放腳本", status: "published",
      events: { create: { eventType: "product_spotlight", triggerSec: 0, title: "回放商品", productId: product.id } } } });
    // A bound valid form turns on chat, reproducing the panels that covered the native controls.
    const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "合成表單", slug: `replay-form-${suffix}`,
      headline: "合成報名", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
    const template = await db.messageTemplate.create({ data: { vendorId: vendor.id, name: "合成確認", channel: "email",
      trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} {{unsubscribe_url}}", isActive: true } });
    const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, formId: form.id, messageTemplateId: template.id, interactionScriptId: script.id,
      title: "合成回放場次", slug: `replay-live-${suffix}`, scheduledAt: new Date(Date.now() - 60 * 60_000),
      status: "live", streamMode: "vod", replayEnabled: true,
      products: { create: { productId: product.id, isPinned: true } } } });
    await page.route("https://video.example.test/**", (route) => route.fulfill({ path: fixtureVideo, contentType: "video/mp4" }));

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/live/${live.slug}`);
      await expect(page.getByText("精彩回放").first()).toBeVisible();

      const play = page.getByRole("button", { name: "播放影片" });
      await expect(play).toBeVisible();
      // The top-most element at the button's centre must be the button itself,
      // i.e. no chat, private-message or tab layer covers it.
      const box = await play.boundingBox();
      if (!box) throw new Error("Expected a laid-out play button");
      const hitIsButton = await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit?.closest("[data-testid='live-playback-toggle']"));
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      expect(hitIsButton).toBe(true);
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `replay-${viewport.name}-paused.png`) });

      await play.click();
      await expect.poll(() => page.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime > 0 || element.ended)).toBe(true);
      await expect(page.getByRole("button", { name: "購買" }).or(page.getByRole("button", { name: "立即搶購" })).first()).toBeVisible();
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `replay-${viewport.name}-product.png`) });
    }
  } finally {
    await db.vendor.delete({ where: { id: vendor.id } });
    await db.$disconnect();
  }
});
