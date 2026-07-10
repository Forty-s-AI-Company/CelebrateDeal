import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Password12345!";
const stamp = Date.now();
const seed = {
  email: `e2e-${stamp}@celebratedeal.local`,
  vendorSlug: `e2e-vendor-${stamp}`,
  productSlug: `e2e-product-${stamp}`,
  formSlug: `e2e-form-${stamp}`,
  liveSlug: `e2e-live-${stamp}`,
  vendorId: "",
  userId: "",
  productId: "",
  formId: "",
  liveId: "",
};

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: "E2E 測試品牌",
      slug: seed.vendorSlug,
      email: seed.email,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: seed.email,
      name: "E2E Owner",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: {
          vendorId: vendor.id,
          role: "owner",
          status: "active",
        },
      },
    },
  });
  const product = await db.product.create({
    data: {
      vendorId: vendor.id,
      name: "E2E 導購商品",
      slug: seed.productSlug,
      description: "Smoke test product",
      priceCents: 12345,
      currency: "TWD",
      inventory: 10,
      isActive: true,
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "E2E 報名表",
      slug: seed.formSlug,
      headline: "E2E 報名測試",
      description: "用於 smoke test",
      submitLabel: "送出報名",
      successMessage: "E2E 已收到資料",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
      isActive: true,
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      title: "E2E 直播頁",
      slug: seed.liveSlug,
      description: "Smoke live page",
      scheduledAt: new Date(Date.now() + 60_000),
      status: "scheduled",
      accentCopy: "E2E 優惠",
      products: {
        create: [{ productId: product.id, sortOrder: 1, isPinned: true }],
      },
    },
  });

  seed.vendorId = vendor.id;
  seed.userId = user.id;
  seed.productId = product.id;
  seed.formId = form.id;
  seed.liveId = live.id;
});

test.afterAll(async () => {
  if (seed.vendorId) {
    await db.vendor.deleteMany({ where: { id: seed.vendorId } });
  }
  if (seed.userId) {
    await db.user.deleteMany({ where: { id: seed.userId } });
  }
  await db.$disconnect();
});

test("login page renders and accepts seeded owner", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登入直播商務後台" })).toBeVisible();
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("protected vendor and admin pages redirect unauthenticated users", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/admin/billing/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("admin area requires MFA for signed-in finance roles", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/admin/billing/dashboard");
  await expect(page).toHaveURL(/\/mfa\/setup/);
  await expect(page.getByRole("heading", { name: "設定管理員 MFA" })).toBeVisible();
});

test("public live page renders mobile-first commerce surface", async ({ page }) => {
  await page.goto(`/live/${seed.liveSlug}`);
  await expect(page.getByText("E2E 直播頁")).toBeVisible();
  await expect(page.getByText("E2E 測試品牌")).toBeVisible();
  await expect(page.getByRole("button", { name: /商品/ })).toBeVisible();
});

test("public form can submit a lead", async ({ page }) => {
  await page.goto(`/form/${seed.formSlug}`);
  await page.getByLabel("姓名").fill("王小明");
  await page.getByLabel("Email").fill(`lead-${stamp}@example.com`);
  await page.getByRole("button", { name: "送出報名" }).click();
  await expect(page.getByText("E2E 已收到資料")).toBeVisible();
});

test("checkout ignores client amount and uses product price", async ({ request }) => {
  const response = await request.post("/api/payments/checkout", {
    headers: { "X-CelebrateDeal-Client": "web" },
    data: {
      vendorId: seed.vendorId,
      productId: seed.productId,
      amountCents: 1,
      referralCode: "E2E",
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json() as { transactionId: string; amountCents: number };
  expect(body.amountCents).toBe(12345);

  const transaction = await db.paymentTransaction.findUniqueOrThrow({ where: { id: body.transactionId } });
  expect(transaction.grossAmountCents).toBe(12345);
});

test("protected API rejects wrong bearer token", async ({ request }) => {
  const response = await request.post("/api/cloudflare/direct-upload", {
    headers: { Authorization: "Bearer wrong-token" },
    data: {
      vendorId: seed.vendorId,
      title: "Should not be created",
      maxDurationSeconds: 60,
    },
  });
  expect(response.status()).toBe(401);
});
