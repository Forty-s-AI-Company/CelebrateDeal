import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatCurrency, formatDateTime } from "../../src/lib/format";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp79SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);

test("active member is denied billing invoices before tenant query or MFA", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp79-${suffix}`;
  const resetAt = new Date("2099-01-01T00:00:00.000Z");

  const vendor = await db.vendor.create({
    data: {
      name: `WP79 Vendor ${suffix}`,
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
      name: "WP79 Active Member",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: { vendorId: vendor.id, role: "member", status: "active" },
      },
    },
  });
  const plan = await db.billingPlan.create({
    data: {
      name: `WP79 Lawful Plan ${suffix}`,
      code: `WP79-PLAN-${suffix}`.toUpperCase(),
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
  const invoices = await Promise.all([
    db.invoice.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2098-11",
        invoiceNumber: `WP79-ISSUED-${suffix}`.toUpperCase(),
        invoiceType: `wp79-issued-type-${suffix}`,
        monthlyFeeCents: 112_233,
        overflowFeeCents: 22_344,
        paymentServiceFeeCents: 3_455,
        transactionServiceFeeCents: 4_566,
        affiliateManagementFeeCents: 5_677,
        subtotalCents: 148_275,
        taxCents: 7_414,
        totalCents: 155_689,
        status: "issued",
        dueAt: new Date("2098-12-21T03:04:05.000Z"),
        createdAt: new Date("2098-12-01T01:02:03.000Z"),
      },
    }),
    db.invoice.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2098-12",
        invoiceNumber: `WP79-PAID-${suffix}`.toUpperCase(),
        invoiceType: `wp79-paid-type-${suffix}`,
        monthlyFeeCents: 223_344,
        overflowFeeCents: 33_455,
        paymentServiceFeeCents: 4_566,
        transactionServiceFeeCents: 5_677,
        affiliateManagementFeeCents: 6_788,
        subtotalCents: 273_830,
        taxCents: 13_692,
        totalCents: 287_522,
        status: "paid",
        dueAt: new Date("2099-01-21T04:05:06.000Z"),
        paidAt: new Date("2099-01-11T05:06:07.000Z"),
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

    const invoiceIds = invoices.map((invoice) => invoice.id);
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
      invoices: await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
        orderBy: { id: "asc" },
      }),
      invoiceCount: await db.invoice.count({ where: { id: { in: invoiceIds } } }),
      invoiceVendorCount: await db.invoice.count({
        where: { vendorId: vendor.id },
      }),
      issuedInvoiceCount: await db.invoice.count({
        where: { vendorId: vendor.id, status: "issued" },
      }),
      paidInvoiceCount: await db.invoice.count({
        where: { vendorId: vendor.id, status: "paid" },
      }),
      invoiceCompositeCounts: await Promise.all(
        invoices.map((invoice) =>
          db.invoice.count({
            where: {
              id: invoice.id,
              vendorId: vendor.id,
              invoiceNumber: invoice.invoiceNumber,
              monthKey: invoice.monthKey,
              status: invoice.status,
            },
          }),
        ),
      ),
      invoiceRelations: await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
    });
    const before = await snapshot();
    const lawfulUsagePercent = Math.round(
      (usageLimit.creditsUsed / usageLimit.creditsLimit) * 100,
    );
    const lawfulRemainingCredits =
      usageLimit.creditsLimit - usageLimit.creditsUsed;

    const invoiceCanaries = invoices.flatMap((invoice) => [
      invoice.id,
      invoice.invoiceNumber,
      invoice.monthKey,
      invoice.invoiceType,
      formatCurrency(invoice.monthlyFeeCents),
      formatCurrency(invoice.overflowFeeCents),
      formatCurrency(invoice.paymentServiceFeeCents),
      formatCurrency(invoice.transactionServiceFeeCents),
      formatCurrency(invoice.affiliateManagementFeeCents),
      formatCurrency(invoice.subtotalCents),
      formatCurrency(invoice.taxCents),
      formatCurrency(invoice.totalCents),
      invoice.status,
      invoice.status === "paid" ? "已付款" : "待付款",
      formatDateTime(invoice.createdAt),
      invoice.dueAt ? formatDateTime(invoice.dueAt) : "",
      invoice.paidAt ? formatDateTime(invoice.paidAt) : "",
      `/billing/invoices/${invoice.id}`,
    ]).filter(
      (value): value is string =>
        typeof value === "string" &&
        value.length > 0 &&
        value !== "$0",
    );

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    const exports: string[] = [];
    const details: string[] = [];
    const invoicesPath = "/billing/invoices";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
        external.push(request.url());
      }
      if (url.hostname.endsWith(".invalid")) invalid.push(request.url());
      if (url.pathname === "/billing/invoices/export") {
        exports.push(url.pathname);
      }
      if (
        url.pathname.startsWith("/billing/invoices/") &&
        url.pathname !== "/billing/invoices/export"
      ) {
        details.push(url.pathname);
      }
    });
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path: invoicesPath,
      protectedPayloadCanaries: invoiceCanaries,
      documentCanaries: invoiceCanaries,
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
        'title="帳單"',
        "累計帳單金額",
        "未付款 / 待扣款",
        "對帳匯出",
        "匯出 CSV",
        "帳單列表",
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
      page.locator('a[href="/billing/invoices/export"]'),
    ).toHaveCount(0);
    for (const invoice of invoices) {
      await expect(
        page.locator(`a[href="/billing/invoices/${invoice.id}"]`),
      ).toHaveCount(0);
    }
    await expect(
      page.getByRole("heading", { name: "帳單", exact: true }),
    ).toHaveCount(0);
    for (const deniedText of [
      "累計帳單金額",
      "未付款 / 待扣款",
      "對帳匯出",
      "匯出 CSV",
      "帳單列表",
    ]) {
      await expect(page.getByText(deniedText, { exact: true })).toHaveCount(0);
    }
    for (const canary of invoiceCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    expect(exports).toEqual([]);
    expect(details).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.invoice.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendorUsageLimit.deleteMany({ where: { vendorId: vendor.id } });
    await db.billingPlan.deleteMany({ where: { id: plan.id } });
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
