import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { PaymentWebhookPayload } from "@/lib/payment-webhooks";
import { RefundProviderError, type PaymentProviderAdapter, type RefundPaymentInput } from "@/lib/payment-providers/types";

const PAYUNI_UPP_VERSION = "2.0";
const PAYUNI_API_BASE_URLS = {
  sandbox: "https://sandbox-api.payuni.com.tw/api",
  production: "https://api.payuni.com.tw/api",
} as const;
const PAYUNI_ORDER_NUMBER = /^[A-Za-z0-9_-]{1,25}$/;
const PAYUNI_MIN_TRADE_AMOUNT = 1;
const PAYUNI_MAX_CREDIT_TRADE_AMOUNT = 199_999;
const PAYUNI_REFUND_VERSION = "1.0";

function cents(value: unknown) {
  const amount = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function normalizeEventType(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["partially_refunded", "partial_refund", "partially-refunded"].includes(raw)) {
    return "partially_refunded";
  }
  if (["refunded", "refund"].includes(raw)) return "refunded";
  if (["failed", "fail", "failure", "cancelled", "canceled", "cancel"].includes(raw)) {
    return "failed";
  }
  if (["paid", "success", "succeeded", "completed"].includes(raw)) return "paid";

  // 金流狀態必須 fail closed；若 PAYUNi 新增或改名狀態，寧可保留交易
  // pending 並留下 webhook 失敗紀錄，也不能把未知狀態誤認為已付款。
  throw new Error("Unsupported PayUni payment status.");
}

function requiredPayloadText(value: unknown, field: string) {
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  if (!normalized) {
    throw new Error(`Missing PayUni ${field}.`);
  }
  return normalized;
}

function optionalPayloadText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
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
  if (!key || !iv || Buffer.byteLength(key) !== 32 || Buffer.byteLength(iv) !== 16) {
    throw new Error("PAYUNI_HASH_KEY and PAYUNI_HASH_IV must use the required byte lengths.");
  }
  return { key, iv };
}

function payUniApiBaseUrl() {
  const environment = process.env.PAYUNI_ENV?.trim();
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("PAYUNI_ENV must be sandbox or production.");
  }

  return PAYUNI_API_BASE_URLS[environment];
}

function payUniOrderNumber(transaction: { id: string; orderNumber: string | null }) {
  const value = transaction.orderNumber ?? transaction.id;
  if (!PAYUNI_ORDER_NUMBER.test(value)) {
    throw new Error("PayUni order number is invalid.");
  }
  return value;
}

function payUniTradeAmount(grossAmountCents: number) {
  if (!Number.isSafeInteger(grossAmountCents) || grossAmountCents % 100 !== 0) {
    throw new Error("PayUni trade amount must use whole TWD units.");
  }
  const amount = grossAmountCents / 100;
  if (amount < PAYUNI_MIN_TRADE_AMOUNT || amount > PAYUNI_MAX_CREDIT_TRADE_AMOUNT) {
    throw new Error("PayUni trade amount is outside the supported credit-card range.");
  }
  return amount;
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

function payUniResultRow(value: Record<string, unknown>) {
  const result = value.Result;
  if (Array.isArray(result)) return result[0] as Record<string, unknown> | undefined;
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as unknown;
      return Array.isArray(parsed) ? parsed[0] as Record<string, unknown> | undefined : parsed as Record<string, unknown>;
    } catch {
      const parsed = Object.fromEntries(new URLSearchParams(result).entries());
      return Object.keys(parsed).length > 0 ? parsed : undefined;
    }
  }
  return result && typeof result === "object" ? result as Record<string, unknown> : undefined;
}

/**
 * Sends only the documented PayUni close/refund envelope.  Errors deliberately
 * stay generic so provider responses, URLs and cryptographic material cannot
 * leak into Server Action responses or runtime logs.
 */
async function refundPayUniTransaction({ transaction, refundAmountCents }: RefundPaymentInput) {
  const merchantId = process.env.PAYUNI_MERCHANT_ID?.trim();
  const tradeNo = transaction.providerTradeNo?.trim();
  if (!merchantId || !tradeNo) throw new RefundProviderError("request_contract");

  const amount = payUniTradeAmount(refundAmountCents);
  const encrypted = encryptInfo({
    MerID: merchantId,
    TradeNo: tradeNo,
    Timestamp: Math.floor(Date.now() / 1000),
    CloseType: 2,
    TradeAmt: amount,
  });

  let response: Response;
  try {
    response = await fetch(`${payUniApiBaseUrl().replace(/\/$/, "")}/trade/close`, {
      method: "POST",
      // PayUni 的信用卡退款 API 要求明確提供 User-Agent；沒有時可能被
      // 閘道拒絕，即使 EncryptInfo／HashInfo 都正確。
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "payuni",
      },
      body: new URLSearchParams({
        MerID: merchantId,
        Version: PAYUNI_REFUND_VERSION,
        EncryptInfo: encrypted,
        HashInfo: hashInfo(encrypted),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new RefundProviderError("network");
  }

  if (!response.ok) throw new RefundProviderError("provider_response");

  let outer: Record<string, unknown>;
  try {
    outer = parseRawPayload(await response.text());
  } catch {
    throw new RefundProviderError("provider_response");
  }

  const responseEncrypted = optionalPayloadText(outer.EncryptInfo);
  const responseHash = optionalPayloadText(outer.HashInfo);
  if (!responseEncrypted || !responseHash || !safeEqual(hashInfo(responseEncrypted), responseHash)) {
    throw new RefundProviderError("authentication");
  }

  let payload: Record<string, unknown>;
  try {
    payload = decryptInfo(responseEncrypted);
  } catch {
    throw new RefundProviderError("authentication");
  }

  // 文件中的成功回覆將 Status、TradeNo、CloseType 直接放在解密內容，
  // 舊版整合則可能包在 Result。兩者都要驗證同一組回傳欄位。
  const result = payUniResultRow(payload) ?? payload;
  if (
    optionalPayloadText(payload.Status) !== "SUCCESS"
    || optionalPayloadText(result?.TradeNo) !== tradeNo
    || optionalPayloadText(result?.CloseType) !== "2"
  ) {
    throw new RefundProviderError("provider_response");
  }

  return {
    providerEventId: optionalPayloadText(result?.CloseNo)
      ?? optionalPayloadText(result?.RefundNo)
      ?? tradeNo,
  };
}

function payUniCallbackUrl(appUrl: string, source: "notify" | "return") {
  const url = new URL("/api/webhooks/payments", appUrl);
  url.searchParams.set("provider", "payuni");
  url.searchParams.set("source", source);
  // ReturnURL is shown to the payer and NotifyURL is stored by PayUni. Neither
  // URL may contain a Vercel automation bypass secret. Sandbox callbacks must
  // therefore use a public, non-production Staging host.
  return url.toString();
}

function verifyPayUniSignature(rawBody: string) {
  try {
    const outerPayload = parseRawPayload(rawBody);
    const merchantId = process.env.PAYUNI_MERCHANT_ID?.trim();
    const outerMerchantId = optionalPayloadText(outerPayload.MerID);
    const version = optionalPayloadText(outerPayload.Version);
    const encryptPayload = optionalPayloadText(outerPayload.EncryptInfo);
    const hashPayload = optionalPayloadText(outerPayload.HashInfo);

    if (
      !merchantId
      || outerMerchantId !== merchantId
      || version !== PAYUNI_UPP_VERSION
      || !encryptPayload
      || !hashPayload
      || !safeEqual(hashInfo(encryptPayload), hashPayload)
    ) {
      return false;
    }

    // HashInfo authenticates EncryptInfo. The merchant ID is checked both outside
    // and inside the encrypted payload so callbacks cannot be attributed to a
    // different shop even when an integration key is accidentally reused.
    const decrypted = decryptInfo(encryptPayload);
    return optionalPayloadText(decrypted.MerID) === merchantId;
  } catch {
    // Invalid key lengths, malformed encryption and decoding failures are all
    // authentication failures. Do not leak provider details or turn them into 500s.
    return false;
  }
}

export const payUniPaymentProvider: PaymentProviderAdapter = {
  id: "payuni",
  async createCheckoutSession({ transaction, product, appUrl }) {
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
      MerTradeNo: payUniOrderNumber(transaction),
      TradeAmt: payUniTradeAmount(transaction.grossAmountCents),
      Timestamp: Math.floor(Date.now() / 1000),
      ProdDesc: product.name.slice(0, 80),
      ReturnURL: payUniCallbackUrl(appUrl, "return"),
      NotifyURL: payUniCallbackUrl(appUrl, "notify"),
    });
    const baseUrl = payUniApiBaseUrl();

    return {
      provider: "payuni",
      mode: "form_post",
      checkoutUrl: null,
      formAction: `${baseUrl.replace(/\/$/, "")}/upp`,
      formMethod: "POST",
      formPayload: {
        MerID: merchantId,
        Version: PAYUNI_UPP_VERSION,
        EncryptInfo: encrypted,
        HashInfo: hashInfo(encrypted),
      },
      nextAction: "submit_payuni_upp_form",
      externalRequired: process.env.PAYUNI_ENV === "production",
    };
  },
  async verifySignature(_request, rawBody) {
    return verifyPayUniSignature(rawBody);
  },
  async normalizePayload(rawBody) {
    const outerPayload = parseRawPayload(rawBody);
    const rawPayload = outerPayload.EncryptInfo ? decryptInfo(String(outerPayload.EncryptInfo)) : outerPayload;
    const orderNumber = rawPayload.MerTradeNo ?? rawPayload.OrderNo ?? rawPayload.orderNumber;
    const eventId = rawPayload.EventId ?? rawPayload.TradeNo ?? rawPayload.TsNo ?? orderNumber;
    const normalizedOrderNumber = requiredPayloadText(orderNumber, "order number");
    const normalizedEventId = requiredPayloadText(eventId, "event ID");
    const normalized = {
      provider: "payuni",
      eventId: normalizedEventId,
      eventType: normalizeEventType(rawPayload.EventType ?? rawPayload.Status ?? rawPayload.PayStatus),
      vendorSlug: optionalPayloadText(rawPayload.VendorSlug),
      vendorId: optionalPayloadText(rawPayload.VendorId),
      orderNumber: normalizedOrderNumber,
      providerTradeNo: optionalPayloadText(rawPayload.TradeNo),
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
  async refundPayment(input) {
    return refundPayUniTransaction(input);
  },
};
