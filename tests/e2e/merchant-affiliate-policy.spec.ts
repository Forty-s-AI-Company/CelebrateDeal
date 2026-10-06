import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { createReservedPaymentTransaction } from "../../src/lib/inventory-reservations";
import { createCommerceOrderForCheckout } from "../../src/lib/commerce-orders";
import { freezeMerchantAffiliateCheckout } from "../../src/lib/merchant-affiliate-policy-service";
import { PaymentWebhookPayload, processPaymentWebhook } from "../../src/lib/payment-webhooks";
import { formatCurrency } from "../../src/lib/format";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120000);
test("manager publishes tiers; original checkout survives policy edit; partner reads paid/refund net", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient(), suffix = randomUUID(), password = "SyntheticMerchantPolicy!";
  const vendor = await db.vendor.create({ data: { name: "合成階梯商家", slug: `tier-${suffix}`, email: `${suffix}@example.test`, passwordHash: hashPassword(password), enabledFeatureModules: ["affiliate_program"], tracking: { create: {} } } });
  const manager = await db.user.create({ data: { name: "合成政策管理員", email: `manager-${suffix}@example.test`, passwordHash: hashPassword(password), memberships: { create: { vendorId: vendor.id, role: "admin", status: "active" } } } });
  const partner = await db.user.create({ data: { name: "合成階梯夥伴", email: `partner-${suffix}@example.test`, passwordHash: hashPassword(password), memberships: { create: { vendorId: vendor.id, role: "partner", status: "active" } } }, include: { memberships: true } });
  const affiliate = await db.affiliate.create({ data: { vendorId: vendor.id, name: "合成階梯合作", code: suffix.toUpperCase() } });
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "合成階梯商品", slug: suffix, priceCents: 10000, currency: "TWD", inventory: 10, commerceDomain: "merchant", fulfillmentType: "physical" } });
  const staleContext = await browser.newContext(), partnerContext = await browser.newContext();
  const stale = await staleContext.newPage(), partnerPage = await partnerContext.newPage();
  async function login(target: typeof page, email: string) {
    await target.goto(`${baseURL}/login`); await target.getByLabel("Email").fill(email); await target.getByLabel("密碼").fill(password);
    await target.getByRole("button", { name: "登入", exact: true }).click(); await expect(target).toHaveURL(/\/dashboard$/);
  }
  async function checkout() {
    const key = randomUUID();
    return createReservedPaymentTransaction({ vendorId: vendor.id, productId: product.id, checkoutIdempotencyKey: key,
      transactionData: { vendorId: vendor.id, providerName: "demo", orderNumber: key, checkoutIdempotencyKey: key, grossAmountCents: 10000, netAmountCents: 10000, currency: "TWD", status: "pending", metadata: { productId: product.id, referralCode: affiliate.code } },
      createCommerceOrder: async (tx, payment) => {
        const order = await createCommerceOrderForCheckout(tx, { vendorId: vendor.id, productId: product.id, orderNumber: key, checkoutIdempotencyKey: key, paymentTransactionId: payment.id, totalAmountCents: 10000, currency: "TWD", buyer: { name: "合成買家", email: "buyer@example.test", phone: "0912345678" }, shipping: { recipientName: "合成買家", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" } });
        await freezeMerchantAffiliateCheckout(tx, { vendorId: vendor.id, transactionId: payment.id, orderId: order.id, affiliateId: affiliate.id, referralCode: affiliate.code });
      } });
  }
  try {
    for (const context of [page.context(), staleContext, partnerContext]) await context.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
    await login(page, manager.email); await page.goto("/affiliates"); await page.getByRole("link", { name: "佣金政策", exact: true }).click();
    await page.getByLabel("第 1 階結束件數", { exact: true }).fill("1"); await page.getByRole("button", { name: "新增階梯", exact: true }).click();
    await expect(page.getByLabel("第 2 階起始件數", { exact: true })).toHaveValue("2");
    await page.getByLabel("第 2 階直接佣金（%）", { exact: true }).fill("20"); await page.getByRole("button", { name: "發布佣金政策", exact: true }).click();
    await expect(page.getByText("佣金政策已發布；只適用於之後的新結帳。", { exact: true })).toBeVisible();
    await expect.poll(async () => (await db.merchantAffiliatePolicyState.findUniqueOrThrow({ where: { vendorId: vendor.id } })).revision).toBe(1);
    await page.reload(); await expect(page.getByLabel("第 2 階直接佣金（%）", { exact: true })).toHaveValue("20");
    const payments = [await checkout(), await checkout()];
    await login(stale, manager.email); await stale.goto("/affiliates/policy");
    await page.getByLabel("第 2 階直接佣金（%）", { exact: true }).fill("30"); await page.getByRole("button", { name: "發布佣金政策", exact: true }).click();
    await expect.poll(async () => (await db.merchantAffiliatePolicyState.findUniqueOrThrow({ where: { vendorId: vendor.id } })).revision).toBe(2);
    await stale.getByRole("button", { name: "發布佣金政策", exact: true }).click();
    await expect(stale.getByText("政策已由其他人變更，請重新整理後確認最新設定。", { exact: true })).toBeVisible();
    expect(await db.merchantAffiliatePolicy.count({ where: { vendorId: vendor.id } })).toBe(2);
    for (const payment of payments) {
      const payload = PaymentWebhookPayload.parse({ provider: "demo", vendorId: vendor.id, eventId: randomUUID(), orderNumber: payment.orderNumber, eventType: "paid", grossAmountCents: 10000, currency: "TWD", occurredAt: "2026-10-06T01:00:00Z" });
      await processPaymentWebhook(payload); await processPaymentWebhook(payload);
    }
    expect((await db.affiliateCommission.findMany({ where: { vendorId: vendor.id }, orderBy: { commissionAmountCents: "asc" } })).map(item => item.commissionAmountCents)).toEqual([1000, 2000]);
    await page.goto(`/affiliates/${affiliate.id}/access`); await page.getByLabel("授權成員", { exact: true }).selectOption(partner.memberships[0]!.id); await page.getByRole("button", { name: "儲存入口授權", exact: true }).click();
    await expect(page.getByText("夥伴入口授權已儲存。", { exact: true })).toBeVisible();
    await login(partnerPage, partner.email); const statement = `/affiliate-portal/${vendor.slug}/${affiliate.id}`; await partnerPage.goto(statement);
    await expect(partnerPage.locator('[aria-label="佣金帳本淨額"]')).toHaveText(`帳本淨額：${formatCurrency(3000)}`);
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", vendorId: vendor.id, eventId: randomUUID(), orderNumber: payments[1]!.orderNumber, eventType: "partially_refunded", grossAmountCents: 10000, refundAmountCents: 5000, currency: "TWD", occurredAt: "2026-10-06T02:00:00Z" }));
    await partnerPage.reload(); await expect(partnerPage.locator('[aria-label="佣金帳本淨額"]')).toHaveText(`帳本淨額：${formatCurrency(2000)}`);
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", vendorId: vendor.id, eventId: randomUUID(), orderNumber: payments[1]!.orderNumber, eventType: "paid", grossAmountCents: 10000, currency: "TWD", occurredAt: "2026-10-06T03:00:00Z" }));
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: payments[1]!.id } })).status).toBe("partially_refunded");
    await partnerPage.goto("/affiliates/policy"); await expect(partnerPage).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    expect((await db.merchantAffiliateSalesCounter.findUniqueOrThrow({ where: { vendorId_affiliateId: { vendorId: vendor.id, affiliateId: affiliate.id } } })).quantity).toBe(BigInt(2));
    // Two real successive submissions retain controlled policy fields without a reload.
    await page.goto("/affiliates/policy");
    await page.getByRole("button", { name: "新增上線層級", exact: true }).click();
    await page.getByRole("button", { name: "新增商品佣金", exact: true }).click();
    await page.getByLabel("第 1 層佣金（%）", { exact: true }).fill("8");
    await page.getByLabel("佣金商品 1", { exact: true }).selectOption(product.id);
    await page.getByLabel("商品 1 佣金（%）", { exact: true }).fill("12");
    for (const revision of [3, 4]) {
      await page.getByRole("button", { name: "發布佣金政策", exact: true }).click();
      await expect.poll(async () => (await db.merchantAffiliatePolicyState.findUniqueOrThrow({ where: { vendorId: vendor.id } })).revision).toBe(revision);
      await expect(page.getByLabel("第 1 層佣金（%）", { exact: true })).toHaveValue("8");
      await expect(page.getByLabel("佣金商品 1", { exact: true })).toHaveValue(product.id);
      await expect(page.getByLabel("商品 1 佣金（%）", { exact: true })).toHaveValue("12");
    }
    await page.reload();
    await expect(page.getByLabel("第 1 層佣金（%）", { exact: true })).toHaveValue("8");
    await expect(page.getByLabel("商品 1 佣金（%）", { exact: true })).toHaveValue("12");

  } finally { await staleContext.close(); await partnerContext.close(); await db.$disconnect(); }
});
