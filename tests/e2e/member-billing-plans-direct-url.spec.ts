import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatCurrency } from "../../src/lib/format";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp78SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);

test("active member is denied billing plans before finance queries or MFA", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp78-${suffix}`;
  const resetAt = new Date(Date.now() + 31 * 86_400_000);

  const vendor = await db.vendor.create({
    data: {
      name: `WP78 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: `member-${tag}@celebratedeal.test`,
      name: "WP78 Active Member",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: { vendorId: vendor.id, role: "member", status: "active" },
      },
    },
  });
  const plan = await db.billingPlan.create({
    data: {
      name: `WP78 Lawful Plan ${suffix}`,
      code: `WP78-PLAN-${suffix}`.toUpperCase(),
      monthlyPriceCents: 543_210,
      includedStreamMinutes: 98_760,
      includedStorageMinutes: 87_652,
      includedCredits: 9_877,
      includedEvents: 7_643,
      includedAffiliates: 6_532,
      overageCreditCostCents: 4_321,
      overflowWatchHourPriceCents: 3_210,
      overflowEventUnitPriceCents: 2_109,
      overflowAffiliateUnitPriceCents: 1_098,
      overflowStorageMinutePriceCents: 987,
      paymentServiceFeeCents: 876,
      transactionFeeRateBps: 765,
      affiliateManagementFeeCents: 654,
      description: `wp78-plan-description-${suffix}`,
      isActive: true,
    },
  });
  const subscription = await db.vendorSubscription.create({
    data: {
      vendorId: vendor.id,
      planId: plan.id,
      paymentMode: `wp78-payment-mode-${suffix}`,
      status: "active",
      customFeeRateBps: 4_321,
      billingCycleDay: 17,
    },
  });
  const usageLimit = await db.vendorUsageLimit.create({
    data: {
      vendorId: vendor.id,
      billingPlanId: plan.id,
      streamMinutesLimit: 98_761,
      storageMinutesLimit: 87_653,
      creditsLimit: 9_877,
      streamMinutesUsed: 12_345,
      storageMinutesUsed: 23_456,
      creditsUsed: 1_234,
      resetAt,
    },
  });
  const membership = await db.vendorMember.findUniqueOrThrow({
    where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
  });
  const tracking = await db.trackingSetting.findUniqueOrThrow({
    where: { vendorId: vendor.id },
  });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const snapshot = async () => ({
      vendor: await db.vendor.findUniqueOrThrow({
        where: { id: vendor.id },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          logoUrl: true,
          primaryColor: true,
          ctaColor: true,
          timezone: true,
          supportEmail: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      vendorCount: await db.vendor.count({ where: { id: vendor.id } }),
      tracking: await db.trackingSetting.findUniqueOrThrow({
        where: { id: tracking.id },
      }),
      trackingCount: await db.trackingSetting.count({ where: { id: tracking.id } }),
      trackingVendorCount: await db.trackingSetting.count({
        where: { vendorId: vendor.id },
      }),
      trackingRelations: await db.trackingSetting.findMany({
        where: { id: tracking.id },
        select: { id: true, vendorId: true },
      }),
      user: await db.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          name: true,
          platformRole: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      userCount: await db.user.count({ where: { id: user.id } }),
      membership: await db.vendorMember.findUniqueOrThrow({
        where: { id: membership.id },
      }),
      membershipCount: await db.vendorMember.count({ where: { id: membership.id } }),
      membershipVendorCount: await db.vendorMember.count({
        where: { vendorId: vendor.id },
      }),
      membershipUserCount: await db.vendorMember.count({
        where: { userId: user.id },
      }),
      activeMemberComposite: await db.vendorMember.count({
        where: {
          id: membership.id,
          vendorId: vendor.id,
          userId: user.id,
          role: "member",
          status: "active",
        },
      }),
      membershipRelations: await db.vendorMember.findMany({
        where: { id: membership.id },
        select: { id: true, vendorId: true, userId: true },
      }),
      sessionCount: await db.userSession.count({
        where: { userId: user.id, vendorId: vendor.id },
      }),
      sessionRelations: await db.userSession.findMany({
        where: { userId: user.id, vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          userId: true,
          vendorId: true,
          mfaVerifiedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      plan: await db.billingPlan.findUniqueOrThrow({
        where: { id: plan.id },
      }),
      planCount: await db.billingPlan.count({ where: { id: plan.id } }),
      activePlanCount: await db.billingPlan.count({
        where: { id: plan.id, isActive: true },
      }),
      planCodeComposite: await db.billingPlan.count({
        where: { id: plan.id, code: plan.code, isActive: true },
      }),
      planRelations: await db.billingPlan.findMany({
        where: { id: plan.id },
        select: {
          id: true,
          subscriptions: {
            where: { id: subscription.id },
            select: { id: true, vendorId: true, planId: true },
          },
          usageLimits: {
            where: { id: usageLimit.id },
            select: { id: true, vendorId: true, billingPlanId: true },
          },
        },
      }),
      subscription: await db.vendorSubscription.findUniqueOrThrow({
        where: { id: subscription.id },
      }),
      subscriptionCount: await db.vendorSubscription.count({ where: { id: subscription.id } }),
      subscriptionVendorCount: await db.vendorSubscription.count({
        where: { vendorId: vendor.id },
      }),
      subscriptionPlanCount: await db.vendorSubscription.count({
        where: { id: subscription.id, planId: plan.id },
      }),
      activeSubscriptionComposite: await db.vendorSubscription.count({
        where: {
          id: subscription.id,
          vendorId: vendor.id,
          planId: plan.id,
          status: "active",
        },
      }),
      subscriptionRelations: await db.vendorSubscription.findMany({
        where: { id: subscription.id },
        select: { id: true, vendorId: true, planId: true },
      }),
      usageLimit: await db.vendorUsageLimit.findUniqueOrThrow({
        where: { id: usageLimit.id },
      }),
      usageLimitCount: await db.vendorUsageLimit.count({ where: { id: usageLimit.id } }),
      usageLimitVendorCount: await db.vendorUsageLimit.count({
        where: { vendorId: vendor.id },
      }),
      usageLimitPlanCount: await db.vendorUsageLimit.count({
        where: { billingPlanId: plan.id },
      }),
      usageLimitComposite: await db.vendorUsageLimit.count({
        where: {
          id: usageLimit.id,
          vendorId: vendor.id,
          billingPlanId: plan.id,
        },
      }),
      usageLimitRelations: await db.vendorUsageLimit.findMany({
        where: { id: usageLimit.id },
        select: { id: true, vendorId: true, billingPlanId: true },
      }),
    });
    const before = await snapshot();
    const lawfulUsagePercent = Math.round(
      (usageLimit.creditsUsed / usageLimit.creditsLimit) * 100,
    );
    const lawfulRemainingCredits =
      usageLimit.creditsLimit - usageLimit.creditsUsed;

    const planPriceAndQuotaCanaries = [
      formatCurrency(plan.monthlyPriceCents),
      `${Math.round(plan.includedStreamMinutes / 60).toLocaleString()} 小時 / 月`,
      `${plan.includedEvents.toLocaleString()} 場 / 月`,
      `${plan.includedAffiliates.toLocaleString()} 人`,
      `${plan.includedStorageMinutes.toLocaleString()} 分鐘`,
      formatCurrency(plan.paymentServiceFeeCents),
      `${plan.transactionFeeRateBps / 100}%`,
      `播放每 100 小時 ${formatCurrency(plan.overflowWatchHourPriceCents)}`,
      `活動每 10 場 ${formatCurrency(plan.overflowEventUnitPriceCents)}`,
      `推廣者每 10 人 ${formatCurrency(plan.overflowAffiliateUnitPriceCents)}`,
    ];
    const rawSensitiveCanaries = [
      plan.id,
      plan.name,
      plan.code,
      plan.description ?? "",
      subscription.id,
      subscription.paymentMode,
      String(subscription.customFeeRateBps),
      usageLimit.id,
      String(usageLimit.streamMinutesLimit),
      String(usageLimit.storageMinutesLimit),
      String(usageLimit.streamMinutesUsed),
      String(usageLimit.storageMinutesUsed),
      ...planPriceAndQuotaCanaries,
    ].filter((value): value is string => value.length > 0 && value !== "$0");
    const deniedDashboardCanaries = rawSensitiveCanaries.filter(
      (value) => value !== plan.name,
    );

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    const plansPath = "/billing/plans";
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
      path: plansPath,
      protectedPayloadCanaries: rawSensitiveCanaries,
      documentCanaries: deniedDashboardCanaries,
      transport: {
        kind: "streaming-redirect",
        status: 200,
        redirectMarker: "NEXT_REDIRECT",
        redirectTargetMarker: "/dashboard?error=insufficient_role",
      },
      finalUrl: /\/dashboard\?error=insufficient_role$/,
      finalStatus: 200,
      forbiddenPayload: [
        ".invalid",
        'title="方案"',
        "混合式計費：平台月費",
        "僅限商店擁有者異動",
        "變更方案",
        "選擇方案",
        'name="planId"',
      ],
    });

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    const usageSummaryHeading = page.getByRole("heading", {
      name: "用量 / 配額",
      exact: true,
    });
    await expect(usageSummaryHeading).toBeVisible();
    const usageSummary = usageSummaryHeading.locator("..");
    await expect(
      usageSummary.getByText(plan.name, { exact: true }),
    ).toBeVisible();
    await expect(
      usageSummary.getByText(`${lawfulUsagePercent}%`, { exact: true }),
    ).toBeVisible();
    await expect(
      usageSummary.getByText(
        `剩餘 ${lawfulRemainingCredits.toLocaleString()} 點`,
        { exact: true },
      ),
    ).toBeVisible();

    for (const financePath of [
      "/billing/usage",
      "/billing/plans",
      "/billing/invoices",
      "/billing/settlements",
      "/billing/payouts",
      "/affiliates/commissions",
    ]) {
      await expect(page.locator(`a[href="${financePath}"]`)).toHaveCount(0);
    }
    await expect(
      page.getByRole("heading", { name: "方案", exact: true }),
    ).toHaveCount(0);
    for (const deniedText of [
      "混合式計費：平台月費、超額用量、金流服務費、交易服務費與聯盟結算管理費分開計算。",
      "方案採月底月結後付，不會在此頁直接發動 PayUni 或建立商品交易。",
      "僅限商店擁有者異動",
      "變更方案",
      "選擇方案",
    ]) {
      await expect(page.getByText(deniedText, { exact: true })).toHaveCount(0);
    }
    await expect(
      page.locator('form:has([name="planId"]):has([name="_csrf"])'),
    ).toHaveCount(0);
    await expect(page.locator('[name="planId"]')).toHaveCount(0);
    for (const canary of deniedDashboardCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendorUsageLimit.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendorSubscription.deleteMany({ where: { vendorId: vendor.id } });
    await db.billingPlan.deleteMany({ where: { id: plan.id } });
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
