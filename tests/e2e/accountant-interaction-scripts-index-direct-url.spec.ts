import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp63SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied interaction scripts before nested data or mutations are exposed", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp63-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP63 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const [user, role, product, video] = await Promise.all([
    db.user.create({
      data: {
        email: `accountant-${tag}@celebratedeal.test`,
        name: "WP63 Active Accountant",
        passwordHash: hashPassword(password),
        status: "active",
        memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
      },
    }),
    db.interactionRole.create({
      data: {
        vendorId: vendor.id,
        name: `WP63 Role ${suffix}`,
        label: `WP63 Role Label ${suffix}`,
        roleType: "official",
        tone: `WP63 Tone ${suffix}`,
        isActive: true,
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP63 Product ${suffix}`,
        slug: `wp63-product-${suffix}`,
        description: `WP63 product description ${suffix}`,
        priceCents: 6363,
        inventory: 63,
        isActive: true,
      },
    }),
    db.video.create({
      data: {
        vendorId: vendor.id,
        title: `WP63 Video ${suffix}`,
        description: `WP63 video description ${suffix}`,
        sourceType: "url",
        videoUrl: `https://video-${tag}.invalid/video.mp4`,
        thumbnailUrl: `https://thumbnail-${tag}.invalid/cover.jpg`,
        durationSec: 630,
        status: "ready",
        cloudflareStreamUid: `wp63-stream-${suffix}`,
        cloudflarePlaybackId: `wp63-playback-${suffix}`,
        cloudflareReadyToStream: true,
      },
    }),
  ]);
  const script = await db.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: `WP63 Script ${suffix}`,
      description: `WP63 script description ${suffix}`,
      status: "published",
      events: {
        create: [
          {
            roleId: role.id,
            eventType: "chat_message",
            triggerSec: 63,
            title: `WP63 Event A ${suffix}`,
            message: `WP63 event message A ${suffix}`,
            productId: product.id,
            ctaLabel: `WP63 CTA A ${suffix}`,
            ctaUrl: `https://cta-a-${tag}.invalid/action`,
            metadata: { canary: `wp63-metadata-a-${suffix}` },
          },
          {
            roleId: role.id,
            eventType: "product_pin",
            triggerSec: 126,
            title: `WP63 Event B ${suffix}`,
            message: `WP63 event message B ${suffix}`,
            productId: product.id,
            ctaLabel: `WP63 CTA B ${suffix}`,
            ctaUrl: `https://cta-b-${tag}.invalid/action`,
            metadata: { canary: `wp63-metadata-b-${suffix}` },
          },
        ],
      },
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      interactionScriptId: script.id,
      title: `WP63 Live ${suffix}`,
      slug: `wp63-live-${suffix}`,
      description: `WP63 live description ${suffix}`,
      scheduledAt: new Date("2033-01-01T00:00:00.000Z"),
      status: "draft",
    },
  });
  const membership = await db.vendorMember.findUniqueOrThrow({
    where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
  });
  const events = await db.interactionEvent.findMany({
    where: { scriptId: script.id },
    orderBy: { id: "asc" },
  });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const snapshot = async () => ({
      vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
      vendorCount: await db.vendor.count(),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      role: await db.interactionRole.findUniqueOrThrow({ where: { id: role.id } }),
      roleCount: await db.interactionRole.count(),
      roleVendorCount: await db.interactionRole.count({ where: { vendorId: vendor.id } }),
      product: await db.product.findUniqueOrThrow({ where: { id: product.id } }),
      productCount: await db.product.count(),
      productVendorCount: await db.product.count({ where: { vendorId: vendor.id } }),
      video: await db.video.findUniqueOrThrow({ where: { id: video.id } }),
      videoCount: await db.video.count(),
      videoVendorCount: await db.video.count({ where: { vendorId: vendor.id } }),
      script: await db.interactionScript.findUniqueOrThrow({ where: { id: script.id } }),
      scriptCount: await db.interactionScript.count(),
      scriptVendorCount: await db.interactionScript.count({ where: { vendorId: vendor.id } }),
      events: await db.interactionEvent.findMany({
        where: { scriptId: script.id },
        orderBy: { id: "asc" },
      }),
      eventCount: await db.interactionEvent.count(),
      eventScriptCount: await db.interactionEvent.count({ where: { scriptId: script.id } }),
      eventVendorCount: await db.interactionEvent.count({
        where: { script: { vendorId: vendor.id } },
      }),
      live: await db.live.findUniqueOrThrow({ where: { id: live.id } }),
      liveCount: await db.live.count(),
      liveVendorCount: await db.live.count({ where: { vendorId: vendor.id } }),
      liveRelations: {
        videoId: (await db.live.findUniqueOrThrow({ where: { id: live.id } })).videoId,
        interactionScriptId: (await db.live.findUniqueOrThrow({ where: { id: live.id } })).interactionScriptId,
      },
    });
    const before = await snapshot();
    const rawCanaries = [
      script.id,
      script.name,
      script.description,
      role.id,
      role.name,
      product.id,
      product.name,
      video.id,
      video.title,
      video.videoUrl,
      video.thumbnailUrl,
      video.cloudflareStreamUid,
      video.cloudflarePlaybackId,
      live.id,
      live.title,
      live.description,
      ...events.flatMap((event) => [
        event.id,
        event.title,
        event.message,
        event.ctaLabel,
        event.ctaUrl,
      ]),
    ].filter((value): value is string => Boolean(value));
    const finalCanaries = [
      script.id,
      script.name,
      script.description,
      role.id,
      role.name,
      product.id,
      product.name,
      video.id,
      video.title,
      video.videoUrl,
      video.thumbnailUrl,
      ...events.flatMap((event) => [
        event.id,
        event.title,
        event.message,
        event.ctaLabel,
        event.ctaUrl,
      ]),
    ].filter((value): value is string => Boolean(value));

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/interaction-scripts";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
    });
    await page.route("**/interaction-scripts", async (route) => {
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
    for (const canary of rawCanaries) expect(intercepted.current?.body).not.toContain(canary);

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "留言組", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "新增留言組", exact: true })).toHaveCount(0);
    for (const title of ["編輯", "複製", "刪除"]) {
      await expect(page.getByTitle(title, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByLabel("每頁筆數", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "套用", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "上一頁", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "下一頁", exact: true })).toHaveCount(0);

    const main = page.getByRole("main");
    await expect(main.locator(`a[href="/interaction-scripts/${script.id}/edit"]`)).toHaveCount(0);
    await expect(main.locator(`form:has(input[name="id"][value="${script.id}"]):has(input[name="_csrf"])`)).toHaveCount(0);
    await expect(page.locator(`input[name="id"][value="${script.id}"]`)).toHaveCount(0);
    for (const canary of finalCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(external).not.toContain(video.videoUrl);
    expect(external).not.toContain(video.thumbnailUrl);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
