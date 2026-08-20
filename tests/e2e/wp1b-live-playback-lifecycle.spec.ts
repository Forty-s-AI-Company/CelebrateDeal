import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const runId = randomUUID();
const fixture = {
  vendorId: "",
  videoId: "",
  formId: "",
  templateId: "",
  liveId: "",
  slug: `wp1b-lifecycle-${runId}`,
};

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: `WP1B Lifecycle Vendor ${runId}`,
      slug: `wp1b-lifecycle-vendor-${runId}`,
      email: `wp1b-lifecycle-vendor-${runId}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  fixture.vendorId = vendor.id;

  const video = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "WP1B lifecycle VOD",
      videoUrl: "https://video.example.test/wp1b-lifecycle.mp4",
      sourceType: "url",
      status: "ready",
      durationSec: 600,
    },
  });
  fixture.videoId = video.id;

  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: `WP1B lifecycle form ${runId}`,
      slug: `wp1b-lifecycle-form-${runId}`,
      headline: "WP1B lifecycle form",
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
      name: `WP1B lifecycle template ${runId}`,
      channel: "email",
      trigger: "registration_confirmed",
      subject: "{{live_title}} 報名成功",
      body: "{{name}} {{unsubscribe_url}}",
      isActive: true,
    },
  });
  fixture.templateId = template.id;

  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: template.id,
      title: "WP1B playback lifecycle",
      slug: fixture.slug,
      scheduledAt: new Date(Date.now() + 60_000),
      status: "scheduled",
      streamMode: "vod",
      replayEnabled: true,
    },
  });
  fixture.liveId = live.id;
});

test.afterAll(async () => {
  try {
    if (fixture.vendorId) {
      await db.liveViewerSession.deleteMany({ where: { vendorId: fixture.vendorId } });
      await db.live.deleteMany({ where: { id: fixture.liveId } });
      await db.video.deleteMany({ where: { id: fixture.videoId } });
      await db.registrationForm.deleteMany({ where: { id: fixture.formId } });
      await db.messageTemplate.deleteMany({ where: { id: fixture.templateId } });
      await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
    }
  } finally {
    await db.$disconnect();
  }
});

test("keeps one persistent video node from waiting through playing into replay", async ({ page }, testInfo) => {
  const livePath = `/live/${fixture.slug}`;
  const liveRouteRequests: string[] = [];
  const admissionResponses: number[] = [];
  const sourceResponses: number[] = [];
  type LifecyclePhase = "pre-ended" | "post-ended";
  type LifecycleEvidence = {
    phase: LifecyclePhase;
    kind: "request" | "response";
    method: string;
    pathname: string;
    status?: number;
    count: number;
  };
  let lifecyclePhase: LifecyclePhase = "pre-ended";
  const requestPhases = new WeakMap<object, LifecyclePhase>();
  const lifecycleEvidence: LifecycleEvidence[] = [];
  const endpointCounts = new Map<string, number>();

  const trackedEndpoint = (method: string, pathname: string) => (
    (method === "GET" && pathname === livePath)
    || (method === "POST" && pathname === "/api/live-admission")
    || (method === "GET" && pathname === "/api/live-playback-source")
  );
  const recordLifecycleEvent = ({
    phase,
    kind,
    method,
    pathname,
    status,
  }: Omit<LifecycleEvidence, "count">) => {
    const countKey = `${kind}:${method}:${pathname}`;
    const count = (endpointCounts.get(countKey) ?? 0) + 1;
    endpointCounts.set(countKey, count);
    lifecycleEvidence.push({ phase, kind, method, pathname, ...(status === undefined ? {} : { status }), count });
  };

  page.on("request", (request) => {
    const url = new URL(request.url());
    const method = request.method();
    if (!trackedEndpoint(method, url.pathname)) return;
    const phase = lifecyclePhase;
    requestPhases.set(request, phase);
    recordLifecycleEvent({ phase, kind: "request", method, pathname: url.pathname });
    if (method === "GET" && url.pathname === livePath) liveRouteRequests.push(url.pathname);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    const request = response.request();
    const method = request.method();
    if (!trackedEndpoint(method, url.pathname)) return;
    const phase = requestPhases.get(request) ?? lifecyclePhase;
    recordLifecycleEvent({ phase, kind: "response", method, pathname: url.pathname, status: response.status() });
    if (url.pathname === "/api/live-admission" && method === "POST") {
      admissionResponses.push(response.status());
    }
    if (url.pathname === "/api/live-playback-source" && method === "GET") {
      sourceResponses.push(response.status());
    }
  });

  const scheduledAt = new Date(Date.now() + 5_000);
  await db.live.update({
    where: { id: fixture.liveId },
    data: { scheduledAt, status: "scheduled", startedAt: null, endedAt: null },
  });

  const pageResponse = await page.goto(livePath, { waitUntil: "domcontentloaded" });
  expect(pageResponse?.status()).toBe(200);
  await expect(page.getByTestId("live-waiting-room")).toBeVisible();
  expect(admissionResponses).toHaveLength(0);
  expect(sourceResponses).toHaveLength(0);
  await expect(page.locator("video")).toHaveCount(0);

  await expect.poll(() => liveRouteRequests.length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => admissionResponses).toEqual(expect.arrayContaining([200]));
  await expect.poll(() => sourceResponses).toEqual(expect.arrayContaining([200]));
  await expect(page.locator("video")).toHaveCount(1);

  const video = page.locator("video");
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    const lifecycleWindow = window as typeof window & { __wp1bPersistentVideo?: HTMLVideoElement };
    lifecycleWindow.__wp1bPersistentVideo = media;
    Object.defineProperty(media, "readyState", { configurable: true, value: 1 });
    media.currentTime = 37;
  });
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(37);

  const routeCountBeforeEnded = liveRouteRequests.length;
  const admissionCountBeforeEnded = admissionResponses.length;
  const sourceCountBeforeEnded = sourceResponses.length;
  const endedAt = new Date();
  await db.live.update({
    where: { id: fixture.liveId },
    data: {
      status: "ended",
      scheduledAt: new Date(endedAt.getTime() - 600_000),
      endedAt,
      replayEnabled: true,
      replayAvailableUntil: new Date(endedAt.getTime() + 86_400_000),
    },
  });

  const postEndedRouteResponse = page.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(response.url());
    return requestPhases.get(request) === "post-ended"
      && request.method() === "GET"
      && url.pathname === livePath
      && response.status() === 200;
  });
  const postEndedAdmissionResponse = page.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(response.url());
    return requestPhases.get(request) === "post-ended"
      && request.method() === "POST"
      && url.pathname === "/api/live-admission"
      && response.status() === 200;
  });
  const postEndedSourceResponse = page.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(response.url());
    return requestPhases.get(request) === "post-ended"
      && request.method() === "GET"
      && url.pathname === "/api/live-playback-source"
      && response.status() === 200;
  });
  lifecyclePhase = "post-ended";
  await video.evaluate((element) => {
    element.dispatchEvent(new Event("ended", { bubbles: true }));
    element.dispatchEvent(new Event("ended", { bubbles: true }));
  });

  await Promise.all([postEndedRouteResponse, postEndedAdmissionResponse, postEndedSourceResponse]);
  await expect.poll(() => liveRouteRequests.length).toBe(routeCountBeforeEnded + 1);
  await expect.poll(() => admissionResponses.length).toBe(admissionCountBeforeEnded + 1);
  await expect.poll(() => sourceResponses.length).toBeGreaterThanOrEqual(sourceCountBeforeEnded + 1);
  await expect(page.locator("video")).toHaveCount(1);
  await expect.poll(() => page.locator("video").evaluate((element) => {
    const lifecycleWindow = window as typeof window & { __wp1bPersistentVideo?: HTMLVideoElement };
    return lifecycleWindow.__wp1bPersistentVideo === element as HTMLVideoElement;
  })).toBe(true);
  await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(0);

  await page.waitForLoadState("networkidle", { timeout: 5_000 });
  await testInfo.attach("wp1b-live-playback-lifecycle-sanitized-evidence", {
    body: Buffer.from(JSON.stringify({ lifecycleEvidence }, null, 2)),
    contentType: "application/json",
  });
  expect(liveRouteRequests).toHaveLength(routeCountBeforeEnded + 1);
  expect(admissionResponses).toHaveLength(admissionCountBeforeEnded + 1);
  expect(sourceResponses.length).toBeLessThanOrEqual(sourceCountBeforeEnded + 2);
  expect(admissionResponses.at(-1)).toBe(200);
  expect(sourceResponses.at(-1)).toBe(200);
});
