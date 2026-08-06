import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp59SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

test("active accountant is denied video creation through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp59-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP59 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const [user, video] = await Promise.all([
    db.user.create({
      data: {
        email: `accountant-${tag}@celebratedeal.test`,
        name: "WP59 Active Accountant",
        passwordHash: hashPassword(password),
        status: "active",
        memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
      },
    }),
    db.video.create({
      data: {
        vendorId: vendor.id,
        title: `WP59 Video ${suffix}`,
        description: `WP59 description ${suffix}`,
        sourceType: "url",
        videoUrl: `https://${tag}.invalid/video.mp4`,
        thumbnailUrl: `https://${tag}.invalid/thumbnail.jpg`,
        durationSec: 359,
        estimatedMinutes: 6,
        status: "archived",
      },
    }),
  ]);
  const snapshot = async () => ({
    vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
    vendorCount: await db.vendor.count(),
    video: await db.video.findUniqueOrThrow({ where: { id: video.id } }),
    videoCount: await db.video.count({ where: { vendorId: vendor.id } }),
  });
  const before = await snapshot();

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const posts: string[] = [];
    const external: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
    });

    const path = "/videos/new";
    const rawRedirect = page.waitForResponse(
      (response) => new URL(response.url()).pathname === path && response.status() === 307,
    );
    const finalResponse = await page.goto(path);
    const redirectResponse = await rawRedirect;
    const location = new URL(redirectResponse.headers().location ?? "", "http://127.0.0.1");

    expect(finalResponse?.status()).toBe(200);
    expect(`${location.pathname}${location.search}`).toBe("/dashboard?error=insufficient_role");
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "新增影片" })).toHaveCount(0);
    for (const label of ["影片名稱", "影片描述", "影片 URL", "縮圖 URL", "長度秒數", "估算用量分鐘", "狀態"]) {
      await expect(page.getByLabel(label)).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /儲存/ })).toHaveCount(0);
    for (const canary of [video.title, video.description, video.videoUrl, video.thumbnailUrl].filter((value): value is string => Boolean(value))) {
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
