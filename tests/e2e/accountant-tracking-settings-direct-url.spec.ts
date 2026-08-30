import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp57SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

test("active accountant is denied same-vendor tracking settings through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const canary = `wp57-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP57 ${suffix}`,
      slug: canary,
      email: `${canary}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `facebook-${canary}`,
          tiktokPixelId: `tiktok-${canary}`,
          googleTagManagerId: `gtm-${canary}`,
          enablePageView: false,
          enableLeadEvent: false,
          enablePurchaseEvent: false,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${canary}@celebratedeal.test`,
      name: "WP57 Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
    },
  });
  const tracking = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: vendor.id } });
  const snapshot = () => Promise.all([
    db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
    db.trackingSetting.findUniqueOrThrow({ where: { vendorId: vendor.id } }),
    db.vendor.count({ where: { id: vendor.id } }),
    db.trackingSetting.count({ where: { vendorId: vendor.id } }),
  ]);
  const before = await snapshot();

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const postRequests: string[] = [];
    const nonLoopbackRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") postRequests.push(`${request.method()} ${url.pathname}`);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) nonLoopbackRequests.push(request.url());
    });

    const path = "/settings/tracking";
    const canaries = [tracking.facebookPixelId, tracking.tiktokPixelId, tracking.googleTagManagerId].filter(
      (value): value is string => Boolean(value),
    );
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

    for (const name of ["追蹤設定", "Facebook Pixel ID", "TikTok Pixel ID", "Google Tag Manager ID", "記錄頁面瀏覽", "記錄名單送出", "記錄商品 CTA"]) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /儲存|提交|送出/ })).toHaveCount(0);
    for (const value of canaries) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    const content = await page.content();
    for (const value of canaries) expect(content).not.toContain(value);
    expect(postRequests).toEqual([]);
    expect(nonLoopbackRequests).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
