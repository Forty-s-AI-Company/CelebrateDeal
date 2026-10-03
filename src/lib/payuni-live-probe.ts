import { randomBytes } from "node:crypto";
import { activePayUniCredentials } from "@/lib/payuni-credentials";

export const PAYUNI_LIVE_PROBE_AMOUNT_CENTS = 100;
export const PAYUNI_LIVE_PROBE_DELAY_MS = 10 * 60 * 1000;
export const PAYUNI_LIVE_PROBE_CONSENT_VERSION = "payuni-live-probe-1twd-then-1twd-after-10min/v1";
export const PAYUNI_LIVE_PROBE_CONSENT_TEXT = "我另行同意這次正式 PAYUNi 驗證：完成首次 1 元綁卡交易後，約 10 分鐘再以同一卡片發起一次 1 元扣款；系統不會自動重試第二筆扣款。";

/** A live charge probe is available to exactly one Preview tenant per deploy. */
export function payUniLiveProbeAvailable(vendorId: string, env: NodeJS.ProcessEnv = process.env) {
  const selectedMerchantId = (() => {
    try { return activePayUniCredentials(env).merchantId; } catch { return null; }
  })();
  return Boolean(vendorId)
    && env.VERCEL_ENV === "preview"
    && env.PAYUNI_ENV === "production"
    && env.PAYMENT_PROVIDER === "payuni"
    && env.PAYUNI_LIVE_PROBE_ENABLED === "true"
    && env.PAYUNI_LIVE_PROBE_VENDOR_ID === vendorId
    && Boolean(env.PAYUNI_LIVE_PROBE_MERCHANT_ID)
    && env.PAYUNI_LIVE_PROBE_MERCHANT_ID === selectedMerchantId;
}

/** Unique within the real merchant, including across a Preview rebuild. */
export function newPayUniLiveProbeOrderNumber() {
  return `pc${randomBytes(16).toString("base64url")}`;
}
