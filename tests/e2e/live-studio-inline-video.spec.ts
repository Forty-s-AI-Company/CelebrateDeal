import { expect, test, type Route } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatZonedDateTimeLocal } from "../../src/lib/zoned-date-time";
import {
  createLiveStudioFixtureWithUploadPendingVideo,
  deleteLiveStudioFixture,
  liveStudioStepButton,
  loginLiveStudioOwner,
  openLiveStudioAdvancedSettings,
  type LiveStudioFixture,
} from "../fixtures/live-studio";

// Synthetic loopback-only tenant without a playable video. Every Cloudflare
// call is answered in the browser: the upload signing route, the upload URL
// and the status route never reach the app server or Cloudflare.
const db = new PrismaClient({ log: [] });
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(180_000);
test.afterAll(async () => db.$disconnect());

const MOCK_UPLOAD_URL = "https://upload.videodelivery.net/e2e-live-wizard-upload";

test("a merchant without a playable video uploads one in the studio's drawer, waits for processing and publishes with it without leaving /lives/new", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const documentNavigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) documentNavigations.push(new URL(frame.url()).pathname);
  });

  let fixture: LiveStudioFixture | undefined;
  try {
    fixture = await createLiveStudioFixtureWithUploadPendingVideo(db);
    const uploadVideoId = fixture.video.id;
    const signedTitles: string[] = [];
    let resumableCalls = 0;
    let statusCalls = 0;
    let providerReady = false;
    let releaseUpload!: () => void;
    const uploadReleased = new Promise<void>((resolve) => { releaseUpload = resolve; });

    await page.route("**/api/media/videos/direct-upload", async (route: Route) => {
      signedTitles.push(String((route.request().postDataJSON() as { title?: unknown }).title));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ videoId: uploadVideoId, uploadUrl: MOCK_UPLOAD_URL, method: "POST" }),
      });
    });
    await page.route("**/api/media/videos/resumable-upload**", async (route: Route) => {
      resumableCalls += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_IN_THIS_TEST" } }) });
    });
    await page.route("https://upload.videodelivery.net/**", async (route: Route) => {
      await uploadReleased;
      await route.fulfill({ status: 200, body: "ok" });
    });
    await page.route((url) => url.pathname === "/api/media/videos/status", async (route: Route) => {
      statusCalls += 1;
      const id = new URL(route.request().url()).searchParams.get("id");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          video: {
            resourceId: id,
            status: providerReady ? "ready" : "processing",
            cloudflareReadyToStream: providerReady,
            durationSec: providerReady ? 1_800 : 0,
            estimatedMinutes: providerReady ? 30 : 0,
            thumbnailUrl: null,
            videoUrl: null,
          },
        }),
      });
    });

    const slug = `inline-video-${fixture.id.slice(0, 8)}`;
    await loginLiveStudioOwner(page, fixture);
    await page.goto("/lives/new");
    documentNavigations.length = 0;

    // 內容
    await page.getByRole("button", { name: /內容／課程直播/u }).click();
    const title = page.getByLabel("直播標題");
    await title.fill("上傳影片的週五講座");
    const titleNode = await title.elementHandle();
    const videoSelect = page.locator("select[name=videoId]");
    await expect(page.getByText("目前沒有可播放的影片，可以在這裡直接上傳。")).toBeVisible();
    await expect(videoSelect.locator("option")).toHaveCount(1);

    const openVideo = page.getByRole("button", { name: "上傳影片或貼上影片網址", exact: true });
    await openVideo.click();
    const videoDrawer = page.getByRole("dialog", { name: "新增影片" });
    await expect(videoDrawer).toBeVisible();
    const videoTitle = videoDrawer.getByLabel("影片名稱");
    await expect(videoTitle).toBeFocused();
    await expect(videoTitle).toHaveValue("上傳影片的週五講座");
    await videoTitle.fill("週五講座錄影");
    await videoDrawer.locator('input[type="file"][accept="video/*"]').setInputFiles({
      name: "weekly-talk.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("synthetic-video"),
    });
    await videoDrawer.getByRole("button", { name: "開始上傳" }).click();

    // While the file is sent the drawer stays open and says how to leave.
    await expect(videoDrawer.getByText(/^上傳中 \d+%$/u)).toBeVisible();
    await expect(videoDrawer.getByRole("button", { name: "關閉" })).toBeDisabled();
    await expect(videoDrawer.getByText("上傳中無法關閉；需要離開請先按「暫停上傳」。")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(videoDrawer).toBeVisible();
    releaseUpload();

    await expect(videoDrawer).toBeHidden();
    expect(signedTitles).toEqual(["週五講座錄影"]);
    const pendingRow = page.locator(`[data-pending-video="${uploadVideoId}"]`);
    await expect(pendingRow).toHaveText("處理中的影片：「週五講座錄影」，轉檔完成後會自動選取。");
    await expect(page.getByText(/可以先繼續其他步驟/u).first()).toBeVisible();
    // Processing: not an option yet.
    await expect(videoSelect.locator("option")).toHaveCount(1);
    await expect(videoSelect).toHaveValue("");

    // Cloudflare finishes: the first check saw "processing"; the webhook marks the row ready.
    await expect.poll(() => statusCalls).toBeGreaterThanOrEqual(1);
    await db.video.update({
      where: { id: uploadVideoId },
      data: { title: "週五講座錄影", status: "ready", cloudflareReadyToStream: true, durationSec: 1_800, estimatedMinutes: 30 },
    });
    providerReady = true;

    await expect(videoSelect).toHaveValue(uploadVideoId);
    await expect(pendingRow).toHaveText("「週五講座錄影」已可播放，已自動選為這場直播的影片。");
    await expect(page.locator("[data-live-resource-status]")).toHaveText("影片「週五講座錄影」已可播放，已自動選為這場直播的影片。");
    expect(await titleNode!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(title).toHaveValue("上傳影片的週五講座");

    await page.locator("select[name=formId]").selectOption(fixture.form.id);
    // A week from now in the studio's Taipei time, so the schedule never becomes a past time.
    await page.getByLabel(/^開播時間/u).fill(formatZonedDateTimeLocal(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), "Asia/Taipei"));
    await openLiveStudioAdvancedSettings(page, "content");
    await page.getByLabel("直播網址").fill(slug);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(liveStudioStepButton(page, "notifications")).toHaveAttribute("aria-current", "step");
    await page.locator("select[name=messageTemplateId]").selectOption(fixture.template.id);
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await expect(liveStudioStepButton(page, "publish")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("已完成 · 可播放的影片或即時直播")).toBeVisible();
    await expect(page.getByText("發布條件已完成")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/lives/new");
    expect(documentNavigations.filter((pathname) => pathname !== "/lives/new")).toEqual([]);

    // The autosaved draft carries the uploaded video, and scheduling binds it.
    await expect.poll(async () => {
      const draft = await db.liveStudioDraft.findFirst({ where: { vendorId: fixture!.vendor.id }, select: { payload: true } });
      return (draft?.payload as { videoId?: string } | undefined)?.videoId ?? null;
    }).toBe(uploadVideoId);
    await page.getByRole("button", { name: "建立並排程", exact: true }).click();
    await page.getByRole("alertdialog", { name: "確定要建立並排程這場直播嗎？" })
      .getByRole("button", { name: "確認建立並排程", exact: true }).click();
    await expect(page).toHaveURL(/\/lives\/[^/]+\/preview$/u, { timeout: 60_000 });
    const live = await db.live.findFirstOrThrow({ where: { vendorId: fixture.vendor.id }, select: { videoId: true, status: true } });
    expect(live).toEqual({ videoId: uploadVideoId, status: "scheduled" });
    expect(resumableCalls).toBe(0);
    expect(nativeDialogs).toEqual([]);
  } finally {
    await deleteLiveStudioFixture(db, fixture);
  }
});
