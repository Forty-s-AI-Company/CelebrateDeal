import { createHash, timingSafeEqual } from "node:crypto";
import { PaymentWebhookPayload } from "@/lib/payment-webhooks";
import {
  PaymentQueryProviderError,
  type CheckoutSessionInput,
  type CheckoutSessionResult,
  type PaymentProviderAdapter,
  type ProviderNormalizeResult,
  type QueryPaymentInput,
  type PaymentQueryResult,
} from "@/lib/payment-providers/types";

// 綠界測試環境特店參數
const DEFAULT_ECPAY_MERCHANT_ID = "2000132";
const DEFAULT_ECPAY_HASH_KEY = "5294y06JbISpM5x9";
const DEFAULT_ECPAY_HASH_IV = "v77hoKGq4kWxNNIS";

const ECPAY_URLS = {
  sandbox: {
    checkout: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
    query: "https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5",
  },
  production: {
    checkout: "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5",
    query: "https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5",
  },
} as const;

const ECPAY_CUSTOM_FIELD2_MAX_LENGTH = 50;
const ECPAY_CUSTOM_FIELD2_SEPARATOR = "|";

export function getEcpayConfig() {
  // Production must never silently fall back to ECPay's public sandbox keys.
  // Treat an explicit production target as production too, so a mistakenly
  // configured local process cannot send a real checkout with test material.
  const isProduction = process.env.NODE_ENV === "production" || process.env.ECPAY_ENV?.trim() === "production";
  const merchantId = process.env.ECPAY_MERCHANT_ID?.trim() || (isProduction ? "" : DEFAULT_ECPAY_MERCHANT_ID);
  const hashKey = process.env.ECPAY_HASH_KEY?.trim() || (isProduction ? "" : DEFAULT_ECPAY_HASH_KEY);
  const hashIv = process.env.ECPAY_HASH_IV?.trim() || (isProduction ? "" : DEFAULT_ECPAY_HASH_IV);
  const env = isProduction ? "production" : "sandbox";
  const urls = ECPAY_URLS[env];
  const configured = Boolean(merchantId && hashKey && hashIv);

  return { merchantId, hashKey, hashIv, env, urls, configured };
}

/**
 * 綠界官方 CheckMacValue 壓碼計算規則：
 * 1. 字典序排列參數（A-Z）
 * 2. 頭尾加入 HashKey 與 HashIV
 * 3. URL 編碼並做 .NET 特殊字元轉換
 * 4. 轉全小寫
 * 5. SHA256 雜湊
 * 6. 轉全大寫
 */
export function computeEcpayCheckMacValue(
  params: Record<string, string | number>,
  hashKey: string,
  hashIv: string,
): string {
  const sortedKeys = Object.keys(params)
    .filter((key) => key !== "CheckMacValue")
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || a.localeCompare(b));

  const queryParts = [`HashKey=${hashKey}`];
  for (const key of sortedKeys) {
    queryParts.push(`${key}=${params[key]}`);
  }
  queryParts.push(`HashIV=${hashIv}`);
  const rawString = queryParts.join("&");

  const encoded = encodeURIComponent(rawString)
    .replace(/%2d/gi, "-")
    .replace(/%5f/gi, "_")
    .replace(/%2e/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2a/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .replace(/%20/gi, "+");

  const lower = encoded.toLowerCase();
  return createHash("sha256").update(lower).digest("hex").toUpperCase();
}

function parseEcpayBody(rawBody: string): Record<string, string> {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== null && v !== undefined) result[k] = String(v);
    }
    return result;
  } catch {
    const params = new URLSearchParams(rawBody);
    const result: Record<string, string> = {};
    for (const [k, v] of params.entries()) {
      result[k] = v;
    }
    return result;
  }
}

function safeMacEqual(incomingMac: string, expectedMac: string) {
  const left = Buffer.from(incomingMac);
  const right = Buffer.from(expectedMac);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * ECPay permits at most 20 alphanumeric characters for MerchantTradeNo.
 * The provider reference is deliberately derived from the immutable internal
 * transaction ID rather than a truncation of the human-facing order number.
 */
function ecpayMerchantTradeNo(transactionId: string) {
  return createHash("sha256").update(transactionId).digest("hex").slice(0, 20).toUpperCase();
}

type EcpayCustomField2Identity = {
  transactionId: string;
  orderNumber: string;
};

/**
 * CustomField2 is CheckMacValue-protected and has a 50-character limit. The
 * delimiter format keeps both server identities reversible (typical current
 * values are 25 + 1 + 24 characters) without overloading MerchantTradeNo.
 */
function encodeEcpayCustomField2(transactionId: string, orderNumber: string) {
  if (
    !transactionId
    || !orderNumber
    || transactionId !== transactionId.trim()
    || orderNumber !== orderNumber.trim()
    || transactionId.includes(ECPAY_CUSTOM_FIELD2_SEPARATOR)
    || orderNumber.includes(ECPAY_CUSTOM_FIELD2_SEPARATOR)
  ) {
    throw new Error("ECPay payment provider request is invalid.");
  }
  const value = `${transactionId}${ECPAY_CUSTOM_FIELD2_SEPARATOR}${orderNumber}`;
  if (value.length > ECPAY_CUSTOM_FIELD2_MAX_LENGTH) {
    throw new Error("ECPay payment provider request is invalid.");
  }
  return value;
}

function decodeEcpayCustomField2(value: string): EcpayCustomField2Identity | undefined {
  if (!value || value.length > ECPAY_CUSTOM_FIELD2_MAX_LENGTH) return undefined;
  const separatorIndex = value.indexOf(ECPAY_CUSTOM_FIELD2_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex !== value.lastIndexOf(ECPAY_CUSTOM_FIELD2_SEPARATOR)) return undefined;
  const transactionId = value.slice(0, separatorIndex);
  const orderNumber = value.slice(separatorIndex + ECPAY_CUSTOM_FIELD2_SEPARATOR.length);
  if (
    !transactionId
    || !orderNumber
    || transactionId !== transactionId.trim()
    || orderNumber !== orderNumber.trim()
  ) return undefined;
  return { transactionId, orderNumber };
}

function ecpayQueryAmountCents(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const wholeTwd = Number(value);
  if (!Number.isSafeInteger(wholeTwd) || wholeTwd <= 0 || wholeTwd > Number.MAX_SAFE_INTEGER / 100) {
    return undefined;
  }
  return wholeTwd * 100;
}

type EcpayQueryContext = {
  merchantId: string;
  hashKey: string;
  hashIv: string;
  merchantTradeNo: string;
  orderNumber: string;
  providerTradeNo: string;
  grossAmountCents: number;
};

function ecpayQueryContext(input: QueryPaymentInput, config: ReturnType<typeof getEcpayConfig>): EcpayQueryContext {
  const { transaction } = input;
  const transactionId = typeof transaction.id === "string" ? transaction.id.trim() : "";
  const orderNumber = typeof transaction.orderNumber === "string"
    ? transaction.orderNumber.trim()
    : transactionId;
  const providerTradeNo = typeof transaction.providerTradeNo === "string"
    ? transaction.providerTradeNo.trim()
    : "";

  // QueryTradeInfo cannot prove cumulative refund state. Never turn a local
  // refund into a provider-confirmed result with this endpoint.
  const invalidContract = !config.configured
    || transaction.providerName !== "ecpay"
    || !transactionId
    || transaction.id !== transactionId
    || !orderNumber
    || (transaction.orderNumber !== null && transaction.orderNumber !== undefined && transaction.orderNumber !== orderNumber)
    || !Number.isSafeInteger(transaction.grossAmountCents)
    || transaction.grossAmountCents <= 0
    || transaction.grossAmountCents % 100 !== 0
    || transaction.refundedAmountCents > 0
    || transaction.status === "refunded"
    || transaction.status === "partially_refunded";
  if (invalidContract) {
    throw new PaymentQueryProviderError(config.configured ? "request_contract" : "authentication");
  }

  return {
    merchantId: config.merchantId,
    hashKey: config.hashKey,
    hashIv: config.hashIv,
    merchantTradeNo: ecpayMerchantTradeNo(transactionId),
    orderNumber,
    providerTradeNo,
    grossAmountCents: transaction.grossAmountCents,
  };
}

function normalizeEcpayQueryResponse(rawPayload: Record<string, string>, context: EcpayQueryContext): PaymentQueryResult {
  const responseMac = rawPayload.CheckMacValue?.trim();
  if (!responseMac || !safeMacEqual(responseMac, computeEcpayCheckMacValue(rawPayload, context.hashKey, context.hashIv))) {
    throw new PaymentQueryProviderError("authentication");
  }

  const responseTradeNo = rawPayload.TradeNo?.trim();
  const grossAmountCents = ecpayQueryAmountCents(rawPayload.TradeAmt);
  const mismatchedIdentity = rawPayload.MerchantID !== context.merchantId
    || rawPayload.MerchantTradeNo !== context.merchantTradeNo
    || !responseTradeNo
    || (context.providerTradeNo && responseTradeNo !== context.providerTradeNo)
    || grossAmountCents === undefined
    || grossAmountCents !== context.grossAmountCents;
  if (mismatchedIdentity) throw new PaymentQueryProviderError("provider_response");

  if (rawPayload.TradeStatus !== "1") {
    throw new PaymentQueryProviderError(rawPayload.TradeStatus === "0" ? "pending" : "provider_response");
  }

  return {
    providerTradeNo: responseTradeNo,
    orderNumber: context.orderNumber,
    grossAmountCents,
    refundedAmountCents: 0,
    remainingRefundableAmountCents: grossAmountCents,
    status: "paid",
  };
}

function cents(value: unknown): number {
  const amount = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatEcpayDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

export const ecpayPaymentProvider: PaymentProviderAdapter = {
  id: "ecpay",

  checkoutReadiness() {
    return getEcpayConfig().configured ? "ready" : "unavailable";
  },

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const { transaction, product, billingPlan, vendor, appUrl, description } = input;
    const { merchantId, hashKey, hashIv, urls, configured } = getEcpayConfig();
    if (!configured) throw new Error("ECPay payment provider is unavailable.");

    const tradeNo = ecpayMerchantTradeNo(transaction.id);
    // CustomField2 is included in CheckMacValue and carries the complete
    // server-owned identity that cannot fit in MerchantTradeNo.
    const orderIdentity = encodeEcpayCustomField2(transaction.id, transaction.orderNumber ?? transaction.id);
    const now = new Date();
    const tradeDate = formatEcpayDate(now);
    const grossTwd = Math.max(1, Math.round(transaction.grossAmountCents / 100));
    const itemName = (product?.name ?? billingPlan?.name ?? description ?? "CelebrateDeal課程服務").slice(0, 100);

    const formPayload: Record<string, string | number> = {
      MerchantID: merchantId,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: tradeDate,
      PaymentType: "aio",
      TotalAmount: grossTwd,
      TradeDesc: "CelebrateDeal訂單",
      ItemName: itemName,
      ReturnURL: `${appUrl}/api/webhooks/payments?provider=ecpay&source=notify`,
      ChoosePayment: "ALL",
      ClientBackURL: `${appUrl}/checkout/result?payment=pending`,
      OrderResultURL: `${appUrl}/api/webhooks/payments?provider=ecpay&source=return`,
      NeedExtraPaidInfo: "Y",
      EncryptType: 1,
      CustomField1: vendor.slug,
      CustomField2: orderIdentity,
    };

    const checkMacValue = computeEcpayCheckMacValue(formPayload, hashKey, hashIv);
    const finalPayload: Record<string, string> = {};
    for (const [k, v] of Object.entries(formPayload)) {
      finalPayload[k] = String(v);
    }
    finalPayload.CheckMacValue = checkMacValue;

    return {
      provider: "ecpay",
      mode: "form_post",
      checkoutUrl: null,
      formAction: urls.checkout,
      formMethod: "POST",
      formPayload: finalPayload,
      nextAction: "ecpay_checkout_redirect",
      externalRequired: true,
    };
  },

  async verifySignature(_request: Request, rawBody: string): Promise<boolean> {
    const { hashKey, hashIv, configured } = getEcpayConfig();
    if (!configured) return false;
    const parsed = parseEcpayBody(rawBody);
    const incomingMac = parsed.CheckMacValue?.trim();
    if (!incomingMac) return false;

    const expectedMac = computeEcpayCheckMacValue(parsed, hashKey, hashIv);
    return safeMacEqual(incomingMac, expectedMac);
  },

  async normalizePayload(rawBody: string): Promise<ProviderNormalizeResult> {
    const rawPayload = parseEcpayBody(rawBody);
    const rtnCode = rawPayload.RtnCode?.trim();
    const isPaid = rtnCode === "1";
    const tradeAmt = Number.parseInt(rawPayload.TradeAmt ?? "0", 10);
    const grossAmountCents = Number.isFinite(tradeAmt) ? tradeAmt * 100 : cents(rawPayload.TradeAmt);

    const eventReference = rawPayload.TradeNo || rawPayload.MerchantTradeNo || String(Date.now());
    // The same provider trade can progress from a failed RtnCode to paid. Keep
    // each status transition distinct while identical status callbacks remain
    // idempotent under the same event ID.
    const eventId = `${eventReference}:${rtnCode || "unknown"}`;
    const customField2 = rawPayload.CustomField2;
    const customIdentity = customField2 === undefined ? undefined : decodeEcpayCustomField2(customField2);
    if (
      customField2 !== undefined
      && (!customIdentity || rawPayload.MerchantTradeNo !== ecpayMerchantTradeNo(customIdentity.transactionId))
    ) {
      throw new Error("Invalid ECPay callback identity.");
    }
    // MerchantTradeNo is an opaque 20-character provider reference. Recover
    // the complete local order identity only from the validated CustomField2.
    const orderNumber = customIdentity?.orderNumber || rawPayload.MerchantTradeNo || eventId;
    const providerTradeNo = rawPayload.TradeNo || undefined;
    const vendorSlug = rawPayload.CustomField1 || undefined;

    let eventType: "paid" | "failed" | "refunded" | "partially_refunded" = isPaid ? "paid" : "failed";
    const rawMsg = (rawPayload.RtnMsg ?? "").toLowerCase();
    if (rawMsg.includes("refund")) {
      eventType = rawMsg.includes("partial") ? "partially_refunded" : "refunded";
    }

    const normalized = {
      provider: "ecpay",
      eventId,
      eventType,
      vendorSlug,
      orderNumber,
      providerTradeNo,
      paymentMode: "platform",
      grossAmountCents,
      gatewayFeeCents: 0,
      platformFeeCents: 0,
      netAmountCents: grossAmountCents,
      refundAmountCents: 0,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents: 0,
      occurredAt: rawPayload.PaymentDate
        ? new Date(rawPayload.PaymentDate.replace(/\//g, "-")).toISOString()
        : new Date().toISOString(),
    };

    const payload = PaymentWebhookPayload.parse(normalized);
    // Persist only reconciliation fields. Free-form provider messages and
    // merchant CustomFields may contain PII that key-name redaction cannot detect.
    return { payload, rawPayload: { eventId, eventType, orderNumber, providerTradeNo,
      grossAmountCents, occurredAt: payload.occurredAt } };
  },

  async queryPayment(input: QueryPaymentInput): Promise<PaymentQueryResult> {
    const config = getEcpayConfig();
    const context = ecpayQueryContext(input, config);
    const requestPayload: Record<string, string> = {
      MerchantID: context.merchantId,
      MerchantTradeNo: context.merchantTradeNo,
      TimeStamp: String(Math.floor(Date.now() / 1000)),
    };
    requestPayload.CheckMacValue = computeEcpayCheckMacValue(requestPayload, context.hashKey, context.hashIv);

    let response: Response;
    try {
      response = await fetch(config.urls.query, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(requestPayload),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Abort/redirect/network details must not cross the provider boundary.
      throw new PaymentQueryProviderError("network");
    }
    if (!response.ok) throw new PaymentQueryProviderError("provider_response");

    let rawPayload: Record<string, string>;
    try {
      rawPayload = parseEcpayBody(await response.text());
    } catch {
      throw new PaymentQueryProviderError("provider_response");
    }
    return normalizeEcpayQueryResponse(rawPayload, context);
  },
};
