import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Evergreen (常青) Webinar public watch page on synthetic loopback data:
 * the server assigns each visitor a session in a signed httpOnly cookie,
 * the waiting room counts down to it, a refresh keeps it, a tampered cookie
 * never yields an earlier start, and on-demand playback is locked to 1x.
 */
const db = new PrismaClient();
const runId = randomUUID();
const fixture = {
  vendorId: "",
  videoId: "",
  formId: "",
  templateId: "",
  jitLiveId: "",
  onDemandLiveId: "",
  jitSlug: `evergreen-jit-${runId}`,
  onDemandSlug: `evergreen-on-demand-${runId}`,
};

async function createLive(slug: string, mode: "just_in_time" | "on_demand") {
  const live = await db.live.create({
    data: {
      vendorId: fixture.vendorId,
      videoId: fixture.videoId,
      formId: fixture.formId,
      messageTemplateId: fixture.templateId,
      title: `Evergreen ${mode}`,
      slug,
      // A long-past shared schedule: only the visitor's own session may open playback.
      scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "scheduled",
      streamMode: "vod",
      replayEnabled: false,
      isEvergreen: true,
      evergreenScheduleMode: mode,
      evergreenIntervalMinutes: 30,
    },
  });
  return live.id;
}

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: `Evergreen Vendor ${runId}`,
      slug: `evergreen-vendor-${runId}`,
      email: `evergreen-vendor-${runId}@example.test`,
      passwordHash: "disposable-test-only",
      timezone: "Asia/Taipei",
    },
  });
  fixture.vendorId = vendor.id;
  const video = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "Evergreen synthetic VOD",
      videoUrl: "https://video.example.test/evergreen.mp4",
      sourceType: "url",
      status: "ready",
      durationSec: 1_800,
    },
  });
  fixture.videoId = video.id;
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: `Evergreen form ${runId}`,
      slug: `evergreen-form-${runId}`,
      headline: "Evergreen form",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    },
  });
  fixture.formId = form.id;
  const template = await db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name: `Evergreen template ${runId}`,
      channel: "email",
      trigger: "registration_confirmed",
      subject: "{{live_title}} 報名成功",
      body: "{{name}} {{unsubscribe_url}}",
      isActive: true,
    },
  });
  fixture.templateId = template.id;
  fixture.jitLiveId = await createLive(fixture.jitSlug, "just_in_time");
  fixture.onDemandLiveId = await createLive(fixture.onDemandSlug, "on_demand");
});

test.afterAll(async () => {
  try {
    if (fixture.vendorId) {
      await db.liveViewerSession.deleteMany({ where: { vendorId: fixture.vendorId } });
      await db.live.deleteMany({ where: { vendorId: fixture.vendorId } });
      await db.video.deleteMany({ where: { id: fixture.videoId } });
      await db.registrationForm.deleteMany({ where: { id: fixture.formId } });
      await db.messageTemplate.deleteMany({ where: { id: fixture.templateId } });
      await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
    }
  } finally {
    await db.$disconnect();
  }
});

async function evergreenCookie(context: import("@playwright/test").BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name.startsWith("celebratedeal_eg_"));
}

test("assigns a stable just-in-time session behind a waiting room without media", async ({ page, context }) => {
  const sourceRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/live-playback-source") sourceRequests.push(request.url());
  });

  await page.goto(`/live/${fixture.jitSlug}`);
  const waitingRoom = page.getByTestId("live-waiting-room");
  await expect(waitingRoom).toBeVisible();
  await expect(waitingRoom).toContainText("你的場次：");
  await expect(waitingRoom).toContainText("距離你的場次開始");
  await expect(waitingRoom).toContainText("不是即時直播");
  await expect(page.locator("video")).toHaveCount(0);
  const cookie = await evergreenCookie(context);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.value).toMatch(/^eg1\./u);
  const sessionLabel = await waitingRoom.locator("p", { hasText: "你的場次：" }).textContent();

  // Refreshing keeps the same server-assigned session.
  await page.reload();
  await expect(page.getByTestId("live-waiting-room")).toContainText(sessionLabel ?? "");
  expect((await evergreenCookie(context))?.value).toBe(cookie?.value);

  // A tampered cookie is ignored and replaced; it never opens playback early.
  await context.addCookies([{ ...cookie!, value: `${cookie!.value.slice(0, -4)}AAAA` }]);
  await page.reload();
  await expect(page.getByTestId("live-waiting-room")).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  expect((await evergreenCookie(context))?.value).not.toContain("AAAA");
  expect(sourceRequests).toHaveLength(0);
});

test("plays an on-demand session from its own start, locked to normal speed", async ({ page, context }) => {
  await page.goto(`/live/${fixture.onDemandSlug}`);
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.getByText("預錄場次播放中")).toBeVisible();
  await expect(page.getByText("不是即時直播").first()).toBeVisible();
  const video = page.locator("video");
  await expect(video).not.toHaveAttribute("controls", /.*/u);
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    media.playbackRate = 2;
    media.dispatchEvent(new Event("ratechange"));
  });
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).playbackRate)).toBe(1);

  const cookie = await evergreenCookie(context);
  await page.reload();
  await expect(page.getByText("預錄場次播放中")).toBeVisible();
  expect((await evergreenCookie(context))?.value).toBe(cookie?.value);
});
