import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
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

function parseRawPayload(rawBody: string) {
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(rawBody).entries()) as Record<string, unknown>;
  }
}

function payUniKeyMaterial() {
  const key = process.env.PAYUNI_HASH_KEY?.trim();
  const iv = process.env.PAYUNI_HASH_IV?.trim();
  if (!key || !iv) {
    throw new Error("PAYUNI_HASH_KEY and PAYUNI_HASH_IV are required.");
  }
  return { key, iv };
}

function encryptInfo(payload: Record<string, string | number>) {
  const { key, iv } = payUniKeyMaterial();
  const tagLength = 16;
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv), { authTagLength: tagLength });
  const query = new URLSearchParams(Object.entries(payload).map(([payloadKey, value]) => [payloadKey, String(value)])).toString();
  const encrypted = Buffer.concat([cipher.update(query, "utf8"), cipher.final()]).toString("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return Buffer.from(`${encrypted}:::${tag}`).toString("hex");
}

function decryptInfo(encryptStr: string) {
  const { key, iv } = payUniKeyMaterial();
  const decoded = Buffer.from(encryptStr, "hex").toString("utf8");
  const [encrypted, tag] = decoded.split(":::");
  if (!encrypted || !tag) {
    throw new Error("Invalid PayUni EncryptInfo payload.");
  }
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
  return Object.fromEntries(new URLSearchParams(decrypted).entries()) as Record<string, unknown>;
}

function hashInfo(encryptStr: string) {
  const { key, iv } = payUniKeyMaterial();
  return createHash("sha256").update(`${key}${encryptStr}${iv}`).digest("hex").toUpperCase();
}

function verifyPayUniSignature(rawBody: string, signature: string | null) {
  const hashKey = process.env.PAYUNI_HASH_KEY;
  const hashIv = process.env.PAYUNI_HASH_IV;
  const webhookSecret = process.env.PAYUNI_WEBHOOK_SECRET;
  const rawPayload = parseRawPayload(rawBody);
  const encryptPayload = rawPayload.EncryptInfo ? String(rawPayload.EncryptInfo) : null;
  const hashPayload = rawPayload.HashInfo ? String(rawPayload.HashInfo) : null;

  if (encryptPayload && hashPayload && hashKey && hashIv) {
    return safeEqual(hashInfo(encryptPayload), hashPayload.trim());
  }

  if (!signature || (!webhookSecret && (!hashKey || !hashIv))) return false;

  const normalized = stablePayloadString(rawBody);
  const expected = webhookSecret
    ? createHmac("sha256", webhookSecret).update(rawBody).digest("hex")
    : createHash("sha256").update(`HashKey=${hashKey}&${normalized}&HashIV=${hashIv}`).digest("hex").toUpperCase();

  return safeEqual(expected, signature.trim());
}

export const payUniPaymentProvider: PaymentProviderAdapter = {
  id: "payuni",
  async createCheckoutSession({ transaction, product, vendor, referralCode, appUrl }) {
    const merchantId = process.env.PAYUNI_MERCHANT_ID;
    if (!merchantId) {
      return {
        provider: "payuni",
        mode: "manual",
        checkoutUrl: null,
        nextAction: "payuni_missing_merchant_id",
        externalRequired: true,
      };
    }

    const encrypted = encryptInfo({
      MerID: merchantId,
      MerTradeNo: transaction.orderNumber ?? transaction.id,
      TradeAmt: Math.max(1, Math.round(transaction.grossAmountCents / 100)),
      Timestamp: Math.floor(Date.now() / 1000),
      ProdDesc: product.name.slice(0, 80),
      ReturnURL: `${appUrl}/api/webhooks/payments?provider=payuni&source=return`,
      NotifyURL: `${appUrl}/api/webhooks/payments?provider=payuni&source=notify`,
      VendorId: vendor.id,
      ReferralCode: referralCode ?? "",
    });

    const baseUrl = process.env.PAYUNI_API_BASE_URL
      ?? (process.env.PAYUNI_ENV === "production" ? "https://api.payuni.com.tw/api" : "https://sandbox-api.payuni.com.tw/api");

    return {
      provider: "payuni",
      mode: "form_post",
      checkoutUrl: null,
      formAction: `${baseUrl.replace(/\/$/, "")}/upp`,
      formMethod: "POST",
      formPayload: {
        MerID: merchantId,
        Version: "1.0",
        EncryptInfo: encrypted,
        HashInfo: hashInfo(encrypted),
      },
      nextAction: "submit_payuni_upp_form",
      externalRequired: process.env.PAYUNI_ENV === "production",
    };
  },
  async verifySignature(request, rawBody) {
    return verifyPayUniSignature(
      rawBody,
      request.headers.get("x-payuni-signature")
        ?? request.headers.get("x-payment-signature")
        ?? request.headers.get("checkmacvalue"),
    );
  },
  async normalizePayload(rawBody) {
    const outerPayload = parseRawPayload(rawBody);
    const rawPayload = outerPayload.EncryptInfo ? decryptInfo(String(outerPayload.EncryptInfo)) : outerPayload;
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
