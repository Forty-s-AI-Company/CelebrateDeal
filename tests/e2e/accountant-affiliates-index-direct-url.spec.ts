import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp61SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied the affiliate operations index without data mutation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp61-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP61 Vendor ${suffix}`,
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
        name: "WP61 Active Accountant",
        passwordHash: hashPassword(password),
        status: "active",
        memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
      },
    }),
    db.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: `WP61 Affiliate ${suffix}`,
        code: `WP61CODE${suffix}`,
        source: `WP61 source ${suffix}`,
        contactEmail: `affiliate-${tag}@celebratedeal.test`,
        commissionRateBps: 4321,
        isActive: true,
      },
    }),
  ]);
  const clicks = await Promise.all([
    db.affiliateClick.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        referralCode: `WP61REF-A-${suffix}`,
        visitorId: `wp61-visitor-a-${suffix}`,
        landingPath: `/wp61/landing-a-${suffix}`,
        convertedAt: new Date("2031-01-01T00:00:00.000Z"),
      },
    }),
    db.affiliateClick.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        referralCode: `WP61REF-B-${suffix}`,
        visitorId: `wp61-visitor-b-${suffix}`,
        landingPath: `/wp61/landing-b-${suffix}`,
      },
    }),
  ]);
  const membership = await db.vendorMember.findUniqueOrThrow({
    where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
  });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const snapshot = async () => ({
      vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
      vendorCount: await db.vendor.count(),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      affiliate: await db.affiliate.findUniqueOrThrow({ where: { id: affiliate.id } }),
      affiliateCount: await db.affiliate.count(),
      affiliateVendorCount: await db.affiliate.count({ where: { vendorId: vendor.id } }),
      clicks: await db.affiliateClick.findMany({
        where: { affiliateId: affiliate.id },
        orderBy: { id: "asc" },
      }),
      clickCount: await db.affiliateClick.count(),
      clickVendorCount: await db.affiliateClick.count({ where: { vendorId: vendor.id } }),
      clickAffiliateCount: await db.affiliateClick.count({ where: { affiliateId: affiliate.id } }),
    });
    const before = await snapshot();
    const rawCanaries = [
      affiliate.name,
      affiliate.code,
      affiliate.source,
      affiliate.contactEmail,
      ...clicks.flatMap((click) => [click.referralCode, click.visitorId, click.landingPath]),
    ].filter((value): value is string => Boolean(value));

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/affiliates";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
    });
    await page.route("**/affiliates", async (route) => {
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

    expect(redirectResponse.headers().location).toBe("/dashboard?error=insufficient_role");
    expect(intercepted.current).toBeDefined();
    expect(intercepted.current?.status).toBe(307);
    expect(intercepted.current?.location).toBe("/dashboard?error=insufficient_role");
    for (const canary of rawCanaries) expect(intercepted.current?.body).not.toContain(canary);
    expect(intercepted.current?.body).not.toContain("43.21%");

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "聯盟夥伴", exact: true })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    for (const header of ["夥伴名稱", "推廣碼", "來源", "狀態", "點擊", "轉換", "轉換率", "佣金比例"]) {
      await expect(page.getByRole("columnheader", { name: header, exact: true })).toHaveCount(0);
    }
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "新增夥伴", exact: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "分潤報表", exact: true })).toHaveCount(0);
    await expect(page.locator(`a[href="/affiliates/${affiliate.id}"]`)).toHaveCount(0);
    for (const canary of [
      affiliate.source,
      affiliate.contactEmail,
      "43.21%",
      ...clicks.flatMap((click) => [click.referralCode, click.visitorId, click.landingPath]),
    ].filter((value): value is string => Boolean(value))) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
