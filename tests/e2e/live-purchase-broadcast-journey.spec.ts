import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition, reconcileCommerceOrderRefund } from "../../src/lib/commerce-orders";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);
test("actual live purchase panel shows only server-attributed paid purchases and removes a canonical refund", async ({ page, baseURL }) => {
  const db = new PrismaClient({ log: [] });
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "合成廣播工作室", slug: `broadcast-ui-${suffix}`,
    email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  try {
    const product = await db.product.create({ data: { vendorId: vendor.id, name: "本場瀏覽器合成商品", slug: `broadcast-product-${suffix}`,
      priceCents: 1200, isActive: true, fulfillmentTypeConfirmed: true, fulfillmentType: "physical", commerceDomain: "merchant" } });
    const video = await db.video.create({ data: { vendorId: vendor.id, title: "合成廣播影片", videoUrl: "https://video.example.test/broadcast.mp4",
      sourceType: "url", status: "ready", durationSec: 600 } });
    const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "合成表單", slug: `broadcast-form-${suffix}`,
      headline: "合成報名", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
    const template = await db.messageTemplate.create({ data: { vendorId: vendor.id, name: "合成確認", channel: "email",
      trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} {{unsubscribe_url}}", isActive: true } });
    const script = await db.interactionScript.create({ data: { vendorId: vendor.id, name: "合成商品流程", status: "published",
      events: { create: { eventType: "product_spotlight", triggerSec: 0, title: "本場商品", productId: product.id } } } });
    const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, formId: form.id, messageTemplateId: template.id,
      interactionScriptId: script.id, title: "合成廣播場次", slug: `broadcast-live-${suffix}`, scheduledAt: new Date(Date.now() - 30_000),
      status: "live", streamMode: "vod", replayEnabled: true, products: { create: { productId: product.id, isPinned: true } } } });
    async function paidOrder(sourceLiveId: string) {
      const identity = randomUUID(), now = new Date();
      return db.$transaction(async tx => {
        // Internal synthetic reconciliation only; no payment provider is called.
        const payment = await tx.paymentTransaction.create({ data: { vendorId: vendor.id, providerName: "synthetic", status: "paid",
          grossAmountCents: 1200, netAmountCents: 1200, metadata: { productId: product.id, sourceLiveId } } });
        const order = await createCommerceOrderForCheckout(tx, { vendorId: vendor.id, productId: product.id, paymentTransactionId: payment.id,
          orderNumber: `BROADCAST-${identity}`, checkoutIdempotencyKey: identity, totalAmountCents: 1200, currency: "TWD", now,
          buyer: { name: "合成買家", email: `${identity}@example.test`, phone: "0912345678" },
          shipping: { recipientName: "合成買家", phone: "0912345678", countryCode: "TW", postalCode: "100",
            administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" } });
        await reconcileCommerceOrderPaymentTransition(tx, { vendorId: vendor.id, paymentTransactionId: payment.id,
          eventIdentity: identity, transition: "paid", occurredAt: now });
        return { order, payment };
      });
    }
    const accepted = await paidOrder(live.id);
    await paidOrder(`other-live-${suffix}`);
    await page.route("https://video.example.test/**", route => route.abort());
    const admitted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/live-admission" && response.request().method() === "POST");
    await page.goto(`/live/${live.slug}`);
    expect((await admitted).status()).toBe(200);
    const panel = page.getByRole("complementary", { name: "本場近期購買" });
    await expect(panel.getByText(`購買了 ${product.name}`, { exact: true })).toBeVisible();
    await expect(panel.locator("li")).toHaveCount(1);
    expect(await panel.textContent()).not.toContain("合成買家");
    const read = await page.request.get(`/api/live-purchase-broadcasts?${new URLSearchParams({ vendorId: vendor.id, liveId: live.id })}`,
      { headers: { origin: baseURL!, "x-celebratedeal-client": "web" } });
    expect(read.status()).toBe(200);
    const payload = await read.text();
    expect(payload).not.toContain(accepted.order.id);
    expect(payload).not.toContain(accepted.payment.id);
    await db.$transaction(tx => reconcileCommerceOrderRefund(tx, { vendorId: vendor.id, orderId: accepted.order.id,
      paymentTransactionId: accepted.payment.id, providerName: "synthetic", eventIdentity: randomUUID(), amountCents: 100, occurredAt: new Date() }));
    await page.reload();
    await expect(panel.getByText("目前沒有近期購買紀錄。", { exact: true })).toBeVisible();
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: accepted.order.id } })).toMatchObject({ status: "partially_refunded", refundedAmountCents: 100 });
  } finally {
    await db.vendor.delete({ where: { id: vendor.id } });
    await db.$disconnect();
  }
});
