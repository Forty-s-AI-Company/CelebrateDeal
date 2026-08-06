import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp60SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied live creation before related assets are exposed", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp60-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP60 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const [user, video, product, form, template, script, affiliate] = await Promise.all([
    db.user.create({
      data: {
        email: `accountant-${tag}@celebratedeal.test`,
        name: "WP60 Active Accountant",
        passwordHash: hashPassword(password),
        status: "active",
        memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
      },
    }),
    db.video.create({
      data: {
        vendorId: vendor.id,
        title: `WP60 Video ${suffix}`,
        description: `WP60 video description ${suffix}`,
        sourceType: "url",
        videoUrl: `https://video-${tag}.invalid/video.mp4`,
        status: "ready",
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP60 Product ${suffix}`,
        slug: `product-${tag}`,
        description: `WP60 product description ${suffix}`,
        priceCents: 6060,
        inventory: 60,
        isActive: true,
      },
    }),
    db.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: `WP60 Form ${suffix}`,
        slug: `form-${tag}`,
        headline: `WP60 Form Headline ${suffix}`,
        fields: [],
        isActive: true,
      },
    }),
    db.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: `WP60 Template ${suffix}`,
        subject: `WP60 Subject ${suffix}`,
        body: `WP60 template body ${suffix}`,
        isActive: true,
      },
    }),
    db.interactionScript.create({
      data: {
        vendorId: vendor.id,
        name: `WP60 Script ${suffix}`,
        description: `WP60 script description ${suffix}`,
        status: "published",
      },
    }),
    db.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: `WP60 Affiliate ${suffix}`,
        code: `wp60affiliate${suffix}`,
        source: `WP60 source ${suffix}`,
        isActive: true,
      },
    }),
  ]);
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: template.id,
      interactionScriptId: script.id,
      title: `WP60 Existing Live ${suffix}`,
      slug: `live-${tag}`,
      description: `WP60 live description ${suffix}`,
      scheduledAt: new Date("2030-06-01T00:00:00.000Z"),
      products: { create: { productId: product.id, sortOrder: 1, isPinned: true } },
    },
  });
  const membership = await db.vendorMember.findUniqueOrThrow({
    where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
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
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      video: await db.video.findUniqueOrThrow({ where: { id: video.id } }),
      videoCount: await db.video.count({ where: { vendorId: vendor.id } }),
      product: await db.product.findUniqueOrThrow({ where: { id: product.id } }),
      productCount: await db.product.count({ where: { vendorId: vendor.id } }),
      form: await db.registrationForm.findUniqueOrThrow({ where: { id: form.id } }),
      formCount: await db.registrationForm.count({ where: { vendorId: vendor.id } }),
      template: await db.messageTemplate.findUniqueOrThrow({ where: { id: template.id } }),
      templateCount: await db.messageTemplate.count({ where: { vendorId: vendor.id } }),
      script: await db.interactionScript.findUniqueOrThrow({ where: { id: script.id } }),
      scriptCount: await db.interactionScript.count({ where: { vendorId: vendor.id } }),
      affiliate: await db.affiliate.findUniqueOrThrow({ where: { id: affiliate.id } }),
      affiliateCount: await db.affiliate.count({ where: { vendorId: vendor.id } }),
      live: await db.live.findUniqueOrThrow({ where: { id: live.id } }),
      liveCount: await db.live.count({ where: { vendorId: vendor.id } }),
      liveProducts: await db.liveProduct.findMany({ where: { liveId: live.id }, orderBy: { id: "asc" } }),
      liveProductCount: await db.liveProduct.count({ where: { live: { vendorId: vendor.id } } }),
    });
    const before = await snapshot();
    const rawCanaries = [
      video.title,
      product.name,
      form.name,
      form.headline,
      template.name,
      template.subject,
      template.body,
      script.name,
      script.description,
      affiliate.name,
      affiliate.code,
    ].filter((value): value is string => Boolean(value));

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/lives/new";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
    });
    await page.route("**/lives/new", async (route) => {
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

    expect(redirectResponse.headers().location).toBe("/dashboard?error=insufficient_role");
    expect(intercepted.current).toBeDefined();
    expect(intercepted.current?.status).toBe(307);
    expect(intercepted.current?.location).toBe("/dashboard?error=insufficient_role");
    for (const canary of rawCanaries) expect(intercepted.current?.body).not.toContain(canary);
    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "建立直播間" })).toHaveCount(0);
    await expect(page.locator('form:has(input[name="title"]):has(input[name="_csrf"])')).toHaveCount(0);
    for (const step of ["基本資料", "影片 / Live Input", "商品", "報名頁", "通知", "互動腳本", "規則", "發布"]) {
      await expect(page.getByRole("button", { name: step, exact: true })).toHaveCount(0);
    }
    for (const label of ["直播標題", "Slug", "開播時間", "直播說明", "串流模式", "影片 / Live Input", "Hero 圖片 URL", "促銷短句", "報名頁", "通知模板", "互動腳本", "允許聯盟來源", "預設推廣碼", "觀看人數上限", "點數低於多少時停止推播"]) {
      await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    }
    for (const canary of [video.title, product.name, form.name, form.headline, template.name, template.subject, template.body, script.name, script.description].filter((value): value is string => Boolean(value))) {
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
