import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Performance-Test-Password-123!";
const runId = randomUUID();
const fixture = {
  email: `performance-${runId}@celebratedeal.local`,
  slug: `performance-${runId}`,
  productSlug: `performance-product-${runId}`,
  liveSlug: `performance-live-${runId}`,
  vendorId: "",
  userId: "",
};

type PerformanceBudget = {
  domContentLoadedMs: number;
  loadMs: number;
  resourceCount: number;
  totalTransferBytes: number;
  scriptTransferBytes: number;
};

async function measurePage(page: Page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!navigation) throw new Error("Navigation timing is unavailable.");

    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return {
      domContentLoadedMs: navigation.domContentLoadedEventEnd - navigation.startTime,
      loadMs: navigation.loadEventEnd - navigation.startTime,
      resourceCount: resources.length,
      totalTransferBytes: resources.reduce((total, resource) => total + Math.max(resource.transferSize, 0), 0),
      scriptTransferBytes: resources
        .filter((resource) => resource.initiatorType === "script")
        .reduce((total, resource) => total + Math.max(resource.transferSize, 0), 0),
    };
  });
}

function expectWithinBudget(
  actual: Awaited<ReturnType<typeof measurePage>>,
  budget: PerformanceBudget,
  route: string,
) {
  expect(actual.domContentLoadedMs, `${route} DOMContentLoaded`).toBeLessThanOrEqual(budget.domContentLoadedMs);
  expect(actual.loadMs, `${route} load`).toBeLessThanOrEqual(budget.loadMs);
  expect(actual.resourceCount, `${route} resource count`).toBeLessThanOrEqual(budget.resourceCount);
  expect(actual.totalTransferBytes, `${route} total transfer`).toBeLessThanOrEqual(budget.totalTransferBytes);
  expect(actual.scriptTransferBytes, `${route} script transfer`).toBeLessThanOrEqual(budget.scriptTransferBytes);
}

async function loginOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: "Performance Test Vendor",
      slug: fixture.slug,
      email: fixture.email,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#c2410c",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: fixture.email,
      name: "Performance Test Owner",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: {
          vendorId: vendor.id,
          role: "owner",
          status: "active",
        },
      },
    },
  });
  const product = await db.product.create({
    data: {
      vendorId: vendor.id,
      name: "Performance Test Product",
      slug: fixture.productSlug,
      description: "Public live performance fixture",
      priceCents: 1_000,
      currency: "TWD",
      inventory: 10,
      isActive: true,
    },
  });
  await db.live.create({
    data: {
      vendorId: vendor.id,
      title: "Performance Test Live",
      slug: fixture.liveSlug,
      description: "Public live performance fixture",
      scheduledAt: new Date(Date.now() + 60_000),
      status: "scheduled",
      products: {
        create: [{ productId: product.id, sortOrder: 1, isPinned: true }],
      },
    },
  });

  fixture.vendorId = vendor.id;
  fixture.userId = user.id;
});

test.afterAll(async () => {
  if (fixture.vendorId) {
    await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  }
  if (fixture.userId) {
    await db.user.deleteMany({ where: { id: fixture.userId } });
  }
  await db.$disconnect();
});

test("public account routes stay within the release performance budget", async ({ page }) => {
  const publicBudget: PerformanceBudget = {
    domContentLoadedMs: 5_000,
    loadMs: 5_000,
    resourceCount: 50,
    totalTransferBytes: 2_000_000,
    scriptTransferBytes: 1_500_000,
  };

  for (const route of ["/login", "/password-reset/request"]) {
    const response = await page.goto(route, { waitUntil: "load" });
    expect(response?.status()).toBe(200);
    expectWithinBudget(await measurePage(page), publicBudget, route);
  }
});

test("authenticated dashboard stays within the release performance budget", async ({ page }) => {
  await loginOwner(page);
  const dashboardBudget: PerformanceBudget = {
    domContentLoadedMs: 5_000,
    loadMs: 5_000,
    resourceCount: 80,
    totalTransferBytes: 3_000_000,
    scriptTransferBytes: 2_500_000,
  };

  expectWithinBudget(await measurePage(page), dashboardBudget, "/dashboard");
});

test("authenticated billing usage stays within the release performance budget", async ({ page }) => {
  await loginOwner(page);
  const billingBudget: PerformanceBudget = {
    domContentLoadedMs: 5_000,
    loadMs: 5_000,
    resourceCount: 80,
    totalTransferBytes: 3_000_000,
    scriptTransferBytes: 2_500_000,
  };

  const response = await page.goto("/billing/usage", { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  expectWithinBudget(await measurePage(page), billingBudget, "/billing/usage");
});

test("public live commerce stays within the release performance budget", async ({ page }) => {
  const route = `/live/${fixture.liveSlug}`;
  const liveBudget: PerformanceBudget = {
    domContentLoadedMs: 5_000,
    loadMs: 5_000,
    resourceCount: 70,
    totalTransferBytes: 2_500_000,
    scriptTransferBytes: 2_000_000,
  };

  const response = await page.goto(route, { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  await expect(page.getByText("Performance Test Live")).toBeVisible();
  await expect(page.getByText("Performance Test Product")).toBeVisible();
  expectWithinBudget(await measurePage(page), liveBudget, route);
});
