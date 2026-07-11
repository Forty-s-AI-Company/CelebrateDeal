import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Password12345!";
const UI_ACTION_TIMEOUT = 30_000;
const stamp = Date.now();
const seed = {
  email: `e2e-${stamp}@celebratedeal.local`,
  accountantEmail: `e2e-accountant-${stamp}@celebratedeal.local`,
  platformAdminEmail: `e2e-platform-${stamp}@celebratedeal.local`,
  vendorSlug: `e2e-vendor-${stamp}`,
  productSlug: `e2e-product-${stamp}`,
  formSlug: `e2e-form-${stamp}`,
  liveSlug: `e2e-live-${stamp}`,
  courseSlug: `e2e-course-${stamp}`,
  vendorId: "",
  userId: "",
  accountantUserId: "",
  platformAdminUserId: "",
  productId: "",
  externalProductId: "",
  formId: "",
  liveId: "",
  courseId: "",
  planId: "",
};

const browserEvidence = new WeakMap<Page, { consoleErrors: string[]; failedRequests: string[] }>();

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`));
  browserEvidence.set(page, { consoleErrors, failedRequests });
});

test.afterEach(async ({ page }, testInfo) => {
  const evidence = browserEvidence.get(page) ?? { consoleErrors: [], failedRequests: [] };
  await testInfo.attach("console-evidence", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence.consoleErrors, null, 2)) });
  await testInfo.attach("network-failures", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence.failedRequests, null, 2)) });
});

test.beforeAll(async () => {
  const plan = await db.billingPlan.create({
    data: {
      name: "E2E Plan",
      code: `e2e-plan-${stamp}`,
      includedEvents: 20,
      includedAffiliates: 20,
      includedStorageMinutes: 1000,
      includedCredits: 1000,
      includedNotificationEmails: 100,
    },
  });
  const vendor = await db.vendor.create({
    data: {
      name: "E2E 測試品牌",
      slug: seed.vendorSlug,
      email: seed.email,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      onboardingStatus: "completed",
      onboardingCompletedAt: new Date(),
      tracking: { create: {} },
      subscriptions: { create: { planId: plan.id, status: "active" } },
      usageLimit: {
        create: {
          billingPlanId: plan.id,
          streamMinutesLimit: 1000,
          storageMinutesLimit: 1000,
          creditsLimit: 1000,
          notificationEmailsLimit: 100,
          resetAt: new Date(Date.now() + 86_400_000),
        },
      },
    },
  });
  seed.vendorId = vendor.id;
  seed.planId = plan.id;
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
  const platformAdmin = await db.user.create({
    data: {
      email: seed.platformAdminEmail,
      name: "E2E Platform Admin",
      passwordHash: hashPassword(password),
      platformRole: "platform_admin",
      status: "active",
    },
  });
  const accountant = await db.user.create({
    data: {
      email: seed.accountantEmail,
      name: "E2E Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
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
  const externalProduct = await db.product.create({
    data: {
      vendorId: vendor.id,
      name: "E2E 外部商城商品",
      slug: `e2e-external-product-${stamp}`,
      description: "External checkout must not create a platform payment.",
      priceCents: 54321,
      currency: "TWD",
      checkoutMode: "external",
      checkoutUrl: `https://shop.example.test/products/e2e-${stamp}`,
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
  const video = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "E2E 課程預覽",
      videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      thumbnailUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1200&auto=format&fit=crop",
      status: "ready",
      cloudflareReadyToStream: true,
    },
  });
  await db.live.update({ where: { id: live.id }, data: { videoId: video.id } });
  const course = await db.course.create({
    data: {
      vendorId: vendor.id,
      registrationFormId: form.id,
      defaultProductId: externalProduct.id,
      title: "E2E 成交課程",
      slug: seed.courseSlug,
      description: "公開課程與報名 smoke test。",
      status: "published",
      publishedAt: new Date(),
      lessons: {
        create: {
          videoId: video.id,
          title: "第一單元",
          sortOrder: 1,
          status: "published",
          isPreview: true,
        },
      },
    },
  });

  seed.userId = user.id;
  seed.accountantUserId = accountant.id;
  seed.platformAdminUserId = platformAdmin.id;
  seed.productId = product.id;
  seed.externalProductId = externalProduct.id;
  seed.formId = form.id;
  seed.liveId = live.id;
  seed.courseId = course.id;
});

test.afterAll(async () => {
  if (seed.vendorId) {
    await db.vendor.deleteMany({ where: { id: seed.vendorId } });
  }
  if (seed.userId || seed.accountantUserId || seed.platformAdminUserId) {
    await db.user.deleteMany({ where: { id: { in: [seed.userId, seed.accountantUserId, seed.platformAdminUserId].filter(Boolean) } } });
  }
  if (seed.planId) await db.billingPlan.deleteMany({ where: { id: seed.planId } });
  await db.$disconnect();
});

test("login page renders and accepts seeded owner", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登入直播商務後台" })).toBeVisible();
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: UI_ACTION_TIMEOUT });
});

test("protected vendor and admin pages redirect unauthenticated users", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/admin/billing/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("vendor owner cannot enter the platform admin area", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: UI_ACTION_TIMEOUT });

  await page.goto("/admin/billing/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("platform admin must set up MFA before entering admin routes", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.platformAdminEmail);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup/, { timeout: UI_ACTION_TIMEOUT });
  await expect(page.getByRole("heading", { name: "設定管理員 MFA" })).toBeVisible();
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
  await expect(page.getByText("E2E 已收到資料")).toBeVisible({ timeout: UI_ACTION_TIMEOUT });
});

test("public course page creates a free enrollment without fabricating payment", async ({ page }) => {
  const email = `course-lead-${stamp}@example.com`;
  const transactionCountBefore = await db.paymentTransaction.count({ where: { vendorId: seed.vendorId } });
  await page.goto(`/course/${seed.courseSlug}`);
  await expect(page.getByRole("heading", { name: "E2E 成交課程" })).toBeVisible();
  await expect(page.getByText("第一單元")).toBeVisible();
  await page.getByLabel("姓名").fill("課程學員");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "送出報名" }).click();
  await expect(page.getByText("E2E 已收到資料")).toBeVisible({ timeout: UI_ACTION_TIMEOUT });

  await expect.poll(() => db.enrollment.count({ where: { courseId: seed.courseId, email } })).toBe(1);
  await expect.poll(() => db.paymentTransaction.count({ where: { vendorId: seed.vendorId } })).toBe(transactionCountBefore);
});

test("course enrollment rejects an unknown course and coalesces duplicate submissions", async ({ page, request }) => {
  const email = `duplicate-course-lead-${stamp}@example.com`;
  const enrollmentCountBefore = await db.enrollment.count({ where: { vendorId: seed.vendorId } });
  const invalid = await request.post("/api/course-enrollments", {
    headers: { "X-CelebrateDeal-Client": "web" },
    data: { courseId: "missing-course", name: "Unknown", email: `unknown-${stamp}@example.com` },
  });
  expect(invalid.status()).toBe(404);

  await page.goto(`/course/${seed.courseSlug}`);
  await page.getByLabel("姓名").fill("重複報名學員");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "送出報名" }).click();
  await expect(page.getByText("E2E 已收到資料")).toBeVisible({ timeout: UI_ACTION_TIMEOUT });

  await page.reload();
  await page.getByLabel("姓名").fill("重複報名學員");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "送出報名" }).click();
  await expect(page.getByText("E2E 已收到資料")).toBeVisible({ timeout: UI_ACTION_TIMEOUT });
  await expect.poll(() => db.enrollment.count({ where: { courseId: seed.courseId, email } })).toBe(1);
  await expect.poll(() => db.analyticsEvent.count({ where: { vendorId: seed.vendorId, visitorId: email, eventType: "course_enrollment" } })).toBe(1);
  await expect.poll(() => db.enrollment.count({ where: { vendorId: seed.vendorId } })).toBe(enrollmentCountBefore + 1);
});

test("accountant cannot view notification recipient PII", async ({ page }) => {
  const recipient = `private-recipient-${stamp}@example.com`;
  await db.notificationOutbox.create({
    data: {
      vendorId: seed.vendorId,
      recipient,
      subject: "E2E private notification",
      body: "PII must not be exposed to accountant roles.",
      sourceType: "e2e",
      sourceId: seed.courseId,
      idempotencyKey: `e2e-notification-${stamp}`,
    },
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.accountantEmail);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: UI_ACTION_TIMEOUT });

  await page.goto("/messages/deliveries");
  await expect(page).toHaveURL(/\/dashboard\?error=notification_access_denied/);
  await expect(page.getByText(recipient)).toHaveCount(0);
});

test("external checkout click is tracked without fabricating a payment", async ({ page }) => {
  const paymentCountBefore = await db.paymentTransaction.count({ where: { vendorId: seed.vendorId } });
  await page.route("https://shop.example.test/**", (route) => route.fulfill({ status: 204, body: "" }));
  await page.goto(`/course/${seed.courseSlug}`);
  const checkoutResponse = page.waitForResponse((response) => response.url().includes("/api/payments/checkout") && response.request().method() === "POST");
  const externalNavigation = page.waitForRequest("https://shop.example.test/**");
  await page.getByRole("button", { name: "前往購買" }).click();
  const response = await checkoutResponse;
  expect(await response.json()).toMatchObject({ checkoutMode: "external", redirectUrl: `https://shop.example.test/products/e2e-${stamp}` });
  await externalNavigation;
  await expect.poll(() => db.paymentTransaction.count({ where: { vendorId: seed.vendorId } })).toBe(paymentCountBefore);
  await expect.poll(() => db.analyticsEvent.count({ where: { vendorId: seed.vendorId, eventType: "course_product_click" } })).toBeGreaterThan(0);
});

test("owner can open the course operations page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: UI_ACTION_TIMEOUT });
  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: "課程與銷講" })).toBeVisible();
  await expect(page.getByText("E2E 成交課程")).toBeVisible();
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

test("protected API rejects wrong bearer token", async ({ request }) => {
  const response = await request.post("/api/cloudflare/direct-upload", {
    headers: { Authorization: "Bearer wrong-token" },
    data: {
      vendorId: seed.vendorId,
      title: "Should not be created",
      maxDurationSeconds: 60,
    },
  });
  expect(response.status()).toBe(401);
});
