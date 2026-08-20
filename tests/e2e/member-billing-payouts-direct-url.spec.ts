import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp82SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);

test("active member is denied billing payouts before tenant query or MFA", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp82-${suffix}`;
  const resetAt = new Date("2099-01-01T00:00:00.000Z");

  const vendor = await db.vendor.create({
    data: {
      name: `WP82 Vendor ${suffix}`,
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
      name: "WP82 Active Member",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: { vendorId: vendor.id, role: "member", status: "active" },
      },
    },
  });
  const plan = await db.billingPlan.create({
    data: {
      name: `WP82 Lawful Plan ${suffix}`,
      code: `WP82-PLAN-${suffix}`.toUpperCase(),
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
  const payoutBatches = await Promise.all([
    db.payoutBatch.create({
      data: {
        batchNumber: `WP82-PAYOUT-A-${suffix}`.toUpperCase(),
        batchDate: new Date("2099-02-15T06:07:08.000Z"),
        totalAmountCents: 876_543,
        totalCount: 1,
        status: `wp82-batch-reviewing-${suffix}`,
        exportedFilePath: `wp82-export-a-${suffix}.csv`,
        exportedAt: new Date("2099-02-16T07:08:09.000Z"),
      },
    }),
    db.payoutBatch.create({
      data: {
        batchNumber: `WP82-PAYOUT-B-${suffix}`.toUpperCase(),
        batchDate: new Date("2099-03-15T08:09:10.000Z"),
        totalAmountCents: 987_654,
        totalCount: 1,
        status: `wp82-batch-failed-${suffix}`,
        executedAt: new Date("2099-03-16T09:10:11.000Z"),
      },
    }),
  ]);
  const payoutItems = await Promise.all([
    db.payoutItem.create({
      data: {
        payoutBatchId: payoutBatches[0].id,
        vendorId: vendor.id,
        bankAccountDisplayName: `甲方收款${suffix.slice(0, 8)}`,
        bankCodeDisplay: "821",
        bankAccountDisplayNumber: "820000001182",
        bankAccountEncrypted: null,
        payoutAmountCents: payoutBatches[0].totalAmountCents,
        status: `wp82-item-pending-${suffix}`,
        failReason: null,
        retryCount: 0,
        createdAt: new Date("2099-02-15T10:11:12.000Z"),
      },
    }),
    db.payoutItem.create({
      data: {
        payoutBatchId: payoutBatches[1].id,
        vendorId: vendor.id,
        bankAccountDisplayName: `乙方收款${suffix.slice(8, 16)}`,
        bankCodeDisplay: "822",
        bankAccountDisplayNumber: "830000002283",
        bankAccountEncrypted: null,
        payoutAmountCents: payoutBatches[1].totalAmountCents,
        status: `wp82-item-failed-${suffix}`,
        failReason: `wp82-failure-${suffix}`,
        retryCount: 2,
        retriedAt: new Date("2099-03-17T10:11:12.000Z"),
        createdAt: new Date("2099-03-15T11:12:13.000Z"),
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

    const payoutBatchIds = payoutBatches.map((batch) => batch.id);
    const payoutItemIds = payoutItems.map((item) => item.id);
    const payoutItemSafeSelect = {
      id: true,
      payoutBatchId: true,
      vendorId: true,
      settlementId: true,
      bankAccountDisplayName: true,
      bankCodeDisplay: true,
      bankAccountDisplayNumber: true,
      payoutAmountCents: true,
      status: true,
      failReason: true,
      paidAt: true,
      retryCount: true,
      retriedAt: true,
      createdAt: true,
      updatedAt: true,
    } as const;
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
      payoutBatches: await db.payoutBatch.findMany({
        where: { id: { in: payoutBatchIds } },
        orderBy: { id: "asc" },
      }),
      payoutBatchCount: await db.payoutBatch.count({ where: { id: { in: payoutBatchIds } } }),
      payoutBatchStatusCounts: await Promise.all(
        payoutBatches.map((batch) =>
          db.payoutBatch.count({ where: { id: { in: payoutBatchIds }, status: batch.status } }),
        ),
      ),
      payoutBatchCompositeCounts: await Promise.all(
        payoutBatches.map((batch) =>
          db.payoutBatch.count({
            where: {
              id: batch.id,
              batchNumber: batch.batchNumber,
              status: batch.status,
              totalAmountCents: batch.totalAmountCents,
              totalCount: batch.totalCount,
            },
          }),
        ),
      ),
      payoutBatchRelations: await db.payoutBatch.findMany({
        where: { id: { in: payoutBatchIds } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          items: {
            where: { id: { in: payoutItemIds }, vendorId: vendor.id },
            orderBy: { id: "asc" },
            select: payoutItemSafeSelect,
          },
        },
      }),
      payoutItems: await db.payoutItem.findMany({
        where: { id: { in: payoutItemIds }, vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: payoutItemSafeSelect,
      }),
      payoutItemCount: await db.payoutItem.count({ where: { id: { in: payoutItemIds } } }),
      payoutItemVendorCount: await db.payoutItem.count({
        where: { vendorId: vendor.id },
      }),
      payoutItemBatchCounts: await Promise.all(
        payoutBatches.map((batch) =>
          db.payoutItem.count({
            where: { payoutBatchId: batch.id, vendorId: vendor.id },
          }),
        ),
      ),
      payoutItemStatusCounts: await Promise.all(
        payoutItems.map((item) =>
          db.payoutItem.count({
            where: { vendorId: vendor.id, status: item.status },
          }),
        ),
      ),
      payoutItemCompositeCounts: await Promise.all(
        payoutItems.map((item) =>
          db.payoutItem.count({
            where: {
              id: item.id,
              payoutBatchId: item.payoutBatchId,
              vendorId: vendor.id,
              settlementId: null,
              status: item.status,
              payoutAmountCents: item.payoutAmountCents,
            },
          }),
        ),
      ),
      payoutItemRelations: await db.payoutItem.findMany({
        where: { id: { in: payoutItemIds }, vendorId: vendor.id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          payoutBatchId: true,
          vendorId: true,
          settlementId: true,
        },
      }),
    });
    const before = await snapshot();
    const lawfulUsagePercent = Math.round(
      (usageLimit.creditsUsed / usageLimit.creditsLimit) * 100,
    );
    const lawfulRemainingCredits =
      usageLimit.creditsLimit - usageLimit.creditsUsed;

    const disclosureCanaries = [
      ...payoutBatches.flatMap((batch) => [
        batch.id,
        batch.batchNumber,
        batch.status,
        batch.exportedFilePath,
      ]),
      ...payoutItems.flatMap((item) => [
        item.id,
        item.status,
        item.failReason,
        item.bankAccountDisplayName,
        item.bankAccountDisplayNumber,
      ]),
    ].filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0,
    );

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    const targetGets: string[] = [];
    const targetNonGets: string[] = [];
    const otherPayoutAdminBillingOrSettlement: string[] = [];
    const payoutsPath = "/billing/payouts";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
        external.push(request.url());
      }
      if (url.hostname.endsWith(".invalid")) invalid.push(request.url());
      if (url.pathname === payoutsPath) {
        if (request.method() === "GET") targetGets.push(url.pathname);
        else targetNonGets.push(`${request.method()} ${url.pathname}`);
      } else if (
        url.pathname.startsWith("/billing/payouts") ||
        url.pathname.startsWith("/admin/billing") ||
        url.pathname.startsWith("/billing/settlements")
      ) {
        otherPayoutAdminBillingOrSettlement.push(url.pathname);
      }
    });
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path: payoutsPath,
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
        'title="批次出款"',
        "每月固定日產生待出款清單",
        "出款批次",
        "待覆核筆數",
        "匯出格式",
        "MVP 先保留 CSV 匯出路徑",
        "尚無出款批次",
        "產生月結並排定出款日後",
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
      page.getByRole("heading", { name: "批次出款", exact: true }),
    ).toHaveCount(0);
    for (const deniedText of [
      "每月固定日產生待出款清單，支援人工覆核、鎖單、匯出銀行批次轉帳檔與失敗重送紀錄。",
      "出款批次",
      "待覆核筆數",
      "匯出格式",
      "MVP 先保留 CSV 匯出路徑，正式版接銀行指定格式。",
      "尚無出款批次",
      "產生月結並排定出款日後，這裡會列出批次與每筆銀行轉帳項目。",
    ]) {
      await expect(page.getByText(deniedText, { exact: true })).toHaveCount(0);
    }
    for (const canary of disclosureCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    expect(targetGets).toEqual([payoutsPath]);
    expect(targetNonGets).toEqual([]);
    expect(otherPayoutAdminBillingOrSettlement).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.userSession.deleteMany({
      where: { userId: user.id, vendorId: vendor.id },
    });
    await db.payoutItem.deleteMany({
      where: {
        id: { in: payoutItems.map((item) => item.id) },
        vendorId: vendor.id,
      },
    });
    await db.payoutBatch.deleteMany({
      where: { id: { in: payoutBatches.map((batch) => batch.id) } },
    });
    await db.vendorUsageLimit.deleteMany({ where: { vendorId: vendor.id } });
    await db.billingPlan.deleteMany({ where: { id: plan.id } });
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
