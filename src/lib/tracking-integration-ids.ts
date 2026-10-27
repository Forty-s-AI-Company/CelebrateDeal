import { META_PIXEL_ID_PATTERN } from "@/lib/tracking-meta-transport";

/**
 * 追蹤「整合設定」：商家只填 ID，平台產生標準 snippet。不接受任意 script。
 * 這些格式在儲存時驗證，渲染前再驗證一次，所以 ID 可以安全地放進平台自己的
 * 內嵌腳本（JSON 字串）與網址。
 */
export const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/u;
export const GTM_CONTAINER_ID_PATTERN = /^GTM-[A-Z0-9]{4,12}$/u;
export const TIKTOK_PIXEL_ID_PATTERN = /^[A-Z0-9]{10,32}$/u;
export { META_PIXEL_ID_PATTERN };

export type TrackingIdKind = "ga4" | "metaPixel" | "gtm" | "tiktok";

const PATTERNS: Readonly<Record<TrackingIdKind, RegExp>> = {
  ga4: GA4_MEASUREMENT_ID_PATTERN,
  metaPixel: META_PIXEL_ID_PATTERN,
  gtm: GTM_CONTAINER_ID_PATTERN,
  tiktok: TIKTOK_PIXEL_ID_PATTERN,
};

/** 空白回傳 null（清除）；格式不符回傳 { ok: false }。英文字母一律轉大寫後比對。 */
export function normalizeTrackingId(kind: TrackingIdKind, raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw !== null && raw !== undefined && typeof raw !== "string") return { ok: false };
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  const value = kind === "metaPixel" ? trimmed : trimmed.toUpperCase();
  return PATTERNS[kind].test(value) ? { ok: true, value } : { ok: false };
}

export type PublicTrackingTags = { ga4MeasurementId?: string; metaPixelId?: string };

/**
 * 公開頁實際載入的瀏覽器追蹤碼：商家必須明確開啟，且 ID 再驗證一次。
 * GTM 容器可以執行任意自訂 HTML／JS，會讓商家程式碼跑在平台網域上，
 * 所以不在公開頁載入（只保留設定值）。
 */
export function publicTrackingTags(setting: { enableBrowserTags?: boolean | null; enablePageView?: boolean | null; ga4MeasurementId?: string | null; facebookPixelId?: string | null } | null | undefined): PublicTrackingTags {
  if (!setting?.enableBrowserTags || setting.enablePageView === false) return {};
  const ga4 = setting.ga4MeasurementId && GA4_MEASUREMENT_ID_PATTERN.test(setting.ga4MeasurementId) ? setting.ga4MeasurementId : undefined;
  const meta = setting.facebookPixelId && META_PIXEL_ID_PATTERN.test(setting.facebookPixelId) ? setting.facebookPixelId : undefined;
  return { ...(ga4 ? { ga4MeasurementId: ga4 } : {}), ...(meta ? { metaPixelId: meta } : {}) };
}

/** GA4 標準 gtag 初始化（ID 已驗證，以 JSON 字串嵌入）。 */
export function ga4InitScript(measurementId: string): string {
  if (!GA4_MEASUREMENT_ID_PATTERN.test(measurementId)) throw new Error("invalid GA4 measurement id");
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config",${JSON.stringify(measurementId)});`;
}

/** Meta Pixel 標準初始化與 PageView（ID 已驗證，以 JSON 字串嵌入）。 */
export function metaPixelInitScript(pixelId: string): string {
  if (!META_PIXEL_ID_PATTERN.test(pixelId)) throw new Error("invalid Meta Pixel id");
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init",${JSON.stringify(pixelId)});fbq("track","PageView");`;
}
