import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { buildCommissionDeduplicationKey } from "../../src/lib/affiliate-commission";
import { formatCurrency } from "../../src/lib/format";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp75SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied a same-tenant affiliate detail before sensitive queries render", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp75-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP75 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const [user, affiliate] = await Promise.all([
    db.user.create({
      data: {
        email: `accountant-${tag}@celebratedeal.test`,
        name: "WP75 Active Accountant",
        passwordHash: hashPassword(password),
        status: "active",
        memberships: {
          create: { vendorId: vendor.id, role: "accountant", status: "active" },
        },
      },
    }),
    db.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: `WP75 Lawful Affiliate ${suffix}`,
        code: `WP75CODE${suffix}`.toUpperCase(),
        source: `wp75-sensitive-source-${suffix}`,
        contactEmail: `affiliate-${tag}@contact.invalid`,
        commissionRateBps: 3751,
        isActive: true,
      },
    }),
  ]);
  const clicks = await Promise.all([
    db.affiliateClick.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        referralCode: `WP75-REF-CONVERTED-${suffix}`,
        visitorId: `wp75-visitor-converted-${suffix}`,
        landingPath: `/wp75/private/converted-${suffix}`,
        convertedAt: new Date("2035-01-02T03:04:05.000Z"),
      },
    }),
    db.affiliateClick.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        referralCode: `WP75-REF-OPEN-${suffix}`,
        visitorId: `wp75-visitor-open-${suffix}`,
        landingPath: `/wp75/private/open-${suffix}`,
      },
    }),
  ]);
  const commissionFixtures = [
    {
      monthKey: "2035-01",
      sourceType: "product",
      sourceId: `wp75-source-pending-${suffix}`,
      referralCode: `WP75-COMMISSION-REF-PENDING-${suffix}`,
      orderNumber: `WP75-ORDER-PENDING-${suffix}`,
      orderAmountCents: 9_876_500,
      commissionRateBps: 3751,
      commissionAmountCents: 3_704_875,
      status: "pending" as const,
      attributedAt: new Date("2035-01-03T04:05:06.000Z"),
    },
    {
      monthKey: "2035-02",
      sourceType: "product",
      sourceId: `wp75-source-approved-${suffix}`,
      referralCode: `WP75-COMMISSION-REF-APPROVED-${suffix}`,
      orderNumber: `WP75-ORDER-APPROVED-${suffix}`,
      orderAmountCents: 8_765_400,
      commissionRateBps: 3751,
      commissionAmountCents: 3_287_901,
      status: "approved" as const,
      attributedAt: new Date("2035-02-03T04:05:06.000Z"),
    },
  ];
  const commissions = await Promise.all(
    commissionFixtures.map((fixture) =>
      db.affiliateCommission.create({
        data: {
          vendorId: vendor.id,
          affiliateId: affiliate.id,
          ...fixture,
          deduplicationKey: buildCommissionDeduplicationKey({
            affiliateId: affiliate.id,
            sourceType: fixture.sourceType,
            sourceId: fixture.sourceId,
          }),
        },
      }),
    ),
  );
  const payout = await db.affiliatePayout.create({
    data: {
      vendorId: vendor.id,
      affiliateId: affiliate.id,
      monthKey: `wp75-month-${suffix}`,
      commissionAmountCents: 6_992_776,
      adjustmentAmountCents: 12_345,
      finalAmountCents: 7_005_121,
      status: `wp75-payout-pending-${suffix}`,
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
      vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
      vendorCount: await db.vendor.count({ where: { id: vendor.id } }),
      tracking: await db.trackingSetting.findUniqueOrThrow({ where: { id: tracking.id } }),
      trackingCount: await db.trackingSetting.count({ where: { id: tracking.id } }),
      trackingVendorCount: await db.trackingSetting.count({ where: { vendorId: vendor.id } }),
      trackingCompositeCount: await db.trackingSetting.count({
        where: { id: tracking.id, vendorId: vendor.id },
      }),
      trackingRelations: await db.trackingSetting.findMany({
        where: { id: tracking.id },
        select: { id: true, vendorId: true },
      }),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count({ where: { id: user.id } }),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipCount: await db.vendorMember.count({ where: { id: membership.id } }),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      membershipUserCount: await db.vendorMember.count({ where: { userId: user.id } }),
      activeAccountantMembershipCount: await db.vendorMember.count({
        where: {
          id: membership.id,
          vendorId: vendor.id,
          userId: user.id,
          role: "accountant",
          status: "active",
        },
      }),
      membershipRelations: await db.vendorMember.findMany({
        where: { id: membership.id },
        select: { id: true, vendorId: true, userId: true },
      }),
      affiliate: await db.affiliate.findUniqueOrThrow({ where: { id: affiliate.id } }),
      affiliateCount: await db.affiliate.count({ where: { id: affiliate.id } }),
      affiliateVendorCount: await db.affiliate.count({ where: { vendorId: vendor.id } }),
      activeAffiliateCount: await db.affiliate.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      affiliateCompositeCount: await db.affiliate.count({
        where: {
          id: affiliate.id,
          vendorId: vendor.id,
          code: affiliate.code,
          isActive: true,
        },
      }),
      affiliateRelations: await db.affiliate.findMany({
        where: { id: affiliate.id },
        select: { id: true, vendorId: true },
      }),
      clicks: await db.affiliateClick.findMany({
        where: { id: { in: clicks.map((click) => click.id) } },
        orderBy: { id: "asc" },
      }),
      clickCount: await db.affiliateClick.count({ where: { id: { in: clicks.map((click) => click.id) } } }),
      clickVendorCount: await db.affiliateClick.count({ where: { vendorId: vendor.id } }),
      clickAffiliateCount: await db.affiliateClick.count({ where: { affiliateId: affiliate.id } }),
      convertedClickCount: await db.affiliateClick.count({
        where: { affiliateId: affiliate.id, convertedAt: { not: null } },
      }),
      unconvertedClickCount: await db.affiliateClick.count({
        where: { affiliateId: affiliate.id, convertedAt: null },
      }),
      clickCompositeCounts: await Promise.all(
        clicks.map((click) =>
          db.affiliateClick.count({
            where: {
              id: click.id,
              vendorId: vendor.id,
              affiliateId: affiliate.id,
              referralCode: click.referralCode,
              visitorId: click.visitorId,
              landingPath: click.landingPath,
            },
          }),
        ),
      ),
      clickRelations: await db.affiliateClick.findMany({
        where: { id: { in: clicks.map((click) => click.id) } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true, affiliateId: true },
      }),
      commissions: await db.affiliateCommission.findMany({
        where: { id: { in: commissions.map((commission) => commission.id) } },
        orderBy: { id: "asc" },
      }),
      commissionCount: await db.affiliateCommission.count({ where: { id: { in: commissions.map((commission) => commission.id) } } }),
      commissionVendorCount: await db.affiliateCommission.count({ where: { vendorId: vendor.id } }),
      commissionAffiliateCount: await db.affiliateCommission.count({
        where: { affiliateId: affiliate.id },
      }),
      pendingCommissionCount: await db.affiliateCommission.count({
        where: { affiliateId: affiliate.id, status: "pending" },
      }),
      approvedCommissionCount: await db.affiliateCommission.count({
        where: { affiliateId: affiliate.id, status: "approved" },
      }),
      commissionCompositeCounts: await Promise.all(
        commissions.map((commission) =>
          db.affiliateCommission.count({
            where: {
              id: commission.id,
              vendorId: vendor.id,
              affiliateId: affiliate.id,
              deduplicationKey: commission.deduplicationKey,
              status: commission.status,
            },
          }),
        ),
      ),
      commissionRelations: await db.affiliateCommission.findMany({
        where: { id: { in: commissions.map((commission) => commission.id) } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true, affiliateId: true },
      }),
      payout: await db.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } }),
      payoutCount: await db.affiliatePayout.count({ where: { id: payout.id } }),
      payoutVendorCount: await db.affiliatePayout.count({ where: { vendorId: vendor.id } }),
      payoutAffiliateCount: await db.affiliatePayout.count({ where: { affiliateId: affiliate.id } }),
      payoutStatusCount: await db.affiliatePayout.count({
        where: { affiliateId: affiliate.id, status: payout.status },
      }),
      payoutCompositeCount: await db.affiliatePayout.count({
        where: {
          id: payout.id,
          vendorId: vendor.id,
          affiliateId: affiliate.id,
          monthKey: payout.monthKey,
          status: payout.status,
        },
      }),
      payoutRelations: await db.affiliatePayout.findMany({
        where: { id: payout.id },
        select: { id: true, vendorId: true, affiliateId: true },
      }),
    });
    const before = await snapshot();
    // Next.js serializes the already-requested dynamic route segment in the
    // redirect shell. Treat that route identity separately from DB-backed data.
    const detailPath = `/affiliates/${affiliate.id}`;
    const routeIdentityCanaries = [affiliate.id, detailPath];
    const rawSensitiveCanaries = [
      affiliate.name,
      affiliate.code,
      affiliate.source ?? "",
      affiliate.contactEmail ?? "",
      ...clicks.flatMap((click) => [
        click.id,
        click.referralCode ?? "",
        click.visitorId,
        click.landingPath,
      ]),
      ...commissions.flatMap((commission) => [
        commission.id,
        commission.sourceId ?? "",
        commission.deduplicationKey,
        commission.referralCode ?? "",
        commission.orderNumber ?? "",
        formatCurrency(commission.orderAmountCents),
        formatCurrency(commission.commissionAmountCents),
      ]),
      payout.id,
      payout.monthKey,
      payout.status,
      String(payout.commissionAmountCents),
      String(payout.adjustmentAmountCents),
      String(payout.finalAmountCents),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const deniedDashboardCanaries = rawSensitiveCanaries.filter(
      (value) => value !== affiliate.name && value !== affiliate.code,
    );

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
      if (url.hostname.endsWith(".invalid")) invalid.push(request.url());
    });
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path: detailPath,
      routeIdentityCanaries,
      protectedPayloadCanaries: rawSensitiveCanaries,
      documentCanaries: deniedDashboardCanaries,
      transport: {
        kind: "http-redirect",
        status: 307,
        location: "/dashboard?error=insufficient_role",
      },
      finalUrl: /\/dashboard\?error=insufficient_role$/,
      finalStatus: 200,
      forbiddenPayload: [
        ".invalid",
        "佣金紀錄",
        "推廣設定",
        "最近來源事件",
      ],
    });

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "聯盟來源摘要", exact: true })).toBeVisible();
    await expect(page.getByText(affiliate.name, { exact: true })).toBeVisible();
    await expect(page.getByText(affiliate.code, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "聯盟佣金", exact: true })).toBeVisible();
    await expect(page.locator('a[href="/affiliates"]')).toHaveCount(0);
    await expect(page.locator(`a[href="${detailPath}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="${detailPath}/edit"]`)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "查看完整分潤報表", exact: true })).toHaveCount(0);
    for (const heading of ["佣金紀錄", "推廣設定", "最近來源事件"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
    }
    // Dashboard has lawful aggregate conversion labels; prohibit only
    // detail-specific labels and all identifiable detail-row canaries.
    for (const label of ["累計佣金", "佣金比例", "聯絡 Email", "追蹤連結"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    for (const status of ["pending", "approved", payout.status]) {
      await expect(page.getByText(status, { exact: true })).toHaveCount(0);
    }
    for (const canary of deniedDashboardCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.affiliatePayout.deleteMany({ where: { vendorId: vendor.id } });
    await db.affiliateCommission.deleteMany({ where: { vendorId: vendor.id } });
    await db.affiliateClick.deleteMany({ where: { vendorId: vendor.id } });
    await db.affiliate.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
