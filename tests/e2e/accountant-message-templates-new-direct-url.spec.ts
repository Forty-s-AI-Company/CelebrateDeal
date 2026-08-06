import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp70SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied message-template creation before the form is rendered", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp70-${suffix}`;
  const activeChannel = `wp70-email-${suffix}`;
  const inactiveChannel = `wp70-sms-${suffix}`;
  const activeTrigger = `wp70-registration-${suffix}`;
  const inactiveTrigger = `wp70-reminder-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP70 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP70-FB-${suffix}`,
          tiktokPixelId: `WP70-TT-${suffix}`,
          googleTagManagerId: `WP70-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: "WP70 Active Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: { vendorId: vendor.id, role: "accountant", status: "active" },
      },
    },
  });
  const templates = await Promise.all([
    db.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: `WP70 Active Template ${suffix}`,
        channel: activeChannel,
        trigger: activeTrigger,
        subject: `WP70 Active Subject ${suffix}`,
        body: `WP70 active body ${suffix} https://active-${tag}.invalid/message`,
        isActive: true,
      },
    }),
    db.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: `WP70 Inactive Template ${suffix}`,
        channel: inactiveChannel,
        trigger: inactiveTrigger,
        subject: `WP70 Inactive Subject ${suffix}`,
        body: `WP70 inactive body ${suffix} https://inactive-${tag}.invalid/message`,
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
      templates: await db.messageTemplate.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
      }),
      templateCount: await db.messageTemplate.count(),
      templateVendorCount: await db.messageTemplate.count({ where: { vendorId: vendor.id } }),
      globalActiveCount: await db.messageTemplate.count({ where: { isActive: true } }),
      globalInactiveCount: await db.messageTemplate.count({ where: { isActive: false } }),
      vendorActiveCount: await db.messageTemplate.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      vendorInactiveCount: await db.messageTemplate.count({
        where: { vendorId: vendor.id, isActive: false },
      }),
      globalActiveChannelCount: await db.messageTemplate.count({
        where: { channel: activeChannel },
      }),
      globalInactiveChannelCount: await db.messageTemplate.count({
        where: { channel: inactiveChannel },
      }),
      vendorActiveChannelCount: await db.messageTemplate.count({
        where: { vendorId: vendor.id, channel: activeChannel },
      }),
      vendorInactiveChannelCount: await db.messageTemplate.count({
        where: { vendorId: vendor.id, channel: inactiveChannel },
      }),
      globalActiveTriggerCount: await db.messageTemplate.count({
        where: { trigger: activeTrigger },
      }),
      globalInactiveTriggerCount: await db.messageTemplate.count({
        where: { trigger: inactiveTrigger },
      }),
      vendorActiveTriggerCount: await db.messageTemplate.count({
        where: { vendorId: vendor.id, trigger: activeTrigger },
      }),
      vendorInactiveTriggerCount: await db.messageTemplate.count({
        where: { vendorId: vendor.id, trigger: inactiveTrigger },
      }),
      activeCompositeCount: await db.messageTemplate.count({
        where: {
          vendorId: vendor.id,
          channel: activeChannel,
          trigger: activeTrigger,
          isActive: true,
        },
      }),
      inactiveCompositeCount: await db.messageTemplate.count({
        where: {
          vendorId: vendor.id,
          channel: inactiveChannel,
          trigger: inactiveTrigger,
          isActive: false,
        },
      }),
      templateVendorRelations: await db.messageTemplate.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
    });
    const before = await snapshot();
    const rawCanaries = templates
      .flatMap((template) => [
        template.id,
        template.name,
        template.channel,
        template.trigger,
        template.subject,
        template.body,
      ])
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/messages/templates/new";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
        external.push(request.url());
      }
    });
    await page.route("**/messages/templates/new", async (route) => {
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
    for (const canary of rawCanaries) {
      expect(intercepted.current?.body).not.toContain(canary);
    }
    expect(intercepted.current?.body).not.toContain(".invalid");

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("商品點擊", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "新增訊息模板", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('a[href="/messages/templates"]')).toHaveCount(0);
    await expect(page.locator('a[href="/messages/templates/new"]')).toHaveCount(0);
    for (const template of templates) {
      await expect(
        page.locator(`a[href="/messages/templates/${template.id}/edit"]`),
      ).toHaveCount(0);
      for (const value of [
        template.name,
        template.channel,
        template.trigger,
        template.subject,
        template.body,
      ].filter((candidate): candidate is string => Boolean(candidate))) {
        await expect(page.getByText(value, { exact: true })).toHaveCount(0);
      }
    }
    for (const label of ["模板名稱", "渠道", "觸發條件", "主旨", "內容", "啟用模板"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /儲存/ })).toHaveCount(0);

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
