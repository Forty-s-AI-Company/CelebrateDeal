import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { monthRange } from "../../src/lib/billing";
import { formatCurrency } from "../../src/lib/format";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp77SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);

test("active member is denied billing usage before finance queries or MFA", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp77-${suffix}`;
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const { start, end } = monthRange(monthKey);
  const previousMonthDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 15));
  const previousMonthKey = previousMonthDate.toISOString().slice(0, 7);

  const vendor = await db.vendor.create({
    data: {
      name: `WP77 Vendor ${suffix}`,
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
      name: "WP77 Active Member",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: { vendorId: vendor.id, role: "member", status: "active" },
      },
    },
  });
  const plan = await db.billingPlan.create({
    data: {
      name: `WP77 Lawful Plan ${suffix}`,
      code: `WP77-PLAN-${suffix}`.toUpperCase(),
      monthlyPriceCents: 543_210,
      includedStreamMinutes: 98_761,
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
      description: `wp77-plan-description-${suffix}`,
      isActive: true,
    },
  });
  const subscription = await db.vendorSubscription.create({
    data: {
      vendorId: vendor.id,
      planId: plan.id,
      paymentMode: "platform",
      status: "active",
      customFeeRateBps: 4321,
      billingCycleDay: 17,
      startedAt: new Date(start.getTime() + 86_400_000),
    },
  });
  const usageLimit = await db.vendorUsageLimit.create({
    data: {
      vendorId: vendor.id,
      billingPlanId: plan.id,
      streamMinutesLimit: 98_761,
      storageMinutesLimit: 87_652,
      creditsLimit: 9_877,
      streamMinutesUsed: 12_345,
      storageMinutesUsed: 23_456,
      creditsUsed: 1_234,
      resetAt: end,
    },
  });
  const usageRecords = await Promise.all([
    db.usageRecord.create({
      data: {
        vendorId: vendor.id,
        monthKey,
        recordType: `wp77-current-record-${suffix}`,
        quantity: 34_567,
        unit: `wp77-current-unit-${suffix}`,
        creditsDelta: -2_345,
        totalWatchMinutes: 45_678,
        totalEvents: 47,
        totalAffiliates: 58,
        totalStorageMinutes: 56_789,
        overflowWatchMinutes: 6_789,
        overflowEvents: 69,
        overflowAffiliates: 79,
        overflowStorageMinutes: 7_890,
        description: `wp77-current-description-${suffix}`,
        metadata: { marker: `wp77-current-metadata-${suffix}` },
        createdAt: new Date(start.getTime() + 2 * 86_400_000),
      },
    }),
    db.usageRecord.create({
      data: {
        vendorId: vendor.id,
        monthKey: previousMonthKey,
        recordType: `wp77-previous-record-${suffix}`,
        quantity: 45_678,
        unit: `wp77-previous-unit-${suffix}`,
        creditsDelta: -3_456,
        totalWatchMinutes: 56_789,
        totalEvents: 83,
        totalAffiliates: 94,
        totalStorageMinutes: 67_890,
        overflowWatchMinutes: 7_891,
        overflowEvents: 105,
        overflowAffiliates: 116,
        overflowStorageMinutes: 8_902,
        description: `wp77-previous-description-${suffix}`,
        metadata: { marker: `wp77-previous-metadata-${suffix}` },
        createdAt: previousMonthDate,
      },
    }),
  ]);
  const transactionFixtures = [
    {
      providerName: `wp77-paid-provider-${suffix}`,
      providerTradeNo: `WP77-PAID-TRADE-${suffix}`,
      orderNumber: `WP77-PAID-ORDER-${suffix}`,
      grossAmountCents: 901_230,
      gatewayFeeCents: 13_579,
      platformFeeCents: 12_345,
      netAmountCents: 875_306,
      status: "paid",
      refundedAmountCents: 0,
      occurredAt: new Date(start.getTime() + 3 * 86_400_000),
      metadata: { marker: `wp77-paid-metadata-${suffix}` },
    },
    {
      providerName: `wp77-partial-provider-${suffix}`,
      providerTradeNo: `WP77-PARTIAL-TRADE-${suffix}`,
      orderNumber: `WP77-PARTIAL-ORDER-${suffix}`,
      grossAmountCents: 812_340,
      gatewayFeeCents: 12_468,
      platformFeeCents: 10_234,
      netAmountCents: 789_638,
      status: "partially_refunded",
      refundedAmountCents: 112_340,
      refundReason: `wp77-partial-reason-${suffix}`,
      refundedAt: new Date(start.getTime() + 5 * 86_400_000),
      occurredAt: new Date(start.getTime() + 4 * 86_400_000),
      metadata: { marker: `wp77-partial-metadata-${suffix}` },
    },
    {
      providerName: `wp77-refunded-provider-${suffix}`,
      providerTradeNo: `WP77-REFUNDED-TRADE-${suffix}`,
      orderNumber: `WP77-REFUNDED-ORDER-${suffix}`,
      grossAmountCents: 701_230,
      gatewayFeeCents: 11_357,
      platformFeeCents: 9_234,
      netAmountCents: 680_639,
      status: "refunded",
      refundedAmountCents: 701_230,
      refundReason: `wp77-refunded-reason-${suffix}`,
      refundedAt: new Date(start.getTime() + 7 * 86_400_000),
      occurredAt: new Date(start.getTime() + 6 * 86_400_000),
      metadata: { marker: `wp77-refunded-metadata-${suffix}` },
    },
    {
      providerName: `wp77-pending-provider-${suffix}`,
      providerTradeNo: `WP77-PENDING-TRADE-${suffix}`,
      orderNumber: `WP77-PENDING-ORDER-${suffix}`,
      grossAmountCents: 623_450,
      gatewayFeeCents: 10_246,
      platformFeeCents: 8_123,
      netAmountCents: 605_081,
      status: "pending",
      refundedAmountCents: 0,
      occurredAt: new Date(start.getTime() + 8 * 86_400_000),
      metadata: { marker: `wp77-pending-metadata-${suffix}` },
    },
  ];
  const transactions = await Promise.all(
    transactionFixtures.map((fixture) =>
      db.paymentTransaction.create({
        data: {
          vendorId: vendor.id,
          paymentMode: "platform",
          currency: "TWD",
          ...fixture,
        },
      }),
    ),
  );
  const refunds = await Promise.all([
    db.refundRecord.create({
      data: {
        vendorId: vendor.id,
        paymentTransactionId: transactions[1].id,
        providerEventId: `WP77-PROCESSED-EVENT-${suffix}`,
        monthKey,
        refundAmountCents: 112_340,
        gatewayFeeRefundCents: 1_357,
        platformFeeRefundCents: 1_234,
        reason: `wp77-processed-refund-${suffix}`,
        status: "processed",
        processedAt: new Date(start.getTime() + 9 * 86_400_000),
      },
    }),
    db.refundRecord.create({
      data: {
        vendorId: vendor.id,
        paymentTransactionId: transactions[3].id,
        providerEventId: `WP77-PENDING-EVENT-${suffix}`,
        monthKey,
        refundAmountCents: 98_760,
        gatewayFeeRefundCents: 2_468,
        platformFeeRefundCents: 2_345,
        reason: `wp77-pending-refund-${suffix}`,
        status: "pending",
        processedAt: new Date(start.getTime() + 10 * 86_400_000),
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
      vendorCount: await db.vendor.count(),
      tracking: await db.trackingSetting.findUniqueOrThrow({ where: { id: tracking.id } }),
      trackingCount: await db.trackingSetting.count(),
      trackingVendorCount: await db.trackingSetting.count({ where: { vendorId: vendor.id } }),
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
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipCount: await db.vendorMember.count(),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      membershipUserCount: await db.vendorMember.count({ where: { userId: user.id } }),
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
      sessionCount: await db.userSession.count({ where: { userId: user.id, vendorId: vendor.id } }),
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
      plan: await db.billingPlan.findUniqueOrThrow({ where: { id: plan.id } }),
      planCount: await db.billingPlan.count(),
      activePlanCount: await db.billingPlan.count({ where: { id: plan.id, isActive: true } }),
      planCodeCount: await db.billingPlan.count({ where: { id: plan.id, code: plan.code } }),
      subscription: await db.vendorSubscription.findUniqueOrThrow({
        where: { id: subscription.id },
      }),
      subscriptionCount: await db.vendorSubscription.count(),
      subscriptionVendorCount: await db.vendorSubscription.count({ where: { vendorId: vendor.id } }),
      subscriptionPlanCount: await db.vendorSubscription.count({ where: { planId: plan.id } }),
      activeSubscriptionCount: await db.vendorSubscription.count({
        where: { vendorId: vendor.id, planId: plan.id, status: "active" },
      }),
      subscriptionComposite: await db.vendorSubscription.count({
        where: {
          id: subscription.id,
          vendorId: vendor.id,
          planId: plan.id,
          status: subscription.status,
        },
      }),
      subscriptionRelations: await db.vendorSubscription.findMany({
        where: { id: subscription.id },
        select: { id: true, vendorId: true, planId: true },
      }),
      usageLimit: await db.vendorUsageLimit.findUniqueOrThrow({
        where: { id: usageLimit.id },
      }),
      usageLimitCount: await db.vendorUsageLimit.count(),
      usageLimitVendorCount: await db.vendorUsageLimit.count({ where: { vendorId: vendor.id } }),
      usageLimitPlanCount: await db.vendorUsageLimit.count({ where: { billingPlanId: plan.id } }),
      usageLimitComposite: await db.vendorUsageLimit.count({
        where: { id: usageLimit.id, vendorId: vendor.id, billingPlanId: plan.id },
      }),
      usageLimitRelations: await db.vendorUsageLimit.findMany({
        where: { id: usageLimit.id },
        select: { id: true, vendorId: true, billingPlanId: true },
      }),
      usageRecords: await db.usageRecord.findMany({
        where: { id: { in: usageRecords.map((record) => record.id) } },
        orderBy: { id: "asc" },
      }),
      usageRecordCount: await db.usageRecord.count(),
      usageRecordVendorCount: await db.usageRecord.count({ where: { vendorId: vendor.id } }),
      usageRecordCurrentMonthCount: await db.usageRecord.count({
        where: { vendorId: vendor.id, monthKey },
      }),
      usageRecordPreviousMonthCount: await db.usageRecord.count({
        where: { vendorId: vendor.id, monthKey: previousMonthKey },
      }),
      usageRecordCompositeCounts: await Promise.all(
        usageRecords.map((record) =>
          db.usageRecord.count({
            where: {
              id: record.id,
              vendorId: vendor.id,
              monthKey: record.monthKey,
              recordType: record.recordType,
            },
          }),
        ),
      ),
      usageRecordRelations: await db.usageRecord.findMany({
        where: { id: { in: usageRecords.map((record) => record.id) } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
      transactions: await db.paymentTransaction.findMany({
        where: { id: { in: transactions.map((transaction) => transaction.id) } },
        orderBy: { id: "asc" },
      }),
      transactionCount: await db.paymentTransaction.count(),
      transactionVendorCount: await db.paymentTransaction.count({ where: { vendorId: vendor.id } }),
      paidTransactionCount: await db.paymentTransaction.count({
        where: { vendorId: vendor.id, status: "paid" },
      }),
      partiallyRefundedTransactionCount: await db.paymentTransaction.count({
        where: { vendorId: vendor.id, status: "partially_refunded" },
      }),
      refundedTransactionCount: await db.paymentTransaction.count({
        where: { vendorId: vendor.id, status: "refunded" },
      }),
      pendingTransactionCount: await db.paymentTransaction.count({
        where: { vendorId: vendor.id, status: "pending" },
      }),
      transactionCompositeCounts: await Promise.all(
        transactions.map((transaction) =>
          db.paymentTransaction.count({
            where: {
              id: transaction.id,
              vendorId: vendor.id,
              providerName: transaction.providerName,
              orderNumber: transaction.orderNumber,
              status: transaction.status,
            },
          }),
        ),
      ),
      transactionRelations: await db.paymentTransaction.findMany({
        where: { id: { in: transactions.map((transaction) => transaction.id) } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
      refunds: await db.refundRecord.findMany({
        where: { id: { in: refunds.map((refund) => refund.id) } },
        orderBy: { id: "asc" },
      }),
      refundCount: await db.refundRecord.count(),
      refundVendorCount: await db.refundRecord.count({ where: { vendorId: vendor.id } }),
      refundMonthCount: await db.refundRecord.count({ where: { vendorId: vendor.id, monthKey } }),
      processedRefundCount: await db.refundRecord.count({
        where: { vendorId: vendor.id, monthKey, status: "processed" },
      }),
      pendingRefundCount: await db.refundRecord.count({
        where: { vendorId: vendor.id, monthKey, status: "pending" },
      }),
      refundTransactionCounts: await Promise.all(
        refunds.map((refund) =>
          db.refundRecord.count({
            where: {
              id: refund.id,
              vendorId: vendor.id,
              paymentTransactionId: refund.paymentTransactionId,
              monthKey: refund.monthKey,
              status: refund.status,
            },
          }),
        ),
      ),
      refundRelations: await db.refundRecord.findMany({
        where: { id: { in: refunds.map((refund) => refund.id) } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true, paymentTransactionId: true },
      }),
    });
    const before = await snapshot();
    const grossRevenue = transactions
      .filter((transaction) => ["paid", "partially_refunded", "refunded"].includes(transaction.status))
      .reduce(
        (sum, transaction) =>
          sum + Math.max(0, transaction.grossAmountCents - transaction.refundedAmountCents),
        0,
      );
    const estimatedPlatformFees = Math.max(
      0,
      transactions
        .filter((transaction) =>
          ["paid", "partially_refunded", "refunded"].includes(transaction.status),
        )
        .reduce((sum, transaction) => sum + transaction.platformFeeCents, 0) -
        refunds
          .filter((refund) => refund.status === "processed")
          .reduce((sum, refund) => sum + refund.platformFeeRefundCents, 0),
    );
    const lawfulUsagePercent = Math.round(
      (usageLimit.creditsUsed / usageLimit.creditsLimit) * 100,
    );
    const lawfulRemainingCredits = usageLimit.creditsLimit - usageLimit.creditsUsed;

    const rawSensitiveCanaries = [
      plan.id,
      plan.name,
      plan.code,
      plan.description ?? "",
      subscription.id,
      usageLimit.id,
      ...usageRecords.flatMap((record) => [
        record.id,
        record.recordType,
        record.unit,
        record.description ?? "",
        String(record.quantity),
        String(record.creditsDelta),
      ]),
      ...transactions.flatMap((transaction) => [
        transaction.id,
        transaction.providerName,
        transaction.providerTradeNo ?? "",
        transaction.orderNumber ?? "",
        transaction.refundReason ?? "",
        formatCurrency(transaction.grossAmountCents),
        formatCurrency(transaction.gatewayFeeCents),
        formatCurrency(transaction.platformFeeCents),
        formatCurrency(transaction.netAmountCents),
        formatCurrency(transaction.refundedAmountCents),
      ]),
      ...refunds.flatMap((refund) => [
        refund.id,
        refund.providerEventId ?? "",
        refund.reason ?? "",
        formatCurrency(refund.refundAmountCents),
        formatCurrency(refund.gatewayFeeRefundCents),
        formatCurrency(refund.platformFeeRefundCents),
      ]),
      formatCurrency(grossRevenue),
      formatCurrency(estimatedPlatformFees),
    ].filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0 && value !== "$0",
    );
    const deniedDashboardCanaries = rawSensitiveCanaries.filter(
      (value) => value !== plan.name,
    );

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    const usagePath = "/billing/usage";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
      if (url.hostname.endsWith(".invalid")) invalid.push(request.url());
    });
    await page.route("**/billing/usage", async (route) => {
      if (new URL(route.request().url()).pathname !== usagePath) {
        await route.continue();
        return;
      }
      const response = await route.fetch({ maxRedirects: 0 });
      intercepted.current = {
        status: response.status(),
        location: response.headers().location,
        body: await response.text(),
      };
      await route.fulfill({ response });
    });

    const rawRedirect = page.waitForResponse(
      (response) => new URL(response.url()).pathname === usagePath && response.status() === 307,
    );
    const finalResponse = await page.goto(usagePath);
    const redirectResponse = await rawRedirect;

    expect(redirectResponse.status()).toBe(307);
    expect(redirectResponse.headers().location).toBe("/dashboard?error=insufficient_role");
    expect(intercepted.current).toBeDefined();
    expect(intercepted.current?.status).toBe(307);
    expect(intercepted.current?.location).toBe("/dashboard?error=insufficient_role");
    for (const canary of rawSensitiveCanaries) {
      expect(intercepted.current?.body).not.toContain(canary);
    }
    expect(intercepted.current?.body).not.toContain(".invalid");
    for (const heading of [
      "用量與扣點",
      "目前方案",
      "本月活動場次",
      "本月成交額",
      "預估交易服務費",
      "用量紀錄",
    ]) {
      expect(intercepted.current?.body).not.toContain(heading);
    }

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const usageSummaryHeading = page.getByRole("heading", {
      name: "用量 / 配額",
      exact: true,
    });
    await expect(usageSummaryHeading).toBeVisible();
    const usageSummary = usageSummaryHeading.locator("..");
    await expect(usageSummary.getByText(plan.name, { exact: true })).toBeVisible();
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
    for (const heading of [
      "用量與扣點",
      "用量紀錄",
    ]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
    }
    for (const label of [
      "目前方案",
      "本月活動場次",
      "本月成交額",
      "預估交易服務費",
      "串流分鐘",
      "儲存分鐘",
      "點數",
      "平台統一金流",
      "自帶金流 / 未設定",
    ]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    for (const canary of deniedDashboardCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.refundRecord.deleteMany({ where: { vendorId: vendor.id } });
    await db.paymentTransaction.deleteMany({ where: { vendorId: vendor.id } });
    await db.usageRecord.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendorUsageLimit.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendorSubscription.deleteMany({ where: { vendorId: vendor.id } });
    await db.billingPlan.deleteMany({ where: { id: plan.id } });
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
