import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp44SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied a foreign product editor before tenant lookup", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP44 Owner ${suffix}`, slug: `wp44-owner-${suffix}`, email: `wp44-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP44 Foreign ${suffix}`, slug: `wp44-foreign-${suffix}`, email: `wp44-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownProduct, foreignProduct] = await Promise.all([
    db.user.create({ data: { email: `wp44-accountant-${suffix}@celebratedeal.test`, name: "WP44 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "accountant", status: "active" } } } }),
    db.product.create({ data: { vendorId: ownerVendor.id, name: `WP44 Own Product ${suffix}`, slug: `wp44-own-${suffix}`, description: `WP44 own description ${suffix}`, priceCents: 100, currency: "TWD", inventory: 1, isActive: true } }),
    db.product.create({ data: { vendorId: foreignVendor.id, name: `WP44 Foreign Product ${suffix}`, slug: `wp44-foreign-${suffix}`, description: `WP44 foreign description ${suffix}`, priceCents: 100, currency: "TWD", inventory: 1, isActive: true } }),
  ]);
  const snapshot = async () => Promise.all([db.product.findUniqueOrThrow({ where: { id: ownProduct.id } }), db.product.findUniqueOrThrow({ where: { id: foreignProduct.id } }), db.product.count({ where: { vendorId: ownerVendor.id } }), db.product.count({ where: { vendorId: foreignVendor.id } })]);
  const before = await snapshot();
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const requests: string[] = []; const responses: { url: string; status: number; location: string | undefined }[] = []; page.on("request", (request) => requests.push(request.url())); page.on("response", (response) => responses.push({ url: response.url(), status: response.status(), location: response.headers()["location"] }));
    const foreignPath = `/products/${foreignProduct.id}/edit`; const response = await page.goto(foreignPath);
    const guard = responses.find((entry) => new URL(entry.url).pathname === foreignPath);
    expect(guard).toEqual(expect.objectContaining({ status: 307, location: "/dashboard?error=insufficient_role" })); expect(response?.status()).toBe(200); await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/); await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "編輯商品" })).toHaveCount(0); await expect(page.getByLabel("商品名稱")).toHaveCount(0); await expect(page.getByRole("button", { name: /儲存|更新/ })).toHaveCount(0);
    for (const value of [ownProduct.name, ownProduct.slug, ownProduct.description ?? "", foreignProduct.name, foreignProduct.slug, foreignProduct.description ?? ""]) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    expect(requests.filter((url) => /https:\/\/(?!127\.0\.0\.1)|cloudflare|openai|resend|payuni|sentry|posthog/i.test(url))).toEqual([]); await expect.poll(snapshot).toEqual(before);
  } finally { await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
