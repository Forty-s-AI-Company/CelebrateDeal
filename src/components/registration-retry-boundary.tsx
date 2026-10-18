import { registrationAttribution, type RegistrationAttributionQuery } from "@/lib/registration-attribution";
import { registrationResultCookieName, verifyRegistrationResult } from "@/lib/registration-submission-receipt";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { getDb } from "@/lib/db";
import { readRegistrationRetryDraft, registrationRetrySecureCookies, registrationRetryCookieName } from "@/lib/registration-form-retry";
import { RegistrationRetryProvider } from "@/components/registration-retry-context";

/** 公開入口載入後才讀草稿，避免跳過原本的發布與存取檢查。 */
export async function registrationRetryBoundary({ formId, sourcePath, retry, submitted, attributionQuery }: {
  formId?: string; sourcePath: string; retry?: string | string[]; submitted?: string; attributionQuery?: RegistrationAttributionQuery;
}) {
  const failed = typeof retry === "string" && ["400", "403", "404", "429", "503", "unavailable"].includes(retry);
  let draft = null;
  if (failed && retry !== "unavailable" && formId) {
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
  return ["400", "403", "404", "429", "503", "unavailable"].includes(query.registrationRetry ?? "") || query.submitted === "verification_required";
}
