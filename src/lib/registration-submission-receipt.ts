import { NextResponse } from "next/server";
import { trustedRequestOrigin } from "@/lib/api-security";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";
import { registrationRetrySourcePath, registrationRetrySecureCookies } from "@/lib/registration-form-retry";

const PURPOSE = "registration-submission-result-v1";
export const REGISTRATION_RESULT_TTL_MS = 60_000;
export function registrationResultCookieName(secure: boolean) {
  return secure ? "__Host-celebratedeal_registration_result" : "celebratedeal_registration_result";
}

/** 僅證明此瀏覽器近期成功送出此表單，不代表Email確認或存取資格。 */
export function attachRegistrationResult(request: Request, response: NextResponse, data: FormData | null, now = Date.now()) {
  if (response.status !== 303) return;
  // 轉址一律不快取；憑證與目的地驗證仍決定是否建立成功回條。
  response.headers.set("Cache-Control", "no-store");
  if (!data || !Number.isFinite(now)) return;
  try {
    const location = response.headers.get("location");
    // Same allowed-origin set as requireSameOriginRequest; Referer never counts.
    const origin = trustedRequestOrigin(request);
    if (!location || !origin) return;
    const target = new URL(location, origin);
    const formId = data.get("formId");
    // The Location pathname is percent-encoded (e.g. a CJK slug); the receipt
    // stores the same canonical decoded path that the page verifies against.
    const path = registrationRetrySourcePath(target.pathname);
    if ((target.origin !== origin && target.origin !== new URL(request.url).origin) || target.searchParams.get("submitted") !== "verification_required" || typeof formId !== "string" || !formId || formId.length > 128 || !path) return;
    // 成功返回也使用已驗證的瀏覽器origin，避免內部host導向造成回條跨host遺失。
    response.headers.set("Location", new URL(target.pathname + target.search + target.hash, origin).toString());
    const value = encryptSensitiveValue(JSON.stringify({ formId, path, expiresAt: now + REGISTRATION_RESULT_TTL_MS }), PURPOSE);
    if (value.length > 3800) return;
    const secure = registrationRetrySecureCookies(new URL(request.url).host);
    response.cookies.set(registrationResultCookieName(secure), value, { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: REGISTRATION_RESULT_TTL_MS / 1000 });
  } catch { /* 提示無法建立不得影響已成功提交，也不記錄識別值。 */ }
}

export function verifyRegistrationResult(value: string | undefined, formId: string | undefined, path: string, now = Date.now()): boolean {
  const canonicalPath = registrationRetrySourcePath(path);
  if (!value || value.length > 3800 || !formId || !Number.isFinite(now) || !canonicalPath) return false;
  try {
    const result: unknown = JSON.parse(decryptSensitiveValue(value, PURPOSE));
    if (!result || typeof result !== "object") return false;
    const entry = result as Record<string, unknown>;
    return entry.formId === formId && entry.path === canonicalPath && typeof entry.expiresAt === "number" && entry.expiresAt > now && entry.expiresAt <= now + REGISTRATION_RESULT_TTL_MS;
  } catch { return false; }
}
