import { NextResponse } from "next/server";
import { trustedRequestOrigin } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { registrationAttribution } from "@/lib/registration-attribution";
import { parseRegistrationFormFields, REGISTRATION_FORM_RESERVED_FIELDS } from "@/lib/registration-form-fields";
import {
  deleteRegistrationRetryDraft,
  REGISTRATION_RETRY_VALUE_LIMITS,
  registrationRetryCookieName,
  registrationRetryCookieOptions,
  registrationRetryPayloadBudget,
  registrationRetrySecureCookies,
  registrationRetrySourcePath,
  saveRegistrationRetryDraft,
} from "@/lib/registration-form-retry";

export const REGISTRATION_RETRY_STATUSES = [400, 403, 404, 429, 503] as const;
type RetryStatus = (typeof REGISTRATION_RETRY_STATUSES)[number];
const LIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

/**
 * Where a native error may send the browser back to: the exact Origin header
 * when it is one of the origins requireSameOriginRequest accepts (request
 * URL, the browser-visible Host, NEXT_PUBLIC_APP_URL). Forwarded hosts and
 * Referer are never trusted.
 */
export function registrationRetryOrigin(request: Request) {
  const trusted = trustedRequestOrigin(request);
  if (trusted) return trusted;
  try { return new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin; }
  catch { return new URL(request.url).origin; }
}
export function trustedNativeRetryRequest(request: Request) {
  return trustedRequestOrigin(request) !== null;
}
function existingDraft(request: Request) {
  const secure = registrationRetrySecureCookies(new URL(request.url).host);
  const name = registrationRetryCookieName(secure);
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return { secure, name, value };
}
export async function clearRegistrationRetry(request: Request, response: NextResponse) {
  const { secure, name, value } = existingDraft(request);
  if (!value) return;
  try { await deleteRegistrationRetryDraft(getDb(), value); } catch { /* A storage failure must not affect a completed submission. */ }
  response.cookies.set(name, "", { ...registrationRetryCookieOptions(secure), maxAge: 0 });
}
/** Re-reads the form from the database: tenant, allowed fields and size budget come from the server record. */
async function eligibleDraftForm(formId: string) {
  if (!formId || formId.length > 128) return null;
  const db = getDb();
  const form = await db.registrationForm.findUnique({ where: { id: formId }, select: { id: true, isActive: true, fields: true, projectId: true, vendorId: true } });
  if (!form?.isActive) return null;
  if (form.projectId && !await db.salesProject.findFirst({ where: { id: form.projectId, vendorId: form.vendorId, status: "published", publishedAt: { not: null } }, select: { id: true } })) return null;
  const fields = parseRegistrationFormFields(form.fields);
  if (!fields.success) return null;
  return {
    id: form.id,
    vendorId: form.vendorId,
    valueLimits: new Map<string, number>(fields.data.map((field) => [field.key, REGISTRATION_RETRY_VALUE_LIMITS[field.type]])),
    maxPayloadBytes: registrationRetryPayloadBudget(fields.data),
  };
}
function stringField(data: FormData | null, key: string) {
  const value = data?.get(key);
  return typeof value === "string" ? value : undefined;
}
function submittedAttribution(data: FormData | null) {
  return registrationAttribution({ ref: stringField(data, "referralCode"), share: stringField(data, "shareCode"), lp: stringField(data, "landingPageId") });
}

/**
 * Validated, non-PII source context that the page itself reads from its URL
 * (affiliate `ref`, live share `share`, marketing page `lp`, and the selected
 * `/form` session `liveId`), so a retry keeps the attribution and session the
 * visitor arrived with, as a JavaScript retry on the same URL would.
 */
function retainSourceQuery(target: URL, sourcePath: string, data: FormData | null) {
  const attribution = submittedAttribution(data);
  if (attribution.referralCode) target.searchParams.set("ref", attribution.referralCode);
  if (attribution.shareCode) target.searchParams.set("share", attribution.shareCode);
  if (attribution.landingPageId) target.searchParams.set("lp", attribution.landingPageId);
  const liveId = stringField(data, "liveId");
  if (sourcePath.startsWith("/form/") && liveId && LIVE_ID_PATTERN.test(liveId)) target.searchParams.set("liveId", liveId);
}

/**
 * Native (no-JavaScript) error path: always a 303 with only an opaque status
 * and validated source context in the URL. Fields are retained only for a
 * same-origin POST back to a public registration path, encrypted and bound to
 * that path and form.
 */
export async function registrationRetryResponse(request: Request, data: FormData | null, status: number) {
  const returnPath = stringField(data, "__registrationReturnPath");
  const sourcePath = returnPath ? registrationRetrySourcePath(returnPath) : null;
  const origin = registrationRetryOrigin(request);
  if (!trustedNativeRetryRequest(request) || !sourcePath) return NextResponse.redirect(new URL("/registration-error", origin), { status: 303, headers: { "Cache-Control": "no-store" } });
  const target = new URL(sourcePath, origin);
  retainSourceQuery(target, sourcePath, data);
  const errorStatus: RetryStatus = (REGISTRATION_RETRY_STATUSES as readonly number[]).includes(status) ? status as RetryStatus : 503;
  let saved: string | null = null;
  try {
    // A separate draft-write budget so a rate-limited submission cannot
    // keep creating ciphertext rows.
    const limited = await checkRateLimit(request, "registration-retry-draft", 10, 60_000);
    if (!limited && data) {
      const form = await eligibleDraftForm(stringField(data, "formId") ?? "");
      const answers: Record<string, string> = {};
      let valid = Boolean(form);
      for (const [key, value] of data.entries()) {
        if (REGISTRATION_FORM_RESERVED_FIELDS.has(key)) continue;
        const limit = form?.valueLimits.get(key);
        if (limit === undefined || typeof value !== "string" || value.length > limit || Object.hasOwn(answers, key)) { valid = false; break; }
        Object.defineProperty(answers, key, { value, enumerable: true });
      }
      if (form && valid) saved = await saveRegistrationRetryDraft(getDb(), {
        vendorId: form.vendorId, formId: form.id, sourcePath, answers, maxPayloadBytes: form.maxPayloadBytes,
        attribution: submittedAttribution(data),
        liveId: stringField(data, "liveId") || null, status: errorStatus,
      });
    }
  } catch { /* Report "unavailable" honestly; never output fields or ciphertext. */ }
  target.searchParams.set("registrationRetry", saved ? String(errorStatus) : "unavailable");
  const response = NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "no-store" } });
  if (saved) {
    const previous = existingDraft(request);
    try { await deleteRegistrationRetryDraft(getDb(), previous.value); } catch { /* The old draft still expires by TTL. */ }
    response.cookies.set(previous.name, saved, registrationRetryCookieOptions(previous.secure));
  } else {
    await clearRegistrationRetry(request, response);
  }
  return response;
}
