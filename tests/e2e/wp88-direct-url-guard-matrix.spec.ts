import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

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
  vendorFinance: ["requireVendorFinance(", "requireVendorOwnerFinance("],
  authenticated: ["requireAuth("],
  platformFinance: ["requireFinanceAdmin("],
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

function guardFor(source: string) {
  // Some pages compose `requireAuth` with a stricter vendor guard. Classify
  // those by the strictest guard so one route is counted once, not twice.
  const priority = ["platformFinance", "vendorFinance", "vendorOwner", "vendorSupportMfa", "vendorManagerMfa", "vendorManager", "vendorContext", "authenticated"] as const;
  const matching = priority.filter((family) => guardFamilies[family].some((call) => source.includes(call)));

  expect(matching, "每一個受保護 page 必須明確使用一個共同 authorization guard").not.toHaveLength(0);
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

  for (const sourceFile of sourceFiles) {
    familyCounts[guardFor(readFileSync(sourceFile, "utf8"))] += 1;
  }

  // These counts are intentionally exact. A new protected page must update
  // this matrix, so it cannot silently evade direct-URL review.
  expect(sourceFiles).toHaveLength(73);
  expect(familyCounts).toEqual({
    vendorContext: 7,
    vendorManagerMfa: 2,
    vendorSupportMfa: 2,
    vendorOwner: 2,
    vendorManager: 36,
    vendorFinance: 11,
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
    for (const protectedPath of ["/dashboard", "/products/new", "/billing/usage", "/team-templates", "/admin/billing/dashboard"]) {
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

    const adminSession = await signedInPage(browser, admin.email);
    contexts.push(adminSession.context);
    await adminSession.page.goto("/products/new");
    await expect(adminSession.page).toHaveURL(/\/products\/new$/);
    await expect(adminSession.page.getByRole("heading", { name: "新增商品" })).toBeVisible();

    const accountantSession = await signedInPage(browser, accountant.email);
    contexts.push(accountantSession.context);
    await accountantSession.page.goto("/products/new");
    await expect(accountantSession.page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(accountantSession.page.getByRole("heading", { name: "新增商品" })).toHaveCount(0);

    const memberSession = await signedInPage(browser, member.email);
    contexts.push(memberSession.context);
    await memberSession.page.goto("/billing/usage");
    await expect(memberSession.page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(memberSession.page.getByRole("heading", { name: "用量與扣點" })).toHaveCount(0);

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
