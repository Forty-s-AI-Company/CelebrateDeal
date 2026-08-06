import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp46SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

test("active accountant is denied a foreign live editor before tenant and asset lookups", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP46 Owner ${suffix}`, slug: `wp46-owner-${suffix}`, email: `wp46-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP46 Foreign ${suffix}`, slug: `wp46-foreign-${suffix}`, email: `wp46-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownLive, foreignLive] = await Promise.all([
    db.user.create({ data: { email: `wp46-accountant-${suffix}@celebratedeal.test`, name: "WP46 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "accountant", status: "active" } } } }),
    db.live.create({ data: { vendorId: ownerVendor.id, title: `WP46 Own Live ${suffix}`, slug: `wp46-own-live-${suffix}`, description: `WP46 own description ${suffix}`, scheduledAt: new Date("2026-01-01T00:00:00.000Z") } }),
    db.live.create({ data: { vendorId: foreignVendor.id, title: `WP46 Foreign Live ${suffix}`, slug: `wp46-foreign-live-${suffix}`, description: `WP46 foreign description ${suffix}`, scheduledAt: new Date("2026-01-01T00:00:00.000Z") } }),
  ]);
  const snapshot = async () => Promise.all([
    db.live.findUniqueOrThrow({ where: { vendorId_id: { vendorId: ownerVendor.id, id: ownLive.id } }, include: { products: true } }),
    db.live.findUniqueOrThrow({ where: { vendorId_id: { vendorId: foreignVendor.id, id: foreignLive.id } }, include: { products: true } }),
    db.live.count({ where: { vendorId: ownerVendor.id } }),
    db.live.count({ where: { vendorId: foreignVendor.id } }),
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
    const foreignPath = `/lives/${foreignLive.id}/edit`;
    const response = await page.goto(foreignPath);
    const guard = responses.find((entry) => new URL(entry.url).pathname === foreignPath);
    expect(guard).toMatchObject({ status: 307, location: "/dashboard?error=insufficient_role" });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL("/dashboard?error=insufficient_role");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "編輯直播間" })).toHaveCount(0);
    for (const label of ["直播標題", "Slug", "開播時間", "串流模式", "狀態", "影片", "表單", "通知模板", "互動腳本", "直播說明", "Hero 圖片 URL", "促銷短句"]) await expect(page.getByLabel(label)).toHaveCount(0);
    // Dashboard may legitimately list the accountant's own Live title; the
    // foreign row remains inaccessible, while neither editor description canary
    // may be serialized into this rejected navigation.
    for (const value of [ownLive.description ?? "", foreignLive.title, foreignLive.description ?? ""]) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    expect(requests.some((url) => /^https:\/\/(?!127\.0\.0\.1|localhost)/i.test(url) || /cloudflare|stream|sentry|posthog|resend|payuni/i.test(url))).toBe(false);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
