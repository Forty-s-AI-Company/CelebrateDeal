import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp62SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied the blacklist index before identifiers or actions are exposed", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp62-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP62 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: "WP62 Active Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
    },
  });
  const blacklists = await Promise.all([
    db.blacklist.create({
      data: {
        vendorId: vendor.id,
        identifier: `blocked-${tag}@example.test`,
        identifierType: "email",
        reason: `WP62 active reason ${suffix}`,
        notes: `WP62 active notes ${suffix}`,
        isActive: true,
        blockedAt: new Date("2032-01-01T00:00:00.000Z"),
      },
    }),
    db.blacklist.create({
      data: {
        vendorId: vendor.id,
        identifier: `wp62-visitor-${suffix}`,
        identifierType: "visitor_id",
        reason: `WP62 inactive reason ${suffix}`,
        notes: `WP62 inactive notes ${suffix}`,
        isActive: false,
        blockedAt: new Date("2032-01-02T00:00:00.000Z"),
        unblockedAt: new Date("2032-01-03T00:00:00.000Z"),
      },
    }),
  ]);
  const membership = await db.vendorMember.findUniqueOrThrow({
    where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
  });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const snapshot = async () => ({
      vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
      vendorCount: await db.vendor.count(),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      blacklists: await db.blacklist.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
      }),
      blacklistCount: await db.blacklist.count(),
      blacklistVendorCount: await db.blacklist.count({ where: { vendorId: vendor.id } }),
      blacklistActiveCount: await db.blacklist.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      blacklistInactiveCount: await db.blacklist.count({
        where: { vendorId: vendor.id, isActive: false },
      }),
    });
    const before = await snapshot();
    const canaries = blacklists.flatMap((entry) => [
      entry.id,
      entry.identifier,
      entry.reason,
      entry.notes,
    ]).filter((value): value is string => Boolean(value));

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/blacklists";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
    });
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path,
      routeIdentityCanaries: [path],
      protectedPayloadCanaries: canaries,
      documentCanaries: [...canaries, "visitor_id"],
      transport: {
        kind: "streaming-redirect",
        status: 200,
        redirectMarker: "NEXT_REDIRECT",
        redirectTargetMarker: "/dashboard?error=insufficient_role",
      },
      finalUrl: "/dashboard?error=insufficient_role",
      finalStatus: 200,
      forbiddenPayload: ["visitor_id"],
    });

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "黑名單管理", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "新增封鎖項目", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("識別值", { exact: true })).toHaveCount(0);
    await expect(page.getByText("類型", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("原因", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("備註", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "加入黑名單", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "解除封鎖", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("搜尋黑名單", { exact: true })).toHaveCount(0);
    await expect(page.getByText("本機篩選", { exact: true })).toHaveCount(0);
    await expect(page.getByText("封鎖中", { exact: true })).toHaveCount(0);
    await expect(page.getByText("已解除", { exact: true })).toHaveCount(0);

    const main = page.getByRole("main");
    await expect(main.locator('form:has(input[name="identifier"]):has(input[name="_csrf"])')).toHaveCount(0);
    for (const entry of blacklists) {
      await expect(main.locator(`form:has(input[name="id"][value="${entry.id}"])`)).toHaveCount(0);
      await expect(page.locator(`input[name="id"][value="${entry.id}"]`)).toHaveCount(0);
    }
    for (const canary of canaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByText("visitor_id", { exact: true })).toHaveCount(0);

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
