import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp73SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied products/new before the product form is rendered or mutated", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp73-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP73 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP73-FB-${suffix}`,
          tiktokPixelId: `WP73-TT-${suffix}`,
          googleTagManagerId: `WP73-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: `WP73 Active Accountant ${suffix}`,
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: {
          vendorId: vendor.id,
          role: "accountant",
          status: "active",
        },
      },
    },
  });
  const products = await Promise.all([
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP73 Active Product ${suffix}`,
        slug: `active-${tag}`,
        description: `WP73 active product description ${suffix}`,
        priceCents: 730173,
        compareAtCents: 930193,
        currency: "TWD",
        imageUrl: `https://active-image-${tag}.invalid/product.jpg`,
        checkoutUrl: `https://active-checkout-${tag}.invalid/order`,
        inventory: 7317,
        isActive: true,
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP73 Inactive Product ${suffix}`,
        slug: `inactive-${tag}`,
        description: `WP73 inactive product description ${suffix}`,
        priceCents: 730273,
        compareAtCents: 930293,
        currency: "USD",
        imageUrl: `https://inactive-image-${tag}.invalid/product.jpg`,
        checkoutUrl: `https://inactive-checkout-${tag}.invalid/order`,
        inventory: 7327,
        isActive: false,
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
      trackingRelationCount: await db.trackingSetting.count({
        where: { id: tracking.id, vendorId: vendor.id },
      }),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipCount: await db.vendorMember.count(),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      activeAccountantMembershipCount: await db.vendorMember.count({
        where: {
          vendorId: vendor.id,
          userId: user.id,
          role: "accountant",
          status: "active",
        },
      }),
      products: await db.product.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
      }),
      productCount: await db.product.count(),
      productVendorCount: await db.product.count({ where: { vendorId: vendor.id } }),
      productGlobalActiveCount: await db.product.count({ where: { isActive: true } }),
      productGlobalInactiveCount: await db.product.count({ where: { isActive: false } }),
      productVendorActiveCount: await db.product.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      productVendorInactiveCount: await db.product.count({
        where: { vendorId: vendor.id, isActive: false },
      }),
      productComposites: await Promise.all(
        products.map((product) =>
          db.product.count({
            where: {
              id: product.id,
              vendorId: vendor.id,
              slug: product.slug,
              isActive: product.isActive,
            },
          }),
        ),
      ),
      productRelations: await db.product.findMany({
        where: { id: { in: products.map((product) => product.id) } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
    });
    const before = await snapshot();
    const canaries = products.flatMap((product) => [
      product.id,
      product.name,
      product.slug,
      product.description ?? "",
      product.imageUrl ?? "",
      product.checkoutUrl ?? "",
    ]);

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    const path = "/products/new";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
      if (url.hostname.endsWith(".invalid")) invalid.push(request.url());
    });
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path,
      routeIdentityCanaries: [path],
      protectedPayloadCanaries: canaries,
      documentCanaries: canaries,
      transport: {
        kind: "streaming-redirect",
        status: 200,
        redirectMarker: "NEXT_REDIRECT",
        redirectTargetMarker: "/dashboard?error=insufficient_role",
      },
      finalUrl: "/dashboard?error=insufficient_role",
      finalStatus: 200,
      forbiddenPayload: [".invalid", "新增商品", "建立可綁定到直播間的商品卡與 CTA。"],
    });

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL("/dashboard?error=insufficient_role");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("商品點擊", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "新增商品", exact: true })).toHaveCount(0);
    await expect(page.getByText("建立可綁定到直播間的商品卡與 CTA。", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "商品管理", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/products"]')).toHaveCount(0);
    await expect(page.locator('a[href="/products/new"]')).toHaveCount(0);

    const targetProductForm = page.locator(
      'form:has([name="slug"]):has([name="priceCents"]):has([name="checkoutUrl"])',
    );
    await expect(targetProductForm).toHaveCount(0);
    for (const field of ["_csrf", "name", "description"]) {
      await expect(targetProductForm.locator(`[name="${field}"]`)).toHaveCount(0);
    }
    for (const field of [
      "slug",
      "priceCents",
      "compareAtCents",
      "currency",
      "inventory",
      "imageUrl",
      "checkoutUrl",
      "isActive",
    ]) {
      await expect(page.locator(`[name="${field}"]`)).toHaveCount(0);
    }
    for (const label of [
      "商品名稱",
      "Slug",
      "售價（分）",
      "原價（分）",
      "幣別",
      "庫存",
      "商品描述",
      "圖片 URL",
      "結帳 URL",
      "上架商品",
    ]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    for (const canary of canaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }
    for (const product of products) {
      await expect(page.locator(`a[href="/products/${product.id}/edit"]`)).toHaveCount(0);
      await expect(page.locator(`[style*="${product.imageUrl}"]`)).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
