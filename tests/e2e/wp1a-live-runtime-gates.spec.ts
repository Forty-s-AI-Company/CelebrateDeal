import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const runId = randomUUID();
const fixture = {
  vendorId: "",
  videoId: "",
  formId: "",
  templateId: "",
  liveId: "",
  slug: `wp1a-runtime-${runId}`,
};

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: `WP1A Runtime Vendor ${runId}`,
      slug: `wp1a-runtime-vendor-${runId}`,
      email: `wp1a-runtime-vendor-${runId}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  const video = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "WP1A runtime VOD",
      videoUrl: "https://video.example.test/wp1a-runtime.m3u8",
      sourceType: "url",
      status: "ready",
      durationSec: 600,
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: `WP1A runtime form ${runId}`,
      slug: `wp1a-runtime-form-${runId}`,
      headline: "WP1A runtime form",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    },
  });
  const template = await db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name: `WP1A runtime template ${runId}`,
      channel: "email",
      trigger: "registration_confirmed",
      subject: "{{live_title}} 報名成功",
      body: "{{name}} {{unsubscribe_url}}",
      isActive: true,
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: template.id,
      title: "WP1A runtime gate",
      slug: fixture.slug,
      scheduledAt: new Date(Date.now() - 120_000),
      status: "live",
      streamMode: "vod",
      replayEnabled: true,
    },
  });
  fixture.vendorId = vendor.id;
  fixture.videoId = video.id;
  fixture.formId = form.id;
  fixture.templateId = template.id;
  fixture.liveId = live.id;
});

test.afterAll(async () => {
  if (fixture.vendorId) {
    await db.liveViewerSession.deleteMany({ where: { vendorId: fixture.vendorId } });
    await db.live.deleteMany({ where: { id: fixture.liveId } });
    await db.video.deleteMany({ where: { id: fixture.videoId } });
    await db.registrationForm.deleteMany({ where: { id: fixture.formId } });
    await db.messageTemplate.deleteMany({ where: { id: fixture.templateId } });
    await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  }
  await db.$disconnect();
});

async function postAdmission(page: Page) {
  return page.evaluate(async ({ vendorId, liveId }) => {
    const response = await fetch("/api/live-admission", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CelebrateDeal-Client": "web",
      },
      body: JSON.stringify({ vendorId, liveId }),
    });
    return { status: response.status, body: await response.json() as unknown };
  }, { vendorId: fixture.vendorId, liveId: fixture.liveId });
}

async function getPlaybackSource(page: Page) {
  return page.evaluate(async ({ vendorId, liveId }) => {
    const query = new URLSearchParams({ vendorId, liveId });
    const response = await fetch(`/api/live-playback-source?${query.toString()}`, {
      headers: { "X-CelebrateDeal-Client": "web" },
    });
    return { status: response.status, body: await response.json() as { playbackStartSeconds?: unknown } };
  }, { vendorId: fixture.vendorId, liveId: fixture.liveId });
}

test("uses the canonical runtime gates for VOD playback and invalid Live Input markers", async ({ page }) => {
  const [pageResponse, admissionResponse] = await Promise.all([
    page.goto(`/live/${fixture.slug}`, { waitUntil: "load" }),
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/live-admission" && response.request().method() === "POST";
    }),
  ]);
  expect(pageResponse?.status()).toBe(200);
  expect(admissionResponse.status()).toBe(200);
  await expect.poll(async () => page.context().cookies()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: "celebratedeal_live_viewer",
      value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      httpOnly: true,
    }),
  ]));
  await expect(page.locator("main").first()).toBeVisible();

  const playingSource = await getPlaybackSource(page);
  expect(playingSource.status).toBe(200);
  expect(playingSource.body.playbackStartSeconds).toEqual(expect.any(Number));
  expect(playingSource.body.playbackStartSeconds as number).toBeGreaterThan(0);
  expect(playingSource.body.playbackStartSeconds as number).toBeLessThan(600);

  await db.live.update({
    where: { id: fixture.liveId },
    data: { streamMode: "live", status: "live", startedAt: null, endedAt: null },
  });
  expect(await postAdmission(page)).toMatchObject({ status: 404 });
  expect((await getPlaybackSource(page)).status).toBe(403);
});
