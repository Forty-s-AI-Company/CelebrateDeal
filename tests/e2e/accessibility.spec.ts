import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { totpCodeForTimestamp } from "../../src/lib/mfa";
import { hashPassword } from "../../src/lib/password";
import { createMerchantRegistrationInvite } from "../../src/lib/merchant-registration-invite";
import { createMerchantEmailVerificationToken } from "../../src/lib/merchant-email-verification-token";
import { openLiveStudioAdvancedSettings } from "../fixtures/live-studio";
import { createLandingPageFixture } from "../fixtures/landing-page";
import { createGoalFunnelStepPages } from "../../src/lib/funnel-goal-step-pages";
import { formatSanitizedAxeBlockingError } from "../../scripts/playwright-ci-reporter";

const db = new PrismaClient();
const password = "A11y-Test-Password-123!";
const runId = randomUUID();
const fixture = {
  email: `a11y-${runId}@celebratedeal.local`,
  ownerEmails: Array.from({ length: 8 }, (_, index) => `a11y-${runId}-${index}@celebratedeal.local`),
  slug: `a11y-${runId}`,
  vendorId: "",
  userId: "",
  ownerUserIds: [] as string[],
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

/**
 * Same gate as `expect(await blockingAxeViolations(page)).toEqual([])`: any
 * critical/serious violation fails. The thrown message uses the sanitized
 * AXE_BLOCKING:RULES grammar so the CI reporter can name the axe rules (it
 * never forwards raw diffs); the full targets go to stdout for local runs.
 */
async function expectNoBlockingAxe(page: Page, label: string) {
  const blocking = await blockingAxeViolations(page);
  if (blocking.length === 0) return;
  console.log(`[axe] ${label}: ${JSON.stringify(blocking)}`);
  throw new Error(formatSanitizedAxeBlockingError(blocking));
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

let ownerLoginIndex = 0;
async function loginOwner(page: Page) {
  await gotoStableRoute(page, "/login");
  const email = fixture.ownerEmails[ownerLoginIndex++ % fixture.ownerEmails.length];
  await page.getByLabel("Email").fill(email);
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
  await page.getByRole("button", { name: "完成設定", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/security\?updated=mfa_enabled$/);
  await waitForStableRoute(page, "/settings/security?updated=mfa_enabled");
  await expect(page.getByText("目前登入狀態：已完成 MFA 驗證", { exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      betaFeatureGrants: ["courses", "billing", "funnel_binding", "consultation_booking", "browser_live", "danmaku"], enabledFeatureModules: ["funnel_builder", "live_webinar", "affiliate_program", "tax_remuneration", "analytics_advanced", "consultation_booking"],
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
      email: fixture.ownerEmails[0],
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
  fixture.ownerUserIds.push(user.id);
  for (const email of fixture.ownerEmails.slice(1)) {
    const owner = await db.user.create({
      data: {
        email,
        name: "Accessibility Test Owner",
        passwordHash: hashPassword(password),
        status: "active",
        memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
      },
    });
    fixture.ownerUserIds.push(owner.id);
  }
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
  if (fixture.ownerUserIds.length > 0) await db.user.deleteMany({ where: { id: { in: fixture.ownerUserIds } } });
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
    "/affiliates/policy",
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
    "/settings",
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

test("registration, policy and support public routes have no blocking axe violations (F-126)", async ({ page }) => {
  test.setTimeout(90_000);
  // Invite mode is the default: cover the invite-only notice and the invited form.
  const invite = createMerchantRegistrationInvite({ email: `a11y-invite-${randomUUID()}@example.test` }).token;
  // The confirm page only checks the signature; nothing is verified until its POST.
  const verification = createMerchantEmailVerificationToken({ userId: "a11y_synthetic_user", email: `a11y-verify-${randomUUID()}@example.test` }).token;
  const routes = [
    "/register",
    `/register?invite=${encodeURIComponent(invite)}`,
    "/verify-email",
    "/verify-email?status=invalid",
    `/verify-email?token=${encodeURIComponent(verification)}`,
    "/policies",
    "/policies/terms",
    "/policies/privacy",
    "/policies/refunds",
    "/support",
    "/support/requests",
    "/support/orders",
    "/verify-registration?status=invalid",
    "/registration-error",
  ];
  const failures: Array<{ route: string; status: number | null; violations: Awaited<ReturnType<typeof blockingAxeViolations>> }> = [];
  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "load" });
    await expect(page.locator("main").first()).toBeVisible();
    const violations = await blockingAxeViolations(page);
    if (response?.status() !== 200 || violations.length > 0) failures.push({ route, status: response?.status() ?? null, violations });
  }
  expect(failures, "公開註冊、政策與客服路由必須回 200 且沒有 axe critical/serious").toEqual([]);
});

test("onboarding and welcome routes have no blocking axe violations (F-126)", async ({ page }) => {
  test.setTimeout(90_000);
  await loginOwner(page);
  const failures: Array<{ route: string; status: number | null; violations: Awaited<ReturnType<typeof blockingAxeViolations>> }> = [];
  for (const route of ["/onboarding", "/welcome"]) {
    const response = await page.goto(route, { waitUntil: "load" });
    await expect(page.locator("main").first()).toBeVisible();
    const violations = await blockingAxeViolations(page);
    if (violations.length > 0 || (response?.status() ?? 0) >= 400) failures.push({ route, status: response?.status() ?? null, violations });
  }
  expect(failures, "onboarding／welcome 不可出現 axe critical/serious").toEqual([]);
});

test("live stepper has no blocking axe violations on any of the four steps, in 進階設定 or on the validation error state (F-126)", async ({ page }) => {
  test.setTimeout(120_000);
  // A second listed product, so 成交 is scanned with the 置頂 label and a 設為置頂 button.
  await db.product.create({
    data: {
      vendorId: fixture.vendorId,
      name: "Accessibility Pin Product",
      slug: `a11y-pin-product-${runId}`,
      priceCents: 4_500,
      currency: "TWD",
      inventory: 5,
      isActive: true,
      fulfillmentTypeConfirmed: true,
    },
  });
  await loginOwner(page);
  await gotoStableRoute(page, "/lives/new");

  // 錯誤狀態：未填必填欄位就按「下一步」，驗證訊息與焦點狀態都要可被掃描。
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("status").filter({ hasText: "請先完成本步驟的必填欄位" })).toBeVisible();
  await expectNoBlockingAxe(page, "stepper 驗證錯誤狀態");

  await page.getByLabel("直播標題", { exact: true }).fill("A11y 步驟掃描");
  // 進階設定預設收合；以鍵盤展開，展開狀態也要可被掃描。
  const contentAdvanced = page.locator('details[data-advanced-settings="content"]');
  await expect(contentAdvanced).not.toHaveAttribute("open", "");
  await contentAdvanced.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  await expect(contentAdvanced).toHaveAttribute("open", "");
  await page.getByLabel("直播網址").fill(`a11y-stepper-${runId}`);

  const stepKeys = ["content", "sales", "notifications", "publish"] as const;
  const scanned: number[] = [];
  const scanStep = async (step: number) => {
    await expect(page.locator(`[data-step-key="${stepKeys[step]}"]`)).toBeVisible();
    await expect(page.locator(`button[aria-controls="live-step-panel-${stepKeys[step]}"]`)).toHaveAttribute("aria-current", "step");
    await expectNoBlockingAxe(page, `stepper 第 ${step + 1} 步`);
    scanned.push(step + 1);
  };
  await page.getByLabel("影片／即時直播").selectOption(fixture.videoId);
  await page.getByLabel("報名頁").selectOption(fixture.formId);
  await page.getByLabel(/開播時間/).fill("2026-12-20T20:00");
  await scanStep(0);
  // 滑入動畫進行到一半時掃描也不能有對比違規（CI 上掃描常落在動畫途中）。
  const drawerSlide = (mode: "midway" | "finish") => page.evaluate((nextMode) => {
    for (const animation of document.getAnimations()) {
      if ((animation as CSSAnimation).animationName !== "side-drawer-in") continue;
      if (nextMode === "midway") { animation.pause(); animation.currentTime = 90; } else animation.finish();
    }
  }, mode);
  // 就地建立抽屜：開啟狀態（含欄位錯誤）也要可被掃描，Escape 關閉後焦點回到按鈕。
  const openFormDrawer = page.getByRole("button", { name: "新增報名表", exact: true });
  await openFormDrawer.click();
  const formDrawer = page.getByRole("dialog", { name: "新增報名表" });
  await expect(formDrawer).toBeVisible();
  await drawerSlide("midway");
  await expectNoBlockingAxe(page, "新增報名表抽屜（滑入動畫中）");
  await drawerSlide("finish");
  await expectNoBlockingAxe(page, "新增報名表抽屜");
  await formDrawer.getByLabel("表單名稱").fill("");
  await formDrawer.getByRole("button", { name: "建立並選取" }).click();
  await expect(formDrawer.getByText("請填寫表單名稱。")).toBeVisible();
  await expectNoBlockingAxe(page, "新增報名表抽屜欄位錯誤");
  await page.keyboard.press("Escape");
  await expect(formDrawer).toBeHidden();
  await expect(openFormDrawer).toBeFocused();
  // 影片抽屜：上傳區與展開的外部網址區（含欄位錯誤）。不選檔、不上傳，不會呼叫任何影片服務。
  const openVideoDrawer = page.getByRole("button", { name: "上傳影片或貼上影片網址", exact: true });
  await openVideoDrawer.click();
  const videoDrawer = page.getByRole("dialog", { name: "新增影片" });
  await expect(videoDrawer).toBeVisible();
  await expect(videoDrawer.getByLabel("影片名稱")).toBeFocused();
  await drawerSlide("midway");
  await expectNoBlockingAxe(page, "新增影片抽屜（滑入動畫中）");
  await drawerSlide("finish");
  await expectNoBlockingAxe(page, "新增影片抽屜");
  await videoDrawer.getByText("改用外部影片網址", { exact: true }).click();
  await videoDrawer.getByLabel("影片網址").fill("not-a-url");
  await videoDrawer.getByRole("button", { name: "以網址建立並選取" }).click();
  await expect(videoDrawer.getByText("影片網址必須是有效的 HTTP 或 HTTPS 完整網址。")).toBeVisible();
  await expectNoBlockingAxe(page, "新增影片抽屜外部網址欄位錯誤");
  await page.keyboard.press("Escape");
  await expect(videoDrawer).toBeHidden();
  await expect(openVideoDrawer).toBeFocused();
  await page.getByRole("button", { name: "下一步" }).click();
  await openLiveStudioAdvancedSettings(page, "sales");
  const salesPanel = page.locator('[data-step-key="sales"]');
  await salesPanel.getByRole("checkbox", { name: /Accessibility Test Product/u }).check();
  await salesPanel.getByRole("checkbox", { name: /Accessibility Pin Product/u }).check();
  await expect(salesPanel.locator('[data-live-product-row] [data-live-product-pinned]')).toHaveText("置頂");
  await expect(salesPanel.getByRole("button", { name: "設為置頂：Accessibility Pin Product", exact: true })).toBeVisible();
  await scanStep(1);
  // 互動腳本：「重新整理清單」後顯示的公告也要可被掃描；新增元素（新分頁連結、說明）已含在上一步掃描內。
  await page.locator('[data-step-key="sales"]').getByRole("button", { name: "重新整理清單", exact: true }).click();
  await expect(page.locator("[data-live-script-status]")).toContainText("已更新清單");
  await expectNoBlockingAxe(page, "互動腳本重新整理公告");
  // 新增商品抽屜：開啟（含滑入動畫中點）與欄位錯誤狀態；不送出，不建立商品。
  const openProductDrawer = page.locator('[data-step-key="sales"]').getByRole("button", { name: "新增商品", exact: true });
  await openProductDrawer.click();
  const productDrawer = page.getByRole("dialog", { name: "新增商品" });
  await expect(productDrawer).toBeVisible();
  await expect(productDrawer.getByLabel("商品名稱")).toBeFocused();
  await drawerSlide("midway");
  await expectNoBlockingAxe(page, "新增商品抽屜（滑入動畫中）");
  await drawerSlide("finish");
  await expectNoBlockingAxe(page, "新增商品抽屜");
  await productDrawer.getByLabel("售價（新台幣整數元）").fill("12.5");
  await productDrawer.getByRole("button", { name: "建立並選取" }).click();
  await expect(productDrawer.getByText("請填寫商品名稱。")).toBeVisible();
  await expect(productDrawer.getByText("售價須為新台幣整數元，不含小數點、逗號或符號。")).toBeVisible();
  await expectNoBlockingAxe(page, "新增商品抽屜欄位錯誤");
  await page.keyboard.press("Escape");
  await expect(productDrawer).toBeHidden();
  await expect(openProductDrawer).toBeFocused();
  await page.getByRole("button", { name: "下一步" }).click();
  await scanStep(2);
  const openTemplateDrawer = page.getByRole("button", { name: "建立報名成功 Email", exact: true });
  await openTemplateDrawer.click();
  await expect(page.getByRole("dialog", { name: "建立報名成功 Email" })).toBeVisible();
  await drawerSlide("midway");
  await expectNoBlockingAxe(page, "建立報名成功 Email 抽屜（滑入動畫中）");
  await drawerSlide("finish");
  await expectNoBlockingAxe(page, "建立報名成功 Email 抽屜");
  await page.keyboard.press("Escape");
  await expect(openTemplateDrawer).toBeFocused();
  await page.getByRole("button", { name: "下一步" }).click();
  await scanStep(3);
  expect(scanned).toEqual([1, 2, 3, 4]);
  // F-118：切換步驟後焦點在新步驟的標題。
  await expect(page.locator(`[data-step-key="publish"] h2, [data-step-key="publish"] h3`).first()).toBeFocused();
  // 發布步只有一份可切換的預覽。
  await expect(page.getByRole("button", { name: "手機預覽" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "桌機預覽" }).click();
  await expect(page.getByRole("button", { name: "桌機預覽" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("complementary", { name: "即時手機預覽" })).toHaveCount(0);
  await expectNoBlockingAxe(page, "發布步桌機預覽");
});

test("platform-admin MFA and static operations routes have no blocking axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoStableRoute(page, "/login");
  await page.getByLabel("Email").fill(fixture.adminEmail);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  // A platform administrator without an enrolled factor is sent to setup
  // instead of the finance back office.
  await expect(page).toHaveURL("/mfa/setup?next=%2Fadmin%2Fbilling%2Fdashboard");
  await waitForStableRoute(page, "/mfa/setup?next=%2Fadmin%2Fbilling%2Fdashboard");
  await expect(page.getByRole("heading", { name: "財務總覽" })).toHaveCount(0);
  await expectNoBlockingAxeViolations(page);

  // After enrollment, future sessions must complete the challenge before any
  // authenticated admin page is available.
  await gotoStableRoute(page, "/mfa/setup");
  await expectNoBlockingAxeViolations(page);

  await page.getByRole("button", { name: "開始設定雙重驗證" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup\?updated=mfa_started/);
  await waitForStableRoute(page, "/mfa/setup?updated=mfa_started");
  await expectNoBlockingAxeViolations(page);
  const totpSeed = (await page.locator("details p.font-mono").textContent())?.trim();
  expect(totpSeed).toBeTruthy();

  await page.getByLabel("6 位數驗證碼").fill(totpCodeForTimestamp(totpSeed!));
  await page.getByRole("button", { name: "完成設定" }).click();
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
  await page.getByRole("button", { name: "確認並繼續" }).click();
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

test("funnel editor publish drawer has no blocking axe violations while sliding in, when ready and after publishing", async ({ page }) => {
  test.setTimeout(120_000);
  // A separate project-scoped tenant: the shared a11y vendor has no sales project.
  const funnel = await createLandingPageFixture(db, randomUUID());
  const content = createGoalFunnelStepPages({ id: "flow_a11y_publish", name: "A11y 發布抽屜", goal: "sell", domain: `a11y-publish-${runId}` })!;
  const landing = await db.landingPage.create({ data: { vendorId: funnel.vendor.id, projectId: funnel.project.id, name: "A11y 發布抽屜", slug: `a11y-publish-${runId}`, draftContent: JSON.parse(JSON.stringify(content)) } });
  try {
    await gotoStableRoute(page, "/login");
    await page.getByLabel("Email").fill(funnel.owner.email);
    await page.getByLabel("密碼").fill(funnel.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto(`/landing-pages/${landing.id}/edit?step=order_form`, { waitUntil: "load" });
    const toolbar = page.getByLabel("編輯器工具列", { exact: true });
    await expect(toolbar.getByRole("button", { name: "已儲存", exact: true })).toBeDisabled();
    const drawerSlide = (mode: "midway" | "finish") => page.evaluate((nextMode) => {
      for (const animation of document.getAnimations()) {
        if ((animation as CSSAnimation).animationName !== "side-drawer-in") continue;
        if (nextMode === "midway") { animation.pause(); animation.currentTime = 90; } else animation.finish();
      }
    }, mode);
    const publish = toolbar.getByRole("button", { name: "發布", exact: true });
    await publish.click();
    const drawer = page.getByRole("dialog", { name: "發布網站" });
    await expect(drawer).toBeVisible();
    await drawerSlide("midway");
    await expectNoBlockingAxe(page, "發布抽屜（滑入動畫中）");
    await drawerSlide("finish");
    await expect(drawer.getByText("檢查通過，可以發布。", { exact: true })).toBeVisible();
    await expectNoBlockingAxe(page, "發布抽屜（檢查通過）");
    // Escape closes the drawer and returns focus to 發布.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(publish).toBeFocused();
    await publish.click();
    await expect(drawer.getByText("檢查通過，可以發布。", { exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "確認發布", exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(page.locator("[data-ui-toast]")).toContainText("已發布版本 v1");
    await expectNoBlockingAxe(page, "發布成功 Toast");
  } finally {
    await db.landingPage.updateMany({ where: { vendorId: funnel.vendor.id }, data: { status: "draft", publishedVersionId: null } });
    await db.landingPage.deleteMany({ where: { vendorId: funnel.vendor.id } });
    await db.vendor.deleteMany({ where: { id: funnel.vendor.id } });
    await db.user.deleteMany({ where: { id: funnel.owner.id } });
  }
});
