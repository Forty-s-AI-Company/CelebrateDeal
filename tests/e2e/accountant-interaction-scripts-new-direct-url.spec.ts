import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp72SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session or media.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied interaction-script creation before tenant data, CSRF, or form render", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp72-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP72 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP72-FB-${suffix}`,
          tiktokPixelId: `WP72-TT-${suffix}`,
          googleTagManagerId: `WP72-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: "WP72 Active Accountant",
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
        name: `WP72 Active Role ${suffix}`,
        avatarUrl: `https://active-role-${tag}.invalid/avatar.svg`,
        label: `WP72 Active Label ${suffix}`,
        roleType: `wp72-active-role-${suffix}`,
        tone: `WP72 Active Tone ${suffix}`,
        isActive: true,
      },
    }),
    db.interactionRole.create({
      data: {
        vendorId: vendor.id,
        name: `WP72 Inactive Role ${suffix}`,
        avatarUrl: `https://inactive-role-${tag}.invalid/avatar.svg`,
        label: `WP72 Inactive Label ${suffix}`,
        roleType: `wp72-inactive-role-${suffix}`,
        tone: `WP72 Inactive Tone ${suffix}`,
        isActive: false,
      },
    }),
  ]);
  const products = await Promise.all([
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP72 Active Product ${suffix}`,
        slug: `active-${tag}`,
        description: `WP72 active product description ${suffix}`,
        priceCents: 720172,
        compareAtCents: 920192,
        currency: "TWD",
        imageUrl: `https://active-product-${tag}.invalid/product.jpg`,
        checkoutUrl: `https://active-checkout-${tag}.invalid/order`,
        inventory: 7217,
        isActive: true,
      },
    }),
    db.product.create({
      data: {
        vendorId: vendor.id,
        name: `WP72 Inactive Product ${suffix}`,
        slug: `inactive-${tag}`,
        description: `WP72 inactive product description ${suffix}`,
        priceCents: 720272,
        compareAtCents: 920292,
        currency: "USD",
        imageUrl: `https://inactive-product-${tag}.invalid/product.jpg`,
        checkoutUrl: `https://inactive-checkout-${tag}.invalid/order`,
        inventory: 7227,
        isActive: false,
      },
    }),
  ]);
  const script = await db.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: `WP72 Script ${suffix}`,
      description: `WP72 script description ${suffix}`,
      status: "published",
      events: {
        create: [
          {
            roleId: roles[0]?.id,
            productId: products[0]?.id,
            eventType: "chat_message",
            triggerSec: 72,
            title: `WP72 Active Event ${suffix}`,
            message: `WP72 active event message ${suffix}`,
            ctaLabel: `WP72 Active CTA ${suffix}`,
            ctaUrl: `https://active-event-${tag}.invalid/action`,
            metadata: { canary: `wp72-active-metadata-${suffix}` },
          },
          {
            roleId: roles[1]?.id,
            productId: products[1]?.id,
            eventType: "product_pin",
            triggerSec: 144,
            title: `WP72 Inactive Event ${suffix}`,
            message: `WP72 inactive event message ${suffix}`,
            ctaLabel: `WP72 Inactive CTA ${suffix}`,
            ctaUrl: `https://inactive-event-${tag}.invalid/action`,
            metadata: { canary: `wp72-inactive-metadata-${suffix}` },
          },
        ],
      },
    },
  });
  const [tracking, membership, events] = await Promise.all([
    db.trackingSetting.findUniqueOrThrow({ where: { vendorId: vendor.id } }),
    db.vendorMember.findUniqueOrThrow({
      where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    }),
    db.interactionEvent.findMany({
      where: { scriptId: script.id },
      orderBy: { id: "asc" },
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
      trackingVendorRelation: await db.trackingSetting.findUniqueOrThrow({
        where: { vendorId: vendor.id },
        select: { id: true, vendorId: true },
      }),
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
      roleActiveCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      roleInactiveCount: await db.interactionRole.count({
        where: { vendorId: vendor.id, isActive: false },
      }),
      roleTypeCounts: await Promise.all(roles.map((role) => db.interactionRole.count({
        where: { vendorId: vendor.id, roleType: role.roleType },
      }))),
      roleLabelCounts: await Promise.all(roles.map((role) => db.interactionRole.count({
        where: { vendorId: vendor.id, label: role.label },
      }))),
      roleCompositeCounts: await Promise.all(roles.map((role) => db.interactionRole.count({
        where: {
          vendorId: vendor.id,
          roleType: role.roleType,
          label: role.label,
          isActive: role.isActive,
        },
      }))),
      roleRelations: await db.interactionRole.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
      products: await db.product.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
      }),
      productCount: await db.product.count(),
      productVendorCount: await db.product.count({ where: { vendorId: vendor.id } }),
      productActiveCount: await db.product.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      productInactiveCount: await db.product.count({
        where: { vendorId: vendor.id, isActive: false },
      }),
      productCompositeCounts: await Promise.all(products.map((product) => db.product.count({
        where: { vendorId: vendor.id, slug: product.slug, isActive: product.isActive },
      }))),
      productRelations: await db.product.findMany({
        where: { vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
      script: await db.interactionScript.findUniqueOrThrow({ where: { id: script.id } }),
      scriptCount: await db.interactionScript.count(),
      scriptVendorCount: await db.interactionScript.count({ where: { vendorId: vendor.id } }),
      scriptRelation: await db.interactionScript.findUniqueOrThrow({
        where: { id: script.id },
        select: { id: true, vendorId: true },
      }),
      events: await db.interactionEvent.findMany({
        where: { scriptId: script.id },
        orderBy: { id: "asc" },
      }),
      eventCount: await db.interactionEvent.count(),
      eventScriptCount: await db.interactionEvent.count({ where: { scriptId: script.id } }),
      eventVendorCount: await db.interactionEvent.count({
        where: { script: { vendorId: vendor.id } },
      }),
      eventCompositeCounts: await Promise.all(events.map((event) => db.interactionEvent.count({
        where: {
          scriptId: script.id,
          roleId: event.roleId,
          productId: event.productId,
          eventType: event.eventType,
        },
      }))),
      eventRelations: await db.interactionEvent.findMany({
        where: { scriptId: script.id },
        orderBy: { id: "asc" },
        select: { id: true, scriptId: true, roleId: true, productId: true },
      }),
    });
    const before = await snapshot();
    const canaries = [
      script.id,
      script.name,
      script.description,
      ...roles.flatMap((role) => [
        role.id,
        role.name,
        role.avatarUrl,
        role.label,
        role.roleType,
        role.tone,
      ]),
      ...products.flatMap((product) => [
        product.id,
        product.name,
        product.slug,
        product.description,
        product.imageUrl,
        product.checkoutUrl,
      ]),
      ...events.flatMap((event) => [
        event.id,
        event.title,
        event.message,
        event.ctaLabel,
        event.ctaUrl,
        JSON.stringify(event.metadata),
      ]),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    const path = "/interaction-scripts/new";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
        external.push(request.url());
      }
      if (url.hostname.endsWith(".invalid")) invalid.push(request.url());
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
      forbiddenPayload: [".invalid", "新增互動腳本", "常見留言組範本"],
    });

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL("/dashboard?error=insufficient_role");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("商品點擊", { exact: true }).first()).toBeVisible();
    for (const heading of ["新增互動腳本", "常見留言組範本", "留言清單"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
    }
    for (const button of ["更新留言組", "新增留言"]) {
      await expect(page.getByRole("button", { name: button, exact: true })).toHaveCount(0);
    }
    await expect(page.locator('a[href="/interaction-scripts"]')).toHaveCount(0);
    await expect(page.locator('a[href="/interaction-scripts/new"]')).toHaveCount(0);
    await expect(page.locator(`a[href="/interaction-scripts/${script.id}/edit"]`)).toHaveCount(0);
    const interactionScriptForm = page.locator(
      'form:has([name="triggerSec"]):has([name="roleId"]):has([name="productId"]):has([name="eventType"])',
    );
    await expect(interactionScriptForm).toHaveCount(0);
    for (const name of ["_csrf", "name", "status", "description"]) {
      await expect(
        page.locator(`form:has([name="triggerSec"]):has([name="roleId"]) [name="${name}"]`),
      ).toHaveCount(0);
    }
    for (const name of [
      "roleId",
      "productId",
      "eventType",
      "eventTitle",
      "triggerSec",
      "message",
      "ctaLabel",
      "ctaUrl",
    ]) {
      await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
    }
    for (const testId of [
      "interaction-timeline-outline",
      "interaction-message-list",
      "interaction-message-row",
      "interaction-message-time",
      "interaction-message-content",
    ]) {
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }
    for (const role of roles) {
      await expect(page.locator(`option[value="${role.id}"]`)).toHaveCount(0);
    }
    for (const product of products) {
      await expect(page.locator(`option[value="${product.id}"]`)).toHaveCount(0);
    }
    for (const canary of canaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
