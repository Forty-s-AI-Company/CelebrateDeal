import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePaymentProvider } from "./stripe";
import { PaymentQueryProviderError, RefundProviderError } from "./types";

const config = { secretKey: "sk_test_fixture_key", webhookSecret: "whsec_fixture_secret" };
const fixedNow = new Date("2026-09-09T12:00:00.000Z").getTime();

function provider(transport = vi.fn()) {
  return createStripePaymentProvider({ transport, getConfig: () => config, now: () => fixedNow });
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx_stripe_001", providerName: "stripe", providerTradeNo: "pi_123456", orderNumber: "CD-STRIPE-001",
    grossAmountCents: 29_800, refundedAmountCents: 0, currency: "USD", status: "paid", ...overrides,
  } as never;
}

function signedRequest(body: string, timestamp = Math.floor(fixedNow / 1000)) {
  const signature = createHmac("sha256", config.webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://app.example.test/api/webhooks/payments?provider=stripe", {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body,
  });
}

function paidEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_stripe_paid_001", type: "payment_intent.succeeded", created: Math.floor(fixedNow / 1000),
    data: { object: {
      id: "pi_123456", amount: 29_800, currency: "usd", status: "succeeded",
      metadata: { orderNumber: "CD-STRIPE-001", vendorId: "vendor-1" },
      ...overrides,
    } },
  });
}

describe("Stripe Payment Provider", () => {
  it("creates an international Checkout Session without exposing credentials", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "cs_test_001", url: "https://checkout.stripe.com/c/pay/cs_test_001" }), { status: 200 }));
    const adapter = provider(transport);
    const result = await adapter.createCheckoutSession!({
      transaction: transaction({ currency: "EUR" }), product: { name: "國際商業化課程" } as never,
      vendor: { id: "vendor-1", slug: "demo" } as never, appUrl: "https://app.example.test",
    });
    expect(result).toMatchObject({ provider: "stripe", mode: "redirect", nextAction: "redirect_to_stripe_checkout" });
    expect(result.checkoutUrl).toContain("checkout.stripe.com");
    const [, init] = transport.mock.calls[0]!;
    expect(init.headers).toMatchObject({ authorization: expect.stringContaining("Bearer ") });
    expect(JSON.stringify(result)).not.toContain(config.secretKey);
    const request = new URLSearchParams(String(init.body));
    expect(request.get("line_items[0][price_data][currency]")).toBe("eur");
    expect(request.get("line_items[0][price_data][unit_amount]")).toBe("29800");
  });

  it.each(["TWD", "USD", "HKD", "EUR", "SGD"])("accepts the %s supported currency", async (currency) => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "cs_test_001", url: "https://checkout.stripe.com/c/pay/cs_test_001" }), { status: 200 }));
    await expect(provider(transport).createCheckoutSession!({
      transaction: transaction({ currency }), description: "伺服器選定品項", vendor: { id: "vendor-1" } as never, appUrl: "https://app.example.test",
    })).resolves.toMatchObject({ provider: "stripe" });
  });

  it("verifies Stripe webhook signatures and rejects forged or stale signatures", async () => {
    const body = paidEvent();
    const adapter = provider();
    await expect(adapter.verifySignature(signedRequest(body), body)).resolves.toBe(true);
    await expect(adapter.verifySignature(signedRequest(`${body}x`), body)).resolves.toBe(false);
    await expect(adapter.verifySignature(signedRequest(body, 1), body)).resolves.toBe(false);
  });

  it("normalizes a payment event using its stable Stripe event id for webhook deduplication", async () => {
    const adapter = provider();
    const first = await adapter.normalizePayload(paidEvent());
    const repeated = await adapter.normalizePayload(paidEvent());
    expect(first.payload).toMatchObject({ provider: "stripe", eventId: "evt_stripe_paid_001", eventType: "paid", orderNumber: "CD-STRIPE-001", grossAmountCents: 29_800, currency: "USD" });
    // The webhook database unique key (provider,eventId) makes retries idempotent.
    expect(repeated.payload.eventId).toBe(first.payload.eventId);
    expect(first.rawPayload).not.toHaveProperty("metadata");
  });

  it("refunds only validated Stripe payment intents with an idempotency key", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_123", status: "succeeded", amount: 10_000 }), { status: 200 }));
    await expect(provider(transport).refundPayment!({ transaction: transaction(), refundAmountCents: 10_000, requestId: "refund-request-001" })).resolves.toEqual({ providerEventId: "re_123" });
    const [, init] = transport.mock.calls[0]!;
    expect(init.headers).toMatchObject({ "idempotency-key": "refund-request-001" });
    expect(new URLSearchParams(String(init.body))).toEqual(new URLSearchParams("payment_intent=pi_123456&amount=10000"));

    const noCall = vi.fn();
    await expect(provider(noCall).refundPayment!({ transaction: transaction(), refundAmountCents: 29_801, requestId: "refund-request-001" })).rejects.toBeInstanceOf(RefundProviderError);
    expect(noCall).not.toHaveBeenCalled();
  });

  it("queries Stripe payment status with amount and currency binding", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "pi_123456", status: "succeeded", amount: 29_800, amount_refunded: 10_000, currency: "usd" }), { status: 200 }));
    await expect(provider(transport).queryPayment!({ transaction: transaction() })).resolves.toEqual({
      providerTradeNo: "pi_123456", orderNumber: "CD-STRIPE-001", grossAmountCents: 29_800,
      refundedAmountCents: 10_000, remainingRefundableAmountCents: 19_800, status: "partially_refunded",
    });
  });

  it("fails closed when a queried payment mismatches the local transaction", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "pi_123456", status: "succeeded", amount: 100, amount_refunded: 0, currency: "usd" }), { status: 200 }));
    await expect(provider(transport).queryPayment!({ transaction: transaction() })).rejects.toMatchObject({ category: "provider_response" });

    const noCall = vi.fn();
    await expect(provider(noCall).queryPayment!({ transaction: transaction({ providerName: "payuni" }) })).rejects.toBeInstanceOf(PaymentQueryProviderError);
    expect(noCall).not.toHaveBeenCalled();
  });
});
