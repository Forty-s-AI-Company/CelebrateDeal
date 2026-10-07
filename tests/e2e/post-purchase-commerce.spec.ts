import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { createReservedPaymentTransaction } from "../../src/lib/inventory-reservations";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition, reconcileCommerceOrderRefund } from "../../src/lib/commerce-orders";
import { issueBuyerSupportGrant } from "../../src/lib/buyer-support-access";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);
test("merchant configures offers; buyer declines, upgrades once, resumes and loses recovery after source refund", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient({ log: [] }); const suffix = randomUUID();
  const password = "SyntheticPostPurchaseManager!";
  const vendor = await db.vendor.create({ data: { name: "合成加購商家", slug: `ppu-browser-${suffix}`,
    email: `${suffix}@example.test`, passwordHash: hashPassword(password) } });
  const user = await db.user.create({ data: { name: "合成商家管理員", email: `manager-${suffix}@example.test`,
    passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "admin", status: "active" } } } });
  const buyerContext = await browser.newContext(); const anonymousContext = await browser.newContext();
  const stage = (name: string) => test.info().annotations.push({ type: "post-purchase-stage", description: name });
  try {
    stage("fixture");
    const source = await db.product.create({ data: { vendorId: vendor.id, name: "合成原商品", slug: `source-${suffix}`,
      priceCents: 10000, inventory: 1, fulfillmentTypeConfirmed: true } });
    const target = await db.product.create({ data: { vendorId: vendor.id, name: "合成升級商品", slug: `target-${suffix}`,
      priceCents: 20000, inventory: 3, fulfillmentTypeConfirmed: true } });
    const alternative = await db.product.create({ data: { vendorId: vendor.id, name: "合成備選商品", slug: `alternative-${suffix}`,
      priceCents: 15000, inventory: 3, fulfillmentTypeConfirmed: true } });
    stage("merchant-login");
    await page.goto("/login"); await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password); await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    stage("merchant-config");
    await page.goto(`/products/${source.id}/edit`);
    stage("merchant-form-loaded");
    // Wrapped native labels include option text; select the actual named
    // controls rather than requiring an exact concatenated label string.
    await page.locator('select[name="upsellProductId"]').selectOption(target.id);
    await page.locator('select[name="downsellProductId"]').selectOption(alternative.id);
    await page.getByLabel("加購額外折扣（元）").fill("5");
    stage("merchant-form-filled");
    // Surface native validation failures without retaining field values.
    expect(await page.locator("form").evaluateAll(forms => forms.every(form => (form as HTMLFormElement).checkValidity()))).toBe(true);
    await page.locator('button[type="submit"]').last().click();
    stage("merchant-form-submitted");
    await expect(page).toHaveURL(/\/products\?updated=saved$/);
    const configured = await db.product.findUniqueOrThrow({ where: { id: source.id } });
    expect([configured.upsellProductId, configured.downsellProductId, configured.upsellDiscountCents]).toEqual([target.id, alternative.id, 500]);
    // A configured target can become unavailable independently. Editing a
    // description must keep its selection and immutable policy fields.
    await db.product.update({ where: { id: target.id }, data: { isActive: false } });
    await page.goto(`/products/${source.id}/edit`);
    await expect(page.locator('select[name="upsellProductId"]')).toHaveValue(target.id);
    await expect(page.locator('select[name="downsellProductId"]')).toHaveValue(alternative.id);
    await expect(page.locator('input[name="upsellDiscount"]')).toHaveValue("5");
    await page.getByLabel("商品描述", { exact: true }).fill("合成描述更新，保留既有加購設定");
    await page.locator('button[type="submit"]').last().click();
    await expect(page).toHaveURL(/\/products\?updated=saved$/);
    const retained = await db.product.findUniqueOrThrow({ where: { id: source.id } });
    expect([retained.upsellProductId, retained.downsellProductId, retained.upsellDiscountCents]).toEqual([target.id, alternative.id, 500]);
    await db.product.update({ where: { id: target.id }, data: { isActive: true } });
    stage("settled-source-handoff");
    const buyer = { name: "合成買家", email: `buyer-${suffix}@example.test`, phone: "0912345678" };
    const shipping = { recipientName: buyer.name, phone: buyer.phone, countryCode: "TW", postalCode: "106",
      administrativeArea: "Taipei", locality: "Da-an", addressLine1: "Synthetic Road 1" };
    let sourceOrderId = "";
    // Approved exact synthetic paid-source handoff, using canonical settlement.
    // This fixture never contacts a real payment or refund provider.
    const payment = await createReservedPaymentTransaction({ vendorId: vendor.id, productId: source.id,
      expectedProductRevision: retained.revision, checkoutIdempotencyKey: randomUUID(),
      transactionData: { vendorId: vendor.id, providerName: "demo", orderNumber: `PPU-BROWSER-${suffix}`,
        grossAmountCents: 10000, netAmountCents: 10000, currency: "TWD", status: "pending", metadata: { productId: source.id } },
      createCommerceOrder: async (tx, created) => {
        const order = await createCommerceOrderForCheckout(tx, { vendorId: vendor.id, productId: source.id,
          orderNumber: created.orderNumber!, checkoutIdempotencyKey: randomUUID(), paymentTransactionId: created.id,
          totalAmountCents: 10000, currency: "TWD", buyer, shipping }); sourceOrderId = order.id;
      } });
    await db.$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: vendor.id,
      paymentTransactionId: payment.id, transition: "paid", eventIdentity: randomUUID() }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const cookie = await issueBuyerSupportGrant(db, { vendorId: vendor.id, orderId: sourceOrderId, request: new Request(baseURL!) });
    await buyerContext.addCookies([{ name: cookie.name, value: cookie.value, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    const grant = await db.buyerSupportOrderGrant.findUniqueOrThrow({ where: { vendorId_orderId: { vendorId: vendor.id, orderId: sourceOrderId } } });
    const viewer = await buyerContext.newPage(); const anonymous = await anonymousContext.newPage();
    viewer.on("response", response => {
      if (new URL(response.url()).pathname === "/checkout/offer") test.info().annotations.push({
        type: "post-purchase-offer-http-status", description: String(response.status()),
      });
    });
    const offerPath = `/checkout/upsell?grant=${grant.id}`;
    stage("anonymous-isolation");
    const anonymousStatus = (await anonymous.goto(offerPath))?.status();
    test.info().annotations.push({ type: "post-purchase-http-status", description: String(anonymousStatus) });
    expect(anonymousStatus).toBe(404);
    stage("buyer-decline");
    await viewer.goto("/checkout/result"); await viewer.getByRole("link", { name: "查看購買後加購 →", exact: true }).click();
    await expect(viewer).toHaveURL(url => url.origin === new URL(baseURL!).origin && url.pathname === "/checkout/offer");
    await expect(viewer.getByRole("heading", { name: target.name })).toBeVisible();
    await viewer.getByRole("button", { name: "暫時不用", exact: true }).click();
    await expect(viewer.getByRole("heading", { name: alternative.name })).toBeVisible();
    stage("buyer-accept");
    await viewer.goto(offerPath); await viewer.getByRole("button", { name: "確認加購，前往結帳", exact: true }).click();
    await expect(viewer).toHaveURL(new RegExp(`/checkout/${vendor.id}/${target.id}\\?`));
    stage("checkout-submit");
    for (const [name, value] of Object.entries({ buyerName: buyer.name, buyerEmail: buyer.email, buyerPhone: buyer.phone,
      recipientName: buyer.name, shippingPhone: buyer.phone, postalCode: "106", administrativeArea: "Taipei", locality: "Da-an", addressLine1: "Synthetic Road 1" })) {
      await viewer.locator(`input[name="${name}"]`).fill(value);
    }
    await viewer.locator('input[name="policyAcknowledgement"]').check();
    // Admission confirms the signed net amount before the second submit creates an order.
    await viewer.locator('button[type="submit"]').last().click();
    await expect(viewer.getByRole("button", { name: "確認優惠並前往付款", exact: true })).toBeVisible();
    const checkoutResponse = viewer.waitForResponse(response => response.url().endsWith("/api/payments/checkout") && response.request().method() === "POST");
    await viewer.locator('button[type="submit"]').last().click(); expect((await checkoutResponse).status()).toBe(200);
    await expect(viewer.getByRole("status")).toContainText("已建立");
    const credit = await db.postPurchaseCredit.findUniqueOrThrow({ where: { vendorId_sourceOrderId: { vendorId: vendor.id, sourceOrderId } } });
    expect(credit.checkoutAmountCents).toBe(9500); expect(credit.creditAmountCents).toBe(10000);
    expect((await db.commerceOrder.findUniqueOrThrow({ where: { id: credit.targetOrderId } })).totalAmountCents).toBe(9500);
    stage("pending-recovery");
    await viewer.reload(); await expect(viewer.getByText("已找到原本的待付款訂單。", { exact: false })).toBeVisible();
    expect(await db.postPurchaseCredit.count({ where: { vendorId: vendor.id } })).toBe(1);
    stage("source-refund");
    await db.$transaction(tx => reconcileCommerceOrderRefund(tx, { vendorId: vendor.id, orderId: sourceOrderId,
      providerName: "demo", eventIdentity: randomUUID(), amountCents: 1000, occurredAt: new Date() }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await viewer.reload(); await expect(viewer.getByText("原結帳請求已結束。", { exact: false })).toBeVisible();
    expect((await db.postPurchaseCredit.findUniqueOrThrow({ where: { id: credit.id } })).invalidatedAt).not.toBeNull();
    expect((await db.shippingFulfillment.findFirstOrThrow({ where: { vendorId: vendor.id, orderItem: { orderId: credit.targetOrderId } } })).status).toBe("cancelled");
  } finally {
    await buyerContext.close(); await anonymousContext.close();
    await db.postPurchaseCredit.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendor.delete({ where: { id: vendor.id } }); await db.user.delete({ where: { id: user.id } }); await db.$disconnect();
  }
});
