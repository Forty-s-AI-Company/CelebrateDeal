import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPasswordAsync } from "../../src/lib/password";

const db = new PrismaClient();
const suffix = `${Date.now().toString(36)}-${process.pid}`;
const password = "Affiliate-test-1234";
const fixture = {
  userId: "",
  vendorId: "",
  affiliateId: "",
  payoutId: "",
  foreignUserId: "",
  foreignVendorId: "",
  foreignPayoutId: "",
  email: `affiliate-${suffix}@example.test`,
  code: `PORTAL${suffix.replace(/[^a-z0-9]/gi, "").toUpperCase()}`.slice(0, 70),
};

test.beforeAll(async () => {
  const passwordHash = await hashPasswordAsync(password);
  const vendor = await db.vendor.create({
    data: { name: "Portal 測試商家", slug: `portal-${suffix}`, email: `vendor-${suffix}@example.test`, passwordHash },
  });
  const user = await db.user.create({ data: { name: "Portal 推廣者", email: fixture.email, passwordHash } });
  const affiliate = await db.affiliate.create({
    data: { vendorId: vendor.id, userId: user.id, name: "Portal 推廣者", code: fixture.code, contactEmail: fixture.email, commissionRateBps: 1_000 },
  });
  await db.affiliateClick.createMany({
    data: [
      { vendorId: vendor.id, affiliateId: affiliate.id, referralCode: affiliate.code, visitorId: `v1-${suffix}`, landingPath: "/live/demo" },
      { vendorId: vendor.id, affiliateId: affiliate.id, referralCode: affiliate.code, visitorId: `v2-${suffix}`, landingPath: "/live/demo" },
    ],
  });
  await db.affiliateCommission.create({
    data: {
      vendorId: vendor.id,
      affiliateId: affiliate.id,
      monthKey: "2026-09",
      sourceType: "product",
      sourceId: `order-${suffix}`,
      deduplicationKey: `portal:${suffix}`,
      referralCode: affiliate.code,
      orderNumber: `ORDER-${suffix}`,
      orderAmountCents: 12_000,
      commissionBaseAmountCents: 12_000,
      netReferenceAmountCents: 12_000,
      commissionRateBps: 1_000,
      commissionAmountCents: 1_200,
      status: "locked",
    },
  });
  const payout = await db.affiliatePayout.create({
    data: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-09", commissionAmountCents: 1_200, finalAmountCents: 1_200, status: "pending" },
  });

  const foreignVendor = await db.vendor.create({
    data: { name: "Foreign Portal 商家", slug: `foreign-portal-${suffix}`, email: `foreign-vendor-${suffix}@example.test`, passwordHash },
  });
  const foreignUser = await db.user.create({ data: { name: "Foreign 推廣者", email: `foreign-affiliate-${suffix}@example.test`, passwordHash } });
  const foreignAffiliate = await db.affiliate.create({
    data: { vendorId: foreignVendor.id, userId: foreignUser.id, name: "Foreign 推廣者", code: `FOREIGN${fixture.code}`.slice(0, 78), commissionRateBps: 500 },
  });
  const foreignPayout = await db.affiliatePayout.create({
    data: { vendorId: foreignVendor.id, affiliateId: foreignAffiliate.id, monthKey: "2026-09", commissionAmountCents: 999, finalAmountCents: 999, status: "pending" },
  });

  Object.assign(fixture, {
    userId: user.id,
    vendorId: vendor.id,
    affiliateId: affiliate.id,
    payoutId: payout.id,
    foreignUserId: foreignUser.id,
    foreignVendorId: foreignVendor.id,
    foreignPayoutId: foreignPayout.id,
  });
});

test.afterAll(async () => {
  if (fixture.vendorId) await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  if (fixture.foreignVendorId) await db.vendor.deleteMany({ where: { id: fixture.foreignVendorId } });
  if (fixture.userId) await db.user.deleteMany({ where: { id: fixture.userId } });
  if (fixture.foreignUserId) await db.user.deleteMany({ where: { id: fixture.foreignUserId } });
  await db.$disconnect();
});

test("promoter can use the isolated dashboard, bank binding, and payout request", async ({ page, context }) => {
  // Production-mode Server Actions can compile cold on Windows; keep the
  // end-to-end flow bounded without shortening any interaction assertions.
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/affiliate-portal/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByLabel("推廣碼").fill(fixture.code.toLowerCase());
  await page.getByRole("button", { name: "登入工作台" }).click();

  await expect(page).toHaveURL(/\/affiliate-portal$/);
  await expect(page.getByRole("heading", { name: "嗨，Portal 推廣者" })).toBeVisible();
  await expect(page.getByText("即時點擊數").locator("..").getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByText("轉換訂單數").locator("..").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("總帶貨金額").locator("..").getByText("$120", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "一鍵複製" }).click();
  await expect(page.getByRole("button", { name: "已複製" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/r/${fixture.code}`);

  await page.getByLabel("戶名").fill("測試推廣者");
  await page.getByLabel("銀行代碼").fill("812");
  await page.getByLabel("帳號").fill("123456789012");
  await page.getByRole("button", { name: "綁定銀行帳戶" }).click();
  await expect(page.getByText("銀行帳戶已安全儲存。", { exact: true })).toBeVisible();
  await expect(page.getByText(/已綁定：812 \/ \*\*\*\*9012/)).toBeVisible();

  const payoutForm = page.locator('form:has(input[name="payoutId"])');
  await payoutForm.locator('input[name="payoutId"]').evaluate((input, foreignId) => {
    (input as HTMLInputElement).value = foreignId;
  }, fixture.foreignPayoutId);
  await payoutForm.getByRole("button", { name: "一鍵申請提領" }).click();
  await expect(page.getByText("資料無法送出，請檢查後再試。", { exact: true })).toBeVisible();
  expect((await db.affiliatePayout.findUniqueOrThrow({ where: { id: fixture.foreignPayoutId } })).requestedAt).toBeNull();

  await page.getByRole("button", { name: "一鍵申請提領" }).click();
  await expect(page.getByText("提領申請已送出。", { exact: true })).toBeVisible();
  const requested = await db.affiliatePayout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  expect(requested.requestedAt).not.toBeNull();
  expect(requested.requestedBankAccountEncrypted).toMatch(/^v2\./);
});
