import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import type { VendorFeatureModule } from "../../src/lib/vendor-feature-toggles";

const db = new PrismaClient();
const password = "Wp88SyntheticPassword!";
const workspaceRoot = process.cwd();

// This is deliberately a guard-family matrix rather than another collection
// of one-route runners. Every protected page must declare one of these shared
// guards; the browser cases below exercise each resulting authorization
// contract with synthetic users only.
const guardFamilies = {
  vendorContext: ["requireVendorContext(", "requireVendor("],
  vendorManagerMfa: ["requireVendorManagerMfa("],
  vendorSupportMfa: ["requireVendorSupportMfa("],
  vendorOwner: ["requireVendorOwner("],
  vendorManager: ["requireVendorManager("],
  vendorManagerContext: ["requireVendorManagerContext("],
  vendorFinance: ["requireVendorFinance(", "requireVendorOwnerFinance("],
  authenticated: ["requireAuth("],
  platformFinance: ["requireFinanceAdmin("],
} as const;

// Exact reviewed paths also catch a page being replaced without changing family counts.
const expectedGuardInventory = {
  "(app)/affiliates/[id]/edit/page.tsx": "vendorManager",
  "(app)/affiliates/[id]/page.tsx": "vendorManager",
  "(app)/affiliates/commissions/[id]/page.tsx": "vendorFinance",
  "(app)/affiliates/commissions/page.tsx": "vendorFinance",
  "(app)/affiliates/new/page.tsx": "vendorManager",
  "(app)/affiliates/page.tsx": "vendorManager",
  "(app)/billing/course-payouts/[id]/page.tsx": "vendorFinance",
  "(app)/billing/course-payouts/page.tsx": "vendorFinance",
  "(app)/billing/electronic-invoices/page.tsx": "vendorFinance",
  "(app)/billing/invoices/[invoiceId]/page.tsx": "vendorFinance",
  "(app)/billing/invoices/page.tsx": "vendorFinance",
  "(app)/billing/payment-methods/page.tsx": "vendorFinance",
  "(app)/billing/payouts/page.tsx": "vendorFinance",
  "(app)/billing/plans/page.tsx": "vendorFinance",
  "(app)/billing/settlements/page.tsx": "vendorFinance",
  "(app)/billing/usage/page.tsx": "vendorFinance",
  "(app)/blacklists/page.tsx": "vendorManager",
  "(app)/consultations/mobile/page.tsx": "vendorManager",
  "(app)/consultations/page.tsx": "vendorManager",
  "(app)/customers/[id]/page.tsx": "vendorManager",
  "(app)/customers/page.tsx": "vendorManager",
  "(app)/dashboard/page.tsx": "vendorContext",
  "(app)/forms/[id]/edit/page.tsx": "vendorManager",
  "(app)/forms/[id]/submissions/page.tsx": "vendorManager",
  "(app)/forms/new/page.tsx": "vendorManager",
  "(app)/forms/page.tsx": "vendorManager",
  "(app)/interaction-roles/[id]/edit/page.tsx": "vendorManager",
  "(app)/interaction-roles/new/page.tsx": "vendorManager",
  "(app)/interaction-roles/page.tsx": "vendorManager",
  "(app)/interaction-scripts/[id]/edit/page.tsx": "vendorManager",
  "(app)/interaction-scripts/new/page.tsx": "vendorManager",
  "(app)/interaction-scripts/page.tsx": "vendorManager",
  "(app)/lives/[id]/analytics/page.tsx": "vendorManager",
  "(app)/lives/[id]/edit/page.tsx": "vendorManager",
  "(app)/lives/[id]/preview/page.tsx": "vendorManager",
  "(app)/lives/new/page.tsx": "vendorManager",
  "(app)/lives/page.tsx": "vendorManager",
  "(app)/messages/deliveries/page.tsx": "vendorManager",
  "(app)/messages/templates/[id]/edit/page.tsx": "vendorManager",
  "(app)/messages/templates/[id]/preview/page.tsx": "vendorManager",
  "(app)/messages/templates/new/page.tsx": "vendorManager",
  "(app)/messages/templates/page.tsx": "vendorManager",
  "(app)/onboarding/page.tsx": "vendorManager",
  "(app)/orders/[id]/page.tsx": "vendorManagerMfa",
  "(app)/orders/page.tsx": "vendorManagerMfa",
  "(app)/partner-pages/[id]/edit/page.tsx": "vendorContext",
  "(app)/partner-pages/page.tsx": "vendorContext",
  "(app)/products/[id]/edit/page.tsx": "vendorManager",
  "(app)/products/[id]/preview/page.tsx": "vendorManager",
  "(app)/products/new/page.tsx": "vendorManager",
  "(app)/products/page.tsx": "vendorManager",
  "(app)/settings/automations/page.tsx": "vendorOwner",
  "(app)/settings/brand/page.tsx": "vendorManager",
  "(app)/settings/commissions/page.tsx": "vendorOwner",
  "(app)/settings/features/page.tsx": "vendorManagerContext",
  "(app)/settings/line/page.tsx": "vendorOwner",
  "(app)/settings/security/page.tsx": "authenticated",
  "(app)/settings/team/page.tsx": "vendorOwner",
  "(app)/settings/tracking/page.tsx": "vendorManager",
  "(app)/support-cases/[id]/page.tsx": "vendorSupportMfa",
  "(app)/support-cases/page.tsx": "vendorSupportMfa",
  "(app)/team-performance/page.tsx": "vendorContext",
  "(app)/team-templates/[id]/edit/page.tsx": "vendorContext",
  "(app)/team-templates/new/page.tsx": "vendorContext",
  "(app)/team-templates/page.tsx": "vendorContext",
  "(app)/videos/[id]/edit/page.tsx": "vendorManager",
  "(app)/videos/[id]/preview/page.tsx": "vendorManager",
  "(app)/videos/new/page.tsx": "vendorManager",
  "(app)/videos/page.tsx": "vendorManager",
  "admin/billing/course-payouts/page.tsx": "platformFinance",
  "admin/billing/dashboard/page.tsx": "platformFinance",
  "admin/billing/payouts/page.tsx": "platformFinance",
  "admin/billing/platform-referral-payouts/page.tsx": "platformFinance",
  "admin/billing/refund-reconciliation/[id]/page.tsx": "platformFinance",
  "admin/billing/settlements/page.tsx": "platformFinance",
  "admin/billing/stream-reconciliation/page.tsx": "platformFinance",
  "admin/billing/webhooks/[id]/page.tsx": "platformFinance",
  "admin/billing/webhooks/page.tsx": "platformFinance",
  "admin/cloudflare/videos/page.tsx": "platformFinance",
  "admin/support-cases/[id]/page.tsx": "platformFinance",
  "admin/support-cases/page.tsx": "platformFinance",
} as const;

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);

function pageFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return pageFiles(entryPath);
    return entry.isFile() && entry.name === "page.tsx" ? [entryPath] : [];
  });
}

function guardFor(source: string, sourceFile: string) {
  // Some pages compose `requireAuth` with a stricter vendor guard. Classify
  // those by the strictest guard so one route is counted once, not twice.
  const priority = ["platformFinance", "vendorFinance", "vendorOwner", "vendorSupportMfa", "vendorManagerMfa", "vendorManager", "vendorManagerContext", "vendorContext", "authenticated"] as const;
  const matching = priority.filter((family) => guardFamilies[family].some((call) => source.includes(call)));

  expect(matching, `${sourceFile} 必須明確使用一個共同 authorization guard`).not.toHaveLength(0);
  return matching[0];
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  // Finance-capable accounts may be sent to the mandatory local MFA step
  // immediately after a successful password login. That is still an
  // authenticated session; the test marks only its synthetic session verified
  // before testing a finance route.
  await expect(page).toHaveURL(/\/(?:dashboard|admin\/billing\/dashboard|mfa\/(?:setup|verify))$/);
}

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

test("WP-88 verifies every guarded page belongs to a browser-proven direct-URL guard family", async ({ browser }) => {
  const protectedRoots = [
    path.join(workspaceRoot, "src", "app", "(app)"),
    path.join(workspaceRoot, "src", "app", "admin"),
  ];
  const sourceFiles = protectedRoots.flatMap(pageFiles);
  const familyCounts = Object.fromEntries(Object.keys(guardFamilies).map((family) => [family, 0])) as Record<string, number>;

  const inventory: Record<string, string> = {};
  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(path.join(workspaceRoot, "src", "app"), sourceFile).split(path.sep).join("/");
    const family = guardFor(readFileSync(sourceFile, "utf8"), relativePath);
    familyCounts[family] += 1;
    inventory[relativePath] = family;
  }
  expect(inventory).toEqual(expectedGuardInventory);

  // These counts are intentionally exact. A new protected page must update
  // this matrix, so it cannot silently evade direct-URL review.
  expect(sourceFiles).toHaveLength(81);
  expect(familyCounts).toEqual({
    vendorContext: 7,
    vendorManagerMfa: 2,
    vendorSupportMfa: 2,
    vendorOwner: 4,
    vendorManager: 40,
    vendorManagerContext: 1,
    vendorFinance: 12,
    authenticated: 1,
    platformFinance: 12,
  });

  const suffix = randomUUID().replace(/-/g, "");
  const vendor = await db.vendor.create({
    data: {
      name: `WP88 Guard Matrix ${suffix}`,
      slug: `wp88-guard-${suffix}`,
      email: `wp88-vendor-${suffix}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      // Isolate role checks from feature visibility for this synthetic vendor.
      enabledFeatureModules: ["funnel_builder", "consultation_booking"] satisfies VendorFeatureModule[],
      tracking: { create: {} },
    },
  });
  const [owner, admin, accountant, member, platformAdmin] = await Promise.all([
    db.user.create({ data: { email: `wp88-owner-${suffix}@celebratedeal.test`, name: "WP88 Owner", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } }),
    db.user.create({ data: { email: `wp88-admin-${suffix}@celebratedeal.test`, name: "WP88 Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "admin", status: "active" } } } }),
    db.user.create({ data: { email: `wp88-accountant-${suffix}@celebratedeal.test`, name: "WP88 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } } } }),
    db.user.create({ data: { email: `wp88-member-${suffix}@celebratedeal.test`, name: "WP88 Member", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "member", status: "active" } } } }),
    db.user.create({ data: { email: `wp88-platform-${suffix}@celebratedeal.test`, name: "WP88 Platform Admin", passwordHash: hashPassword(password), platformRole: "platform_admin", status: "active" } }),
  ]);
  const contexts: BrowserContext[] = [];

  const enableSyntheticMfa = async (userId: string) => {
    // The guard only requires an enrolled factor and a verified local session.
    // This marker is synthetic and is never decrypted, logged, or sent out.
    await db.userMfaFactor.create({ data: { userId, secretEncrypted: "wp88-test-only-guard-marker" } });
    await db.userSession.updateMany({ where: { userId, revokedAt: null }, data: { mfaVerifiedAt: new Date() } });
  };

  try {
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    const anonymousPage = await anonymous.newPage();
    for (const protectedPath of ["/dashboard", "/products/new", "/billing/usage", "/team-templates", "/settings/features", "/admin/billing/dashboard"]) {
      await anonymousPage.goto(protectedPath);
      await expect(anonymousPage).toHaveURL(/\/login(?:\?|$)/);
      await expect(anonymousPage.getByRole("button", { name: "登入" })).toBeVisible();
    }

    const publicResponse = await anonymousPage.goto("/login");
    expect(publicResponse?.status()).toBe(200);
    await expect(anonymousPage.getByRole("button", { name: "登入" })).toBeVisible();

    const ownerSession = await signedInPage(browser, owner.email);
    contexts.push(ownerSession.context);
    await enableSyntheticMfa(owner.id);
    await ownerSession.page.goto("/dashboard");
    await expect(ownerSession.page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await ownerSession.page.goto("/team-templates");
    await expect(ownerSession.page.getByRole("heading", { name: "團隊展業" })).toBeVisible();
    await ownerSession.page.goto("/billing/usage");
    await expect(ownerSession.page).toHaveURL(/\/billing\/usage$/);
    await expect(ownerSession.page.getByRole("heading", { name: "用量與扣點" })).toBeVisible();

    const invoiceResponse = await ownerSession.page.goto("/billing/electronic-invoices");
    expect(invoiceResponse?.status()).toBe(200);
    await expect(ownerSession.page.getByRole("heading", { name: "電子發票", exact: true })).toBeVisible();

    const adminSession = await signedInPage(browser, admin.email);
    contexts.push(adminSession.context);
    await adminSession.page.goto("/products/new");
    await expect(adminSession.page).toHaveURL(/\/products\/new$/);
    await expect(adminSession.page.getByRole("heading", { name: "新增商品" })).toBeVisible();

    // The context-returning manager guard is a distinct entry point: prove it
    // grants an admin and rejects both non-manager membership roles below.
    for (const [route, heading] of [
      ["/settings/features", "功能模組管理"],
      ["/consultations", "諮詢預約工作台"],
      ["/consultations/mobile", "今日諮詢"],
      ["/customers", "學員 CRM"],
    ] as const) {
      const response = await adminSession.page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(adminSession.page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    const accountantSession = await signedInPage(browser, accountant.email);
    contexts.push(accountantSession.context);
    await accountantSession.page.goto("/products/new");
    await expect(accountantSession.page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(accountantSession.page.getByRole("heading", { name: "新增商品" })).toHaveCount(0);

    for (const route of ["/settings/features", "/consultations", "/consultations/mobile", "/customers", "/customers/wp88-no-customer"]) {
      await accountantSession.page.goto(route);
      await expect(accountantSession.page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    }

    const memberSession = await signedInPage(browser, member.email);
    contexts.push(memberSession.context);
    await memberSession.page.goto("/billing/usage");
    await expect(memberSession.page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(memberSession.page.getByRole("heading", { name: "用量與扣點" })).toHaveCount(0);

    await memberSession.page.goto("/settings/features");
    await expect(memberSession.page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(memberSession.page.getByRole("heading", { name: "功能模組管理" })).toHaveCount(0);
    await memberSession.page.goto("/billing/electronic-invoices");
    await expect(memberSession.page).toHaveURL(/\/dashboard\?error=insufficient_role$/);

    const platformSession = await signedInPage(browser, platformAdmin.email);
    contexts.push(platformSession.context);
    await enableSyntheticMfa(platformAdmin.id);
    const platformResponse = await platformSession.page.goto("/admin/billing/dashboard");
    await expect(platformSession.page).toHaveURL(/\/admin\/billing\/dashboard$/);
    expect(platformResponse?.status()).toBe(200);
    await expect(platformSession.page.getByRole("heading", { name: "財務總覽" })).toBeVisible();

    await ownerSession.page.goto("/admin/billing/dashboard");
    await expect(ownerSession.page).toHaveURL(/\/dashboard$/);
    await expect(ownerSession.page.getByRole("heading", { name: "財務總覽" })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, admin.id, accountant.id, member.id, platformAdmin.id] } } });
    await db.$disconnect();
  }
});
