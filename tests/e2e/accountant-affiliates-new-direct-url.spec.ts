import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp74SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied affiliates/new before the affiliate form is rendered or mutated", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp74-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP74 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP74-FB-${suffix}`,
          tiktokPixelId: `WP74-TT-${suffix}`,
          googleTagManagerId: `WP74-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: `WP74 Active Accountant ${suffix}`,
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: {
          vendorId: vendor.id,
          role: "accountant",
          status: "active",
        },
      },
    },
  });
  const affiliates = await Promise.all([
    db.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: `WP74 Active Affiliate ${suffix}`,
        code: `WP74ACTIVE${suffix}`,
        source: `wp74-active-source-${suffix}`,
        contactEmail: `active-${tag}@affiliate.invalid`,
        commissionRateBps: 4174,
        isActive: true,
      },
    }),
    db.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: `WP74 Inactive Affiliate ${suffix}`,
        code: `WP74INACTIVE${suffix}`,
        source: `wp74-inactive-source-${suffix}`,
        contactEmail: `inactive-${tag}@affiliate.invalid`,
        commissionRateBps: 2874,
        isActive: false,
      },
    }),
  ]);
  const clicks = (
    await Promise.all(
      affiliates.flatMap((affiliate, affiliateIndex) => [
        db.affiliateClick.create({
          data: {
            vendorId: vendor.id,
            affiliateId: affiliate.id,
            referralCode: `WP74REF-${affiliateIndex}-CONVERTED-${suffix}`,
            visitorId: `wp74-visitor-${affiliateIndex}-converted-${suffix}`,
            landingPath: `/wp74/${affiliateIndex}/converted-${suffix}`,
            convertedAt: new Date(`2034-01-0${affiliateIndex + 1}T00:00:00.000Z`),
          },
        }),
        db.affiliateClick.create({
          data: {
            vendorId: vendor.id,
            affiliateId: affiliate.id,
            referralCode: `WP74REF-${affiliateIndex}-OPEN-${suffix}`,
            visitorId: `wp74-visitor-${affiliateIndex}-open-${suffix}`,
            landingPath: `/wp74/${affiliateIndex}/open-${suffix}`,
          },
        }),
      ]),
    )
  ).sort((left, right) => left.id.localeCompare(right.id));
  const [tracking, membership] = await Promise.all([
    db.trackingSetting.findUniqueOrThrow({ where: { vendorId: vendor.id } }),
    db.vendorMember.findUniqueOrThrow({
      where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    }),
  ]);

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const snapshot = async () => ({
      vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
      vendorCount: await db.vendor.count(),
      tracking: await db.trackingSetting.findUniqueOrThrow({ where: { id: tracking.id } }),
      trackingCount: await db.trackingSetting.count(),
      trackingVendorCount: await db.trackingSetting.count({ where: { vendorId: vendor.id } }),
      trackingRelationCount: await db.trackingSetting.count({
        where: { id: tracking.id, vendorId: vendor.id },
      }),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipCount: await db.vendorMember.count(),
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
      affiliates: await db.affiliate.findMany({
        where: { id: { in: affiliates.map((affiliate) => affiliate.id) } },
        orderBy: { id: "asc" },
      }),
      affiliateCount: await db.affiliate.count(),
      affiliateVendorCount: await db.affiliate.count({ where: { vendorId: vendor.id } }),
      affiliateGlobalActiveCount: await db.affiliate.count({ where: { isActive: true } }),
      affiliateGlobalInactiveCount: await db.affiliate.count({ where: { isActive: false } }),
      affiliateVendorActiveCount: await db.affiliate.count({
        where: { vendorId: vendor.id, isActive: true },
      }),
      affiliateVendorInactiveCount: await db.affiliate.count({
        where: { vendorId: vendor.id, isActive: false },
      }),
      affiliateComposites: await Promise.all(
        affiliates.map((affiliate) =>
          db.affiliate.count({
            where: {
              id: affiliate.id,
              vendorId: vendor.id,
              code: affiliate.code,
              isActive: affiliate.isActive,
            },
          }),
        ),
      ),
      affiliateRelations: await db.affiliate.findMany({
        where: { id: { in: affiliates.map((affiliate) => affiliate.id) } },
        orderBy: { id: "asc" },
        select: { id: true, vendorId: true },
      }),
      clicks: await db.affiliateClick.findMany({
        where: { id: { in: clicks.map((click) => click.id) } },
        orderBy: { id: "asc" },
      }),
      clickCount: await db.affiliateClick.count(),
      clickVendorCount: await db.affiliateClick.count({ where: { vendorId: vendor.id } }),
      clickConvertedGlobalCount: await db.affiliateClick.count({
        where: { convertedAt: { not: null } },
      }),
      clickUnconvertedGlobalCount: await db.affiliateClick.count({
        where: { convertedAt: null },
      }),
      clickConvertedVendorCount: await db.affiliateClick.count({
        where: { vendorId: vendor.id, convertedAt: { not: null } },
      }),
      clickUnconvertedVendorCount: await db.affiliateClick.count({
        where: { vendorId: vendor.id, convertedAt: null },
      }),
      clickPerAffiliateCounts: await Promise.all(
        affiliates.map(async (affiliate) => ({
          affiliateId: affiliate.id,
          total: await db.affiliateClick.count({ where: { affiliateId: affiliate.id } }),
          converted: await db.affiliateClick.count({
            where: { affiliateId: affiliate.id, convertedAt: { not: null } },
          }),
          unconverted: await db.affiliateClick.count({
            where: { affiliateId: affiliate.id, convertedAt: null },
          }),
        })),
      ),
      clickComposites: await Promise.all(
        clicks.map((click) =>
          db.affiliateClick.count({
            where: {
              id: click.id,
              vendorId: vendor.id,
              affiliateId: click.affiliateId,
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
    });
    const before = await snapshot();
    const canaries = [
      ...affiliates.flatMap((affiliate) => [
        affiliate.id,
        affiliate.name,
        affiliate.code,
        affiliate.source ?? "",
        affiliate.contactEmail ?? "",
      ]),
      ...clicks.flatMap((click) => [
        click.id,
        click.referralCode,
        click.visitorId,
        click.landingPath,
      ]),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const deniedDashboardCanaries = [
      ...affiliates.flatMap((affiliate) => [
        affiliate.id,
        affiliate.source ?? "",
        affiliate.contactEmail ?? "",
      ]),
      ...clicks.flatMap((click) => [
        click.id,
        click.referralCode,
        click.visitorId,
        click.landingPath,
      ]),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    const posts: string[] = [];
    const external: string[] = [];
    const invalid: string[] = [];
    const path = "/affiliates/new";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
      if (url.hostname.endsWith(".invalid")) invalid.push(request.url());
    });
    await page.route("**/affiliates/new", async (route) => {
      if (new URL(route.request().url()).pathname !== path) {
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
      (response) => new URL(response.url()).pathname === path && response.status() === 307,
    );
    const finalResponse = await page.goto(path);
    const redirectResponse = await rawRedirect;

    expect(redirectResponse.status()).toBe(307);
    expect(redirectResponse.headers().location).toBe("/dashboard?error=insufficient_role");
    expect(intercepted.current).toBeDefined();
    expect(intercepted.current?.status).toBe(307);
    expect(intercepted.current?.location).toBe("/dashboard?error=insufficient_role");
    for (const canary of canaries) expect(intercepted.current?.body).not.toContain(canary);
    expect(intercepted.current?.body).not.toContain(".invalid");
    expect(intercepted.current?.body).not.toContain("新增聯盟夥伴");
    expect(intercepted.current?.body).not.toContain("建立推廣碼與來源設定，前台會記錄 ref 來源。");

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "聯盟來源摘要", exact: true })).toBeVisible();
    for (const affiliate of affiliates) {
      await expect(page.getByText(affiliate.name, { exact: true })).toBeVisible();
      await expect(page.getByText(affiliate.code, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "新增聯盟夥伴", exact: true })).toHaveCount(0);
    await expect(page.getByText("建立推廣碼與來源設定，前台會記錄 ref 來源。", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "聯盟夥伴", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/affiliates"]')).toHaveCount(0);
    await expect(page.locator('a[href="/affiliates/new"]')).toHaveCount(0);

    const targetAffiliateForm = page.locator(
      'form:has([name="code"]):has([name="commissionRateBps"]):has([name="contactEmail"])',
    );
    await expect(targetAffiliateForm).toHaveCount(0);
    for (const field of ["_csrf", "id", "name"]) {
      await expect(targetAffiliateForm.locator(`[name="${field}"]`)).toHaveCount(0);
    }
    for (const field of ["code", "source", "contactEmail", "commissionRateBps", "isActive"]) {
      await expect(page.locator(`[name="${field}"]`)).toHaveCount(0);
    }
    for (const label of [
      "夥伴名稱",
      "推廣碼",
      "來源渠道",
      "聯絡 Email",
      "佣金 BPS",
      "啟用推廣碼",
    ]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    for (const canary of deniedDashboardCanaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }
    for (const affiliate of affiliates) {
      await expect(page.locator(`a[href="/affiliates/${affiliate.id}"]`)).toHaveCount(0);
      await expect(page.locator(`a[href="/affiliates/${affiliate.id}/edit"]`)).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    expect(invalid).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
