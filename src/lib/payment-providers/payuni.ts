import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PaymentWebhookPayload } from "@/lib/payment-webhooks";
import type { PaymentProviderAdapter } from "@/lib/payment-providers/types";

function cents(value: unknown) {
  const amount = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function normalizeEventType(value: unknown) {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("partial")) return "partially_refunded";
  if (raw.includes("refund")) return "refunded";
  if (raw.includes("fail") || raw.includes("cancel")) return "failed";
  return "paid";
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function stablePayloadString(rawBody: string) {
  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    return Object.keys(payload)
      .filter((key) => !["CheckMacValue", "Signature", "sign", "signature"].includes(key))
      .sort()
      .map((key) => `${key}=${String(payload[key] ?? "")}`)
      .join("&");
  } catch {
    return rawBody;
  }
}

function verifyPayUniSignature(rawBody: string, signature: string | null) {
  const hashKey = process.env.PAYUNI_HASH_KEY;
  const hashIv = process.env.PAYUNI_HASH_IV;
  const webhookSecret = process.env.PAYUNI_WEBHOOK_SECRET;
  if (!signature || (!webhookSecret && (!hashKey || !hashIv))) return false;

  const normalized = stablePayloadString(rawBody);
  const expected = webhookSecret
    ? createHmac("sha256", webhookSecret).update(rawBody).digest("hex")
    : createHash("sha256").update(`HashKey=${hashKey}&${normalized}&HashIV=${hashIv}`).digest("hex").toUpperCase();

  return safeEqual(expected, signature.trim());
}

export const payUniPaymentProvider: PaymentProviderAdapter = {
  id: "payuni",
  async verifySignature(request, rawBody) {
    return verifyPayUniSignature(
      rawBody,
      request.headers.get("x-payuni-signature")
        ?? request.headers.get("x-payment-signature")
        ?? request.headers.get("checkmacvalue"),
    );
  },
  async normalizePayload(rawBody) {
    const rawPayload = JSON.parse(rawBody) as Record<string, unknown>;
    const orderNumber = rawPayload.MerTradeNo ?? rawPayload.OrderNo ?? rawPayload.orderNumber;
    const eventId = rawPayload.EventId ?? rawPayload.TradeNo ?? rawPayload.TsNo ?? orderNumber;
    const normalized = {
      provider: "payuni",
      eventId: String(eventId),
      eventType: normalizeEventType(rawPayload.EventType ?? rawPayload.Status ?? rawPayload.PayStatus),
      vendorSlug: rawPayload.VendorSlug ? String(rawPayload.VendorSlug) : undefined,
      vendorId: rawPayload.VendorId ? String(rawPayload.VendorId) : undefined,
      orderNumber: String(orderNumber),
      providerTradeNo: rawPayload.TradeNo ? String(rawPayload.TradeNo) : undefined,
      paymentMode: "platform",
      grossAmountCents: cents(rawPayload.Amount ?? rawPayload.TradeAmt),
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

    return {
      payload: PaymentWebhookPayload.parse(normalized),
      rawPayload,
    };
  },
};
