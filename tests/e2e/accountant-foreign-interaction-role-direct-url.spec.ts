import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp43SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied a foreign interaction-role editor before tenant lookup", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP43 Owner ${suffix}`, slug: `wp43-owner-${suffix}`, email: `wp43-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP43 Foreign ${suffix}`, slug: `wp43-foreign-${suffix}`, email: `wp43-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownRole, foreignRole] = await Promise.all([
    db.user.create({ data: { email: `wp43-accountant-${suffix}@celebratedeal.test`, name: "WP43 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "accountant", status: "active" } } } }),
    db.interactionRole.create({ data: { vendorId: ownerVendor.id, name: `WP43 Own Role ${suffix}`, label: `WP43 Own Label ${suffix}`, tone: `WP43 Own Tone ${suffix}`, avatarUrl: null, isActive: true } }),
    db.interactionRole.create({ data: { vendorId: foreignVendor.id, name: `WP43 Foreign Role ${suffix}`, label: `WP43 Foreign Label ${suffix}`, tone: `WP43 Foreign Tone ${suffix}`, avatarUrl: null, isActive: true } }),
  ]);
  const snapshot = async () => Promise.all([db.interactionRole.findUniqueOrThrow({ where: { id: ownRole.id } }), db.interactionRole.findUniqueOrThrow({ where: { id: foreignRole.id } }), db.interactionRole.count({ where: { vendorId: ownerVendor.id } }), db.interactionRole.count({ where: { vendorId: foreignVendor.id } })]);
  const before = await snapshot();
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email); await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const requests: string[] = []; const responses: { url: string; status: number; location: string | undefined }[] = []; page.on("request", (request) => requests.push(request.url())); page.on("response", (response) => responses.push({ url: response.url(), status: response.status(), location: response.headers()["location"] }));
    const foreignPath = `/interaction-roles/${foreignRole.id}/edit`;
    const response = await page.goto(foreignPath);
    const guardResponse = responses.find((entry) => new URL(entry.url).pathname === foreignPath);
    expect(guardResponse).toEqual(expect.objectContaining({ status: 307, location: "/dashboard?error=insufficient_role" }));
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    for (const text of ["互動角色", "使用者清單", "編輯使用者", "暱稱", "角色類型", "顯示標籤", "語氣設定", "啟用使用者", ownRole.name, ownRole.label, ownRole.tone ?? "", foreignRole.name, foreignRole.label, foreignRole.tone ?? ""]) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    const externalRequests = requests.filter((url) => /https:\/\/(?!127\.0\.0\.1)|cloudflare|openai|resend|payuni|sentry|posthog/i.test(url));
    expect(externalRequests).toEqual([]); await expect.poll(snapshot).toEqual(before);
  } finally { await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } }); await db.user.deleteMany({ where: { id: user.id } }); await db.$disconnect(); }
});
