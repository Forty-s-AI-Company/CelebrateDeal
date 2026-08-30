import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp40SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("admin cannot open another vendor video edit route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP40 Owner ${suffix}`, slug: `wp40-owner-${suffix}`, email: `wp40-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP40 Foreign ${suffix}`, slug: `wp40-foreign-${suffix}`, email: `wp40-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const ownVideoUrl = `https://wp40-own-${suffix}.invalid/video.mp4`;
  const ownThumbnailUrl = `https://wp40-own-${suffix}.invalid/thumbnail.jpg`;
  const foreignVideoUrl = `https://wp40-foreign-${suffix}.invalid/video.mp4`;
  const foreignThumbnailUrl = `https://wp40-foreign-${suffix}.invalid/thumbnail.jpg`;
  const [user, ownVideo, foreignVideo] = await Promise.all([
    db.user.create({ data: { email: `wp40-admin-${suffix}@celebratedeal.test`, name: "WP40 Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "admin", status: "active" } } } }),
    db.video.create({ data: { vendorId: ownerVendor.id, title: `WP40 Own ${suffix}`, description: `WP40 own description ${suffix}`, sourceType: "url", videoUrl: ownVideoUrl, thumbnailUrl: ownThumbnailUrl, durationSec: 321, estimatedMinutes: 6, status: "ready" } }),
    db.video.create({ data: { vendorId: foreignVendor.id, title: `WP40 Foreign ${suffix}`, description: `WP40 foreign description ${suffix}`, sourceType: "url", videoUrl: foreignVideoUrl, thumbnailUrl: foreignThumbnailUrl, durationSec: 654, estimatedMinutes: 11, status: "archived" } }),
  ]);
  const snapshot = async () => Promise.all([
    db.video.findUniqueOrThrow({ where: { id: ownVideo.id } }),
    db.video.findUniqueOrThrow({ where: { id: foreignVideo.id } }),
    db.video.count({ where: { vendorId: ownerVendor.id } }),
    db.video.count({ where: { vendorId: foreignVendor.id } }),
  ]);
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const before = await snapshot();

    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const ownPath = `/videos/${ownVideo.id}/edit`;
    const ownResponse = await page.goto(ownPath);
    expect(ownResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${ownPath}$`));
    await expect(page.getByRole("heading", { name: "編輯影片" })).toBeVisible();
    await expect(page.getByLabel("影片名稱")).toHaveValue(ownVideo.title);
    await expect(page.getByLabel("影片描述")).toHaveValue(ownVideo.description ?? "");
    await expect(page.getByText("替換影片檔案", { exact: true })).toBeVisible();
    const replacementVideoInput = page.locator('input[type="file"][accept="video/*"]');
    await expect(replacementVideoInput).toHaveCount(1);
    await expect(replacementVideoInput).toBeAttached();
    await expect(page.getByText("進階：使用既有外部影片 URL", { exact: true })).toBeVisible();
    await expect(page.getByLabel("影片 URL")).toBeHidden();
    await page.getByText("進階：使用既有外部影片 URL", { exact: true }).click();
    await expect(page.getByLabel("影片 URL")).toHaveValue(ownVideo.videoUrl);
    await expect(page.getByText("進階：使用既有圖片 URL", { exact: true })).toBeVisible();
    await expect(page.getByLabel("圖片 URL")).toBeHidden();
    await page.getByText("進階：使用既有圖片 URL", { exact: true }).click();
    await expect(page.getByLabel("圖片 URL")).toHaveValue(ownVideo.thumbnailUrl ?? "");
    await expect(page.getByLabel("長度秒數")).toHaveValue(String(ownVideo.durationSec));
    await expect(page.getByLabel("估算用量分鐘")).toHaveValue(String(ownVideo.estimatedMinutes));
    await expect(page.getByLabel("狀態")).toHaveValue(ownVideo.status);
    await expect(page.getByText("尚未建立 Live Input", { exact: true })).toBeVisible();

    const foreignPath = `/videos/${foreignVideo.id}/edit`;
    const foreignDataCanaries = [foreignVideo.title, foreignVideo.description ?? "", foreignVideoUrl, foreignThumbnailUrl];
    requests.length = 0;
    await navigateAndAssertDirectUrlGuard({
      page,
      path: foreignPath,
      routeIdentityCanaries: [foreignVideo.id],
      protectedPayloadCanaries: foreignDataCanaries,
      documentCanaries: foreignDataCanaries,
      finalUrl: new RegExp(`${foreignPath}$`),
      transport: {
        kind: "streaming-not-found",
        status: 200,
      },
      finalStatus: 200,
    });
    await expect(page.getByRole("heading", { name: "編輯影片" })).toHaveCount(0);
    for (const label of ["影片名稱", "影片描述", "影片 URL", "圖片 URL", "長度秒數", "估算用量分鐘", "狀態"]) await expect(page.getByLabel(label)).toHaveCount(0);
    for (const value of [foreignVideo.id, ...foreignDataCanaries]) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    const documentContent = await page.content();
    // Next.js serializes the requested dynamic route ID into the 404 RSC payload.
    // That URL echo is not a Video-row disclosure; media values must still be absent.
    for (const value of foreignDataCanaries) expect(documentContent).not.toContain(value);
    expect(requests.some((url) => url.includes(".invalid") || /cloudflare/i.test(url))).toBe(false);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
