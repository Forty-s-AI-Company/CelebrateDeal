import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

const Context = z.object({
  sourceUrl: z.string().max(1024).url(),
  userAgent: z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/u),
}).strict();
export type TrackingBrowserContext = z.infer<typeof Context>;

function purpose(vendorId: string, sourceId: string) {
  if (![vendorId, sourceId].every(id => /^[A-Za-z0-9_-]{1,191}$/u.test(id))) throw new TypeError("Invalid tracking context scope.");
  return `server-side-tracking:${vendorId}:${sourceId}:browser-context`;
}

function validate(value: unknown) {
  const parsed = Context.parse(value), url = new URL(parsed.sourceUrl);
  // URL 只是網站事件資料；不允許憑證、query、fragment 或其他協定。
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError("Invalid tracking source URL.");
  return parsed;
}

/** 僅在既有 Origin/CSRF/權益驗證後呼叫；不接收瀏覽器 JSON 的追蹤欄位。 */
export function captureTrackingBrowserContext(headers: Pick<Headers, "get">, serverOwnedPath?: string): TrackingBrowserContext | null {
  const userAgent = headers.get("user-agent");
  if (!userAgent || userAgent.length > 512 || /[\u0000-\u001f\u007f]/u.test(userAgent)) return null;
  const origin = getCanonicalAppUrl();
  let path = serverOwnedPath;
  try {
    const referer = headers.get("referer"), url = referer ? new URL(referer) : null;
    // 只保留同源公開頁路徑；不保存回復 token、query 或會員/管理頁資訊。
    if (url?.origin === origin && !url.username && !url.password && /^\/(?:live\/[^/]+|checkout\/[^/]+\/[^/]+|lp\/[^/]+(?:\/[^/]+)?(?:\/checkout)?|register|verify-registration)\/?$/u.test(url.pathname)) path = url.pathname;
  } catch { /* 不可信 Referer 不能改變 server-owned fallback。 */ }
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[?#\u0000-\u001f\u007f]/u.test(path)) return null;
  try { return validate({ sourceUrl: new URL(path, origin).toString(), userAgent }); } catch { return null; }
}

/** context 採 tenant + source 綁定加密，不能跨來源交換 envelope。 */
export function protectTrackingBrowserContext(vendorId: string, sourceId: string, context: TrackingBrowserContext) {
  return encryptSensitiveValue(JSON.stringify(validate(context)), purpose(vendorId, sourceId));
}

export function revealTrackingBrowserContext(vendorId: string, sourceId: string, envelope: string) {
  try { return validate(JSON.parse(decryptSensitiveValue(envelope, purpose(vendorId, sourceId)))); }
  catch { throw new Error("Tracking browser context unavailable."); }
}
