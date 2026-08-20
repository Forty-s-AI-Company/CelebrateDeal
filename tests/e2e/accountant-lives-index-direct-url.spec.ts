import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp66SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied the lives index before live relationships are queried or rendered", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp66-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP66 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP66-FB-${suffix}`,
          tiktokPixelId: `WP66-TT-${suffix}`,
          googleTagManagerId: `WP66-GTM-${suffix}`,
        },
      },
    },
  });
  const [user, video, form, product] = await Promise.all([
    db.user.create({
      data: {
        email: `accountant-${tag}@celebratedeal.test`,
        name: "WP66 Active Accountant",
        passwordHash: hashPassword(password),
        status: "active",
        memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
      },
    }),
    db.video.create({
      data: {
        vendorId: vendor.id,
        title: `WP66 Video ${suffix}`,
        description: `WP66 video description ${suffix}`,
        sourceType: "cloudflare_stream",
        videoUrl: `https://video-${tag}.invalid/video.mp4`,
        thumbnailUrl: `https://thumbnail-${tag}.invalid/thumbnail.jpg`,
        durationSec: 3666,
        status: `wp66-video-status-${suffix}`,
        cloudflareStreamUid: `wp66-stream-${suffix}`,
        cloudflareLiveInputUid: `wp66-live-input-${suffix}`,
        cloudflarePlaybackId: `wp66-playback-${suffix}`,
        cloudflareReadyToStream: true,
        liveStreamKey: `wp66-stream-key-${suffix}`,
        liveInputStatus: `wp66-input-status-${suffix}`,
        estimatedMinutes: 66,
      },
    }),
    db.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: `WP66 Form ${suffix}`,
        slug: `form-${tag}`,
        headline: `WP66 Form Headline ${suffix}`,
        description: `WP66 form description ${suffix}`,
        submitLabel: `WP66 Submit ${suffix}`,
        successMessage: `WP66 Success ${suffix}`,
        fields: [
          {
            key: `wp66_field_${suffix}`,
            label: `WP66 Field Label ${suffix}`,
            type: "text",
            required: true,
          },
        ],
        isActive: true,
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP66 Product ${suffix}`,
        slug: `product-${tag}`,
        description: `WP66 product description ${suffix}`,
        priceCents: 660066,
        compareAtCents: 770077,
        currency: "TWD",
        imageUrl: `https://image-${tag}.invalid/product.jpg`,
        checkoutUrl: `https://checkout-${tag}.invalid/order`,
        inventory: 66,
        isActive: true,
      },
    }),
  ]);
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      title: `WP66 Dashboard-visible Live ${suffix}`,
      slug: `live-${tag}`,
      description: `WP66 live description ${suffix}`,
      scheduledAt: new Date("2036-06-06T06:06:00.000Z"),
      status: `wp66-live-status-${suffix}`,
      heroImageUrl: `https://hero-${tag}.invalid/hero.jpg`,
      accentCopy: `WP66 accent copy ${suffix}`,
      replayEnabled: true,
      streamMode: "vod",
      cloudflareLiveInputUid: `wp66-live-route-input-${suffix}`,
      quotaPolicy: { canary: `wp66-quota-${suffix}`, maxViewers: 66 },
      products: {
        create: {
          productId: product.id,
          sortOrder: 66,
          offerLabel: `WP66 Offer ${suffix}`,
          isPinned: true,
        },
      },
    },
  });
  const [tracking, membership, liveProduct] = await Promise.all([
    db.trackingSetting.findUniqueOrThrow({ where: { vendorId: vendor.id } }),
    db.vendorMember.findUniqueOrThrow({
      where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    }),
    db.liveProduct.findUniqueOrThrow({
      where: {
        vendorId_liveId_productId: {
          vendorId: vendor.id,
          liveId: live.id,
          productId: product.id,
        },
      },
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
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      video: await db.video.findUniqueOrThrow({ where: { id: video.id } }),
      videoCount: await db.video.count(),
      videoVendorCount: await db.video.count({ where: { vendorId: vendor.id } }),
      form: await db.registrationForm.findUniqueOrThrow({ where: { id: form.id } }),
      formCount: await db.registrationForm.count(),
      formVendorCount: await db.registrationForm.count({ where: { vendorId: vendor.id } }),
      product: await db.product.findUniqueOrThrow({ where: { id: product.id } }),
      productCount: await db.product.count(),
      productVendorCount: await db.product.count({ where: { vendorId: vendor.id } }),
      live: await db.live.findUniqueOrThrow({ where: { id: live.id } }),
      liveCount: await db.live.count(),
      liveVendorCount: await db.live.count({ where: { vendorId: vendor.id } }),
      liveStatusCount: await db.live.count({
        where: { vendorId: vendor.id, status: live.status },
      }),
      liveProduct: await db.liveProduct.findUniqueOrThrow({ where: { id: liveProduct.id } }),
      liveProductCount: await db.liveProduct.count(),
      liveProductLiveCount: await db.liveProduct.count({ where: { liveId: live.id } }),
      liveProductVendorRelationCount: await db.liveProduct.count({
        where: { live: { vendorId: vendor.id } },
      }),
      relations: {
        live: await db.live.findUniqueOrThrow({
          where: { id: live.id },
          select: { vendorId: true, videoId: true, formId: true },
        }),
        liveProduct: await db.liveProduct.findUniqueOrThrow({
          where: { id: liveProduct.id },
          select: { liveId: true, productId: true },
        }),
      },
    });
    const before = await snapshot();
    const fields = form.fields as Array<Record<string, unknown>>;
    const rawCanaries = [
      vendor.id,
      tracking.id,
      user.id,
      membership.id,
      video.id,
      video.title,
      video.description,
      video.videoUrl,
      video.thumbnailUrl,
      video.status,
      video.cloudflareStreamUid,
      video.cloudflareLiveInputUid,
      video.cloudflarePlaybackId,
      video.liveStreamKey,
      video.liveInputStatus,
      form.id,
      form.name,
      form.slug,
      form.headline,
      form.description,
      form.submitLabel,
      form.successMessage,
      ...fields.flatMap((field) => [field.key, field.label]),
      product.id,
      product.name,
      product.slug,
      product.description,
      product.imageUrl,
      product.checkoutUrl,
      live.id,
      live.title,
      live.slug,
      live.description,
      live.status,
      live.heroImageUrl,
      live.accentCopy,
      live.cloudflareLiveInputUid,
      (live.quotaPolicy as { canary?: string } | null)?.canary,
      liveProduct.id,
      liveProduct.offerLabel,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const relationCanaries = [
      video.title,
      video.description,
      video.videoUrl,
      video.thumbnailUrl,
      video.cloudflareStreamUid,
      video.cloudflareLiveInputUid,
      video.cloudflarePlaybackId,
      video.liveStreamKey,
      video.liveInputStatus,
      form.name,
      form.slug,
      form.headline,
      form.description,
      form.submitLabel,
      form.successMessage,
      ...fields.flatMap((field) => [field.key, field.label]),
      product.name,
      product.slug,
      product.description,
      product.imageUrl,
      product.checkoutUrl,
      live.description,
      live.heroImageUrl,
      live.accentCopy,
      live.cloudflareLiveInputUid,
      (live.quotaPolicy as { canary?: string } | null)?.canary,
      liveProduct.offerLabel,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/lives";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
    });
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path,
      routeIdentityCanaries: [path],
      protectedPayloadCanaries: rawCanaries,
      documentCanaries: relationCanaries,
      transport: {
        kind: "streaming-redirect",
        status: 200,
        redirectMarker: "NEXT_REDIRECT",
        redirectTargetMarker: "/dashboard?error=insufficient_role",
      },
      finalUrl: "/dashboard?error=insufficient_role",
      finalStatus: 200,
      forbiddenPayload: [".invalid"],
    });

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL("/dashboard?error=insufficient_role");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const dashboardLiveSummaries = page.getByText(live.title, { exact: true });
    await expect(dashboardLiveSummaries).toHaveCount(2);
    await expect(dashboardLiveSummaries.first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "直播間管理", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "建立直播", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/lives"]')).toHaveCount(0);
    await expect(page.locator('a[href="/lives/new"]')).toHaveCount(0);
    await expect(page.locator(`a[href="/lives/${live.id}/edit"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/lives/${live.id}/preview"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/lives/${live.id}/analytics"]`)).toHaveCount(0);
    await expect(page.getByText(`/live/${live.slug}`, { exact: true })).toHaveCount(0);
    await expect(page.getByText("已綁影片", { exact: true })).toHaveCount(0);
    await expect(page.getByText("已綁表單", { exact: true })).toHaveCount(0);
    await expect(page.getByText("1 商品", { exact: true })).toHaveCount(0);
    for (const canary of relationCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
