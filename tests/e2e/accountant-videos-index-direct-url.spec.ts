import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp68SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied the videos index before video data is queried or rendered", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp68-${suffix}`;
  const externalStatus = `wp68-archived-${suffix}`;
  const providerStatus = `wp68-processing-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP68 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP68-FB-${suffix}`,
          tiktokPixelId: `WP68-TT-${suffix}`,
          googleTagManagerId: `WP68-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: "WP68 Active Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: { vendorId: vendor.id, role: "accountant", status: "active" },
      },
    },
  });
  const videos = await Promise.all([
    db.video.create({
      data: {
        vendorId: vendor.id,
        title: `WP68 External Video ${suffix}`,
        description: `WP68 external description ${suffix}`,
        sourceType: "url",
        videoUrl: `https://external-video-${tag}.invalid/video.mp4`,
        thumbnailUrl: `https://external-thumbnail-${tag}.invalid/poster.jpg`,
        durationSec: 681,
        estimatedMinutes: 12,
        status: externalStatus,
      },
    }),
    db.video.create({
      data: {
        vendorId: vendor.id,
        title: `WP68 Provider Video ${suffix}`,
        description: `WP68 provider description ${suffix}`,
        sourceType: "cloudflare_stream",
        videoUrl: `https://provider-video-${tag}.invalid/manifest.m3u8`,
        thumbnailUrl: `https://provider-thumbnail-${tag}.invalid/poster.jpg`,
        durationSec: 682,
        estimatedMinutes: 13,
        status: providerStatus,
        cloudflareStreamUid: `wp68-stream-${suffix}`,
        cloudflareLiveInputUid: `wp68-input-${suffix}`,
        cloudflarePlaybackId: `wp68-playback-${suffix}`,
        cloudflareReadyToStream: false,
        liveInputStatus: `wp68-input-status-${suffix}`,
      },
    }),
  ]);
  const [tracking, membership] = await Promise.all([
    db.trackingSetting.findUniqueOrThrow({ where: { vendorId: vendor.id } }),
    db.vendorMember.findUniqueOrThrow({
      where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    }),
  ]);

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const snapshot = async () => ({
      vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
      vendorCount: await db.vendor.count(),
      tracking: await db.trackingSetting.findUniqueOrThrow({ where: { id: tracking.id } }),
      trackingCount: await db.trackingSetting.count(),
      trackingVendorCount: await db.trackingSetting.count({ where: { vendorId: vendor.id } }),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipCount: await db.vendorMember.count(),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      membershipRelationCount: await db.vendorMember.count({
        where: { vendorId: vendor.id, userId: user.id },
      }),
      videos: await db.video.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
      }),
      videoCount: await db.video.count(),
      videoVendorCount: await db.video.count({ where: { vendorId: vendor.id } }),
      globalUrlCount: await db.video.count({ where: { sourceType: "url" } }),
      globalProviderCount: await db.video.count({ where: { sourceType: "cloudflare_stream" } }),
      vendorUrlCount: await db.video.count({
        where: { vendorId: vendor.id, sourceType: "url" },
      }),
      vendorProviderCount: await db.video.count({
        where: { vendorId: vendor.id, sourceType: "cloudflare_stream" },
      }),
      globalExternalStatusCount: await db.video.count({ where: { status: externalStatus } }),
      globalProviderStatusCount: await db.video.count({ where: { status: providerStatus } }),
      vendorExternalStatusCount: await db.video.count({
        where: { vendorId: vendor.id, status: externalStatus },
      }),
      vendorProviderStatusCount: await db.video.count({
        where: { vendorId: vendor.id, status: providerStatus },
      }),
      readyToStreamCount: await db.video.count({
        where: { vendorId: vendor.id, cloudflareReadyToStream: true },
      }),
      videoVendorRelations: await db.video.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
    });
    const before = await snapshot();
    const rawCanaries = videos
      .flatMap((video) => [
        video.id,
        video.title,
        video.description,
        video.videoUrl,
        video.thumbnailUrl,
        video.status,
        video.cloudflareStreamUid,
        video.cloudflareLiveInputUid,
        video.cloudflarePlaybackId,
        video.liveInputStatus,
      ])
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/videos";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
        external.push(request.url());
      }
    });
    await page.route("**/videos", async (route) => {
      if (new URL(route.request().url()).pathname !== path) {
        await route.continue();
        return;
      }
      const response = await route.fetch({ maxRedirects: 0 });
      intercepted.current = {
        status: response.status(),
        location: response.headers().location,
        body: await response.text(),
      };
      await route.fulfill({ response });
    });

    const rawRedirect = page.waitForResponse(
      (response) => new URL(response.url()).pathname === path && response.status() === 307,
    );
    const finalResponse = await page.goto(path);
    const redirectResponse = await rawRedirect;

    expect(redirectResponse.status()).toBe(307);
    expect(redirectResponse.headers().location).toBe("/dashboard?error=insufficient_role");
    expect(intercepted.current).toBeDefined();
    expect(intercepted.current?.status).toBe(307);
    expect(intercepted.current?.location).toBe("/dashboard?error=insufficient_role");
    for (const canary of rawCanaries) {
      expect(intercepted.current?.body).not.toContain(canary);
    }
    expect(intercepted.current?.body).not.toContain(".invalid");

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("商品點擊", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "影片庫", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "新增影片", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/videos"]')).toHaveCount(0);
    await expect(page.locator('a[href="/videos/new"]')).toHaveCount(0);
    for (const video of videos) {
      await expect(page.locator(`a[href="/videos/${video.id}/edit"]`)).toHaveCount(0);
      for (const value of [
        video.title,
        video.description,
        video.videoUrl,
        video.thumbnailUrl,
        video.status,
        video.cloudflareStreamUid,
        video.cloudflareLiveInputUid,
        video.cloudflarePlaybackId,
        video.liveInputStatus,
      ].filter((candidate): candidate is string => Boolean(candidate))) {
        await expect(page.getByText(value, { exact: true })).toHaveCount(0);
      }
    }
    for (const label of [
      "影片名稱",
      "影片描述",
      "影片 URL",
      "縮圖 URL",
      "長度秒數",
      "估算用量分鐘",
      "狀態",
      "Stream Key",
      "Cloudflare 播放來源",
    ]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /儲存/ })).toHaveCount(0);

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
