import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "ComprehensiveQA123!";
const stamp = Date.now();
const seed = {
  vendorOwnerEmail: `qa-owner-${stamp}@example.test`,
  affiliateEmail: `qa-affiliate-${stamp}@example.test`,
  vendorSlug: `qa-vendor-${stamp}`,
  vendorId: "",
  ownerId: "",
  affiliateUserId: "",
  planId: "",
};

function assertDisposableDatabase(): void {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required for comprehensive QA");
  const databaseUrl = new URL(rawUrl);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname);
  if (!isLocal) {
    throw new Error("Comprehensive QA refuses to mutate a non-local database");
  }
}

test.beforeAll(async () => {
  assertDisposableDatabase();
  const plan = await db.billingPlan.create({
    data: {
      name: "QA Plan",
      code: `qa-plan-${stamp}`,
      includedEvents: 100,
    },
  });
  seed.planId = plan.id;
  
  const owner = await db.user.create({
    data: {
      email: seed.vendorOwnerEmail,
      name: "QA Vendor Owner",
      passwordHash: hashPassword(password),
      status: "active",
    },
  });
  seed.ownerId = owner.id;

  const affiliateUser = await db.user.create({
    data: {
      email: seed.affiliateEmail,
      name: "QA Affiliate",
      passwordHash: hashPassword(password),
      status: "active",
    },
  });
  seed.affiliateUserId = affiliateUser.id;

  const vendor = await db.vendor.create({
    data: {
      name: "QA 測試品牌",
      slug: seed.vendorSlug,
      email: seed.vendorOwnerEmail,
      passwordHash: "test",
      onboardingStatus: "completed",
      onboardingCompletedAt: new Date(),
      members: { create: { userId: owner.id, role: "owner" } },
      subscriptions: { create: { planId: plan.id, status: "active" } },
      usageLimit: {
        create: {
          billingPlanId: plan.id,
          resetAt: new Date(Date.now() + 86_400_000),
        },
      },
    },
  });
  seed.vendorId = vendor.id;

  await db.affiliate.create({
    data: {
      vendorId: vendor.id,
      name: "QA 推廣者",
      contactEmail: seed.affiliateEmail,
      code: `QA-CODE-${stamp}`,
      isActive: true,
      commissionRateBps: 1000,
    },
  });

});

test.afterAll(async () => {
  if (seed.vendorId) {
    await db.affiliate.deleteMany({ where: { vendorId: seed.vendorId } });
    await db.vendor.deleteMany({ where: { id: seed.vendorId } });
  }
  if (seed.ownerId) await db.user.deleteMany({ where: { id: seed.ownerId } });
  if (seed.affiliateUserId) await db.user.deleteMany({ where: { id: seed.affiliateUserId } });
  if (seed.planId) await db.billingPlan.deleteMany({ where: { id: seed.planId } });
  await db.$disconnect();
});

test("QA Matrix: Suspended vendor owner cannot access dashboard", async ({ page }) => {
  await db.user.update({
    where: { id: seed.ownerId },
    data: { status: "suspended" },
  });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(seed.vendorOwnerEmail);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page.getByText(/停權/)).toBeVisible({ timeout: 10000 });
  } finally {
    await db.user.update({
      where: { id: seed.ownerId },
      data: { status: "active" },
    });
  }
});

test("QA Matrix: Unknown route returns 404 cleanly", async ({ page }) => {
  const response = await page.goto("/some-unknown-route-that-does-not-exist");
  expect(response?.status()).toBe(404);
});
