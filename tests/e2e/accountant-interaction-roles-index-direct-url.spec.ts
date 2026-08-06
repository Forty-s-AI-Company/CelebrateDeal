import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp65SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied the interaction roles index before role data is queried or rendered", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp65-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP65 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP65-FB-${suffix}`,
          tiktokPixelId: `WP65-TT-${suffix}`,
          googleTagManagerId: `WP65-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: "WP65 Active Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
    },
  });
  const roles = await Promise.all([
    db.interactionRole.create({
      data: {
        vendorId: vendor.id,
        name: `WP65 Active Role ${suffix}`,
        avatarUrl: `https://avatar-active-${tag}.invalid/avatar.svg`,
        label: `WP65 Active Label ${suffix}`,
        roleType: `wp65-active-type-${suffix}`,
        tone: `WP65 Active Tone ${suffix}`,
        isActive: true,
      },
    }),
    db.interactionRole.create({
      data: {
        vendorId: vendor.id,
        name: `WP65 Inactive Role ${suffix}`,
        avatarUrl: `https://avatar-inactive-${tag}.invalid/avatar.svg`,
        label: `WP65 Inactive Label ${suffix}`,
        roleType: `wp65-inactive-type-${suffix}`,
        tone: `WP65 Inactive Tone ${suffix}`,
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
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      roles: await db.interactionRole.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
      }),
      roleCount: await db.interactionRole.count(),
      roleVendorCount: await db.interactionRole.count({ where: { vendorId: vendor.id } }),
      roleActiveCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      roleInactiveCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, isActive: false },
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
    const path = "/interaction-roles";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
    });
    await page.route("**/interaction-roles", async (route) => {
      if (new URL(route.request().url()).pathname !== path) {
        await route.continue();
        return;
      }
      const response = await route.fetch({ maxRedirects: 0 });
      intercepted.current = {
        status: response.status(),
        location: response.headers().location,
        body: await response.text(),
      };
      await route.fulfill({ response });
    });

    const rawRedirect = page.waitForResponse(
      (response) => new URL(response.url()).pathname === path && response.status() === 307,
    );
    const finalResponse = await page.goto(path);
    const redirectResponse = await rawRedirect;

    expect(redirectResponse.status()).toBe(307);
    expect(redirectResponse.headers().location).toBe("/dashboard?error=insufficient_role");
    expect(intercepted.current).toBeDefined();
    expect(intercepted.current?.status).toBe(307);
    expect(intercepted.current?.location).toBe("/dashboard?error=insufficient_role");
    for (const canary of canaries) expect(intercepted.current?.body).not.toContain(canary);
    expect(intercepted.current?.body).not.toContain(".invalid");
    expect(intercepted.current?.body).not.toContain("2 個官方互動角色");

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "互動角色", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "使用者清單", exact: true })).toHaveCount(0);
    await expect(page.getByText("新增使用者", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /建立互動角色/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "匯入 10 個官方角色", exact: true })).toHaveCount(0);
    for (const label of ["暱稱", "角色類型", "顯示標籤", "語氣設定", "啟用使用者"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.locator('a[href="/interaction-roles/new"]')).toHaveCount(0);
    for (const role of roles) {
      await expect(page.locator(`a[href="/interaction-roles/${role.id}/edit"]`)).toHaveCount(0);
      await expect(page.locator(`img[src="${role.avatarUrl}"]`)).toHaveCount(0);
    }
    for (const name of ["avatarUrl", "name", "roleType", "label", "tone", "isActive"]) {
      await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
    }
    await expect(page.getByText("2 個官方互動角色", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "主要導覽" }).locator('a[href="/interaction-roles"]'),
    ).toHaveCount(0);
    for (const canary of canaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(external.some((url) => url.includes("api.dicebear.com") || url.includes(".invalid"))).toBe(false);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
