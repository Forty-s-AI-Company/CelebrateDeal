import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp41SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

test("admin cannot open another vendor live preview through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP41 Owner ${suffix}`, slug: `wp41-owner-${suffix}`, email: `wp41-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP41 Foreign ${suffix}`, slug: `wp41-foreign-${suffix}`, email: `wp41-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownLive, foreignLive] = await Promise.all([
    db.user.create({ data: { email: `wp41-admin-${suffix}@celebratedeal.test`, name: "WP41 Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "admin", status: "active" } } } }),
    db.live.create({ data: { vendorId: ownerVendor.id, title: `WP41 Own ${suffix}`, slug: `wp41-own-${suffix}`, description: `WP41 own description ${suffix}`, scheduledAt: new Date("2026-01-01T00:00:00.000Z"), streamMode: "vod", cloudflareLiveInputUid: `wp41-own-uid-${suffix}` } }),
    db.live.create({ data: { vendorId: foreignVendor.id, title: `WP41 Foreign ${suffix}`, slug: `wp41-foreign-${suffix}`, description: `WP41 foreign description ${suffix}`, scheduledAt: new Date("2026-01-01T00:00:00.000Z"), streamMode: "vod", cloudflareLiveInputUid: `wp41-foreign-uid-${suffix}` } }),
  ]);
  const snapshot = async () => Promise.all([db.live.findUniqueOrThrow({ where: { vendorId_id: { vendorId: ownerVendor.id, id: ownLive.id } } }), db.live.findUniqueOrThrow({ where: { vendorId_id: { vendorId: foreignVendor.id, id: foreignLive.id } } }), db.live.count({ where: { vendorId: ownerVendor.id } }), db.live.count({ where: { vendorId: foreignVendor.id } })]);
  const before = await snapshot();
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const requests: string[] = []; page.on("request", (request) => requests.push(request.url()));
    const ownPath = `/lives/${ownLive.id}/preview`; const ownResponse = await page.goto(ownPath); expect(ownResponse?.status()).toBe(200); await expect(page).toHaveURL(new RegExp(`${ownPath}$`));
    await expect(page.getByRole("heading", { name: "直播預覽" })).toBeVisible(); await expect(page.getByText(ownLive.title, { exact: true })).toBeVisible(); await expect(page.getByText(ownLive.description ?? "", { exact: true })).toBeVisible(); await expect(page.getByText(`/live/${ownLive.slug}`, { exact: true })).toBeVisible(); await expect(page.getByText(`串流模式：${ownLive.streamMode}`, { exact: true })).toBeVisible(); await expect(page.getByText(`Cloudflare Live Input：${ownLive.cloudflareLiveInputUid}`, { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "開啟公開頁" })).toHaveAttribute("href", `/live/${ownLive.slug}`);
    const foreignPath = `/lives/${foreignLive.id}/preview`;
    const foreignCanaries = [foreignLive.title, foreignLive.description ?? "", foreignLive.slug, foreignLive.cloudflareLiveInputUid ?? ""];
    const { finalResponse: foreignResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path: foreignPath,
      routeIdentityCanaries: [foreignLive.id, foreignPath],
      protectedPayloadCanaries: foreignCanaries,
      documentCanaries: foreignCanaries,
      finalUrl: new RegExp(`${foreignPath}$`),
      transport: { kind: "streaming-not-found", status: 200 },
      finalStatus: 200,
    });
    expect(foreignResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${foreignPath}$`));
    await expect(page.getByRole("heading", { name: "直播預覽" })).toHaveCount(0); await expect(page.getByRole("link", { name: "開啟公開頁" })).toHaveCount(0);
    for (const value of foreignCanaries) await expect(page.getByText(value, { exact: true })).toHaveCount(0); const content = await page.content(); for (const value of foreignCanaries) expect(content).not.toContain(value);
    const forbiddenRequests = requests.filter((url) => /cloudflare|\/live\//i.test(url));
    expect(forbiddenRequests, `unexpected public-live or Cloudflare requests: ${forbiddenRequests.join(", ")}`).toEqual([]); await expect.poll(snapshot).toEqual(before);
  } finally { await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
