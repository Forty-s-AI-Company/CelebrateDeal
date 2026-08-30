import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const runId = randomUUID();
const externalCheckoutUrl = "https://external.wp2.test/checkout";
const fixture = {
  vendorId: "",
  videoId: "",
  formId: "",
  registrationTemplateId: "",
  reminderTemplateId: "",
  scriptId: "",
  externalProductId: "",
  internalProductId: "",
  liveId: "",
  slug: `wp2-spotlight-${runId}`,
};

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: `WP2 Spotlight Vendor ${runId}`,
      slug: `wp2-spotlight-vendor-${runId}`,
      email: `wp2-spotlight-${runId}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  fixture.vendorId = vendor.id;

  const [video, form, registrationTemplate, reminderTemplate, externalProduct, internalProduct] = await Promise.all([
    db.video.create({
      data: {
        vendorId: vendor.id,
        title: "WP2 spotlight VOD",
        videoUrl: "https://video.example.test/wp2-spotlight.mp4",
        sourceType: "url",
        status: "ready",
        durationSec: 600,
      },
    }),
    db.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: `WP2 spotlight form ${runId}`,
        slug: `wp2-spotlight-form-${runId}`,
        headline: "WP2 spotlight form",
        fields: [
          { key: "name", label: "姓名", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      },
    }),
    db.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: `WP2 registration template ${runId}`,
        channel: "email",
        trigger: "registration_confirmed",
        subject: "{{live_title}} 報名成功",
        body: "{{name}} {{unsubscribe_url}}",
        isActive: true,
      },
    }),
    db.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: `WP2 reminder template ${runId}`,
        channel: "email",
        trigger: "live_reminder",
        subject: "{{live_title}} 即將開始",
        body: "{{name}} {{live_url}} {{unsubscribe_url}}",
        isActive: true,
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: "WP2 外連商品",
        slug: `wp2-external-product-${runId}`,
        priceCents: 12_000,
        inventory: 10,
        checkoutUrl: externalCheckoutUrl,
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: "WP2 平台內商品",
        slug: `wp2-internal-product-${runId}`,
        priceCents: 8_000,
        inventory: 10,
        checkoutUrl: null,
      },
    }),
  ]);
  Object.assign(fixture, {
    videoId: video.id,
    formId: form.id,
    registrationTemplateId: registrationTemplate.id,
    reminderTemplateId: reminderTemplate.id,
    externalProductId: externalProduct.id,
    internalProductId: internalProduct.id,
  });

  const script = await db.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: `WP2 spotlight script ${runId}`,
      status: "published",
      events: {
        create: {
          eventType: "product_spotlight",
          triggerSec: 5,
          title: "外連商品推薦",
          productId: externalProduct.id,
        },
      },
    },
  });
  fixture.scriptId = script.id;

  const startedAt = new Date(Date.now() - 30_000);
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: registrationTemplate.id,
      liveReminderTemplateId: reminderTemplate.id,
      interactionScriptId: script.id,
      title: "WP2 spotlight checkout",
      slug: fixture.slug,
      scheduledAt: startedAt,
      startedAt,
      status: "live",
      streamMode: "vod",
      replayEnabled: true,
      products: {
        create: [
          { productId: externalProduct.id, sortOrder: 0, isPinned: true },
          { productId: internalProduct.id, sortOrder: 1 },
        ],
      },
    },
  });
  fixture.liveId = live.id;
});

test.afterAll(async () => {
  try {
    if (fixture.vendorId) {
      await db.liveViewerSession.deleteMany({ where: { vendorId: fixture.vendorId } });
      await db.live.deleteMany({ where: { id: fixture.liveId } });
      await db.interactionScript.deleteMany({ where: { id: fixture.scriptId } });
      await db.product.deleteMany({ where: { id: { in: [fixture.externalProductId, fixture.internalProductId] } } });
      await db.registrationForm.deleteMany({ where: { id: fixture.formId } });
      await db.messageTemplate.deleteMany({ where: { id: { in: [fixture.registrationTemplateId, fixture.reminderTemplateId] } } });
      await db.video.deleteMany({ where: { id: fixture.videoId } });
      await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
    }
  } finally {
    await db.$disconnect();
  }
});

test("gates an event-driven external checkout while internal checkout stays immediate", async ({ page }) => {
  const productClickProductIds: string[] = [];
  let externalNavigationCount = 0;
  await page.route("https://external.wp2.test/**", async (route) => {
    externalNavigationCount += 1;
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>WP2 synthetic external checkout</title>" });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname !== "/api/analytics" || request.method() !== "POST") return;
    const body = request.postDataJSON() as { eventType?: string; payload?: { productId?: string } };
    if (body.eventType === "product_click" && body.payload?.productId) productClickProductIds.push(body.payload.productId);
  });

  const livePath = `/live/${fixture.slug}`;
  const response = await page.goto(livePath, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const video = page.locator("video");
  await expect(video).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: /推薦商品/u })).toHaveCount(0);

  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    const scope = window as typeof window & { __wp2PauseCount?: number; __wp2PlayCount?: number; __wp2Video?: HTMLVideoElement };
    scope.__wp2PauseCount = 0;
    scope.__wp2PlayCount = 0;
    scope.__wp2Video = media;
    Object.defineProperty(media, "readyState", { configurable: true, value: 1 });
    Object.defineProperty(media, "paused", { configurable: true, get: () => true });
    media.pause = () => { scope.__wp2PauseCount = (scope.__wp2PauseCount ?? 0) + 1; };
    media.play = () => {
      scope.__wp2PlayCount = (scope.__wp2PlayCount ?? 0) + 1;
      return Promise.resolve();
    };
    media.currentTime = 4;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(page.getByRole("complementary", { name: /推薦商品/u })).toHaveCount(0);
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    media.currentTime = 5;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });

  const spotlight = page.getByRole("complementary", { name: "推薦商品：WP2 外連商品" });
  await expect(spotlight).toBeVisible();
  const ordersBeforeIntent = await db.commerceOrder.count({ where: { vendorId: fixture.vendorId } });
  await spotlight.getByRole("button", { name: "立即搶購" }).click();
  const dialog = page.getByRole("dialog", { name: "前往外部商品頁？" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("離開後直播聲音會中斷");
  const cancelButton = dialog.getByRole("button", { name: "留在直播" });
  await expect(cancelButton).toBeFocused();
  await expect.poll(() => video.evaluate(() => (window as typeof window & { __wp2PauseCount?: number }).__wp2PauseCount)).toBe(1);
  expect(productClickProductIds.filter((id) => id === fixture.externalProductId)).toHaveLength(0);
  expect(externalNavigationCount).toBe(0);
  expect(await db.commerceOrder.count({ where: { vendorId: fixture.vendorId } })).toBe(ordersBeforeIntent);

  await cancelButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(spotlight.getByRole("button", { name: "立即搶購" })).toBeFocused();
  await expect.poll(() => video.evaluate(() => (window as typeof window & { __wp2PlayCount?: number }).__wp2PlayCount)).toBe(0);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  expect(productClickProductIds.filter((id) => id === fixture.externalProductId)).toHaveLength(0);
  expect(externalNavigationCount).toBe(0);
  expect(await db.commerceOrder.count({ where: { vendorId: fixture.vendorId } })).toBe(ordersBeforeIntent);

  await spotlight.getByRole("button", { name: "立即搶購" }).click();
  await expect(dialog).toBeVisible();
  await expect(cancelButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "確認前往" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(spotlight.getByRole("button", { name: "立即搶購" })).toBeFocused();
  await expect.poll(() => video.evaluate(() => (window as typeof window & { __wp2PlayCount?: number }).__wp2PlayCount)).toBe(0);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await expect.poll(() => video.evaluate(() => (window as typeof window & { __wp2PauseCount?: number }).__wp2PauseCount)).toBe(2);
  expect(productClickProductIds.filter((id) => id === fixture.externalProductId)).toHaveLength(0);
  expect(externalNavigationCount).toBe(0);
  expect(await db.commerceOrder.count({ where: { vendorId: fixture.vendorId } })).toBe(ordersBeforeIntent);

  await page.getByRole("button", { name: "商品", exact: true }).click();
  const internalProduct = page.getByRole("article").filter({ hasText: "WP2 平台內商品" });
  await internalProduct.getByRole("button", { name: "購買" }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${fixture.vendorId}/${fixture.internalProductId}$`, "u"));
  await expect(page.getByRole("dialog", { name: "前往外部商品頁？" })).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(1);
  await expect.poll(() => page.locator("video").evaluate((element) => (
    (window as typeof window & { __wp2Video?: HTMLVideoElement }).__wp2Video === element
  ))).toBe(true);

  await page.getByTestId("persistent-live-player").getByRole("button", { name: "返回直播", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${livePath}$`, "u"));
  await page.getByRole("button", { name: "立即搶購" }).click();
  const confirm = page.getByRole("button", { name: "確認前往" });
  await confirm.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });

  await expect.poll(() => externalNavigationCount).toBe(1);
  await expect.poll(() => productClickProductIds.filter((id) => id === fixture.externalProductId)).toHaveLength(1);
  expect(await db.commerceOrder.count({ where: { vendorId: fixture.vendorId } })).toBe(ordersBeforeIntent);
});
