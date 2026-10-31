import { registrationAttribution, type RegistrationAttributionQuery } from "@/lib/registration-attribution";
import { registrationResultCookieName, verifyRegistrationResult } from "@/lib/registration-submission-receipt";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { getDb } from "@/lib/db";
import { REGISTRATION_RETRY_STATUSES } from "@/lib/registration-form-retry-response";
import { readRegistrationRetryDraft, registrationRetrySecureCookies, registrationRetryCookieName } from "@/lib/registration-form-retry";
import { RegistrationRetryProvider } from "@/components/registration-retry-context";

/**
 * 公開入口載入後才讀草稿，避免跳過原本的發布與存取檢查。草稿只能讀一次：
 * `readDraft` 為 false 時（例如 A/B 或步驟決定此頁不會顯示表單）不讀取、不消耗。
 */
/** Every value a native retry redirect may carry in ?registrationRetry= (409: a fixed-session problem, 指定場次). */
const REGISTRATION_RETRY_QUERY_VALUES: readonly string[] = [...REGISTRATION_RETRY_STATUSES.map(String), "unavailable"];

export async function registrationRetryBoundary({ formId, sourcePath, retry, submitted, attributionQuery, readDraft = true }: {
  formId?: string; sourcePath: string; retry?: string | string[]; submitted?: string; attributionQuery?: RegistrationAttributionQuery; readDraft?: boolean;
}) {
  const failed = typeof retry === "string" && REGISTRATION_RETRY_QUERY_VALUES.includes(retry);
  let draft = null;
  if (readDraft && failed && retry !== "unavailable" && formId) {
    const jar = await cookies();
    const host = (await headers()).get("host") ?? "";
    const capability = jar.get(registrationRetryCookieName(registrationRetrySecureCookies(host)))?.value;
    try { draft = await readRegistrationRetryDraft(getDb(), { capability, formId, sourcePath }); } catch { /* 明示未保留，不送出敏感診斷。 */ }
  }
  const verifiedSubmission = await verifiedRegistrationSubmission(formId, sourcePath, submitted);
  return function RetryBoundary(children: ReactNode) {
    return <RegistrationRetryProvider value={{ formId, sourcePath, draft, failed, submitted: verifiedSubmission, attribution: draft?.attribution ?? registrationAttribution(attributionQuery) }}>{children}</RegistrationRetryProvider>;
  };
}


/** 共用驗證，避免個別入口直接信任網址上的成功旗標。 */
export async function verifiedRegistrationSubmission(formId: string | undefined, sourcePath: string, submitted?: string) {
  if (submitted !== "verification_required" || !formId) return false;
  const jar = await cookies();
  const secure = registrationRetrySecureCookies((await headers()).get("host") ?? "");
  return verifyRegistrationResult(jar.get(registrationResultCookieName(secure))?.value, formId, sourcePath);
}

/** 網址只決定是否呈現結果頁；成功與欄位仍須通過原來源綁定驗證。 */
export function hasRegistrationFeedbackQuery(query: { registrationRetry?: string; submitted?: string }) {
  return REGISTRATION_RETRY_QUERY_VALUES.includes(query.registrationRetry ?? "") || query.submitted === "verification_required";
}
