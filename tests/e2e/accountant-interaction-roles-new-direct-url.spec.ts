import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp71SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session or media.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied interaction-role creation before role data, CSRF, or controls render", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp71-${suffix}`;
  const activeRoleType = `wp71-active-type-${suffix}`;
  const inactiveRoleType = `wp71-inactive-type-${suffix}`;
  const activeLabel = `WP71 Active Label ${suffix}`;
  const inactiveLabel = `WP71 Inactive Label ${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP71 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP71-FB-${suffix}`,
          tiktokPixelId: `WP71-TT-${suffix}`,
          googleTagManagerId: `WP71-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: "WP71 Active Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: { vendorId: vendor.id, role: "accountant", status: "active" },
      },
    },
  });
  const roles = await Promise.all([
    db.interactionRole.create({
      data: {
        vendorId: vendor.id,
        name: `WP71 Active Role ${suffix}`,
        avatarUrl: `https://active-avatar-${tag}.invalid/avatar.svg`,
        label: activeLabel,
        roleType: activeRoleType,
        tone: `WP71 Active Tone ${suffix}`,
        isActive: true,
      },
    }),
    db.interactionRole.create({
      data: {
        vendorId: vendor.id,
        name: `WP71 Inactive Role ${suffix}`,
        avatarUrl: `https://inactive-avatar-${tag}.invalid/avatar.svg`,
        label: inactiveLabel,
        roleType: inactiveRoleType,
        tone: `WP71 Inactive Tone ${suffix}`,
        isActive: false,
      },
    }),
  ]);
  const [tracking, membership] = await Promise.all([
    db.trackingSetting.findUniqueOrThrow({ where: { vendorId: vendor.id } }),
    db.vendorMember.findUniqueOrThrow({
      where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    }),
  ]);

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const snapshot = async () => ({
      vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
      vendorCount: await db.vendor.count(),
      tracking: await db.trackingSetting.findUniqueOrThrow({ where: { id: tracking.id } }),
      trackingCount: await db.trackingSetting.count(),
      trackingVendorCount: await db.trackingSetting.count({ where: { vendorId: vendor.id } }),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipCount: await db.vendorMember.count(),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      membershipRelationCount: await db.vendorMember.count({
        where: { vendorId: vendor.id, userId: user.id },
      }),
      roles: await db.interactionRole.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
      }),
      roleCount: await db.interactionRole.count(),
      roleVendorCount: await db.interactionRole.count({ where: { vendorId: vendor.id } }),
      globalActiveCount: await db.interactionRole.count({ where: { isActive: true } }),
      globalInactiveCount: await db.interactionRole.count({ where: { isActive: false } }),
      vendorActiveCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      vendorInactiveCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, isActive: false },
      }),
      globalActiveTypeCount: await db.interactionRole.count({
        where: { roleType: activeRoleType },
      }),
      globalInactiveTypeCount: await db.interactionRole.count({
        where: { roleType: inactiveRoleType },
      }),
      vendorActiveTypeCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, roleType: activeRoleType },
      }),
      vendorInactiveTypeCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, roleType: inactiveRoleType },
      }),
      globalActiveLabelCount: await db.interactionRole.count({
        where: { label: activeLabel },
      }),
      globalInactiveLabelCount: await db.interactionRole.count({
        where: { label: inactiveLabel },
      }),
      vendorActiveLabelCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, label: activeLabel },
      }),
      vendorInactiveLabelCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, label: inactiveLabel },
      }),
      activeCompositeCount: await db.interactionRole.count({
        where: {
          vendorId: vendor.id,
          roleType: activeRoleType,
          label: activeLabel,
          isActive: true,
        },
      }),
      inactiveCompositeCount: await db.interactionRole.count({
        where: {
          vendorId: vendor.id,
          roleType: inactiveRoleType,
          label: inactiveLabel,
          isActive: false,
        },
      }),
      roleVendorRelations: await db.interactionRole.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
    });
    const before = await snapshot();
    const canaries = roles
      .flatMap((role) => [
        role.id,
        role.name,
        role.avatarUrl,
        role.label,
        role.roleType,
        role.tone,
      ])
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/interaction-roles/new";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
        external.push(request.url());
      }
    });
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
      forbiddenPayload: [".invalid", "匯入 10 個官方角色", "使用者清單"],
    });

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL("/dashboard?error=insufficient_role");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("商品點擊", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "互動角色", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "使用者清單", exact: true })).toHaveCount(0);
    await expect(page.getByText("新增使用者", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "匯入 10 個官方角色", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新增", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/interaction-roles"]')).toHaveCount(0);
    await expect(page.locator('a[href="/interaction-roles/new"]')).toHaveCount(0);
    for (const role of roles) {
      await expect(page.locator(`a[href="/interaction-roles/${role.id}/edit"]`)).toHaveCount(0);
      await expect(page.locator(`img[src="${role.avatarUrl}"]`)).toHaveCount(0);
    }
    for (const name of ["avatarUrl", "name", "roleType", "label", "tone", "isActive"]) {
      await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
    }
    for (const label of ["暱稱", "角色類型", "顯示標籤", "語氣設定", "啟用使用者"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    for (const canary of canaries) {
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
