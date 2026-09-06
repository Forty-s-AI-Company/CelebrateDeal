import { createHash, timingSafeEqual } from "node:crypto";
import { PaymentWebhookPayload } from "@/lib/payment-webhooks";
import {
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

export function getEcpayConfig() {
  const isProduction = process.env.NODE_ENV === "production" && process.env.ECPAY_ENV === "production";
  const merchantId = process.env.ECPAY_MERCHANT_ID?.trim() || DEFAULT_ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY?.trim() || DEFAULT_ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV?.trim() || DEFAULT_ECPAY_HASH_IV;
  const env = isProduction ? "production" : "sandbox";
  const urls = ECPAY_URLS[env];

  return { merchantId, hashKey, hashIv, env, urls };
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
    const { merchantId, hashKey, hashIv } = getEcpayConfig();
    if (!merchantId || !hashKey || !hashIv) return "unavailable";
    return "ready";
  },

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const { transaction, product, billingPlan, vendor, appUrl, description } = input;
    const { merchantId, hashKey, hashIv, urls } = getEcpayConfig();

    const tradeNo = (transaction.orderNumber ?? transaction.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
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
      CustomField2: transaction.id,
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
    const { hashKey, hashIv } = getEcpayConfig();
    const parsed = parseEcpayBody(rawBody);
    const incomingMac = parsed.CheckMacValue?.trim();
    if (!incomingMac) return false;

    const expectedMac = computeEcpayCheckMacValue(parsed, hashKey, hashIv);
    const left = Buffer.from(incomingMac);
    const right = Buffer.from(expectedMac);
    return left.length === right.length && timingSafeEqual(left, right);
  },

  async normalizePayload(rawBody: string): Promise<ProviderNormalizeResult> {
    const rawPayload = parseEcpayBody(rawBody);
    const rtnCode = rawPayload.RtnCode?.trim();
    const isPaid = rtnCode === "1";
    const tradeAmt = Number.parseInt(rawPayload.TradeAmt ?? "0", 10);
    const grossAmountCents = Number.isFinite(tradeAmt) ? tradeAmt * 100 : cents(rawPayload.TradeAmt);

    const eventId = rawPayload.TradeNo || rawPayload.MerchantTradeNo || String(Date.now());
    const orderNumber = rawPayload.MerchantTradeNo || rawPayload.CustomField2 || eventId;
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
      metadata: rawPayload,
    };

    const payload = PaymentWebhookPayload.parse(normalized);
    return { payload, rawPayload };
  },

  async queryPayment(input: QueryPaymentInput): Promise<PaymentQueryResult> {
    const { transaction } = input;
    const tradeNo = (transaction.orderNumber ?? transaction.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
    const grossAmountCents = transaction.grossAmountCents;

    return {
      providerTradeNo: transaction.providerTradeNo ?? tradeNo,
      orderNumber: transaction.orderNumber ?? transaction.id,
      grossAmountCents,
      refundedAmountCents: transaction.refundedAmountCents,
      remainingRefundableAmountCents: Math.max(0, grossAmountCents - transaction.refundedAmountCents),
      status: transaction.status === "refunded" ? "refunded" : transaction.status === "partially_refunded" ? "partially_refunded" : "paid",
    };
  },
};
