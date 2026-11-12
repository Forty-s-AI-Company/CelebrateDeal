import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "../../src/lib/form-submission-chat-session";

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
  dailyWaitingLiveId: "",
  dailyPlayingLiveId: "",
  jitSlug: `evergreen-jit-${runId}`,
  onDemandSlug: `evergreen-on-demand-${runId}`,
  dailyWaitingSlug: `evergreen-daily-waiting-${runId}`,
  dailyPlayingSlug: `evergreen-daily-playing-${runId}`,
};
const TAIPEI = "Asia/Taipei";

async function createLive(slug: string, mode: "just_in_time" | "on_demand" | "recurring_daily") {
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
      ...(mode === "recurring_daily" ? { evergreenDailyTimes: ["09:00"] } : {}),
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
  fixture.dailyWaitingLiveId = await createLive(fixture.dailyWaitingSlug, "recurring_daily");
  fixture.dailyPlayingLiveId = await createLive(fixture.dailyPlayingSlug, "recurring_daily");
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

/** Wall-clock HH:mm in Asia/Taipei for `minutesFromNow`, independent of the machine timezone. */
function taipeiClock(minutesFromNow: number, at = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TAIPEI,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at + minutesFromNow * 60_000));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

/** Re-anchors the daily times to the real clock right before each test, so a slow run never drifts. */
async function setDailyTimes(liveId: string, minutesFromNow: number[]) {
  const times = minutesFromNow.map((minutes) => taipeiClock(minutes));
  await db.live.update({ where: { id: liveId }, data: { evergreenDailyTimes: times } });
  return times;
}

type SessionProjection = { assigned: boolean; mode: string; timezone: string; roomState: string; sessionStartAt: string; offsetSeconds: number };

async function readSession(context: import("@playwright/test").BrowserContext, baseURL: string, liveId: string) {
  const response = await context.request.get(`${baseURL}/api/live-evergreen-session?liveId=${liveId}`, {
    headers: { Origin: baseURL, "X-CelebrateDeal-Client": "web" },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as SessionProjection;
}

test("assigns a recurring-daily visitor the next Asia/Taipei daily session behind a waiting room", async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  // Past session (ended), the upcoming one, and a later one: the visitor gets the nearest future start.
  const [past, next, later] = await setDailyTimes(fixture.dailyWaitingLiveId, [-180, 120, 240]);
  // A browser timezone far from Taipei must not influence the server-computed session.
  const context = await browser.newContext({ baseURL, timezoneId: "America/Los_Angeles" });
  try {
    const page = await context.newPage();
    const sourceRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/live-playback-source") sourceRequests.push(request.url());
    });
    await page.goto(`/live/${fixture.dailyWaitingSlug}`);
    const waitingRoom = page.getByTestId("live-waiting-room");
    await expect(waitingRoom).toBeVisible();
    await expect(waitingRoom).toContainText(`${next}（${TAIPEI}）`);
    await expect(waitingRoom).not.toContainText(`${past}（${TAIPEI}）`);
    await expect(waitingRoom).not.toContainText(`${later}（${TAIPEI}）`);
    // About two hours away: the countdown shows an hours component.
    await expect(waitingRoom).toContainText(/距離你的場次開始 1:\d{2}:\d{2}/u);
    await expect(waitingRoom).toContainText("不是即時直播");
    await expect(page.locator("video")).toHaveCount(0);

    const cookie = await evergreenCookie(context);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value).toMatch(/^eg1\./u);
    const session = await readSession(context, baseURL, fixture.dailyWaitingLiveId);
    expect(session).toMatchObject({ assigned: true, mode: "recurring_daily", timezone: TAIPEI, roomState: "waiting_countdown", offsetSeconds: 0 });
    const msUntilStart = new Date(session.sessionStartAt).getTime() - Date.now();
    expect(msUntilStart).toBeGreaterThan(110 * 60_000);
    expect(msUntilStart).toBeLessThanOrEqual(120 * 60_000);

    // Refreshing keeps the same signed session.
    await page.reload();
    await expect(page.getByTestId("live-waiting-room")).toContainText(`${next}（${TAIPEI}）`);
    expect((await evergreenCookie(context))?.value).toBe(cookie?.value);
    expect(sourceRequests).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("keeps two independent visitors on their own recurring-daily sessions", async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const [upcoming] = await setDailyTimes(fixture.dailyWaitingLiveId, [90]);
  const contextA = await browser.newContext({ baseURL });
  const contextB = await browser.newContext({ baseURL });
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.goto(`/live/${fixture.dailyWaitingSlug}`);
    await pageB.goto(`/live/${fixture.dailyWaitingSlug}`);
    await expect(pageA.getByTestId("live-waiting-room")).toContainText(`${upcoming}（${TAIPEI}）`);
    await expect(pageB.getByTestId("live-waiting-room")).toContainText(`${upcoming}（${TAIPEI}）`);

    const cookieA = await evergreenCookie(contextA);
    const cookieB = await evergreenCookie(contextB);
    expect(cookieA?.value).toMatch(/^eg1\./u);
    expect(cookieB?.value).toMatch(/^eg1\./u);
    const sessionA = await readSession(contextA, baseURL, fixture.dailyWaitingLiveId);
    const sessionB = await readSession(contextB, baseURL, fixture.dailyWaitingLiveId);
    expect(sessionA.assigned).toBe(true);
    expect(sessionB.assigned).toBe(true);
    expect(sessionB.sessionStartAt).toBe(sessionA.sessionStartAt);

    // Visitor A losing the cookie leaves visitor B's session untouched.
    await contextA.clearCookies();
    expect((await readSession(contextA, baseURL, fixture.dailyWaitingLiveId)).assigned).toBe(false);
    expect((await evergreenCookie(contextB))?.value).toBe(cookieB?.value);
    expect((await readSession(contextB, baseURL, fixture.dailyWaitingLiveId)).assigned).toBe(true);
    await pageB.reload();
    await expect(pageB.getByTestId("live-waiting-room")).toContainText(`${upcoming}（${TAIPEI}）`);
    expect((await evergreenCookie(contextB))?.value).toBe(cookieB?.value);

    // A reloads and is simply assigned the same upcoming session again.
    await pageA.reload();
    await expect(pageA.getByTestId("live-waiting-room")).toContainText(`${upcoming}（${TAIPEI}）`);
    expect((await readSession(contextA, baseURL, fixture.dailyWaitingLiveId)).sessionStartAt).toBe(sessionB.sessionStartAt);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("ignores a tampered recurring-daily cookie and never grants an earlier start", async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const [upcoming] = await setDailyTimes(fixture.dailyWaitingLiveId, [120]);
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    const sourceRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/live-playback-source") sourceRequests.push(request.url());
    });
    await page.goto(`/live/${fixture.dailyWaitingSlug}`);
    await expect(page.getByTestId("live-waiting-room")).toContainText(`${upcoming}（${TAIPEI}）`);
    const cookie = (await evergreenCookie(context))!;
    const legitStart = (await readSession(context, baseURL, fixture.dailyWaitingLiveId)).sessionStartAt;

    const [version, payload, signature] = cookie.value.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as { s: number };
    const forgedPayload = (start: number) => Buffer.from(JSON.stringify({ ...claims, s: start }), "utf8").toString("base64url");
    const tamperedValues = [
      // Content edited to a start that already began, original signature kept.
      `${version}.${forgedPayload(Date.now() - 60_000)}.${signature}`,
      // Signature edited, content untouched.
      `${version}.${payload}.${signature!.slice(0, -4)}AAAA`,
      // Not a token at all.
      "eg1.garbage.garbage",
    ];
    for (const value of tamperedValues) {
      await context.addCookies([{ ...cookie, value }]);
      await page.reload();
      await expect(page.getByTestId("live-waiting-room")).toBeVisible();
      await expect(page.locator("video")).toHaveCount(0);
      // The server replaced the forged cookie with a genuine session for the real next start.
      const replaced = (await evergreenCookie(context))?.value;
      expect(replaced).not.toBe(value);
      expect(replaced).toMatch(/^eg1\./u);
      const session = await readSession(context, baseURL, fixture.dailyWaitingLiveId);
      expect(session.roomState).toBe("waiting_countdown");
      expect(new Date(session.sessionStartAt).getTime()).toBeGreaterThanOrEqual(new Date(legitStart).getTime());
    }
    expect(sourceRequests).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("opens playback for a recurring-daily session that has already started", async ({ page, context, baseURL }) => {
  // A finished earlier session (-90 min) must not shadow the one that began five minutes ago.
  const [, started] = await setDailyTimes(fixture.dailyPlayingLiveId, [-90, -5]);
  await page.goto(`/live/${fixture.dailyPlayingSlug}`);
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.getByText("預錄場次播放中")).toBeVisible();
  await expect(page.getByTestId("live-waiting-room")).toHaveCount(0);
  const cookie = await evergreenCookie(context);
  expect(cookie?.httpOnly).toBe(true);

  const session = await readSession(context, baseURL!, fixture.dailyPlayingLiveId);
  expect(session).toMatchObject({ assigned: true, mode: "recurring_daily", timezone: TAIPEI, roomState: "playing" });
  // The daily time is minute-aligned, so the session began between 5 and ~6 minutes ago.
  expect(session.offsetSeconds).toBeGreaterThanOrEqual(295);
  expect(session.offsetSeconds).toBeLessThan(480);
  expect(taipeiClock(0, new Date(session.sessionStartAt).getTime())).toBe(started);

  await page.reload();
  await expect(page.getByText("預錄場次播放中")).toBeVisible();
  expect((await evergreenCookie(context))?.value).toBe(cookie?.value);
});

test("records a verified registrant's existing session once their registration cookie arrives (F-2)", async ({ page, context, baseURL }) => {
  // Unique per run, so --repeat-each never collides on the global slug or the registration.
  const recordId = randomUUID();
  const slug = `evergreen-record-${recordId}`;
  // A daily session two hours ahead: the page stays in the waiting room for the whole test.
  const liveId = await createLive(slug, "recurring_daily");
  await setDailyTimes(liveId, [120]);
  const submission = await db.formSubmission.create({
    data: {
      formId: fixture.formId,
      liveId,
      name: "Evergreen Registrant",
      email: `evergreen-registrant-${recordId}@example.test`,
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
    },
  });
  const claims: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/live-evergreen-session") claims.push(request.url());
  });

  // First visit without a registration cookie: a session is claimed, nothing is recorded.
  await page.goto(`/live/${slug}`);
  await expect(page.getByTestId("live-waiting-room")).toContainText("你的場次：");
  expect(await page.content()).not.toContain("recordRegistration");
  await expect.poll(async () => (await evergreenCookie(context))?.value ?? "").toMatch(/^eg1\./u);
  const cookie = await evergreenCookie(context);
  await expect.poll(() => claims.length).toBe(1);
  expect(await db.evergreenSessionAssignment.count({ where: { vendorId: fixture.vendorId, liveId } })).toBe(0);

  // The same browser later holds the signed registration cookie (as after verifying).
  await context.addCookies([{
    name: FORM_SUBMISSION_CHAT_SESSION_COOKIE,
    value: createFormSubmissionChatSessionToken({ submissionId: submission.id }),
    url: baseURL!,
  }]);
  await page.reload();
  await expect(page.getByTestId("live-waiting-room")).toBeVisible();
  // The server flagged this render: the flag is in the page payload.
  expect(await page.content()).toContain("recordRegistration");
  await expect.poll(() => db.evergreenSessionAssignment.count({ where: { vendorId: fixture.vendorId, liveId, formSubmissionId: submission.id } })).toBe(1);
  const session = await readSession(context, baseURL!, liveId);
  const recorded = await db.evergreenSessionAssignment.findFirstOrThrow({ where: { vendorId: fixture.vendorId, liveId, formSubmissionId: submission.id } });
  // The existing session is kept (same cookie) and is the one recorded.
  expect((await evergreenCookie(context))?.value).toBe(cookie?.value);
  expect(recorded.sessionStartAt.toISOString()).toBe(session.sessionStartAt);
  expect(claims).toHaveLength(2);

  // Once recorded, the server no longer flags the page, so nothing asks for another claim.
  await page.reload();
  await expect(page.getByTestId("live-waiting-room")).toBeVisible();
  expect(await page.content()).not.toContain("recordRegistration");
  expect(claims).toHaveLength(2);
});
