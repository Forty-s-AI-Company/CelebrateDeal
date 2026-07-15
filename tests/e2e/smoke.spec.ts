import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { totpCodeForTimestamp, verifyRecoveryCode, verifyTotpCode } from "../../src/lib/mfa";

const db = new PrismaClient();
const password = "Password12345!";
const stamp = Date.now();
const rateLimitRunId = stamp.toString(16).slice(-12).padStart(12, "0");
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

async function loginMfaAdmin(page: Page, user: MfaTestUser, expectedUrl: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(expectedUrl);
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
      priceCents: 12345,
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

test("CSP reports are accepted by the report-only endpoint", async ({ request }) => {
  const response = await request.post("/api/security/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: {
      "csp-report": {
        "blocked-uri": "https://example.test/script.js",
        "violated-directive": "script-src",
      },
    },
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
});

test("protected vendor and admin pages redirect unauthenticated users", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/admin/billing/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("admin area requires MFA for signed-in finance roles", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/admin/billing/dashboard");
  await expect(page).toHaveURL(/\/mfa\/setup/);
  await expect(page.getByRole("heading", { name: "設定管理員 MFA" })).toBeVisible();
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
  await enrollMfa(page, mfaUser);
  const oldRecoveryCode = await displayedRecoveryCode(page);
  await page.getByRole("button", { name: "我已保存 recovery codes" }).click();
  await expect(page).toHaveURL(/\/mfa\/verify/);

  await page.goto("/mfa/setup");
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
  expect(body.amountCents).toBe(12345);

  const transaction = await db.paymentTransaction.findUniqueOrThrow({ where: { id: body.transactionId } });
  expect(transaction.grossAmountCents).toBe(12345);
});

test("JOB_SECRET protected APIs reject missing and invalid authorization", async ({ request }) => {
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
