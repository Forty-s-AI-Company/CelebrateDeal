import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Accessibility123!";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const fixture = {
  vendorId: "",
  userId: "",
  adminUserId: "",
  adminSessionId: "",
  adminSessionToken: "",
  planId: "",
  email: `a11y-${suffix}@example.test`,
  courseSlug: `a11y-course-${suffix}`,
  liveSlug: `a11y-live-${suffix}`,
};

test.beforeAll(async () => {
  const plan = await db.billingPlan.create({ data: { name: "A11y Plan", code: `a11y-plan-${suffix}`, includedNotificationEmails: 20 } });
  const user = await db.user.create({ data: { email: fixture.email, name: "A11y Owner", passwordHash: hashPassword(password) } });
  const admin = await db.user.create({
    data: {
      email: `a11y-admin-${suffix}@example.test`,
      name: "A11y Platform Admin",
      passwordHash: hashPassword(password),
      platformRole: "platform_admin",
      mfaFactor: { create: { factorType: "totp", secretEncrypted: "a11y-fixture-only" } },
    },
  });
  fixture.adminSessionToken = randomBytes(32).toString("base64url");
  const adminSession = await db.userSession.create({
    data: {
      userId: admin.id,
      tokenHash: createHash("sha256").update(fixture.adminSessionToken).digest("hex"),
      mfaVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const vendor = await db.vendor.create({
    data: {
      name: "無障礙測試品牌",
      slug: `a11y-vendor-${suffix}`,
      email: `a11y-vendor-${suffix}@example.test`,
      passwordHash: "test",
      onboardingStatus: "completed",
      onboardingCompletedAt: new Date(),
      members: { create: { userId: user.id, role: "owner" } },
      subscriptions: { create: { planId: plan.id, status: "active" } },
      usageLimit: { create: { billingPlanId: plan.id, notificationEmailsLimit: 20, resetAt: new Date(Date.now() + 86_400_000) } },
    },
  });
  const [form, video] = await Promise.all([
    db.registrationForm.create({ data: { vendorId: vendor.id, name: "A11y form", slug: `a11y-form-${suffix}`, headline: "報名", fields: [] } }),
    db.video.create({ data: { vendorId: vendor.id, title: "A11y preview", videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", status: "ready" } }),
  ]);
  await db.course.create({
    data: {
      vendorId: vendor.id,
      registrationFormId: form.id,
      title: "無障礙直播成交課程",
      slug: fixture.courseSlug,
      description: "用於鍵盤、表單標籤與顏色對比檢查。",
      status: "published",
      publishedAt: new Date(),
      lessons: { create: { videoId: video.id, title: "公開預覽單元", sortOrder: 1, status: "published", isPreview: true } },
    },
  });
  await db.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      title: "無障礙直播測試",
      slug: fixture.liveSlug,
      scheduledAt: new Date(),
      status: "live",
      accentCopy: "測試直播",
    },
  });
  fixture.vendorId = vendor.id;
  fixture.userId = user.id;
  fixture.adminUserId = admin.id;
  fixture.adminSessionId = adminSession.id;
  fixture.planId = plan.id;
});

test.afterAll(async () => {
  if (fixture.vendorId) {
    await db.auditLog.deleteMany({ where: { vendorId: fixture.vendorId } });
    await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  }
  if (fixture.userId) await db.user.deleteMany({ where: { id: fixture.userId } });
  if (fixture.adminSessionId) await db.userSession.deleteMany({ where: { id: fixture.adminSessionId } });
  if (fixture.adminUserId) await db.user.deleteMany({ where: { id: fixture.adminUserId } });
  if (fixture.planId) await db.billingPlan.deleteMany({ where: { id: fixture.planId } });
  await db.$disconnect();
});

async function expectNoSeriousViolations(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical"), JSON.stringify(result.violations, null, 2)).toEqual([]);
}

async function loginOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("login page has no serious accessibility violations or console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登入直播商務後台" })).toBeVisible();

  await expectNoSeriousViolations(page);
  expect(consoleErrors).toEqual([]);
});

test("public course page has no serious accessibility violations", async ({ page }) => {
  await page.goto(`/course/${fixture.courseSlug}`);
  await expect(page.getByRole("heading", { name: "無障礙直播成交課程" })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("authenticated dashboard has no serious accessibility violations", async ({ page }) => {
  await loginOwner(page);
  await expectNoSeriousViolations(page);
});

test("public live playback has no serious accessibility violations", async ({ page }) => {
  await page.goto(`/live/${fixture.liveSlug}`);
  await expect(page.getByText("無障礙直播測試")).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("Cloudflare direct upload and external fallback form have no serious accessibility violations", async ({ page }) => {
  await loginOwner(page);
  await page.goto("/videos/new");
  await expect(page.getByRole("heading", { name: "新增影片" })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("notification delivery operations have no serious accessibility violations", async ({ page }) => {
  await loginOwner(page);
  await page.goto("/messages/deliveries");
  await expect(page.getByRole("heading", { name: "通知投遞紀錄" })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("admin affiliate payout operations have no serious accessibility violations", async ({ context, page, baseURL }) => {
  await context.addCookies([{
    name: "celebrate_session",
    value: fixture.adminSessionToken,
    url: baseURL ?? "http://127.0.0.1:31023",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/admin/billing/affiliate-payouts");
  await expect(page.getByRole("heading", { name: "聯盟佣金與出款" })).toBeVisible();
  await expectNoSeriousViolations(page);
});
