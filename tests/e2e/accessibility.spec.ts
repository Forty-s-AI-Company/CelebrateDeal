import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { totpCodeForTimestamp } from "../../src/lib/mfa";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "A11y-Test-Password-123!";
const runId = randomUUID();
const fixture = {
  email: `a11y-${runId}@celebratedeal.local`,
  slug: `a11y-${runId}`,
  vendorId: "",
  userId: "",
  videoId: "",
  productId: "",
  formId: "",
  liveId: "",
  liveSlug: `a11y-live-${runId}`,
  formSlug: `a11y-form-${runId}`,
  roleId: "",
  scriptId: "",
  templateId: "",
  affiliateId: "",
  adminEmail: `a11y-admin-${runId}@celebratedeal.local`,
  adminUserId: "",
};

async function blockingAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return result.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    }));
}

async function waitForStableRoute(page: Page, expectedPath: string) {
  await page.waitForLoadState("load");
  const actualUrl = new URL(page.url());
  const expectedUrl = new URL(expectedPath, page.url());
  expect(`${actualUrl.pathname}${actualUrl.search}`, `導航後應停留在 ${expectedPath}`).toBe(`${expectedUrl.pathname}${expectedUrl.search}`);
  await expect(page.locator("main").first()).toBeVisible();
}

async function gotoStableRoute(page: Page, expectedPath: string) {
  const response = await page.goto(expectedPath, { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  await waitForStableRoute(page, expectedPath);
  return response;
}

async function expectNoBlockingAxeViolations(page: Page) {
  await page.waitForLoadState("load");
  await expect(page.locator("main").first()).toBeVisible();
  // Next can stream the page landmark before the root metadata title arrives.
  // Wait for the real document title before running the accessibility scan.
  await expect.poll(() => page.title()).toContain("CelebrateDeal");
  const blocking = await blockingAxeViolations(page);
  expect(blocking, "頁面不可出現 axe critical/serious 違規").toEqual([]);
}

async function loginOwner(page: Page) {
  await gotoStableRoute(page, "/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await waitForStableRoute(page, "/dashboard");
  // App Router can finish the document load while the protected layout is
  // still streaming its loading shell. Wait for the real AppShell landmark
  // before asserting focus order or mobile navigation targets.
  await expect(page.getByRole("link", { name: "跳至主要內容" })).toBeVisible();
}

async function enableOwnerMfa(page: Page) {
  await gotoStableRoute(page, "/settings/security");
  await page.getByRole("button", { name: "開始設定 TOTP", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/security\?updated=mfa_started$/);
  await waitForStableRoute(page, "/settings/security?updated=mfa_started");

  const totpSeed = (await page.locator("p.font-mono").first().textContent())?.trim();
  if (!totpSeed) throw new Error("Owner MFA setup did not provide a TOTP secret.");

  await page.getByLabel("6 位數驗證碼").fill(totpCodeForTimestamp(totpSeed));
  await page.getByRole("button", { name: "啟用 MFA", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/security\?updated=mfa_enabled$/);
  await waitForStableRoute(page, "/settings/security?updated=mfa_enabled");
  await expect(page.getByText("目前 session：已完成 MFA 驗證", { exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: "Accessibility Test Vendor",
      slug: fixture.slug,
      email: fixture.email,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: fixture.email,
      name: "Accessibility Test Owner",
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
  const adminUser = await db.user.create({
    data: {
      email: fixture.adminEmail,
      name: "Accessibility Test Platform Admin",
      passwordHash: hashPassword(password),
      platformRole: "platform_admin",
      status: "active",
    },
  });
  const video = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "Accessibility Test Video",
      sourceType: "url",
      videoUrl: "https://example.test/video.mp4",
      status: "ready",
    },
  });
  const product = await db.product.create({
    data: {
      vendorId: vendor.id,
      name: "Accessibility Test Product",
      slug: `a11y-product-${runId}`,
      description: "Accessibility fixture",
      priceCents: 12_300,
      currency: "TWD",
      inventory: 10,
      isActive: true,
      fulfillmentTypeConfirmed: true,
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "Accessibility Test Form",
      slug: fixture.formSlug,
      headline: "Accessibility Test Form",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
      isActive: true,
    },
  });
  const role = await db.interactionRole.create({
    data: {
      vendorId: vendor.id,
      name: "Accessibility Test Host",
      label: "官方角色",
      roleType: "official",
      isActive: true,
    },
  });
  const script = await db.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: "Accessibility Test Script",
      status: "published",
      events: {
        create: {
          roleId: role.id,
          eventType: "chat_message",
          triggerSec: 10,
          title: "歡迎",
          message: "歡迎參加測試直播",
        },
      },
    },
  });
  const messageTemplate = await db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name: "Accessibility Test Message",
      channel: "email",
      trigger: "registration_confirmed",
      subject: "測試通知",
      body: "這是本機無障礙測試訊息。",
      isActive: true,
    },
  });
  const affiliate = await db.affiliate.create({
    data: {
      vendorId: vendor.id,
      name: "Accessibility Test Affiliate",
      code: `a11y-${runId}`,
      commissionRateBps: 500,
      isActive: true,
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: messageTemplate.id,
      interactionScriptId: script.id,
      title: "Accessibility Test Live",
      slug: fixture.liveSlug,
      scheduledAt: new Date(Date.now() + 3_600_000),
      status: "scheduled",
      replayEnabled: true,
      products: {
        create: {
          productId: product.id,
          sortOrder: 1,
          isPinned: true,
        },
      },
    },
  });

  fixture.vendorId = vendor.id;
  fixture.userId = user.id;
  fixture.adminUserId = adminUser.id;
  fixture.videoId = video.id;
  fixture.productId = product.id;
  fixture.formId = form.id;
  fixture.liveId = live.id;
  fixture.roleId = role.id;
  fixture.scriptId = script.id;
  fixture.templateId = messageTemplate.id;
  fixture.affiliateId = affiliate.id;
});

test.afterAll(async () => {
  if (fixture.vendorId) {
    await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  }
  if (fixture.userId) {
    await db.user.deleteMany({ where: { id: fixture.userId } });
  }
  if (fixture.adminUserId) {
    await db.user.deleteMany({ where: { id: fixture.adminUserId } });
  }
  await db.$disconnect();
});

test("public account pages pass automated WCAG checks", async ({ page }) => {
  for (const path of ["/login", "/password-reset/request"]) {
    await gotoStableRoute(page, path);
    await expectNoBlockingAxeViolations(page);
  }
});

test("login keyboard focus is visible and follows the form order", async ({ page }) => {
  await gotoStableRoute(page, "/login");

  await page.keyboard.press("Tab");
  const email = page.getByLabel("Email");
  await expect(email).toBeFocused();
  const focusStyle = await email.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(1);

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("密碼")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "登入" })).toBeFocused();
});

test("authenticated shell exposes a working skip link and passes axe", async ({ page }) => {
  await loginOwner(page);
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "跳至主要內容" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expectNoBlockingAxeViolations(page);
});

test("static authenticated owner routes have no blocking axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  await loginOwner(page);
  await enableOwnerMfa(page);
  const routes = [
    "/dashboard",
    "/lives",
    "/lives/new",
    "/videos",
    "/videos/new",
    "/products",
    "/products/new",
    "/forms",
    "/forms/new",
    "/messages/templates",
    "/messages/templates/new",
    "/interaction-scripts",
    "/interaction-scripts/new",
    "/interaction-roles",
    "/interaction-roles/new",
    "/blacklists",
    "/affiliates",
    "/affiliates/new",
    "/team-templates",
    "/team-templates/new",
    "/team-performance",
    "/partner-pages",
    "/billing/usage",
    "/billing/plans",
    "/billing/invoices",
    "/billing/settlements",
    "/billing/payouts",
    "/affiliates/commissions",
    "/settings/brand",
    "/settings/tracking",
    "/settings/security",
  ];
  const failures: Array<{ route: string; status: number | null; violations: Awaited<ReturnType<typeof blockingAxeViolations>> }> = [];

  for (const route of routes) {
    const routePage = await page.context().newPage();
    try {
      const response = await gotoStableRoute(routePage, route);
      const violations = await blockingAxeViolations(routePage);
      if (response?.status() !== 200 || violations.length > 0) {
        failures.push({
          route,
          status: response?.status() ?? null,
          violations,
        });
      }
    } finally {
      await routePage.close();
    }
  }

  expect(failures, "所有靜態 owner routes 都必須回 200 且沒有 axe critical/serious").toEqual([]);
});

test("dynamic owner and public commerce routes have no blocking axe violations", async ({ page }) => {
  test.setTimeout(90_000);
  await loginOwner(page);
  const routes = [
    `/videos/${fixture.videoId}/edit`,
    `/products/${fixture.productId}/edit`,
    `/forms/${fixture.formId}/edit`,
    `/forms/${fixture.formId}/submissions`,
    `/lives/${fixture.liveId}/edit`,
    `/lives/${fixture.liveId}/preview`,
    `/lives/${fixture.liveId}/analytics`,
    `/interaction-roles/${fixture.roleId}/edit`,
    `/interaction-scripts/${fixture.scriptId}/edit`,
    `/messages/templates/${fixture.templateId}/edit`,
    `/affiliates/${fixture.affiliateId}`,
    `/affiliates/${fixture.affiliateId}/edit`,
    `/live/${fixture.liveSlug}`,
    `/form/${fixture.formSlug}`,
  ];
  const failures: Array<{ route: string; status: number | null; violations: Awaited<ReturnType<typeof blockingAxeViolations>> }> = [];

  for (const route of routes) {
    const response = await gotoStableRoute(page, route);
    const violations = await blockingAxeViolations(page);
    if (response?.status() !== 200 || violations.length > 0) {
      failures.push({
        route,
        status: response?.status() ?? null,
        violations,
      });
    }
  }

  expect(failures, "dynamic owner/public commerce routes 必須回 200 且沒有 axe critical/serious").toEqual([]);
});

test("platform-admin MFA and static operations routes have no blocking axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoStableRoute(page, "/login");
  await page.getByLabel("Email").fill(fixture.adminEmail);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup$/);
  await waitForStableRoute(page, "/mfa/setup");
  await expectNoBlockingAxeViolations(page);

  await page.getByRole("button", { name: "開始建立 TOTP" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup\?updated=mfa_started/);
  await waitForStableRoute(page, "/mfa/setup?updated=mfa_started");
  await expectNoBlockingAxeViolations(page);
  const totpSeed = (await page.locator("details p.font-mono").textContent())?.trim();
  expect(totpSeed).toBeTruthy();

  await page.getByLabel("6 位數驗證碼").fill(totpCodeForTimestamp(totpSeed!));
  await page.getByRole("button", { name: "啟用 MFA" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup\?updated=mfa_enabled/);
  await waitForStableRoute(page, "/mfa/setup?updated=mfa_enabled");
  await expectNoBlockingAxeViolations(page);

  await page.context().clearCookies();
  await gotoStableRoute(page, "/login");
  await page.getByLabel("Email").fill(fixture.adminEmail);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL("/mfa/verify?next=%2Fadmin%2Fbilling%2Fdashboard");
  await waitForStableRoute(page, "/mfa/verify?next=%2Fadmin%2Fbilling%2Fdashboard");
  await expectNoBlockingAxeViolations(page);
  await page.getByLabel("驗證碼").fill(totpCodeForTimestamp(totpSeed!));
  await page.getByRole("button", { name: "確認並進入後台" }).click();
  await expect(page).toHaveURL(/\/admin\/billing\/dashboard/);
  await waitForStableRoute(page, "/admin/billing/dashboard");

  const routes = [
    "/admin/billing/dashboard",
    "/admin/billing/webhooks",
    "/admin/billing/payouts",
    "/admin/billing/settlements",
    "/admin/cloudflare/videos",
  ];
  const failures: Array<{ route: string; status: number | null; violations: Awaited<ReturnType<typeof blockingAxeViolations>> }> = [];
  for (const route of routes) {
    const response = await gotoStableRoute(page, route);
    const violations = await blockingAxeViolations(page);
    if (response?.status() !== 200 || violations.length > 0) {
      failures.push({
        route,
        status: response?.status() ?? null,
        violations,
      });
    }
  }

  expect(failures, "platform-admin operations routes 必須回 200 且沒有 axe critical/serious").toEqual([]);
});

test("reduced-motion preference suppresses authored motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoStableRoute(page, "/login");
  const duration = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.animation = "fadeInUp 2s ease";
    probe.style.transition = "transform 2s ease";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const result = {
      animationDurationMs: Number.parseFloat(style.animationDuration) * 1_000,
      transitionDurationMs: Number.parseFloat(style.transitionDuration) * 1_000,
    };
    probe.remove();
    return result;
  });

  expect(duration.animationDurationMs).toBeLessThanOrEqual(0.01);
  expect(duration.transitionDurationMs).toBeLessThanOrEqual(0.01);
});

test("mobile shell has no horizontal page overflow and primary targets are touch-sized", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginOwner(page);

  const overflowDetails = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > viewportWidth + 1 || rect.left < -1)
      .sort((left, right) => (right.rect.right - viewportWidth) - (left.rect.right - viewportWidth))
      .slice(0, 5)
      .map(({ element, rect }) => ({
        tag: element.tagName,
        id: element.id,
        className: typeof element.className === "string" ? element.className : "",
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      }));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: viewportWidth,
      innerWidth: window.innerWidth,
      offenders,
    };
  });
  expect(overflowDetails.scrollWidth - overflowDetails.clientWidth, JSON.stringify(overflowDetails)).toBeLessThanOrEqual(1);

  const mobileTargets = page.locator("header a, header button");
  const count = await mobileTargets.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const box = await mobileTargets.nth(index).boundingBox();
    expect(box?.height ?? 0, `mobile target ${index + 1} height`).toBeGreaterThanOrEqual(44);
  }
});
