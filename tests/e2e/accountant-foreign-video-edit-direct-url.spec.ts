import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp45SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied a foreign video editor before tenant lookup", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP45 Owner ${suffix}`, slug: `wp45-owner-${suffix}`, email: `wp45-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP45 Foreign ${suffix}`, slug: `wp45-foreign-${suffix}`, email: `wp45-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const ownVideoUrl = `https://wp45-own-${suffix}.invalid/video.mp4`;
  const foreignVideoUrl = `https://wp45-foreign-${suffix}.invalid/video.mp4`;
  const ownThumbnailUrl = `https://wp45-own-${suffix}.invalid/thumbnail.jpg`;
  const foreignThumbnailUrl = `https://wp45-foreign-${suffix}.invalid/thumbnail.jpg`;
  const [user, ownVideo, foreignVideo] = await Promise.all([
    db.user.create({ data: { email: `wp45-accountant-${suffix}@celebratedeal.test`, name: "WP45 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "accountant", status: "active" } } } }),
    db.video.create({ data: { vendorId: ownerVendor.id, title: `WP45 Own ${suffix}`, description: `WP45 own description ${suffix}`, sourceType: "url", videoUrl: ownVideoUrl, thumbnailUrl: ownThumbnailUrl, durationSec: 321, estimatedMinutes: 6, status: "ready" } }),
    db.video.create({ data: { vendorId: foreignVendor.id, title: `WP45 Foreign ${suffix}`, description: `WP45 foreign description ${suffix}`, sourceType: "url", videoUrl: foreignVideoUrl, thumbnailUrl: foreignThumbnailUrl, durationSec: 654, estimatedMinutes: 11, status: "archived" } }),
  ]);
  const snapshot = async () => Promise.all([
    db.video.findUniqueOrThrow({ where: { id: ownVideo.id } }),
    db.video.findUniqueOrThrow({ where: { id: foreignVideo.id } }),
    db.video.count({ where: { vendorId: ownerVendor.id } }),
    db.video.count({ where: { vendorId: foreignVendor.id } }),
  ]);
  const before = await snapshot();

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const requests: string[] = [];
    const responses: { url: string; status: number; location: string | null }[] = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("response", (response) => responses.push({ url: response.url(), status: response.status(), location: response.headers()["location"] ?? null }));
    const foreignPath = `/videos/${foreignVideo.id}/edit`;
    const response = await page.goto(foreignPath);
    const guard = responses.find((entry) => new URL(entry.url).pathname === foreignPath);
    expect(guard).toMatchObject({ status: 307, location: "/dashboard?error=insufficient_role" });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL("/dashboard?error=insufficient_role");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "編輯影片" })).toHaveCount(0);
    for (const label of ["影片名稱", "影片描述", "影片 URL", "縮圖 URL", "長度秒數", "估算用量分鐘", "狀態"]) await expect(page.getByLabel(label)).toHaveCount(0);
    for (const value of [ownVideo.title, ownVideo.description ?? "", foreignVideo.title, foreignVideo.description ?? "", ownVideoUrl, foreignVideoUrl, ownThumbnailUrl, foreignThumbnailUrl]) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    expect(requests.some((url) => /^https:\/\/(?!127\.0\.0\.1|localhost)/i.test(url) || /cloudflare|sentry|posthog|resend|payuni|\.invalid/i.test(url))).toBe(false);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
