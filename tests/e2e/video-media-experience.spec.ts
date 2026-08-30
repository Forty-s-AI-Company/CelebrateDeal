import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Video-Media-E2E-Password-123!";
const runId = randomUUID();
const fixture = {
  email: `video-media-${runId}@celebratedeal.local`,
  slug: `video-media-${runId}`,
  vendorId: "",
  userId: "",
  thumbnailVideoId: "",
  placeholderVideoId: "",
  processingVideoId: "",
  uploadVideoId: "",
  thumbnailAssetId: "",
};

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: "Video Media E2E Vendor",
      slug: fixture.slug,
      email: fixture.email,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#c2410c",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: fixture.email,
      name: "Video Media E2E Owner",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
    },
  });
  const thumbnailVideo = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "影片縮圖 E2E",
      description: "有縮圖的測試影片",
      sourceType: "url",
      videoUrl: "https://media.example.test/video-thumbnail-e2e.mp4",
      thumbnailUrl: "https://media.example.test/video-thumbnail-e2e.jpg",
      durationSec: 125,
      estimatedMinutes: 3,
      status: "ready",
    },
  });
  const placeholderVideo = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "影片 Placeholder E2E",
      description: "沒有縮圖的測試影片",
      sourceType: "url",
      videoUrl: "https://media.example.test/video-placeholder-e2e.mp4",
      durationSec: 61,
      estimatedMinutes: 2,
      status: "ready",
    },
  });
  const processingVideo = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "影片 Provider Processing E2E",
      description: "測試 provider polling 到 ready",
      sourceType: "cloudflare_stream",
      videoUrl: "https://media.example.test/provider-processing-e2e.mp4",
      cloudflareStreamUid: `stream-${runId}`,
      cloudflareReadyToStream: false,
      durationSec: 0,
      estimatedMinutes: 0,
      status: "processing",
    },
  });
  const uploadVideo = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "待保存的上傳影片 E2E",
      description: "測試上傳後儲存並回到列表",
      sourceType: "cloudflare_stream",
      videoUrl: "https://media.example.test/upload-processing-e2e.mp4",
      cloudflareStreamUid: `stream-upload-${runId}`,
      cloudflareReadyToStream: false,
      durationSec: 0,
      estimatedMinutes: 0,
      status: "processing",
    },
  });
  const thumbnailAsset = await db.imageAsset.create({
    data: {
      id: `asset-${runId}`,
      vendorId: vendor.id,
      objectKey: `e2e/${runId}/thumbnail.jpg`,
      originalFilename: "browser-e2e-thumbnail.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1,
      publicUrl: "https://cdn.example.test/video-thumbnail.jpg",
      status: "ready",
    },
  });

  fixture.vendorId = vendor.id;
  fixture.userId = user.id;
  fixture.thumbnailVideoId = thumbnailVideo.id;
  fixture.placeholderVideoId = placeholderVideo.id;
  fixture.processingVideoId = processingVideo.id;
  fixture.uploadVideoId = uploadVideo.id;
  fixture.thumbnailAssetId = thumbnailAsset.id;
});

test.afterAll(async () => {
  if (fixture.vendorId) await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  if (fixture.userId) await db.user.deleteMany({ where: { id: fixture.userId } });
  await db.$disconnect();
});

async function loginOwner(page: Page) {
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("[data-dashboard-scope]")).toHaveCount(2);
}

function stubCanvasAndVideo(page: Page) {
  return page.addInitScript(({ png }) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob([bytes], { type: "image/png" }));
    };
    const contextPrototype = window.CanvasRenderingContext2D?.prototype;
    if (contextPrototype) {
      Object.defineProperty(contextPrototype, "drawImage", { configurable: true, value: () => undefined });
    }
    window.addEventListener("beforeunload", () => {
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
    });
  }, { png: tinyPngBase64 });
}

function stubReadyMediaNetwork(page: Page) {
  return page.addInitScript(() => {
    // The ready-player assertion targets DOM creation and controls, not a
    // public CDN. Keep the fixture deterministic without changing product
    // playback/error handling or the processing-state assertion below.
    const originalSetAttribute = Element.prototype.setAttribute;
    const originalSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    if (!originalSrc?.set) return;

    Element.prototype.setAttribute = function setAttribute(name, value) {
      if (this instanceof HTMLMediaElement && name.toLowerCase() === "src") {
        originalSetAttribute.call(this, "data-e2e-media-src", value);
        return;
      }
      originalSetAttribute.call(this, name, value);
    };

    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      get: originalSrc.get,
      set(this: HTMLMediaElement, value: string) {
        originalSetAttribute.call(this, "data-e2e-media-src", value);
      },
    });
  });
}

test("video library displays thumbnails and protects archive/restore with confirmation", async ({ page }) => {
  await loginOwner(page);
  await page.goto("/videos", { waitUntil: "load" });

  await expect(page.getByRole("img", { name: "影片縮圖 E2E縮圖" })).toBeVisible();
  await expect(page.getByRole("img", { name: "影片 Placeholder E2E尚無縮圖" })).toBeVisible();

  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  const archiveForm = page.getByRole("form", { name: "影片縮圖 E2E封存" });
  await archiveForm.getByRole("button", { name: "封存" }).click();
  await expect.poll(async () => (await db.video.findUniqueOrThrow({ where: { id: fixture.thumbnailVideoId }, select: { status: true } })).status).toBe("archived");

  // A fresh document makes the second mutation prove recovery from persisted
  // state instead of relying on an in-flight streamed RSC response.
  await page.reload({ waitUntil: "load" });
  await expect(page.getByRole("form", { name: "影片縮圖 E2E恢復" })).toBeVisible();
  expect(dialogs.at(-1)).toContain("Cloudflare Stream 資源不會被刪除");
  const restoreForm = page.getByRole("form", { name: "影片縮圖 E2E恢復" });
  await restoreForm.getByRole("button", { name: "恢復" }).click();
  await expect.poll(async () => (await db.video.findUniqueOrThrow({ where: { id: fixture.thumbnailVideoId }, select: { status: true } })).status).toBe("ready");
  await page.reload({ waitUntil: "load" });
  await expect(page.getByRole("form", { name: "影片縮圖 E2E封存" })).toBeVisible();
  expect(dialogs.at(-1)).toContain("恢復後會回到封存前的狀態");

  const restored = await db.video.findUniqueOrThrow({ where: { id: fixture.thumbnailVideoId } });
  expect(restored.status).toBe("ready");
});

test("ready video preview creates the player and keeps processing preview closed", async ({ page }) => {
  await stubReadyMediaNetwork(page);
  await loginOwner(page);

  await page.goto(`/videos/${fixture.thumbnailVideoId}/preview`, { waitUntil: "load" });
  const player = page.locator('video[aria-label="影片縮圖 E2E"]');
  // The fixture URL is intentionally unreachable; assert the preview route
  // creates the player without making browser QA depend on a public media CDN.
  await expect(player).toHaveCount(1);
  await expect(player).toHaveAttribute("controls", "");
  await expect(player).toHaveAttribute("preload", "metadata");
  await expect(page.getByRole("heading", { name: "播放檢查" })).toBeVisible();
  await expect(page.getByText("外部影片", { exact: true })).toBeVisible();

  await page.goto(`/videos/${fixture.processingVideoId}/preview`, { waitUntil: "load" });
  await expect(page.getByText("影片目前無法播放，請回到編輯頁檢查素材狀態。", { exact: true })).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByText("Cloudflare Stream", { exact: true })).toBeVisible();
  await expect(page.getByText("影片來源尚未準備好，系統已安全停止載入。", { exact: true })).toBeVisible();
});

test("new video browser flow exposes metadata, timeline, crop controls and mocked upload feedback", async ({ page }) => {
  await stubCanvasAndVideo(page);
  await page.route("**/api/media/images/presign", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      assetId: fixture.thumbnailAssetId,
      uploadUrl: "https://upload.example.test/image",
      publicUrl: "https://cdn.example.test/video-thumbnail.jpg",
      method: "PUT",
      headers: { "content-type": "image/png" },
    }),
  }));
  await page.route("**/api/media/images/complete", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assetId: fixture.thumbnailAssetId, publicUrl: "https://cdn.example.test/video-thumbnail.jpg" }),
  }));
  await page.route("https://upload.example.test/*", (route) => route.fulfill({ status: 200, body: "ok" }));
  await page.route("**/api/media/videos/direct-upload", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      videoId: fixture.uploadVideoId,
      uploadUrl: "https://upload.videodelivery.net/mock-upload",
      method: "POST",
    }),
  }));
  await page.route("https://upload.videodelivery.net/*", (route) => route.fulfill({ status: 200, body: "ok" }));

  await loginOwner(page);
  await page.goto("/videos/new", { waitUntil: "load" });
  await page.getByLabel("影片名稱").fill("瀏覽器上傳影片 E2E");

  const videoInput = page.locator('input[type="file"][accept="video/*"]');
  await videoInput.setInputFiles({ name: "browser-e2e.mp4", mimeType: "video/mp4", buffer: Buffer.from("synthetic-video") });
  const video = page.locator("video").first();
  await expect(video).toBeVisible();
  await video.evaluate((element) => {
    let currentTime = 0;
    Object.defineProperties(element, {
      duration: { configurable: true, value: 125 },
      videoWidth: { configurable: true, value: 1280 },
      videoHeight: { configurable: true, value: 720 },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => { currentTime = value; },
      },
    });
    element.dispatchEvent(new Event("loadedmetadata", { bubbles: true }));
  });

  await expect(page.getByLabel("長度秒數")).toHaveValue("125");
  await expect(page.getByLabel("估算用量分鐘")).toHaveValue("3");
  const timeline = page.getByRole("slider", { name: "選取影片縮圖畫面" });
  await expect(timeline).toBeVisible();
  await timeline.fill("30");
  await expect(timeline).toHaveValue("30");

  await page.getByRole("button", { name: "使用目前畫面作為縮圖" }).click();
  await expect(page.getByText("16:9", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1:1", exact: true }).click();
  await expect(page.getByRole("button", { name: "1:1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("縮放縮圖").fill("1.5");
  await expect(page.getByLabel("縮放縮圖")).toHaveValue("1.5");
  await expect(page.getByText("縮圖上傳完成，儲存表單後即會套用。")).toBeVisible();

  await page.getByRole("button", { name: "開始上傳" }).first().click();
  await expect(page.getByText("檔案已送達 Cloudflare Stream，正在處理，尚未可播放；儲存表單後會套用。")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "檔案已送達 Cloudflare Stream" })).toBeVisible();

  // The provider mock has finished processing before the server action is
  // submitted. This keeps the browser test local while still exercising the
  // real tenant-scoped save and redirect back to the video list.
  await db.video.update({
    where: { id: fixture.uploadVideoId },
    data: {
      title: "瀏覽器上傳影片 E2E",
      videoUrl: "https://videodelivery.net/browser-e2e/master.m3u8",
      cloudflareReadyToStream: true,
      durationSec: 125,
      estimatedMinutes: 3,
      status: "ready",
    },
  });
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page).toHaveURL(/\/videos$/);
  const savedVideo = page.getByRole("article").filter({ hasText: "瀏覽器上傳影片 E2E" });
  await expect(savedVideo.getByRole("img", { name: "瀏覽器上傳影片 E2E縮圖" })).toBeVisible();
  await expect(savedVideo.getByText("02:05", { exact: true })).toBeVisible();
});

test("provider polling updates processing video to ready and authoritative duration", async ({ page }) => {
  await page.route(`**/api/media/videos/status?id=${fixture.processingVideoId}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      video: {
        resourceId: fixture.processingVideoId,
        status: "ready",
        cloudflareReadyToStream: true,
        durationSec: 321,
        estimatedMinutes: 6,
        thumbnailUrl: "https://cdn.example.test/provider-thumbnail.jpg",
        videoUrl: "https://videodelivery.net/provider/master.m3u8",
      },
    }),
  }));
  await loginOwner(page);
  await page.goto(`/videos/${fixture.processingVideoId}/edit`, { waitUntil: "load" });
  await expect(page.getByText("Provider 狀態：ready")).toBeVisible();
  await expect(page.getByText("Cloudflare ready，影片可播放。")).toBeVisible();
  await expect(page.getByLabel("長度秒數")).toHaveValue("321");
  await expect(page.getByLabel("估算用量分鐘")).toHaveValue("6");
});

test("mobile video flow keeps metadata, thumbnail controls and loading feedback usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubCanvasAndVideo(page);
  await page.route("**/api/media/images/presign", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      assetId: `mobile-asset-${runId}`,
      uploadUrl: "https://upload.example.test/mobile-image",
      publicUrl: "https://cdn.example.test/mobile-thumbnail.jpg",
      method: "PUT",
      headers: { "content-type": "image/png" },
    }),
  }));
  await page.route("**/api/media/images/complete", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assetId: `mobile-asset-${runId}`, publicUrl: "https://cdn.example.test/mobile-thumbnail.jpg" }),
  }));
  await page.route("https://upload.example.test/*", (route) => route.fulfill({ status: 200, body: "ok" }));
  await page.route("**/api/media/videos/direct-upload", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      videoId: `mobile-provider-${runId}`,
      uploadUrl: "https://upload.videodelivery.net/mobile-upload",
      method: "POST",
    }),
  }));
  await page.route("https://upload.videodelivery.net/*", (route) => route.fulfill({ status: 200, body: "ok" }));

  await loginOwner(page);
  await page.goto("/videos/new", { waitUntil: "load" });
  await page.getByLabel("影片名稱").fill("手機版影片 E2E");
  await page.locator('input[type="file"][accept="video/*"]').setInputFiles({
    name: "mobile-e2e.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("synthetic-mobile-video"),
  });

  const video = page.locator("video").first();
  await expect(video).toBeVisible();
  await video.evaluate((element) => {
    let currentTime = 0;
    Object.defineProperties(element, {
      duration: { configurable: true, value: 61 },
      videoWidth: { configurable: true, value: 720 },
      videoHeight: { configurable: true, value: 1280 },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => { currentTime = value; },
      },
    });
    element.dispatchEvent(new Event("loadedmetadata", { bubbles: true }));
  });

  await expect(page.getByLabel("長度秒數")).toHaveValue("61");
  await expect(page.getByLabel("估算用量分鐘")).toHaveValue("2");
  const timeline = page.getByRole("slider", { name: "選取影片縮圖畫面" });
  await timeline.fill("12");
  await expect(timeline).toHaveValue("12");
  await page.getByRole("button", { name: "使用目前畫面作為縮圖" }).click();
  await page.getByRole("button", { name: "4:5", exact: true }).click();
  await expect(page.getByRole("button", { name: "4:5", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("縮放縮圖").fill("1.2");
  await expect(page.getByText("縮圖上傳完成，儲存表單後即會套用。")).toBeVisible();

  await page.getByRole("button", { name: "開始上傳" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "檔案已送達 Cloudflare Stream" })).toBeVisible();
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth, "mobile video form horizontal overflow").toBeLessThanOrEqual(layout.clientWidth + 1);

  await page.goto("/dashboard", { waitUntil: "load" });
  await expect(page.locator("[data-dashboard-scope]")).toHaveCount(2);
  const dashboardLayout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dashboardLayout.scrollWidth, "mobile dashboard horizontal overflow").toBeLessThanOrEqual(dashboardLayout.clientWidth + 1);
});
