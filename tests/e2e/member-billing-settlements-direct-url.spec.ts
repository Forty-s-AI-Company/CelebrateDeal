import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatCurrency, formatDateTime } from "../../src/lib/format";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp81SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);

test("active member is denied billing settlements before tenant query or MFA", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp81-${suffix}`;
  const resetAt = new Date("2099-01-01T00:00:00.000Z");

  const vendor = await db.vendor.create({
    data: {
      name: `WP81 Vendor ${suffix}`,
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
      name: "WP81 Active Member",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: { vendorId: vendor.id, role: "member", status: "active" },
      },
    },
  });
  const plan = await db.billingPlan.create({
    data: {
      name: `WP81 Lawful Plan ${suffix}`,
      code: `WP81-PLAN-${suffix}`.toUpperCase(),
      monthlyPriceCents: 321_987,
      includedStreamMinutes: 54_321,
      includedStorageMinutes: 43_210,
      includedCredits: 9_931,
      includedEvents: 83,
      includedAffiliates: 74,
      isActive: true,
    },
  });
  const usageLimit = await db.vendorUsageLimit.create({
    data: {
      vendorId: vendor.id,
      billingPlanId: plan.id,
      streamMinutesLimit: 54_321,
      storageMinutesLimit: 43_210,
      creditsLimit: 9_931,
      streamMinutesUsed: 12_345,
      storageMinutesUsed: 21_234,
      creditsUsed: 1_287,
      resetAt,
    },
  });
  const payoutBatch = await db.payoutBatch.create({
    data: {
      batchNumber: `WP81-PAYOUT-BATCH-${suffix}`.toUpperCase(),
      batchDate: new Date("2099-02-15T06:07:08.000Z"),
      totalAmountCents: 876_543,
      totalCount: 1,
      status: `wp81-batch-reviewing-${suffix}`,
    },
  });
  const settlements = await Promise.all([
    db.settlement.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2098-11",
        monthlyFeeCents: 112_233,
        overflowFeeCents: 22_344,
        paymentServiceFeeCents: 3_455,
        transactionServiceFeeCents: 4_566,
        affiliateManagementFeeCents: 5_677,
        paymentGatewayFeeCents: 6_788,
        grossRevenueCents: 789_012,
        payoutableAmountCents: 745_678,
        adjustmentAmountCents: -12_345,
        adjustmentReason: `wp81-draft-reason-${suffix}`,
        finalPayoutAmountCents: 733_333,
        status: `wp81-draft-${suffix}`,
        createdAt: new Date("2098-12-01T01:02:03.000Z"),
      },
    }),
    db.settlement.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2098-12",
        monthlyFeeCents: 223_344,
        overflowFeeCents: 33_455,
        paymentServiceFeeCents: 4_566,
        transactionServiceFeeCents: 5_677,
        affiliateManagementFeeCents: 6_788,
        paymentGatewayFeeCents: 7_899,
        grossRevenueCents: 890_123,
        payoutableAmountCents: 834_567,
        adjustmentAmountCents: 23_456,
        adjustmentReason: `wp81-paid-reason-${suffix}`,
        finalPayoutAmountCents: 858_023,
        status: `wp81-paid-${suffix}`,
        lockedAt: new Date("2099-01-08T02:03:04.000Z"),
        lockedBy: `wp81-locker-${suffix}`,
        paidAt: new Date("2099-01-11T05:06:07.000Z"),
        reviewedBy: `wp81-reviewer-${suffix}`,
        payoutBatchId: payoutBatch.id,
        payoutDate: new Date("2099-02-20T07:08:09.000Z"),
        batchNumber: `WP81-SETTLEMENT-BATCH-${suffix}`.toUpperCase(),
        createdAt: new Date("2099-01-01T02:03:04.000Z"),
      },
    }),
  ]);
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

    const settlementIds = settlements.map((settlement) => settlement.id);
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
          expiresAt: true,
          revokedAt: true,
          mfaVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      plan: await db.billingPlan.findUniqueOrThrow({
        where: { id: plan.id },
      }),
      planCount: await db.billingPlan.count({ where: { id: plan.id } }),
      activePlanComposite: await db.billingPlan.count({
        where: { id: plan.id, code: plan.code, isActive: true },
      }),
      planUsageRelations: await db.billingPlan.findMany({
        where: { id: plan.id },
        select: {
          id: true,
          usageLimits: {
            where: { id: usageLimit.id },
            select: { id: true, vendorId: true, billingPlanId: true },
          },
        },
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
      settlements: await db.settlement.findMany({
        where: { id: { in: settlementIds } },
        orderBy: { id: "asc" },
      }),
      settlementCount: await db.settlement.count({ where: { id: { in: settlementIds } } }),
      settlementVendorCount: await db.settlement.count({
        where: { vendorId: vendor.id },
      }),
      settlementMonthCounts: await Promise.all(
        settlements.map((settlement) =>
          db.settlement.count({
            where: {
              vendorId: vendor.id,
              monthKey: settlement.monthKey,
            },
          }),
        ),
      ),
      settlementStatusCounts: await Promise.all(
        settlements.map((settlement) =>
          db.settlement.count({
            where: {
              vendorId: vendor.id,
              status: settlement.status,
            },
          }),
        ),
      ),
      linkedSettlementCount: await db.settlement.count({
        where: {
          id: settlements[1].id,
          vendorId: vendor.id,
          payoutBatchId: payoutBatch.id,
        },
      }),
      unlinkedSettlementCount: await db.settlement.count({
        where: {
          id: settlements[0].id,
          vendorId: vendor.id,
          payoutBatchId: null,
        },
      }),
      settlementCompositeCounts: await Promise.all(
        settlements.map((settlement) =>
          db.settlement.count({
            where: {
              id: settlement.id,
              vendorId: vendor.id,
              monthKey: settlement.monthKey,
              status: settlement.status,
              payoutBatchId: settlement.payoutBatchId,
            },
          }),
        ),
      ),
      settlementRelations: await db.settlement.findMany({
        where: { id: { in: settlementIds } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true, payoutBatchId: true },
      }),
      payoutBatch: await db.payoutBatch.findUniqueOrThrow({
        where: { id: payoutBatch.id },
      }),
      payoutBatchCount: await db.payoutBatch.count({ where: { id: payoutBatch.id } }),
      payoutBatchStatusCount: await db.payoutBatch.count({
        where: { id: payoutBatch.id, status: payoutBatch.status },
      }),
      payoutBatchComposite: await db.payoutBatch.count({
        where: {
          id: payoutBatch.id,
          batchNumber: payoutBatch.batchNumber,
          status: payoutBatch.status,
          totalAmountCents: payoutBatch.totalAmountCents,
          totalCount: payoutBatch.totalCount,
        },
      }),
      payoutBatchRelations: await db.payoutBatch.findMany({
        where: { id: payoutBatch.id },
        select: {
          id: true,
          settlements: {
            where: { id: { in: settlementIds } },
            orderBy: { id: "asc" },
            select: { id: true, vendorId: true, payoutBatchId: true },
          },
        },
      }),
    });
    const before = await snapshot();
    const lawfulUsagePercent = Math.round(
      (usageLimit.creditsUsed / usageLimit.creditsLimit) * 100,
    );
    const lawfulRemainingCredits =
      usageLimit.creditsLimit - usageLimit.creditsUsed;

    const settlementCanaries = settlements.flatMap((settlement) => [
      settlement.id,
      settlement.monthKey,
      settlement.status,
      settlement.batchNumber,
      settlement.adjustmentReason,
      settlement.lockedBy,
      settlement.reviewedBy,
      formatCurrency(settlement.monthlyFeeCents),
      formatCurrency(settlement.overflowFeeCents),
      formatCurrency(settlement.paymentServiceFeeCents),
      formatCurrency(settlement.transactionServiceFeeCents),
      formatCurrency(settlement.affiliateManagementFeeCents),
      formatCurrency(settlement.paymentGatewayFeeCents),
      formatCurrency(settlement.grossRevenueCents),
      formatCurrency(settlement.payoutableAmountCents),
      formatCurrency(settlement.adjustmentAmountCents),
      formatCurrency(settlement.finalPayoutAmountCents),
      formatDateTime(settlement.createdAt),
      settlement.lockedAt ? formatDateTime(settlement.lockedAt) : "",
      settlement.paidAt ? formatDateTime(settlement.paidAt) : "",
      settlement.payoutDate ? formatDateTime(settlement.payoutDate) : "",
    ]);
    const payoutBatchCanaries = [
      payoutBatch.id,
      payoutBatch.batchNumber,
      payoutBatch.status,
      formatCurrency(payoutBatch.totalAmountCents),
      formatDateTime(payoutBatch.batchDate),
    ];
    const disclosureCanaries = [
      ...settlementCanaries,
      ...payoutBatchCanaries,
    ].filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0 && value !== "$0",
    );

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    const targetGets: string[] = [];
    const targetNonGets: string[] = [];
    const otherSettlementOrPayout: string[] = [];
    const settlementsPath = "/billing/settlements";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
        external.push(request.url());
      }
      if (url.hostname.endsWith(".invalid")) invalid.push(request.url());
      if (url.pathname === settlementsPath) {
        if (request.method() === "GET") targetGets.push(url.pathname);
        else targetNonGets.push(`${request.method()} ${url.pathname}`);
      } else if (
        url.pathname.startsWith("/billing/settlements") ||
        url.pathname.startsWith("/billing/payouts") ||
        url.pathname.startsWith("/admin/billing")
      ) {
        otherSettlementOrPayout.push(url.pathname);
      }
    });
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path: settlementsPath,
      protectedPayloadCanaries: disclosureCanaries,
      documentCanaries: disclosureCanaries,
      transport: {
        kind: "streaming-redirect",
        status: 200,
        redirectMarker: "NEXT_REDIRECT",
        redirectTargetMarker: "/dashboard?error=insufficient_role",
      },
      finalUrl: "/dashboard?error=insufficient_role",
      finalStatus: 200,
      forbiddenPayload: [
        ".invalid",
        'title="月結"',
        "平台金流與自帶金流共用同一套結算報表",
        "本期成交額",
        "平台費用",
        "金流手續費",
        "預計撥款",
        "實際撥款金額",
        "月費",
        "超額用量",
        "交易服務費",
        "聯盟管理費",
        "調整金額",
        "已鎖單",
        "已連結出款批次",
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
      page.getByRole("heading", { name: "月結", exact: true }),
    ).toHaveCount(0);
    for (const deniedText of [
      "平台金流與自帶金流共用同一套結算報表，平台交易費、金流手續費與應撥款金額分開追溯。",
      "本期成交額",
      "平台費用",
      "金流手續費",
      "預計撥款",
      "實際撥款金額",
      "月費",
      "超額用量",
      "交易服務費",
      "聯盟管理費",
      "調整金額",
      "已鎖單",
    ]) {
      await expect(page.getByText(deniedText, { exact: true })).toHaveCount(0);
    }
    for (const canary of disclosureCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    expect(targetGets).toEqual([settlementsPath]);
    expect(targetNonGets).toEqual([]);
    expect(otherSettlementOrPayout).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.userSession.deleteMany({
      where: { userId: user.id, vendorId: vendor.id },
    });
    await db.settlement.deleteMany({
      where: {
        id: { in: settlements.map((settlement) => settlement.id) },
        vendorId: vendor.id,
      },
    });
    await db.payoutBatch.deleteMany({ where: { id: payoutBatch.id } });
    await db.vendorUsageLimit.deleteMany({ where: { vendorId: vendor.id } });
    await db.billingPlan.deleteMany({ where: { id: plan.id } });
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
