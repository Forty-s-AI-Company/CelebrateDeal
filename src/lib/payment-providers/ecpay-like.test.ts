import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ecpayLikePaymentProvider } from "@/lib/payment-providers/ecpay-like";

const secret = "synthetic-ecpay-secret";
const transaction = { id: "tx-1", orderNumber: "ORDER-1" } as never;

function signedRequest(rawBody: string, header = "x-ecpay-signature") {
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  return new Request("http://127.0.0.1/webhook", { headers: { [header]: signature } });
}

describe("ECPay-like payment provider", () => {
  it("creates a manual checkout handoff with a stable order number", async () => {
    const result = await ecpayLikePaymentProvider.createCheckoutSession!({
      transaction,
      product: {} as never,
      vendor: {} as never,
      appUrl: "http://127.0.0.1:3000",
    });

    expect(result).toEqual({
      provider: "ecpay-like",
      mode: "manual",
      checkoutUrl: null,
      nextAction: "ecpay_like_checkout_adapter_pending",
      formPayload: { orderNumber: "ORDER-1" },
      externalRequired: true,
    });
  });

  it("verifies the primary and fallback signature headers and fails closed", async () => {
    vi.stubEnv("ECPAY_WEBHOOK_SECRET", secret);
    const rawBody = "{\"TradeNo\":\"trade-1\"}";

    await expect(ecpayLikePaymentProvider.verifySignature(signedRequest(rawBody), rawBody)).resolves.toBe(true);
    await expect(ecpayLikePaymentProvider.verifySignature(signedRequest(rawBody, "x-payment-signature"), rawBody)).resolves.toBe(true);
    await expect(ecpayLikePaymentProvider.verifySignature(new Request("http://127.0.0.1"), rawBody)).resolves.toBe(false);
    await expect(ecpayLikePaymentProvider.verifySignature(
      new Request("http://127.0.0.1", { headers: { "x-ecpay-signature": "bad" } }),
      rawBody,
    )).resolves.toBe(false);

    vi.unstubAllEnvs();
    await expect(ecpayLikePaymentProvider.verifySignature(signedRequest(rawBody), rawBody)).resolves.toBe(false);
  });

  it("normalizes paid, partial-refund, failed and refund payloads with decimal cents", async () => {
    const common = {
      MerchantTradeNo: "ORDER-2",
      TradeNo: "trade-2",
      VendorSlug: "vendor-2",
      TradeAmt: "123.45",
      GatewayFee: 1.01,
      PlatformFee: "2.49",
      NetAmount: "119.95",
      RefundAmount: "10.00",
      GatewayFeeRefund: "0.10",
      PlatformFeeRefund: "0.20",
      RefundReason: "customer request",
      ReferralCode: "AFF-2",
      OccurredAt: "2026-07-21T00:00:00.000Z",
    };

    const paid = await ecpayLikePaymentProvider.normalizePayload(JSON.stringify({ ...common, EventId: "evt-paid", EventType: "paid" }));
    expect(paid.payload).toMatchObject({
      provider: "ecpay-like",
      eventId: "evt-paid",
      eventType: "paid",
      grossAmountCents: 12345,
      gatewayFeeCents: 101,
      platformFeeCents: 249,
      netAmountCents: 11995,
      occurredAt: "2026-07-21T00:00:00.000Z",
      metadata: common,
    });
    expect(paid.rawPayload).toEqual(expect.objectContaining(common));

    await expect(ecpayLikePaymentProvider.normalizePayload(JSON.stringify({
      ...common,
      MerchantTradeNo: "ORDER-PARTIAL",
      RtnCode: "Partial refund",
      TradeAmt: "not-a-number",
      GatewayFee: null,
    }))).resolves.toMatchObject({ payload: { eventType: "partially_refunded", grossAmountCents: 0, gatewayFeeCents: 0 } });
    await expect(ecpayLikePaymentProvider.normalizePayload(JSON.stringify({ ...common, RtnCode: "refund completed" }))).resolves.toMatchObject({ payload: { eventType: "refunded" } });
    await expect(ecpayLikePaymentProvider.normalizePayload(JSON.stringify({ ...common, RtnCode: "failed" }))).resolves.toMatchObject({ payload: { eventType: "failed" } });
  });

  it("uses fallback identifiers and omits optional fields when absent", async () => {
    const result = await ecpayLikePaymentProvider.normalizePayload(JSON.stringify({
      EventId: "evt-fallback",
      OrderNumber: "ORDER-FALLBACK",
      TradeAmt: 5,
    }));

    expect(result.payload).toMatchObject({
      eventId: "evt-fallback",
      orderNumber: "ORDER-FALLBACK",
      grossAmountCents: 500,
      paymentMode: "platform",
    });
    expect(result.payload.vendorSlug).toBeUndefined();
    expect(result.payload.providerTradeNo).toBeUndefined();
  });
});
