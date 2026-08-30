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
  responseStartMs?: number;
  domContentLoadedMs: number;
  domInteractiveMs?: number;
  loadMs: number;
  resourceCount: number;
  totalTransferBytes: number;
  scriptTransferBytes: number;
};

async function measurePage(page: Page, expectedPath?: string) {
  if (expectedPath) {
    const escapedPath = expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(page).toHaveURL(new RegExp(`${escapedPath}$`));
  }
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("load");
  await expect(page.locator("body")).toBeVisible();

  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!navigation) throw new Error("Navigation timing is unavailable.");

    // AppShell links may begin Next.js background prefetches after the
    // document load event. Keep the release budget focused on the initial
    // navigation, otherwise the result depends on when the assertion happens
    // to race those non-blocking prefetches.
    const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter((resource) => resource.startTime <= navigation.loadEventEnd);
    return {
      responseStartMs: navigation.responseStart - navigation.startTime,
      domContentLoadedMs: navigation.domContentLoadedEventEnd - navigation.startTime,
      domInteractiveMs: navigation.domInteractive - navigation.startTime,
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
  const announcement = page.getByRole("dialog", { name: "進站最新消息" });
  if (await announcement.isVisible().catch(() => false)) {
    await page.getByTestId("announcement-center-close").click();
    await expect(announcement).toBeHidden();
  }
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator('[data-dashboard-scope="kpis"]')).toBeVisible();
  await expect(page.locator('[data-dashboard-scope="details"]')).toBeVisible();
  // The performance test is not an MFA flow; mark this isolated local session
  // verified after the normal login so the protected billing page is measured.
  await db.userSession.updateMany({
    where: { userId: fixture.userId, revokedAt: null },
    data: { mfaVerifiedAt: new Date() },
  });
}

async function installDashboardLifecycleObserver(page: Page) {
  await page.addInitScript(() => {
    const lifecycle = {
      routeShellMs: null as number | null,
      kpiRegionMs: null as number | null,
      detailsRegionMs: null as number | null,
      kpisMs: null as number | null,
      detailsMs: null as number | null,
    };
    (window as Window & { __dashboardLifecycle?: typeof lifecycle }).__dashboardLifecycle = lifecycle;

    const mark = (selector: string, key: keyof typeof lifecycle) => {
      if (lifecycle[key] === null && document.querySelector(selector)) lifecycle[key] = performance.now();
    };
    const record = () => {
      mark('[data-dashboard-scope="route-shell"]', "routeShellMs");
      mark('[data-dashboard-region="kpis"]', "kpiRegionMs");
      mark('[data-dashboard-region="details"]', "detailsRegionMs");
      mark('[data-dashboard-scope="kpis"]', "kpisMs");
      mark('[data-dashboard-scope="details"]', "detailsMs");
    };

    record();
    new MutationObserver(record).observe(document, { childList: true, subtree: true });
  });
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
  // Billing routes require an enrolled MFA factor. This opaque test marker is
  // only checked for presence by the guard and is never decrypted or sent out.
  await db.userMfaFactor.create({
    data: {
      userId: user.id,
      secretEncrypted: "performance-test-only-mfa-factor",
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
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "Performance Test Registration Form",
      slug: `performance-form-${runId}`,
      headline: "Performance Test Registration",
      description: "Public live performance fixture",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
      isActive: true,
    },
  });
  const video = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "Performance Test Video",
      description: "Synthetic ready VOD for the public live performance fixture",
      sourceType: "url",
      videoUrl: "https://example.test/e2e-webinar.mp4",
      durationSec: 900,
      status: "ready",
    },
  });
  const registrationTemplate = await db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name: "Performance Test Registration Email",
      channel: "email",
      trigger: "registration_confirmed",
      subject: "{{name}}，你已報名 {{live_title}}",
      body: "活動：{{live_title}}\n時間：{{live_start_at}}\n{{unsubscribe_url}}",
      isActive: true,
    },
  });
  const reminderTemplate = await db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name: "Performance Test Live Reminder Email",
      channel: "email",
      trigger: "live_reminder",
      subject: "{{live_title}} 即將開始",
      body: "提醒：{{live_title}} 將於 {{live_start_at}} 開始。\n{{live_url}}\n{{unsubscribe_url}}",
      isActive: true,
    },
  });
  const interactionScript = await db.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: "Performance Test Commerce Script",
      status: "published",
    },
  });
  await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: registrationTemplate.id,
      liveReminderTemplateId: reminderTemplate.id,
      interactionScriptId: interactionScript.id,
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
    expectWithinBudget(await measurePage(page, route), publicBudget, route);
  }
});

test("authenticated dashboard stays within the release performance budget", async ({ page }) => {
  await installDashboardLifecycleObserver(page);
  await loginOwner(page);
  const dashboardBudget: PerformanceBudget = {
    domContentLoadedMs: 5_000,
    loadMs: 5_000,
    resourceCount: 80,
    totalTransferBytes: 3_000_000,
    scriptTransferBytes: 2_500_000,
  };

  const detailsDiagnosticDelayMs = Number.parseInt(process.env.E2E_DASHBOARD_DETAILS_DELAY_MS ?? "", 10);
  if (Number.isSafeInteger(detailsDiagnosticDelayMs) && detailsDiagnosticDelayMs > 0) {
    // Use a fresh document while keeping the authenticated browser context so
    // the slow probe cannot reuse lifecycle marks from the login redirect.
    const slowProbePage = await page.context().newPage();
    await installDashboardLifecycleObserver(slowProbePage);
    await slowProbePage.goto(`/dashboard?e2eDashboardDetailsDelayMs=${detailsDiagnosticDelayMs}`, { waitUntil: "load" });
    page = slowProbePage;
    await expect(page.locator('[data-dashboard-scope="kpis"]')).toBeVisible();
    await expect(page.locator('[data-dashboard-scope="details"]')).toBeVisible();
  }
  const timing = await measurePage(page, detailsDiagnosticDelayMs > 0 ? undefined : "/dashboard");
  const lifecycle = await page.evaluate(() => {
    const value = (window as Window & {
      __dashboardLifecycle?: {
        routeShellMs: number | null;
        kpiRegionMs: number | null;
        detailsRegionMs: number | null;
        kpisMs: number | null;
        detailsMs: number | null;
      };
    }).__dashboardLifecycle;
    if (!value) throw new Error("Dashboard lifecycle marks are unavailable.");
    return value;
  });
  const dashboardMeasurements = await page.locator('[data-dashboard-scope="kpis"], [data-dashboard-scope="details"]').evaluateAll((elements) => elements.map((element) => ({
    scope: element.getAttribute("data-dashboard-scope"),
    readOperationCount: Number(element.getAttribute("data-dashboard-read-operation-count")),
    readOperationDurationMs: Number(element.getAttribute("data-dashboard-read-operation-duration-ms")),
  })));
  expect(dashboardMeasurements).toEqual(expect.arrayContaining([
    expect.objectContaining({ scope: "kpis", readOperationCount: expect.any(Number), readOperationDurationMs: expect.any(Number) }),
    expect.objectContaining({ scope: "details", readOperationCount: expect.any(Number), readOperationDurationMs: expect.any(Number) }),
  ]));
  for (const measurement of dashboardMeasurements) {
    expect(measurement.readOperationCount, `${measurement.scope} read-operation count`).toBeGreaterThan(0);
    expect(measurement.readOperationDurationMs, `${measurement.scope} read-operation duration`).toBeGreaterThanOrEqual(0);
  }
  expect(lifecycle.kpiRegionMs, "Dashboard KPI region mark").not.toBeNull();
  expect(lifecycle.detailsRegionMs, "Dashboard details region mark").not.toBeNull();
  expect(lifecycle.kpisMs, "Dashboard KPI content mark").not.toBeNull();
  expect(lifecycle.detailsMs, "Dashboard details content mark").not.toBeNull();
  expect(lifecycle.kpiRegionMs!, "KPI region before details region").toBeLessThanOrEqual(lifecycle.detailsRegionMs!);
  expect(lifecycle.kpiRegionMs!, "KPI region before KPI content").toBeLessThanOrEqual(lifecycle.kpisMs!);
  if (Number.isSafeInteger(detailsDiagnosticDelayMs) && detailsDiagnosticDelayMs > 0) {
    expect(lifecycle.kpisMs!, "KPI content before diagnostically delayed details").toBeLessThan(lifecycle.detailsMs!);
  }
  expect(timing.responseStartMs, "Dashboard response start").toBeGreaterThanOrEqual(0);
  expect(timing.domInteractiveMs, "Dashboard DOM interactive").toBeGreaterThanOrEqual(0);
  console.log(`[dashboard-performance] ${JSON.stringify({ timing, lifecycle, dashboardMeasurements })}`);
  expectWithinBudget(timing, dashboardBudget, "/dashboard");
});

test("dashboard isolates one failed KPI read without resubmitting other flows", async ({ page }) => {
  await loginOwner(page);
  const failureProbePage = await page.context().newPage();
  const postRequests: string[] = [];
  failureProbePage.on("request", (request) => {
    if (request.method() === "POST") postRequests.push(request.url());
  });

  await failureProbePage.goto("/dashboard?e2eDashboardFailScope=analytics", { waitUntil: "load" });
  await expect(failureProbePage.getByRole("alert").filter({ hasText: "Dashboard KPI 暫時無法載入" })).toBeVisible();
  await expect(failureProbePage.locator('[data-dashboard-scope="details"]')).toBeVisible();
  expect(postRequests, "Dashboard read failure must not resubmit a write flow").toEqual([]);
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

  const response = await page.goto("/billing/usage", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/billing\/usage$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "用量與扣點", exact: true })).toBeVisible();
  expectWithinBudget(await measurePage(page, "/billing/usage"), billingBudget, "/billing/usage");
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
  const waitingRoom = page.getByTestId("live-waiting-room");
  await expect(waitingRoom.getByText("Performance Test Live", { exact: false })).toBeVisible();
  await expect(page.getByText("Performance Test Product", { exact: true })).toHaveCount(0);
  expectWithinBudget(await measurePage(page, route), liveBudget, route);
});
