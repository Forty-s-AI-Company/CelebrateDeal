import { createHash, randomUUID } from "node:crypto";
import { expect, test as base, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { totpCodeForTimestamp, verifyRecoveryCode, verifyTotpCode } from "../../src/lib/mfa";
import { createPasswordResetToken } from "../../src/lib/password-reset";
import { createTeamFunnelFixture, TEAM_FUNNEL_TEST_ONLY } from "../fixtures/team-funnel";

const db = new PrismaClient();
const password = "Password12345!";
const previousCredential = ["Previous", "Credential", "123!"].join("");
const replacementCredential = ["Replacement", "Credential", "123!"].join("");
const undersizedCredential = ["too", "short"].join("-");
const stamp = Date.now();
// 每次 Playwright 程序都使用不同識別碼，避免重試或中斷後的假資料互相衝突。
const e2eRunId = `${stamp.toString(36)}-${process.pid.toString(36)}-${randomUUID().slice(0, 8)}`;
const resetReference = ["e2e", "invalid", "reset", e2eRunId].join("-");
const rateLimitRunId = stamp.toString(16).slice(-12).padStart(12, "0");
// PayUni UPP accepts integer TWD only. Keep the fixture provider-valid while
// still proving that checkout ignores a forged client-side amount.
const e2eProductPriceCents = 12_300;
const e2eOrigin = new URL(
  process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? "31023"}`,
).origin;
const seed = {
  email: `e2e-${stamp}@celebratedeal.local`,
  vendorSlug: `e2e-vendor-${stamp}`,
  productSlug: `e2e-product-${stamp}`,
  formSlug: `e2e-form-${stamp}`,
  liveSlug: `e2e-live-${stamp}`,
  vendorId: "",
  userId: "",
  productId: "",
  formId: "",
  liveId: "",
};

type MfaTestUser = {
  id: string;
  email: string;
};

type PasswordResetTestUser = {
  id: string;
  email: string;
  vendorId: string;
};

type LoginRateLimitTestUser = {
  id: string;
  email: string;
  normalizedEmail: string;
  vendorId: string;
  sessionCountBaseline: number;
  correctCredential: string;
  incorrectCredential: string;
};

type PublicRateLimitEndpoint = {
  name: string;
  path: string;
  limit: number;
  invalidPayloadError: string;
};

function uniqueRateLimitTestIp(routeId: number) {
  return [
    "2001",
    "0db8",
    rateLimitRunId.slice(0, 4),
    rateLimitRunId.slice(4, 8),
    rateLimitRunId.slice(8, 12),
    routeId.toString(16).padStart(4, "0"),
    "0000",
    "0001",
  ].join(":");
}

function uniqueLoginTestIp(testId: string, retry: number, lane = 0) {
  const digest = createHash("sha256")
    .update(`${rateLimitRunId}:${testId}:${retry}:${lane}`)
    .digest("hex");

  return [
    "2001",
    "0db8",
    digest.slice(0, 4),
    digest.slice(4, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 24),
  ].join(":");
}

// Each browser test gets an isolated source bucket so one login scenario cannot
// consume another scenario's in-memory rate-limit allowance. Retries get a new
// address as well, preventing a failed first attempt from poisoning its retry.
const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await page.context().setExtraHTTPHeaders({
      "X-Forwarded-For": uniqueLoginTestIp(testInfo.testId, testInfo.retry),
    });
    // Playwright fixture API; this is not React's use hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

const cspReportPayload = {
  "csp-report": {
    "blocked-uri": "https://example.test/script.js",
    "violated-directive": "script-src",
  },
};

async function expectCspReportRateLimit(request: APIRequestContext, routeId: number) {
  const headers = {
    "content-type": "application/csp-report",
    "X-Forwarded-For": uniqueRateLimitTestIp(routeId),
  };

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await request.post("/api/security/csp-report", { headers, data: cspReportPayload });
    expect(response.status(), `CSP report request ${attempt + 1} before its limit`).toBe(204);
  }

  const limited = await request.post("/api/security/csp-report", { headers, data: cspReportPayload });
  expect(limited.status(), "CSP report request after its limit").toBe(429);
  expect(await limited.json()).toEqual({ error: "Too many requests" });
  expect(limited.headers()["retry-after"], "CSP report Retry-After header").toMatch(/^[1-9]\d*$/);
}

function countPublicPostSideEffects() {
  return Promise.all([
    db.formSubmission.count(),
    db.analyticsEvent.count(),
    db.affiliateClick.count(),
    db.paymentTransaction.count(),
  ]);
}

async function expectPublicPostRateLimit(
  request: APIRequestContext,
  endpoint: PublicRateLimitEndpoint,
  routeId: number,
) {
  const recordCountsBefore = await countPublicPostSideEffects();
  const headers = {
    "content-type": "application/json",
    "X-CelebrateDeal-Client": "web",
    Origin: e2eOrigin,
    "X-Forwarded-For": uniqueRateLimitTestIp(routeId),
  };

  for (let attempt = 0; attempt < endpoint.limit; attempt += 1) {
    const response = await request.post(endpoint.path, { headers, data: {} });
    expect(response.status(), `${endpoint.name} request ${attempt + 1} before its limit`).toBe(400);
    expect(await response.json()).toEqual({ error: endpoint.invalidPayloadError });
  }

  const limited = await request.post(endpoint.path, { headers, data: {} });
  expect(limited.status(), `${endpoint.name} request after its limit`).toBe(429);
  expect(await limited.json()).toEqual({ error: "Too many requests" });
  const retryAfter = limited.headers()["retry-after"];
  expect(retryAfter, `${endpoint.name} Retry-After header`).toMatch(/^[1-9]\d*$/);
  expect(await countPublicPostSideEffects(), `${endpoint.name} must reject invalid payloads before side effects`).toEqual(recordCountsBefore);
}

const mfaTest = test.extend<{ mfaUser: MfaTestUser }>({
  mfaUser: async ({}, use, testInfo) => {
    const email = `e2e-mfa-${stamp}-${testInfo.testId.replace(/[^a-zA-Z0-9]/g, "")}@celebratedeal.local`;
    const user = await db.user.create({
      data: {
        email,
        name: "E2E MFA Platform Admin",
        passwordHash: hashPassword(password),
        platformRole: "platform_admin",
        status: "active",
      },
    });

    try {
      // Playwright fixture API; this is not React's use hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use({ id: user.id, email: user.email });
    } finally {
      // AuditLog deliberately has no user foreign key, so remove only this fixture's entries.
      await db.auditLog.deleteMany({
        where: {
          OR: [{ actorId: user.id }, { targetId: user.id }],
        },
      });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  },
});

// MFA setup intentionally reveals one-time credentials; never retain them in Playwright traces.
mfaTest.use({ trace: "off" });

const passwordResetTest = test.extend<{ passwordResetUser: PasswordResetTestUser }>({
  passwordResetUser: async ({}, use, testInfo) => {
    const testIdSuffix = createHash("sha256").update(testInfo.testId).digest("hex").slice(0, 12);
    const suffix = `${e2eRunId}-${testInfo.retry}-${testIdSuffix}`;
    const sessionReference = `e2e-reset-session-${suffix}`;
    const vendor = await db.vendor.create({
      data: {
        name: `E2E Reset Vendor ${suffix}`,
        slug: `e2e-reset-vendor-${suffix}`,
        email: `e2e-reset-vendor-${suffix}@celebratedeal.local`,
        passwordHash: hashPassword(previousCredential),
        primaryColor: "#2563eb",
        ctaColor: "#f97316",
        tracking: { create: {} },
      },
    });
    const smokeTestEmail = process.env.E2E_SMOKE_TEST_EMAIL;
    if (!smokeTestEmail) throw new Error("E2E_SMOKE_TEST_EMAIL is required for isolated email smoke QA.");
    let user: { id: string; email: string } | null = null;

    try {
      user = await db.user.create({
        data: {
          email: smokeTestEmail,
          name: "E2E Password Reset User",
          passwordHash: hashPassword(previousCredential),
          status: "active",
          memberships: {
            create: { vendorId: vendor.id, role: "owner", status: "active" },
          },
          sessions: {
            create: {
              tokenHash: createHash("sha256").update(sessionReference).digest("hex"),
              expiresAt: new Date(Date.now() + 10 * 60_000),
            },
          },
        },
      });

      // Playwright fixture API; this is not React's use hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use({ id: user.id, email: user.email, vendorId: vendor.id });
    } finally {
      if (user) {
        await db.passwordResetToken.deleteMany({ where: { userId: user.id } });
        await db.userSession.deleteMany({ where: { userId: user.id } });
      }
      await db.auditLog.deleteMany({
        where: {
          OR: [
            ...(user
              ? [
                  { actorId: user.id },
                  { targetId: user.id },
                  { targetId: user.email },
                  { after: { path: ["email"], equals: user.email } },
                ]
              : []),
            { vendorId: vendor.id },
          ],
        },
      });
      if (user) {
        await db.user.deleteMany({ where: { id: user.id } });
      }
      await db.vendor.deleteMany({ where: { id: vendor.id } });
    }
  },
});

passwordResetTest.use({ trace: "off", screenshot: "off", video: "off" });

const loginRateLimitTest = test.extend<{ loginRateLimitUser: LoginRateLimitTestUser }>({
  context: async ({ browser, contextOptions }, use, testInfo) => {
    const context = await browser.newContext({
      ...contextOptions,
      // 限流案例使用獨立 IP，避免污染後續正常登入與 MFA 測試。
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        "X-Forwarded-For": uniqueLoginTestIp(testInfo.testId, testInfo.retry),
      },
    });
    // Playwright fixture API；這裡不是 React Hook。
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(context);
    await context.close();
  },
  loginRateLimitUser: async ({}, use, testInfo) => {
    const testIdSuffix = testInfo.testId.replace(/[^a-zA-Z0-9]/g, "").slice(-12);
    const suffix = `${e2eRunId}-${testInfo.retry}-${testIdSuffix}`;
    const normalizedEmail = `e2e-login-rate-limit-${suffix}@celebratedeal.local`;
    const correctCredential = ["Rate", "Limit", "Correct", "Credential", "123!"].join("");
    const incorrectCredential = ["Rate", "Limit", "Incorrect", "Credential", "123!"].join("");
    const vendor = await db.vendor.create({
      data: {
        name: `E2E Login Rate Limit Vendor ${suffix}`,
        slug: `e2e-login-rate-limit-vendor-${suffix}`,
        email: `e2e-login-rate-limit-vendor-${suffix}@celebratedeal.local`,
        passwordHash: hashPassword(correctCredential),
        primaryColor: "#2563eb",
        ctaColor: "#f97316",
        tracking: { create: {} },
      },
    });
    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        name: "E2E Login Rate Limit Owner",
        passwordHash: hashPassword(correctCredential),
        status: "active",
        memberships: {
          create: { vendorId: vendor.id, role: "owner", status: "active" },
        },
      },
    });
    const sessionCountBaseline = await db.userSession.count({ where: { userId: user.id } });

    try {
      // Playwright fixture API; this is not React's use hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use({
        id: user.id,
        email: user.email,
        normalizedEmail,
        vendorId: vendor.id,
        sessionCountBaseline,
        correctCredential,
        incorrectCredential,
      });
    } finally {
      await db.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: user.id },
            { targetId: normalizedEmail },
            { vendorId: vendor.id },
            { after: { path: ["email"], equals: normalizedEmail } },
          ],
        },
      });
      await db.userSession.deleteMany({ where: { userId: user.id } });
      await db.vendorMember.deleteMany({ where: { vendorId: vendor.id, userId: user.id } });
      await db.user.deleteMany({ where: { id: user.id, email: normalizedEmail } });
      await db.vendor.deleteMany({ where: { id: vendor.id } });
    }
  },
});

loginRateLimitTest.use({ trace: "off", screenshot: "off", video: "off" });

function confirmUrlWithInvalidResetReference() {
  const search = new URLSearchParams();
  search.set(["to", "ken"].join(""), resetReference);
  return `/password-reset/confirm?${search.toString()}`;
}

function resetReferenceDigest() {
  return createHash("sha256").update(resetReference).digest("hex");
}

async function putResetReferenceInHiddenField(page: Page, value: string) {
  await page.locator('input[name="token"]').evaluate((element, hiddenValue) => {
    (element as HTMLInputElement).value = hiddenValue;
  }, value);
}

async function loginMfaAdmin(page: Page, user: MfaTestUser, expectedUrl: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(expectedUrl);
}

async function loginSeededOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function html5DragAndDrop(source: Locator, target: Locator) {
  const targetIndex = await target.evaluate((element) => (
    Array.from(document.querySelectorAll('[data-testid="interaction-message-row"]')).indexOf(element)
  ));
  if (targetIndex < 0) throw new Error("HTML5 drag target is not a message row.");

  await source.evaluate((sourceElement, index) => {
    const targetElement = document.querySelectorAll('[data-testid="interaction-message-row"]')[index];
    if (!targetElement) throw new Error(`HTML5 drag target not found at index ${index}`);

    const dataTransfer = new DataTransfer();
    sourceElement.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    targetElement.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    targetElement.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    targetElement.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    sourceElement.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
  }, targetIndex);
}

function invalidTotpCode(totpSeed: string) {
  for (let candidate = 0; candidate < 1_000_000; candidate += 1) {
    const code = String(candidate).padStart(6, "0");
    if (!verifyTotpCode(totpSeed, code)) return code;
  }
  throw new Error("Unable to select an invalid TOTP code.");
}

async function enrollMfa(page: Page, user: MfaTestUser) {
  await loginMfaAdmin(page, user, /\/mfa\/setup$/);
  await page.getByRole("button", { name: "開始建立 TOTP" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup\?updated=mfa_started/);

  const totpSeed = (await page.locator("p.font-mono").textContent())?.trim();
  if (!totpSeed) throw new Error("MFA setup did not provide a TOTP secret.");

  await page.getByLabel("6 位數驗證碼").fill(totpCodeForTimestamp(totpSeed));
  await page.getByRole("button", { name: "啟用 MFA" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup\?updated=mfa_enabled/);
  expect(await db.userMfaFactor.count({ where: { userId: user.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { actorId: user.id, action: "mfa_enabled" } })).toBe(1);

  return totpSeed;
}

async function displayedRecoveryCode(page: Page) {
  const codes = await page.locator("div.font-mono").allTextContents();
  expect(codes.length > 0).toBe(true);
  const code = codes[0]?.trim();
  if (!code) throw new Error("MFA setup did not provide a recovery code.");
  return code;
}

async function verifyMfa(page: Page, code: string) {
  await page.getByLabel("驗證碼").fill(code);
  await page.getByRole("button", { name: "確認並進入後台" }).click();
}

async function expectMfaAuditActions(userId: string, actions: string[]) {
  const logs = await db.auditLog.findMany({
    where: { actorId: userId, action: { in: actions } },
    select: { action: true },
  });
  const recorded = new Set(logs.map((log) => log.action));
  for (const action of actions) {
    expect(recorded.has(action)).toBe(true);
  }
}

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: "E2E 測試品牌",
      slug: seed.vendorSlug,
      email: seed.email,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: seed.email,
      name: "E2E Owner",
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
      name: "E2E 導購商品",
      slug: seed.productSlug,
      description: "Smoke test product",
      priceCents: e2eProductPriceCents,
      currency: "TWD",
      inventory: 10,
      isActive: true,
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "E2E 報名表",
      slug: seed.formSlug,
      headline: "E2E 報名測試",
      description: "用於 smoke test",
      submitLabel: "送出報名",
      successMessage: "E2E 已收到資料",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
      isActive: true,
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      title: "E2E 直播頁",
      slug: seed.liveSlug,
      description: "Smoke live page",
      scheduledAt: new Date(Date.now() + 60_000),
      status: "scheduled",
      accentCopy: "E2E 優惠",
      products: {
        create: [{ productId: product.id, sortOrder: 1, isPinned: true }],
      },
    },
  });

  seed.vendorId = vendor.id;
  seed.userId = user.id;
  seed.productId = product.id;
  seed.formId = form.id;
  seed.liveId = live.id;
});

test.afterAll(async () => {
  if (seed.vendorId) {
    await db.vendor.deleteMany({ where: { id: seed.vendorId } });
  }
  if (seed.userId) {
    await db.user.deleteMany({ where: { id: seed.userId } });
  }
  await db.$disconnect();
});

test("health endpoint confirms live database availability", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body = await response.json() as Record<string, unknown>;
  expect(body.ok).toBe(true);
  expect(body.database).toBe("ok");
  expect(body).not.toHaveProperty("error");

  const latencyMs = body.latencyMs;
  expect(typeof latencyMs).toBe("number");
  expect(Number.isFinite(latencyMs)).toBe(true);
  expect(latencyMs).toBeGreaterThanOrEqual(0);
});

test("login page renders and accepts seeded owner", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.headers()["content-security-policy-report-only"]).toContain(
    "report-uri /api/security/csp-report",
  );
  await expect(page.getByRole("heading", { name: "登入直播商務後台" })).toBeVisible();
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("merchant can drag the last template message to the first timeline slot", async ({ page }) => {
  await loginSeededOwner(page);
  await page.goto("/interaction-scripts/new");
  await expect(page.getByRole("heading", { name: "新增互動腳本" })).toBeVisible();

  const scriptName = `E2E 拖曳排序持久化 ${e2eRunId}`;
  await page.getByLabel("留言組名稱").fill(scriptName);
  await page.getByRole("button", { name: "新品快閃" }).click();

  const messageRows = page.getByTestId("interaction-message-row");
  await expect(messageRows).toHaveCount(4);
  await html5DragAndDrop(messageRows.nth(3), messageRows.nth(0));

  const expectedMessages = [
    "直播限定優惠已開放，等等會整理完整連結。",
    "歡迎來到官方直播間，今天會快速整理新品亮點。",
    "主打組合已經浮出，想比較規格可以先點商品卡。",
    "第一次接觸可以先從體驗組開始，門檻比較輕。",
  ];
  const expectedTimes = ["00:00:05", "00:00:45", "00:01:30", "00:03:00"];

  await expect(messageRows.nth(0).getByTestId("interaction-message-content")).toHaveValue(expectedMessages[0]);
  expect(await messageRows.getByTestId("interaction-message-content").evaluateAll((elements) => (
    elements.map((element) => (element as HTMLTextAreaElement).value)
  ))).toEqual(expectedMessages);
  expect(await messageRows.getByTestId("interaction-message-time").evaluateAll((elements) => (
    elements.map((element) => (element as HTMLInputElement).value)
  ))).toEqual(expectedTimes);

  const timelineOutline = page.getByTestId("interaction-timeline-outline");
  await expect(timelineOutline.getByTestId("interaction-timeline-outline-message")).toHaveText(expectedMessages);
  await expect(timelineOutline.getByTestId("interaction-timeline-outline-time")).toHaveText(expectedTimes);

  await page.getByRole("button", { name: "更新留言組" }).click();
  await expect(page).toHaveURL(/\/interaction-scripts$/);

  const savedScript = page.getByRole("heading", { name: scriptName, exact: true }).locator("../../../..");
  await expect(savedScript).toBeVisible();
  await savedScript.getByTitle("編輯").click();
  await expect(page).toHaveURL(/\/interaction-scripts\/[^/]+\/edit$/);

  const persistedMessageRows = page.getByTestId("interaction-message-row");
  await expect(persistedMessageRows).toHaveCount(4);
  expect(await persistedMessageRows.getByTestId("interaction-message-content").evaluateAll((elements) => (
    elements.map((element) => (element as HTMLTextAreaElement).value)
  ))).toEqual(expectedMessages);
  expect(await persistedMessageRows.getByTestId("interaction-message-time").evaluateAll((elements) => (
    elements.map((element) => (element as HTMLInputElement).value)
  ))).toEqual(expectedTimes);
});

loginRateLimitTest("login failures are audited and the sixth UI attempt is rejected before authentication", async ({ page, loginRateLimitUser }) => {
  const {
    id: userId,
    email,
    normalizedEmail,
    sessionCountBaseline,
    correctCredential,
    incorrectCredential,
  } = loginRateLimitUser;
  const loginFailedWhere = {
    action: "login_failed",
    targetType: "Auth",
    targetId: normalizedEmail,
  };
  const loginRateLimitedWhere = {
    action: "login_rate_limited",
    targetType: "Auth",
    targetId: normalizedEmail,
  };
  const loginSuccessWhere = {
    action: "login_success",
    targetType: "User",
    targetId: userId,
    actorId: userId,
  };

  expect(await db.auditLog.count({ where: loginSuccessWhere })).toBe(0);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("密碼").fill(incorrectCredential);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/login\?error=1$/);
    await expect(page.getByText("帳號或密碼不正確。")).toBeVisible();
    expect(await db.auditLog.count({ where: loginFailedWhere })).toBe(attempt);
  }

  expect(await db.auditLog.count({ where: loginFailedWhere })).toBe(5);
  expect(await db.auditLog.count({ where: loginRateLimitedWhere })).toBe(0);
  expect(await db.auditLog.count({ where: loginSuccessWhere })).toBe(0);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("密碼").fill(correctCredential);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/login\?error=rate_limited$/);
  await expect(page.getByText("登入失敗次數過多，請 15 分鐘後再試，或請平台管理員協助重設。")).toBeVisible();

  expect(await db.auditLog.count({ where: loginFailedWhere })).toBe(5);
  expect(await db.auditLog.count({ where: loginRateLimitedWhere })).toBe(0);
  expect(await db.auditLog.count({ where: loginSuccessWhere })).toBe(0);
  expect(await db.userSession.count({ where: { userId } })).toBe(sessionCountBaseline);
});

passwordResetTest("password reset request hides account existence and revokes an undelivered reset record", async ({ page, passwordResetUser }) => {
  await page.goto("/password-reset/request");
  await page.getByLabel("Email").fill(passwordResetUser.email);
  await page.getByRole("button", { name: "寄送重設信" }).click();

  await expect(page).toHaveURL(/\/password-reset\/request\?updated=sent/);
  await expect(page.getByText("如果這個 Email 存在，系統已寄出密碼重設信。")).toBeVisible();

  const resetRecords = await db.passwordResetToken.findMany({
    where: { userId: passwordResetUser.id },
  });
  expect(resetRecords).toHaveLength(1);
  expect(resetRecords[0]?.usedAt).not.toBeNull();
  expect(resetRecords[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  expect(await db.auditLog.count({
    where: {
      actorLabel: "password_reset_request_failed",
      action: "password_reset_email_failed",
      after: { path: ["email"], equals: passwordResetUser.email },
    },
  })).toBeGreaterThan(0);
});

passwordResetTest("security password reset smoke targets only the signed-in user and remains locally isolated", async ({ page, passwordResetUser }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(passwordResetUser.email);
  await page.getByLabel("密碼").fill(previousCredential);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings/security");
  const smokeForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "寄送目前帳號的 reset 測試信" }),
  });
  await expect(smokeForm).toHaveCount(1);
  await expect(smokeForm.locator('input:not([type="hidden"])')).toHaveCount(0);

  await smokeForm.getByRole("button", { name: "寄送目前帳號的 reset 測試信" }).click();
  await expect(page).toHaveURL(/\/settings\/security\?error=password_reset_smoke$/);
  await expect(page.getByText("密碼重設測試信寄送失敗，請檢查 Resend 設定。")).toBeVisible();

  const resetRecords = await db.passwordResetToken.findMany({
    where: { userId: passwordResetUser.id },
    select: { userId: true, usedAt: true, expiresAt: true },
  });
  expect(resetRecords).toHaveLength(1);
  expect(resetRecords[0]?.userId).toBe(passwordResetUser.id);
  expect(resetRecords[0]?.usedAt).not.toBeNull();
  expect(resetRecords[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

  const failedAudits = await db.auditLog.findMany({
    where: {
      action: "password_reset_smoke_email_failed",
      actorId: passwordResetUser.id,
      targetId: passwordResetUser.id,
      after: { path: ["email"], equals: passwordResetUser.email },
    },
    select: { actorId: true, targetId: true, after: true },
  });
  expect(failedAudits).toHaveLength(1);
  expect(failedAudits[0]).toMatchObject({
    actorId: passwordResetUser.id,
    targetId: passwordResetUser.id,
    after: { email: passwordResetUser.email },
  });
  expect(await db.auditLog.count({
    where: { action: "password_reset_smoke_email_sent", actorId: passwordResetUser.id },
  })).toBe(0);
});

passwordResetTest("password reset confirmation validates safely and replaces credentials through the UI", async ({ page, passwordResetUser }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(passwordResetUser.email);
  await page.getByLabel("密碼").fill(previousCredential);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const activeSessionsBeforeReset = await db.userSession.count({
    where: { userId: passwordResetUser.id, revokedAt: null },
  });
  expect(activeSessionsBeforeReset).toBeGreaterThan(0);

  await page.goto(confirmUrlWithInvalidResetReference());
  await page.getByLabel("新密碼").fill(undersizedCredential);
  await page.getByLabel("確認密碼").fill(undersizedCredential);
  await page.getByRole("button", { name: "更新密碼" }).click();
  await expect(page.getByText("密碼至少需要 12 個字元。")).toBeVisible();

  await page.getByLabel("新密碼").fill(replacementCredential);
  await page.getByLabel("確認密碼").fill(previousCredential);
  await page.getByRole("button", { name: "更新密碼" }).click();
  await expect(page.getByText("兩次輸入的密碼不一致。")).toBeVisible();

  await page.getByLabel("新密碼").fill(replacementCredential);
  await page.getByLabel("確認密碼").fill(replacementCredential);
  await page.getByRole("button", { name: "更新密碼" }).click();
  await expect(page.getByText("這個重設連結已失效，請重新申請。")).toBeVisible();

  const preparedReset = await createPasswordResetToken({ email: passwordResetUser.email });
  if (!preparedReset) throw new Error("Password reset fixture was not created.");
  const preparedRecord = await db.passwordResetToken.findFirstOrThrow({
    where: { userId: passwordResetUser.id, usedAt: null },
    select: { id: true },
  });
  await db.passwordResetToken.update({
    where: { id: preparedRecord.id },
    data: {
      tokenHash: resetReferenceDigest(),
      expiresAt: new Date(Date.now() - 1_000),
    },
  });

  await page.goto(confirmUrlWithInvalidResetReference());
  await page.getByLabel("新密碼").fill(replacementCredential);
  await page.getByLabel("確認密碼").fill(replacementCredential);
  await page.getByRole("button", { name: "更新密碼" }).click();
  await expect(page.getByText("這個重設連結已失效，請重新申請。")).toBeVisible();

  await db.passwordResetToken.update({
    where: { id: preparedRecord.id },
    data: {
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    },
  });
  await page.goto(confirmUrlWithInvalidResetReference());
  await page.getByLabel("新密碼").fill(replacementCredential);
  await page.getByLabel("確認密碼").fill(replacementCredential);
  await page.getByRole("button", { name: "更新密碼" }).click();
  await expect(page.getByText("這個重設連結已失效，請重新申請。")).toBeVisible();

  await page.goto("/password-reset/confirm");
  const activeResetFixture = await createPasswordResetToken({ email: passwordResetUser.email });
  if (!activeResetFixture) throw new Error("Password reset fixture was not created.");
  await putResetReferenceInHiddenField(page, activeResetFixture.token);
  await page.getByLabel("新密碼").fill(replacementCredential);
  await page.getByLabel("確認密碼").fill(replacementCredential);
  await page.getByRole("button", { name: "更新密碼" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);

  expect(await db.userSession.count({
    where: { userId: passwordResetUser.id, revokedAt: null },
  })).toBe(0);
  expect(await db.passwordResetToken.count({
    where: { userId: passwordResetUser.id, usedAt: { not: null } },
  })).toBeGreaterThan(0);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(passwordResetUser.email);
  await page.getByLabel("密碼").fill(previousCredential);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/login\?error=1/);

  await page.getByLabel("Email").fill(passwordResetUser.email);
  await page.getByLabel("密碼").fill(replacementCredential);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("CSP reports are accepted by the report-only endpoint", async ({ request }) => {
  const response = await request.post("/api/security/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: cspReportPayload,
  });

  expect(response.status()).toBe(204);
});

test("public JSON POST endpoints require the trusted client header before side effects", async ({ request }) => {
  const publicJsonPosts = [
    {
      path: "/api/form-submissions",
      data: {
        formId: seed.formId,
        liveId: seed.liveId,
        payload: { name: "Header guard", email: `header-guard-${stamp}@example.com` },
      },
    },
    {
      path: "/api/analytics",
      data: { vendorId: seed.vendorId, liveId: seed.liveId, visitorId: "header-guard", eventType: "page_view" },
    },
    {
      path: "/api/affiliate-clicks",
      data: {
        vendorId: seed.vendorId,
        liveId: seed.liveId,
        referralCode: "HEADER-GUARD",
        visitorId: "header-guard",
        landingPath: "/live/header-guard",
      },
    },
    {
      path: "/api/payments/checkout",
      data: { vendorId: seed.vendorId, productId: seed.productId },
    },
  ];

  for (const endpoint of publicJsonPosts) {
    const response = await request.post(endpoint.path, {
      headers: { "content-type": "application/json" },
      data: endpoint.data,
    });

    expect(response.status(), `${endpoint.path} without trusted client header`).toBe(403);
    expect(await response.json()).toEqual({ error: "Missing trusted client header" });
  }
});

test("public JSON POST endpoints reject cross-origin requests before side effects", async ({ request }) => {
  const publicJsonPosts = [
    {
      path: "/api/form-submissions",
      data: {
        formId: seed.formId,
        liveId: seed.liveId,
        payload: { name: "Origin guard", email: `origin-guard-${stamp}@example.com` },
      },
    },
    {
      path: "/api/analytics",
      data: { vendorId: seed.vendorId, liveId: seed.liveId, visitorId: "origin-guard", eventType: "page_view" },
    },
    {
      path: "/api/affiliate-clicks",
      data: {
        vendorId: seed.vendorId,
        liveId: seed.liveId,
        referralCode: "ORIGIN-GUARD",
        visitorId: "origin-guard",
        landingPath: "/live/origin-guard",
      },
    },
    {
      path: "/api/payments/checkout",
      data: { vendorId: seed.vendorId, productId: seed.productId },
    },
  ];

  for (const endpoint of publicJsonPosts) {
    const response = await request.post(endpoint.path, {
      headers: {
        "content-type": "application/json",
        "X-CelebrateDeal-Client": "web",
        Origin: "https://cross-origin-smoke.invalid",
      },
      data: endpoint.data,
    });

    expect(response.status(), `${endpoint.path} with cross-origin Origin`).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid request origin" });
  }
});

test.describe("memory-provider public POST rate limits", () => {
  test.skip(
    ["cloudflare_waf", "upstash_redis"].includes(process.env.RATE_LIMIT_PROVIDER ?? "memory"),
    "These assertions exercise the deterministic in-process memory provider.",
  );

  test("form submissions return 429 after 10 invalid trusted requests without creating submissions", async ({ request }) => {
    await expectPublicPostRateLimit(request, {
      name: "POST /api/form-submissions",
      path: "/api/form-submissions",
      limit: 10,
      invalidPayloadError: "Invalid payload",
    }, 1);
  });

  test("analytics returns 429 after 120 invalid trusted requests without creating events", async ({ request }) => {
    test.setTimeout(90_000);
    await expectPublicPostRateLimit(request, {
      name: "POST /api/analytics",
      path: "/api/analytics",
      limit: 120,
      invalidPayloadError: "Invalid payload",
    }, 2);
  });

  test("affiliate clicks return 429 after 60 invalid trusted requests without creating clicks", async ({ request }) => {
    test.setTimeout(60_000);
    await expectPublicPostRateLimit(request, {
      name: "POST /api/affiliate-clicks",
      path: "/api/affiliate-clicks",
      limit: 60,
      invalidPayloadError: "Invalid payload",
    }, 3);
  });

  test("checkout returns 429 after 20 invalid trusted requests without creating transactions", async ({ request }) => {
    await expectPublicPostRateLimit(request, {
      name: "POST /api/payments/checkout",
      path: "/api/payments/checkout",
      limit: 20,
      invalidPayloadError: "Invalid checkout request",
    }, 4);
  });

  test("CSP reports return 429 after 120 accepted reports", async ({ request }) => {
    test.setTimeout(90_000);
    await expectCspReportRateLimit(request, 5);
  });
});

test("protected vendor and admin pages redirect unauthenticated users", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/admin/billing/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("vendor finance roles cannot enter the cross-tenant platform admin area", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/admin/billing/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "財務總覽" })).toHaveCount(0);
});

mfaTest("platform admin can enable TOTP, rejects an incorrect code, and enters admin after verification", async ({ page, mfaUser }) => {
  const totpSeed = await enrollMfa(page, mfaUser);

  await page.context().clearCookies();
  await loginMfaAdmin(page, mfaUser, /\/mfa\/verify\?next=%2Fadmin%2Fbilling%2Fdashboard/);
  await verifyMfa(page, invalidTotpCode(totpSeed));
  await expect(page).toHaveURL(/\/mfa\/verify\?error=invalid/);

  await verifyMfa(page, totpCodeForTimestamp(totpSeed));
  await expect(page).toHaveURL(/\/admin\/billing\/dashboard/);
  await expectMfaAuditActions(mfaUser.id, ["mfa_verify_failed", "mfa_verify_totp"]);
});

mfaTest("recovery code completes MFA once and cannot be reused", async ({ page, mfaUser }) => {
  await enrollMfa(page, mfaUser);
  const recoveryCode = await displayedRecoveryCode(page);
  await page.getByRole("button", { name: "我已保存 recovery codes" }).click();
  await expect(page).toHaveURL(/\/mfa\/verify/);

  await page.context().clearCookies();
  await loginMfaAdmin(page, mfaUser, /\/mfa\/verify\?next=%2Fadmin%2Fbilling%2Fdashboard/);
  await verifyMfa(page, recoveryCode);
  await expect(page).toHaveURL(/\/admin\/billing\/dashboard/);

  const usedCode = await db.userRecoveryCode.findFirst({
    where: { userId: mfaUser.id, usedAt: { not: null } },
    select: { id: true },
  });
  expect(Boolean(usedCode)).toBe(true);

  await page.context().clearCookies();
  await loginMfaAdmin(page, mfaUser, /\/mfa\/verify\?next=%2Fadmin%2Fbilling%2Fdashboard/);
  await verifyMfa(page, recoveryCode);
  await expect(page).toHaveURL(/\/mfa\/verify\?error=invalid/);
  await expectMfaAuditActions(mfaUser.id, ["mfa_verify_recovery_code", "mfa_verify_failed"]);
});

mfaTest("regenerating recovery codes invalidates old codes and accepts newly issued codes", async ({ page, mfaUser }) => {
  const totpSeed = await enrollMfa(page, mfaUser);
  const oldRecoveryCode = await displayedRecoveryCode(page);
  await page.getByRole("button", { name: "我已保存 recovery codes" }).click();
  await expect(page).toHaveURL(/\/mfa\/verify/);

  await page.goto("/mfa/setup");
  await page.getByLabel("目前 TOTP 驗證碼").fill(totpCodeForTimestamp(totpSeed));
  await page.getByRole("button", { name: "重新產生 recovery codes" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup\?updated=recovery_regenerated/);
  const newRecoveryCode = await displayedRecoveryCode(page);
  expect(oldRecoveryCode === newRecoveryCode).toBe(false);

  const recoveryCodeHashes = await db.userRecoveryCode.findMany({
    where: { userId: mfaUser.id },
    select: { codeHash: true },
  });
  expect(recoveryCodeHashes.some(({ codeHash }) => verifyRecoveryCode(oldRecoveryCode, codeHash))).toBe(false);
  expect(recoveryCodeHashes.some(({ codeHash }) => verifyRecoveryCode(newRecoveryCode, codeHash))).toBe(true);

  await page.context().clearCookies();
  await loginMfaAdmin(page, mfaUser, /\/mfa\/verify\?next=%2Fadmin%2Fbilling%2Fdashboard/);
  await verifyMfa(page, oldRecoveryCode);
  await expect(page).toHaveURL(/\/mfa\/verify\?error=invalid/);

  await page.context().clearCookies();
  await loginMfaAdmin(page, mfaUser, /\/mfa\/verify\?next=%2Fadmin%2Fbilling%2Fdashboard/);
  await verifyMfa(page, newRecoveryCode);
  await expect(page).toHaveURL(/\/admin\/billing\/dashboard/);
  await expectMfaAuditActions(mfaUser.id, [
    "mfa_recovery_codes_regenerated",
    "mfa_verify_failed",
    "mfa_verify_recovery_code",
  ]);
});

test("public live page renders mobile-first commerce surface", async ({ page }) => {
  await page.goto(`/live/${seed.liveSlug}`);
  await expect(page.getByText("E2E 直播頁")).toBeVisible();
  await expect(page.getByText("E2E 測試品牌")).toBeVisible();
  await expect(page.getByRole("button", { name: /商品/ })).toBeVisible();
});

test("public form can submit a lead", async ({ page }) => {
  await page.goto(`/form/${seed.formSlug}`);
  await page.getByLabel("姓名").fill("王小明");
  await page.getByLabel("Email").fill(`lead-${stamp}@example.com`);
  await page.getByRole("button", { name: "送出報名" }).click();
  await expect(page.getByText("E2E 已收到資料")).toBeVisible();
});

test("checkout ignores client amount and uses product price", async ({ request }) => {
  const response = await request.post("/api/payments/checkout", {
    headers: { "X-CelebrateDeal-Client": "web" },
    data: {
      vendorId: seed.vendorId,
      productId: seed.productId,
      amountCents: 1,
      referralCode: "E2E",
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json() as { transactionId: string; amountCents: number };
  expect(body.amountCents).toBe(e2eProductPriceCents);

  const transaction = await db.paymentTransaction.findUniqueOrThrow({ where: { id: body.transactionId } });
  expect(transaction.grossAmountCents).toBe(e2eProductPriceCents);
});

test("JOB_SECRET protected APIs reject missing and invalid authorization", async ({ request }) => {
  // This assertion intentionally cold-loads nine separate Next.js route
  // modules in the development server. Keep the allowance local and bounded
  // so route compilation does not consume the suite-wide 30-second default.
  test.setTimeout(120_000);
  const invalidBearerHeader = ["Bearer", "e2e-invalid-credential"].join(" ");
  const protectedEndpoints = [
    { method: "GET", path: "/api/admin/preflight" },
    { method: "POST", path: "/api/admin/ops/test-email" },
    { method: "POST", path: "/api/admin/ops/test-analytics" },
    { method: "POST", path: "/api/admin/ops/test-monitoring" },
    { method: "POST", path: "/api/jobs/webhook-retry" },
    { method: "POST", path: "/api/admin/ops/cloudflare/direct-upload" },
    { method: "POST", path: "/api/admin/ops/cloudflare/live-input" },
    { method: "POST", path: "/api/cloudflare/direct-upload" },
    { method: "POST", path: "/api/cloudflare/live-inputs" },
  ] as const;

  for (const endpoint of protectedEndpoints) {
    const missingAuthorization = await request.fetch(endpoint.path, { method: endpoint.method });
    expect(missingAuthorization.status(), `${endpoint.method} ${endpoint.path} without Authorization`).toBe(401);

    const invalidAuthorization = await request.fetch(endpoint.path, {
      method: endpoint.method,
      headers: { Authorization: invalidBearerHeader },
    });
    expect(invalidAuthorization.status(), `${endpoint.method} ${endpoint.path} with invalid Authorization`).toBe(401);
  }
});

test("team-funnel browser acceptance covers leader publishing, partner modes, attribution, scope, and responsive QA", async ({ browser }, testInfo) => {
  // 此驗收會依序覆蓋三種領取模式與三個獨立瀏覽器 context；開發伺服器在
  // 完整 smoke suite 後仍可能進行路由編譯，因此保留有界但足夠的整體時間。
  test.setTimeout(240_000);
  const fixture = await createTeamFunnelFixture(db, `pw-${Date.now().toString(36)}`);
  const consoleFailures: string[] = [];
  let leaderContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let partnerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let outsiderContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  const track = (page: Page, name: string) => {
    page.on("pageerror", (error) => consoleFailures.push(`${name}: pageerror ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") consoleFailures.push(`${name}: console ${message.text()}`);
    });
    return page;
  };
  const login = async (context: NonNullable<typeof leaderContext>, email: string) => {
    const page = track(await context.newPage(), email);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("密碼").fill(fixture.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    return page;
  };
  const noHorizontalOverflow = async (page: Page) => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  };
  const publishNextVersion = async (page: Page, templateId: string) => {
    await page.goto(`/team-templates/${templateId}/edit`);
    await expect(page.getByRole("heading", { name: new RegExp(`編輯 ${TEAM_FUNNEL_TEST_ONLY.templateName}`) })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "發布新版本" }).click();
    await expect(page.getByRole("status")).toContainText("已發布", { timeout: 30_000 });
  };
  const claim = async (page: Page, sharePath: string, mode: "快速套用" | "複製後編輯" | "空白頁綁定研討會", slug: string) => {
    await page.goto(sharePath);
    await expect(page.getByRole("heading", { name: "取得團隊模板" })).toBeVisible();
    await page.getByText(mode, { exact: true }).click();
    await page.getByLabel("你的公開網址（slug）").fill(slug);
    await page.getByRole("checkbox", { name: /我已確認建立自己的夥伴頁/ }).check();
    await page.getByRole("button", { name: "確認並建立夥伴頁" }).click();
    // 開發模式首次載入 Server Action 可能需要額外編譯時間。
    await expect(page).toHaveURL(/\/partner-pages\/[^/]+\/edit$/, { timeout: 30_000 });
  };

  try {
    leaderContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "X-Forwarded-For": uniqueLoginTestIp(testInfo.testId, testInfo.retry, 1) },
    });
    partnerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "X-Forwarded-For": uniqueLoginTestIp(testInfo.testId, testInfo.retry, 2) },
    });
    outsiderContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "X-Forwarded-For": uniqueLoginTestIp(testInfo.testId, testInfo.retry, 3) },
    });
    const leaderPage = await login(leaderContext, fixture.leader.email);
    const partnerPage = await login(partnerContext, fixture.partner.email);

    // A creates the original page through the actual browser form, then publishes v2.
    await leaderPage.goto("/team-templates/new");
    await expect(leaderPage.getByRole("heading", { name: "建立團隊原始頁" })).toBeVisible();
    await leaderPage.getByLabel("模板名稱").fill(fixture.scenario.templateName);
    await leaderPage.getByLabel("原始頁網址（slug）").fill(fixture.scenario.sourceSlug);
    await leaderPage.getByLabel("綁定 webinar").selectOption(fixture.seminar.id);
    await leaderPage.getByRole("textbox", { name: "主標題" }).fill("TEST ONLY A 模板主標題");
    await leaderPage.getByRole("textbox", { name: "副標題" }).fill("TEST ONLY 可由 B 編輯的副標題");
    await leaderPage.getByRole("textbox", { name: "內容說明" }).fill("TEST ONLY 鎖定的內容說明");
    await leaderPage.getByRole("textbox", { name: "CTA 按鈕文字" }).fill("TEST ONLY 立即參加");
    await leaderPage.locator('input[name="lockedFields"][value="BODY"]').check();
    await leaderPage.locator('select[name="product_main_product"]').selectOption(fixture.product.id);
    await leaderPage.getByRole("button", { name: "建立原始頁" }).click();
    await expect(leaderPage.getByRole("status")).toContainText("原始頁與第一個模板版本已建立");

    const template = await db.teamFunnelTemplate.findFirstOrThrow({
      where: { vendorId: fixture.leader.vendorId, name: fixture.scenario.templateName },
      include: { versions: { orderBy: { version: "asc" } } },
    });
    expect(template.versions).toHaveLength(1);
    await publishNextVersion(leaderPage, template.id);
    expect(await db.teamFunnelTemplateVersion.count({ where: { templateId: template.id } })).toBe(2);
    const sourcePage = await db.partnerFunnelPage.findFirstOrThrow({
      where: { teamId: fixture.team.id, promoterMembershipId: fixture.leader.membershipId, templateVersion: { templateId: template.id } },
    });
    expect(sourcePage.liveId).toBe(fixture.seminar.id);

    await leaderPage.goto("/team-templates");
    await leaderPage.getByRole("button", { name: "建立分享連結" }).click();
    const sharePath = await leaderPage.getByRole("status").locator("code").innerText();
    expect(sharePath).toMatch(/^\/team-template\?share=tf1\./);

    // B mode 1: quick apply, editable copy, product override, immutable locked body, and readable error state.
    const quickSlug = `${fixture.scenario.sourceSlug}-b-quick`;
    await claim(partnerPage, sharePath, "快速套用", quickSlug);
    await expect(partnerPage.getByText(`來源 A：${TEAM_FUNNEL_TEST_ONLY.leader.name}`)).toBeVisible();
    await expect(partnerPage.getByLabel("內容說明")).toBeDisabled();
    await expect(partnerPage.getByLabel("主標題")).toBeEnabled();
    await partnerPage.getByLabel("主標題").fill("TEST ONLY B 的公開主標題");
    await partnerPage.locator('input[name="url_main_product"]').fill(TEAM_FUNNEL_TEST_ONLY.partnerProductUrl);
    await partnerPage.getByRole("button", { name: "儲存可編輯內容" }).click();
    await expect(partnerPage.getByRole("status")).toContainText("夥伴頁已儲存");
    const quickPage = await db.partnerFunnelPage.findUniqueOrThrow({
      where: { slug: quickSlug },
      include: { productOverrides: true },
    });
    expect(quickPage.headline).toBe("TEST ONLY B 的公開主標題");
    expect(quickPage.liveId).toBe(fixture.seminar.id);
    expect(quickPage.contentOwnerMembershipId).toBe(fixture.leader.membershipId);
    expect(quickPage.promoterMembershipId).toBe(fixture.partner.membershipId);
    expect(quickPage.productOverrides.some((override) => override.overrideUrl === TEAM_FUNNEL_TEST_ONLY.partnerProductUrl)).toBe(true);

    await partnerPage.getByLabel("主標題").fill("");
    // Exercise the server-side readable error, which remains necessary even
    // though production browsers normally block this required field first.
    await partnerPage.locator('input[name="headline"]').evaluate((input) => input.removeAttribute("required"));
    await partnerPage.getByRole("button", { name: "儲存可編輯內容" }).click();
    await expect(partnerPage.getByRole("alert").filter({ hasText: "主標題與 CTA 按鈕文字不可留白" })).toBeVisible();
    await partnerPage.getByLabel("主標題").fill("TEST ONLY B 的公開主標題");
    await partnerPage.getByRole("button", { name: "儲存可編輯內容" }).click();
    await expect(partnerPage.getByRole("status")).toContainText("夥伴頁已儲存");
    await partnerPage.getByRole("button", { name: "發布公開頁" }).click();
    // Development mode may compile this Server Action on first use. Keep the
    // wait bounded while matching the other cold-action checks in this flow.
    await expect(partnerPage.getByRole("status").filter({ hasText: "夥伴頁已發布" })).toBeVisible({ timeout: 30_000 });

    const publicPage = track(await partnerContext.newPage(), "public-team-funnel");
    let formSubmissionReferer: string | undefined;
    publicPage.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/form-submissions") {
        formSubmissionReferer = request.headers().referer;
      }
    });
    await publicPage.goto(`/p/${quickSlug}`);
    await expect(publicPage.getByRole("heading", { name: "TEST ONLY B 的公開主標題" })).toBeVisible();
    await expect(publicPage.getByText(`由 ${TEAM_FUNNEL_TEST_ONLY.partner.name} 為您服務`)).toBeVisible();
    await expect(publicPage.getByRole("heading", { name: TEAM_FUNNEL_TEST_ONLY.seminarTitle })).toBeVisible();
    await expect(publicPage.getByRole("heading", { name: "立即報名" })).toBeVisible();
    await expect(publicPage.getByRole("link", { name: "TEST ONLY 立即參加" })).toHaveAttribute("href", "#registration-heading");
    await expect(publicPage.getByRole("link", { name: "推薦商品" })).toHaveAttribute("href", TEAM_FUNNEL_TEST_ONLY.partnerProductUrl);
    await noHorizontalOverflow(publicPage);
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: "TEST ONLY B 的公開主標題" })).toBeVisible();
    await expect(publicPage.getByRole("heading", { name: "立即報名" })).toBeVisible();
    await noHorizontalOverflow(publicPage);

    // Fill and submit the real public form. Its browser Referer is the B page,
    // so attribution is resolved from server-owned page data rather than input.
    const registrationEmail = `lead-${Date.now()}@team-funnel.test`;
    await publicPage.getByLabel("姓名").fill("TEST ONLY 報名訪客");
    await publicPage.getByLabel("Email").fill(registrationEmail);
    await publicPage.getByRole("button", { name: "TEST ONLY 送出報名" }).click();
    await expect(publicPage.getByText("TEST ONLY 已收到報名")).toBeVisible();
    expect(formSubmissionReferer).toMatch(new RegExp(`/p/${quickSlug}$`));
    const submission = await db.formSubmission.findFirstOrThrow({
      where: { formId: fixture.form.id, liveId: fixture.seminar.id, email: registrationEmail },
    });
    const attributedLead = await db.teamLeadAttribution.findFirstOrThrow({
      where: { formSubmissionId: submission.id, pageId: quickPage.id },
      orderBy: { attributedAt: "desc" },
    });
    expect(attributedLead).toMatchObject({
      promoterMembershipId: fixture.partner.membershipId,
      leaderMembershipId: fixture.leader.membershipId,
      contentOwnerMembershipId: fixture.leader.membershipId,
      seminarOwnerMembershipId: fixture.leader.membershipId,
    });

    // The same controlled share advances with A's immutable version; B claims the remaining two modes.
    await publishNextVersion(leaderPage, template.id);
    const copySlug = `${fixture.scenario.sourceSlug}-b-copy`;
    await claim(partnerPage, sharePath, "複製後編輯", copySlug);
    const copyPage = await db.partnerFunnelPage.findUniqueOrThrow({ where: { slug: copySlug } });
    expect(copyPage.liveId).toBe(fixture.seminar.id);
    expect(copyPage.templateVersionId).not.toBe(quickPage.templateVersionId);

    await publishNextVersion(leaderPage, template.id);
    const blankSlug = `${fixture.scenario.sourceSlug}-b-blank`;
    await claim(partnerPage, sharePath, "空白頁綁定研討會", blankSlug);
    const blankPage = await db.partnerFunnelPage.findUniqueOrThrow({ where: { slug: blankSlug } });
    expect(blankPage).toMatchObject({
      liveId: fixture.seminar.id,
      contentOwnerMembershipId: fixture.leader.membershipId,
      promoterMembershipId: fixture.partner.membershipId,
      headline: "",
      ctaLabel: "",
    });

    // A can see pages using A's template; B's report is constrained to B's own pages.
    await leaderPage.goto(`/team-performance?teamId=${fixture.team.id}`);
    await expect(leaderPage.getByRole("heading", { name: "展業成效" })).toBeVisible();
    await expect(leaderPage.getByText(`/${quickSlug}`)).toBeVisible();
    await partnerPage.goto(`/team-performance?teamId=${fixture.team.id}`);
    await expect(partnerPage.getByText(`/${quickSlug}`)).toBeVisible();
    await expect(partnerPage.getByText(`/${fixture.scenario.sourceSlug}`, { exact: true })).toHaveCount(0);
    await partnerPage.setViewportSize({ width: 390, height: 844 });
    await partnerPage.goto(`/partner-pages/${quickPage.id}/edit`);
    await expect(partnerPage.getByRole("heading", { name: "編輯夥伴頁" })).toBeVisible();
    await expect(partnerPage.getByLabel("主標題")).toBeVisible();
    await expect(partnerPage.getByRole("button", { name: "儲存可編輯內容" })).toBeVisible();
    await noHorizontalOverflow(partnerPage);

    // A tenant other than the source tenant is rejected before a claim can be made.
    const outsiderPage = await login(outsiderContext, fixture.outsider.email);
    await outsiderPage.goto(sharePath);
    await expect(outsiderPage.getByRole("status")).toContainText("此分享不屬於你的團隊");

    // The TEST ONLY fixture provides a separate already-expired sharing scenario.
    expect(fixture.expiredScenario.templateId).not.toBe(template.id);
    await partnerPage.goto(fixture.expiredSharePath);
    await expect(partnerPage.getByRole("status")).toContainText("此分享連結已過期");
  } finally {
    await leaderContext?.close();
    await partnerContext?.close();
    await outsiderContext?.close();
    await fixture.cleanup();
  }

  expect(consoleFailures, consoleFailures.join("\n")).toEqual([]);
});
