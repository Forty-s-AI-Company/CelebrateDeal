import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp58SyntheticPassword!";
test.setTimeout(60_000);

test("active accountant is denied same-vendor brand settings through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp58-${suffix}`;
  const vendor = await db.vendor.create({ data: { name: `Brand ${tag}`, slug: tag, email: `${tag}@celebratedeal.test`, passwordHash: hashPassword(password), logoUrl: `https://${tag}.invalid/logo.png`, primaryColor: "#123456", ctaColor: "#654321", timezone: "Asia/Taipei", supportEmail: `support-${tag}@example.test`, tracking: { create: {} } } });
  const user = await db.user.create({ data: { email: `accountant-${tag}@celebratedeal.test`, name: "WP58 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } } } });
  const before = await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } });
  const vendorCountBefore = await db.vendor.count();
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const posts: string[] = []; const external: string[] = [];
    page.on("request", (request) => { const url = new URL(request.url()); if (request.method() === "POST") posts.push(url.pathname); if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url()); });
    const canaries = [before.logoUrl, before.primaryColor, before.ctaColor, before.timezone, before.supportEmail].filter((value): value is string => Boolean(value));
    const path = "/settings/brand";
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
    });
    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL("/dashboard?error=insufficient_role");
    // Dashboard 合法顯示目前商家名稱；只把品牌設定頁專屬值當成資料洩漏 canary。
    for (const value of canaries) await expect(page.getByText(value, { exact: true })).toHaveCount(0); for (const label of ["品牌設定", "品牌名稱", "品牌 Slug", "Logo URL", "客服 Email"]) await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    expect(posts).toEqual([]); expect(external).toEqual([]); await expect.poll(() => db.vendor.findUniqueOrThrow({ where: { id: vendor.id } })).toEqual(before); await expect.poll(() => db.vendor.count()).toBe(vendorCountBefore);
  } finally { await db.vendor.deleteMany({ where: { id: vendor.id } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
