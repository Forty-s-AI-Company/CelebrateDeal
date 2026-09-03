import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatCurrency } from "../../src/lib/format";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp67SyntheticPassword!";

function highEntropyInventoryFromSuffix(seed: string, start: number) {
  return 100_000_000 + (Number.parseInt(seed.slice(start, start + 8), 16) % 900_000_000);
}

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied the products index before product data is queried or rendered", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp67-${suffix}`;
  const activeInventory = highEntropyInventoryFromSuffix(suffix, 0);
  const inactiveInventoryBase = highEntropyInventoryFromSuffix(suffix, 8);
  const inactiveInventory =
    inactiveInventoryBase === activeInventory
      ? activeInventory === 999_999_999
        ? 100_000_000
        : activeInventory + 1
      : inactiveInventoryBase;
  const vendor = await db.vendor.create({
    data: {
      name: `WP67 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP67-FB-${suffix}`,
          tiktokPixelId: `WP67-TT-${suffix}`,
          googleTagManagerId: `WP67-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: "WP67 Active Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
    },
  });
  const products = await Promise.all([
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP67 Active Product ${suffix}`,
        slug: `active-${tag}`,
        description: `WP67 active product description ${suffix}`,
        priceCents: 670167,
        compareAtCents: 970197,
        currency: "TWD",
        imageUrl: `https://active-image-${tag}.invalid/product.jpg`,
        checkoutUrl: `https://active-checkout-${tag}.invalid/order`,
        inventory: activeInventory,
        isActive: true,
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP67 Inactive Product ${suffix}`,
        slug: `inactive-${tag}`,
        description: `WP67 inactive product description ${suffix}`,
        priceCents: 670267,
        compareAtCents: 970297,
        currency: "USD",
        imageUrl: `https://inactive-image-${tag}.invalid/product.jpg`,
        checkoutUrl: `https://inactive-checkout-${tag}.invalid/order`,
        inventory: inactiveInventory,
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
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipCount: await db.vendorMember.count(),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      membershipRelationCount: await db.vendorMember.count({
        where: { vendorId: vendor.id, userId: user.id },
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
      productVendorRelations: await db.product.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
    });
    const before = await snapshot();
    const prices = products.map((product) => formatCurrency(product.priceCents, product.currency));
    const rawCanaries = products
      .flatMap((product, index) => [
        product.id,
        product.name,
        product.slug,
        product.description,
        String(product.priceCents),
        String(product.compareAtCents),
        // ISO currency codes are shared runtime vocabulary (for example, a
        // framework or locale payload can legitimately contain "USD"). The
        // product-specific formatted price below retains currency coverage
        // together with a per-record amount, while the remaining generated
        // fields prove that this product's database row was not serialized.
        String(product.inventory),
        product.imageUrl,
        product.checkoutUrl,
        prices[index],
      ])
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/products";
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
      documentCanaries: rawCanaries,
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
    await expect(page.getByText("商品點擊", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "商品管理", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "新增商品", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/products"]')).toHaveCount(0);
    await expect(page.locator('a[href="/products/new"]')).toHaveCount(0);
    for (const product of products) {
      await expect(page.locator(`a[href="/products/${product.id}/edit"]`)).toHaveCount(0);
      await expect(page.getByText(product.name, { exact: true })).toHaveCount(0);
      await expect(page.getByText(product.description ?? "", { exact: true })).toHaveCount(0);
      await expect(page.locator(`[style*="${product.imageUrl}"]`)).toHaveCount(0);
    }
    for (const price of prices) {
      await expect(page.getByText(price, { exact: true })).toHaveCount(0);
    }
    for (const status of ["上架", "停用"]) {
      await expect(page.getByText(status, { exact: true })).toHaveCount(0);
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

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
