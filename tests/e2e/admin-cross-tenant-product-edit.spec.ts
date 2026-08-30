import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp31SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("admin cannot open another vendor product edit route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP31 Owner ${suffix}`, slug: `wp31-owner-${suffix}`, email: `wp31-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP31 Foreign ${suffix}`, slug: `wp31-foreign-${suffix}`, email: `wp31-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownProduct, foreignProduct] = await Promise.all([
    db.user.create({ data: { email: `wp31-admin-${suffix}@celebratedeal.test`, name: "WP31 Active Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "admin", status: "active" } } } }),
    db.product.create({ data: { vendorId: ownerVendor.id, name: `WP31 Own Product ${suffix}`, slug: `wp31-own-${suffix}`, description: "own", priceCents: 100, currency: "TWD", inventory: 1, isActive: true } }),
    db.product.create({ data: { vendorId: foreignVendor.id, name: `WP31 Foreign Product ${suffix}`, slug: `wp31-foreign-product-${suffix}`, description: "foreign", priceCents: 100, currency: "TWD", inventory: 1, isActive: true } }),
  ]);
  const [ownBefore, foreignBefore, ownerCount, foreignCount] = await Promise.all([
    db.product.findUniqueOrThrow({ where: { id: ownProduct.id } }),
    db.product.findUniqueOrThrow({ where: { id: foreignProduct.id } }),
    db.product.count({ where: { vendorId: ownerVendor.id } }),
    db.product.count({ where: { vendorId: foreignVendor.id } }),
  ]);
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const ownPath = `/products/${ownProduct.id}/edit`;
    const ownResponse = await page.goto(ownPath);
    expect(ownResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${ownPath}$`));
    await expect(page.getByRole("heading", { name: "編輯商品" })).toBeVisible();
    await expect(page.getByLabel("商品名稱")).toHaveValue(ownProduct.name);
    const foreignPath = `/products/${foreignProduct.id}/edit`;
    const foreignCanaries = [foreignProduct.name];
    const { finalResponse: foreignResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path: foreignPath,
      routeIdentityCanaries: [foreignProduct.id, foreignPath],
      protectedPayloadCanaries: foreignCanaries,
      documentCanaries: foreignCanaries,
      finalUrl: new RegExp(`${foreignPath}$`),
      transport: { kind: "streaming-not-found", status: 200 },
      finalStatus: 200,
    });
    expect(foreignResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${foreignPath}$`));
    await expect(page.getByRole("heading", { name: "編輯商品" })).toHaveCount(0);
    await expect(page.getByLabel("商品名稱")).toHaveCount(0);
    await expect(page.getByText(foreignProduct.name)).toHaveCount(0);
    await expect.poll(async () => Promise.all([
      db.product.findUniqueOrThrow({ where: { id: ownProduct.id } }),
      db.product.findUniqueOrThrow({ where: { id: foreignProduct.id } }),
      db.product.count({ where: { vendorId: ownerVendor.id } }),
      db.product.count({ where: { vendorId: foreignVendor.id } }),
    ])).toEqual([ownBefore, foreignBefore, ownerCount, foreignCount]);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
