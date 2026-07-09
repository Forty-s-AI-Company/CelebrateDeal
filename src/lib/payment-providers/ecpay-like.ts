import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentWebhookPayload } from "@/lib/payment-webhooks";
import type { PaymentProviderAdapter } from "@/lib/payment-providers/types";

function cents(value: unknown) {
  const amount = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function eventType(value: unknown) {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("partial")) return "partially_refunded";
  if (raw.includes("refund")) return "refunded";
  if (raw.includes("fail")) return "failed";
  return "paid";
}

function verifyHmac(rawBody: string, signature: string | null) {
  const secret = process.env.ECPAY_WEBHOOK_SECRET ?? "demo-ecpay-secret";
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const incoming = signature.trim();
  const expectedBuffer = Buffer.from(expected);
  const incomingBuffer = Buffer.from(incoming);
  return expectedBuffer.length === incomingBuffer.length && timingSafeEqual(expectedBuffer, incomingBuffer);
}

export const ecpayLikePaymentProvider: PaymentProviderAdapter = {
  id: "ecpay-like",
  async verifySignature(request, rawBody) {
    return verifyHmac(rawBody, request.headers.get("x-ecpay-signature") ?? request.headers.get("x-payment-signature"));
  },
  async normalizePayload(rawBody) {
    const rawPayload = JSON.parse(rawBody) as Record<string, unknown>;
    const normalized = {
      provider: "ecpay-like",
      eventId: String(rawPayload.EventId ?? rawPayload.MerchantTradeNo ?? rawPayload.TradeNo),
      eventType: eventType(rawPayload.EventType ?? rawPayload.RtnCode),
      vendorSlug: rawPayload.VendorSlug ? String(rawPayload.VendorSlug) : undefined,
      orderNumber: String(rawPayload.MerchantTradeNo ?? rawPayload.OrderNumber),
      providerTradeNo: rawPayload.TradeNo ? String(rawPayload.TradeNo) : undefined,
      paymentMode: "platform",
      grossAmountCents: cents(rawPayload.TradeAmt),
      gatewayFeeCents: cents(rawPayload.GatewayFee),
      platformFeeCents: cents(rawPayload.PlatformFee),
      netAmountCents: cents(rawPayload.NetAmount),
      refundAmountCents: cents(rawPayload.RefundAmount),
      gatewayFeeRefundCents: cents(rawPayload.GatewayFeeRefund),
      platformFeeRefundCents: cents(rawPayload.PlatformFeeRefund),
      refundReason: rawPayload.RefundReason ? String(rawPayload.RefundReason) : undefined,
      referralCode: rawPayload.ReferralCode ? String(rawPayload.ReferralCode) : undefined,
      occurredAt: rawPayload.OccurredAt ? new Date(String(rawPayload.OccurredAt)).toISOString() : undefined,
      metadata: rawPayload,
    };
    const payload = PaymentWebhookPayload.parse(normalized);
    return { payload, rawPayload };
  },
};
