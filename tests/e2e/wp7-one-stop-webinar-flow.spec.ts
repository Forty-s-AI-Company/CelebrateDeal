import { randomUUID } from "node:crypto";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { revealEmailDeliveryPayload } from "../../src/lib/email-delivery-pii";
import { processDuePostLiveFollowups } from "../../src/lib/email-delivery";

const db = new PrismaClient();
const runId = randomUUID();
const fixture = {
  vendorId: "",
  formId: "",
  formSlug: "",
  videoId: "",
  liveId: "",
  productId: "",
  scriptId: "",
  roleId: "",
  slug: `wp7-one-stop-${runId}`,
};

async function expectNoBlockingAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = result.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.map((selector) => (
        String(selector).split(" > ").slice(-3).join(" > ")
      ))),
    }));

  if (blocking.length > 0) {
    throw new Error(`AXE_BLOCKING:${JSON.stringify(blocking)}`);
  }
}

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: `WP7 One-stop Vendor ${runId}`,
      slug: `wp7-one-stop-vendor-${runId}`,
      email: `wp7-merchant-${runId}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  fixture.vendorId = vendor.id;

  const [form, video, registrationTemplate, reminderTemplate, followupTemplate, product] = await Promise.all([
    db.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: `WP7 registration ${runId}`,
        slug: `wp7-registration-${runId}`,
        headline: "WP7 單一場次報名",
        submitLabel: "完成 WP7 報名",
        successMessage: "已收到報名，請完成 Email 驗證。",
        fields: [
          { key: "name", label: "姓名", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      },
    }),
    db.video.create({
      data: {
        vendorId: vendor.id,
        title: "WP7 disposable VOD",
        videoUrl: "https://video.example.test/wp7-one-stop.mp4",
        sourceType: "url",
        status: "ready",
        durationSec: 600,
      },
    }),
    db.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: `WP7 registration confirmation ${runId}`,
        channel: "email",
        trigger: "registration_confirmed",
        subject: "{{live_title}} 報名成功",
        body: "{{name}} 已完成報名。{{unsubscribe_url}}",
        isActive: true,
      },
    }),
    db.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: `WP7 reminder ${runId}`,
        channel: "email",
        trigger: "live_reminder",
        subject: "{{live_title}} 即將開始",
        body: "{{name}} {{live_url}} {{unsubscribe_url}}",
        isActive: true,
      },
    }),
    db.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: `WP7 post-live followup ${runId}`,
        channel: "email",
        trigger: "post_live_followup",
        subject: "{{live_title}} 課後通知",
        body: "{{name}} {{unsubscribe_url}}",
        isActive: true,
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: "WP7 直播內商品",
        slug: `wp7-product-${runId}`,
        priceCents: 1_200,
        inventory: 5,
        checkoutUrl: null,
        fulfillmentType: "physical",
      },
    }),
  ]);
  Object.assign(fixture, { formId: form.id, formSlug: form.slug, videoId: video.id, productId: product.id });

  const role = await db.interactionRole.create({
    data: {
      vendorId: vendor.id,
      name: `WP7 官方主持人 ${runId}`,
      label: "官方角色",
      roleType: "official",
      isActive: true,
      isScheduled: true,
    },
  });
  fixture.roleId = role.id;

  const script = await db.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: `WP7 one-stop script ${runId}`,
      status: "published",
      events: {
        create: [
          {
            roleId: role.id,
            eventType: "chat_message",
            triggerSec: 3,
            title: "WP7 排程聊天室訊息",
            message: "WP7 預定聊天室訊息",
          },
          { eventType: "product_spotlight", triggerSec: 5, title: "WP7 內部商品推薦", productId: product.id },
        ],
      },
    },
  });
  fixture.scriptId = script.id;

  const scheduledAt = new Date(Date.now() - 30_000);
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: registrationTemplate.id,
      liveReminderTemplateId: reminderTemplate.id,
      interactionScriptId: script.id,
      title: "WP7 單一場次直播",
      slug: fixture.slug,
      scheduledAt,
      startedAt: scheduledAt,
      status: "live",
      streamMode: "vod",
      replayEnabled: true,
      products: { create: { productId: product.id, sortOrder: 0, isPinned: true } },
    },
  });
  fixture.liveId = live.id;
  await db.liveNotificationRule.create({
    data: {
      vendorId: vendor.id,
      liveId: live.id,
      messageTemplateId: followupTemplate.id,
      trigger: "post_live_followup",
      offsetMinutes: 0,
    },
  });
});

test.afterAll(async () => {
  try {
    if (fixture.vendorId) await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  } finally {
    await db.$disconnect();
  }
});

test("one stop webinar verifies registration, preserves live playback through demo checkout, and materializes one follow-up", async ({ page }) => {
  let pageErrorCount = 0;
  let liveAdmissionRequestCount = 0;
  let playbackSourceRequestCount = 0;
  page.on("pageerror", () => { pageErrorCount += 1; });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/live-admission" && request.method() === "POST") liveAdmissionRequestCount += 1;
    if (path === "/api/live-playback-source" && request.method() === "GET") playbackSourceRequestCount += 1;
  });
  const livePath = `/live/${fixture.slug}`;
  const registrationResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/form-submissions" && response.request().method() === "POST"
  ));
  const formResponse = await page.goto(`/form/${fixture.formSlug}`, { waitUntil: "domcontentloaded" });
  expect(formResponse?.status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: join(process.env.G7_COMMERCE_SCREENSHOT_DIR!, "wp7-registration-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: join(process.env.G7_COMMERCE_SCREENSHOT_DIR!, "wp7-registration.png"), fullPage: true });
  const announcement = page.getByRole("dialog", { name: "進站最新消息" });
  await expect(announcement).toBeVisible();
  await announcement.getByRole("checkbox", { name: "今日不再提醒" }).check();
  await announcement.getByRole("button", { name: "關閉最新消息" }).click();
  await expect(announcement).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "WP7 單一場次報名", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "完成 WP7 報名", exact: true })).toBeVisible();
  await page.getByLabel("姓名").fill("WP7 Lead");
  await page.getByLabel("Email").fill(`wp7-lead-${runId}@example.test`);
  await page.getByRole("button", { name: "完成 WP7 報名", exact: true }).click();
  const registrationResponseResult = await registrationResponse;
  const registrationResponseBody = await registrationResponseResult.json().catch(() => null) as { error?: unknown } | null;
  const registrationRequestHeaders = await registrationResponseResult.request().allHeaders();
  expect(registrationResponseResult.status(), JSON.stringify({
    body: registrationResponseBody,
    pageUrl: page.url(),
    requestUrl: registrationResponseResult.url(),
    origin: registrationRequestHeaders.origin,
    host: registrationRequestHeaders.host,
    referer: registrationRequestHeaders.referer,
  })).toBe(200);
  await expect(page.getByText("請到 Email 開啟確認連結；完成確認後才會列入正式名單。", { exact: true })).toBeVisible();

  await expect.poll(async () => await db.formSubmission.count({
    where: { liveId: fixture.liveId },
  })).toBe(1);
  const submission = await db.formSubmission.findFirstOrThrow({
    where: { liveId: fixture.liveId },
    select: { id: true, verificationStatus: true },
  });
  const submissionId = submission.id;
  expect(submission.verificationStatus).toBe("UNVERIFIED");
  const verificationDelivery = await db.emailDelivery.findFirstOrThrow({
    where: { vendorId: fixture.vendorId, sourceFormSubmissionId: submissionId, trigger: "form_submission_verification" },
    select: { id: true, status: true, payloadEncryptedEnvelope: true },
  });
  expect(verificationDelivery.status).toBe("queued");

  // The URL is only held in memory for the loopback browser navigation. It is
  // deliberately never logged, persisted, or included in assertion messages.
  const verificationPayload = revealEmailDeliveryPayload(verificationDelivery.payloadEncryptedEnvelope, {
    vendorId: fixture.vendorId,
    deliveryId: verificationDelivery.id,
  });
  const verificationUrlValue = verificationPayload.body.match(/http:\/\/127\.0\.0\.1:\d+\/verify-registration\?[^\s]+/u)?.[0];
  if (!verificationUrlValue) throw new Error("Verification URL is unavailable.");
  const verificationUrl = new URL(verificationUrlValue);
  const verificationQueryKeys = [...verificationUrl.searchParams.keys()];
  if (
    verificationUrl.protocol !== "http:"
    || verificationUrl.hostname !== "127.0.0.1"
    || verificationUrl.origin !== new URL(page.url()).origin
    || verificationUrl.pathname !== "/verify-registration"
    || verificationUrl.hash
    || verificationUrl.username
    || verificationUrl.password
    || verificationQueryKeys.length !== 1
    || verificationQueryKeys[0] !== "token"
    || verificationUrl.searchParams.getAll("token").length !== 1
    || !verificationUrl.searchParams.get("token")
  ) throw new Error("Verification URL failed the loopback allowlist.");
  await page.goto(verificationUrl.toString(), { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "確認 Email 並完成報名", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Email 已確認", exact: true })).toBeVisible();

  await expect.poll(async () => await db.formSubmission.findUnique({
    where: { id: submissionId },
    select: { verificationStatus: true },
  })).toEqual({ verificationStatus: "VERIFIED" });
  await expect.poll(async () => await db.emailDelivery.count({
    where: { vendorId: fixture.vendorId, sourceFormSubmissionId: submissionId, trigger: "registration_confirmed" },
  })).toBe(1);
  const registrationDelivery = await db.emailDelivery.findFirstOrThrow({
    where: { vendorId: fixture.vendorId, sourceFormSubmissionId: submissionId, trigger: "registration_confirmed" },
    select: { id: true, payloadEncryptedEnvelope: true },
  });
  const registrationPayload = revealEmailDeliveryPayload(registrationDelivery.payloadEncryptedEnvelope, {
    vendorId: fixture.vendorId,
    deliveryId: registrationDelivery.id,
  });
  expect(registrationPayload.body).toContain(`/live/${fixture.slug}`);

  const liveAdmissionResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/live-admission" && response.request().method() === "POST"
  ));
  const playbackSourceResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/live-playback-source" && response.request().method() === "GET"
  ));
  await page.goto(livePath, { waitUntil: "domcontentloaded" });
  expect((await liveAdmissionResponse).status()).toBe(200);
  const playbackResponse = await playbackSourceResponse;
  expect(playbackResponse.status()).toBe(200);
  const playbackPayload = await playbackResponse.json() as { playbackUrl?: unknown };
  expect(typeof playbackPayload.playbackUrl).toBe("string");
  expect(playbackPayload.playbackUrl).toBe("https://video.example.test/wp7-one-stop.mp4");
  expect(pageErrorCount).toBe(0);
  await page.waitForTimeout(2_000);
  expect(liveAdmissionRequestCount).toBeGreaterThanOrEqual(1);
  expect(liveAdmissionRequestCount).toBeLessThanOrEqual(2);
  expect(playbackSourceRequestCount).toBeGreaterThanOrEqual(1);
  expect(playbackSourceRequestCount).toBeLessThanOrEqual(2);
  await page.screenshot({ path: join(process.env.G7_COMMERCE_SCREENSHOT_DIR!, "wp7-live.png"), fullPage: true });
  const video = page.locator("video");
  await expect.poll(async () => await page.getByTestId("persistent-live-player").evaluate((element) => ({
    sourceState: element.getAttribute("data-playback-source-state"),
    videoCount: element.querySelectorAll("video").length,
  }))).toEqual({ sourceState: "ready", videoCount: 1 });
  await expect(page.getByRole("button", { name: "商品", exact: true })).toHaveCount(0);
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    const browserWindow = window as typeof window & { __wp7Video?: HTMLVideoElement };
    browserWindow.__wp7Video = media;
    Object.defineProperty(media, "readyState", { configurable: true, value: 1 });
    Object.defineProperty(media, "paused", { configurable: true, get: () => true });
    media.currentTime = 3;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(page.getByText("WP7 預定聊天室訊息", { exact: true })).toBeVisible();
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    media.currentTime = 5;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(page.getByRole("complementary", { name: "推薦商品：WP7 直播內商品" })).toBeVisible();
  await expect(page.getByRole("button", { name: "商品", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expectNoBlockingAxeViolations(page);
  await page.screenshot({ path: join(process.env.G7_COMMERCE_SCREENSHOT_DIR!, "wp7-live-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "商品", exact: true }).click();
  await page.getByRole("article").filter({ hasText: "WP7 直播內商品" }).getByRole("button", { name: "購買", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${fixture.vendorId}/${fixture.productId}$`, "u"));
  await page.screenshot({ path: join(process.env.G7_COMMERCE_SCREENSHOT_DIR!, "wp7-checkout.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "確認購買資料", exact: true })).toBeVisible();
  await expect(page.locator("video")).toHaveCount(1);
  await expect.poll(() => page.locator("video").evaluate((current) => (
    (window as typeof window & { __wp7Video?: HTMLVideoElement }).__wp7Video === current
  ))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expectNoBlockingAxeViolations(page);
  await page.screenshot({ path: join(process.env.G7_COMMERCE_SCREENSHOT_DIR!, "wp7-checkout-mobile.png"), fullPage: true });

  await page.getByLabel("姓名").fill("WP7 Buyer");
  await page.getByLabel("Email").fill(`wp7-buyer-${runId}@example.test`);
  await page.getByLabel("電話", { exact: true }).fill("0912345678");
  await page.getByLabel("收件人").fill("WP7 Buyer");
  await page.getByLabel("收件電話").fill("0912345678");
  await page.getByLabel("縣市").fill("台北市");
  await page.getByLabel("鄉鎮市區").fill("中正區");
  await page.getByLabel("地址", { exact: true }).fill("測試路 1 號");
  await page.getByRole("checkbox", { name: /我已閱讀目前的/u }).check();
  await page.getByRole("button", { name: "購買「WP7 直播內商品」", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/訂單 .* 已建立/u);
  await expect.poll(async () => await db.commerceOrder.count({
    where: {
      vendorId: fixture.vendorId,
      status: "pending_payment",
      items: { some: { productId: fixture.productId } },
    },
  })).toBe(1);
  expect(await db.commerceOrder.count({
    where: {
      vendorId: fixture.vendorId,
      status: "paid",
      items: { some: { productId: fixture.productId } },
    },
  })).toBe(0);
  await page.screenshot({ path: join(process.env.G7_COMMERCE_SCREENSHOT_DIR!, "wp7-order.png") });
  await page.screenshot({ path: join(process.env.G7_COMMERCE_SCREENSHOT_DIR!, "wp7-order-mobile.png") });

  const completedScheduledAt = new Date(Date.now() - 601_000);
  const completionAt = new Date(completedScheduledAt.getTime() + 600_000);
  await db.live.update({
    where: { id: fixture.liveId },
    data: {
      scheduledAt: completedScheduledAt,
      startedAt: completedScheduledAt,
      status: "ended",
      endedAt: completionAt,
    },
  });
  await expect(processDuePostLiveFollowups({ now: new Date() })).resolves.toEqual([{ status: "queued" }]);
  await expect.poll(async () => await db.emailDelivery.count({
    where: {
      vendorId: fixture.vendorId,
      sourceLiveId: fixture.liveId,
      sourceFormSubmissionId: submissionId,
      trigger: "post_live_followup",
      status: "queued",
    },
  })).toBe(1);
  expect(pageErrorCount).toBe(0);
});

test("direct or refreshed checkout does not invent a live playback session", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const checkoutPath = `/checkout/${fixture.vendorId}/${fixture.productId}`;

  try {
    const response = await page.goto(checkoutPath, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "確認購買資料", exact: true })).toBeVisible();
    await expect(page.getByTestId("persistent-live-player")).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "確認購買資料", exact: true })).toBeVisible();
    await expect(page.getByTestId("persistent-live-player")).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
