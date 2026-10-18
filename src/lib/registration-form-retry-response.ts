import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { registrationAttribution } from "@/lib/registration-attribution";
import { parseRegistrationFormFields, REGISTRATION_FORM_RESERVED_FIELDS } from "@/lib/registration-form-fields";
import {
  deleteRegistrationRetryDraft,
  registrationRetryCookieName,
  registrationRetryCookieOptions,
  registrationRetrySecureCookies,
  registrationRetrySourcePath,
  saveRegistrationRetryDraft,
} from "@/lib/registration-form-retry";

export const REGISTRATION_RETRY_STATUSES = [400, 403, 404, 429, 503] as const;
type RetryStatus = (typeof REGISTRATION_RETRY_STATUSES)[number];

export function registrationRetryOrigin(request: Request) {
  // The deployer-configured public origin; a forwarded host is never trusted.
  try { return new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin; }
  catch { return new URL(request.url).origin; }
}
export function trustedNativeRetryRequest(request: Request) {
  // Drafts require an exact Origin match; Referer is not accepted as a substitute.
  return request.headers.get("origin") === registrationRetryOrigin(request);
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
/** Re-reads the form from the database: tenant and allowed fields come from the server record. */
async function eligibleDraftForm(formId: string) {
  if (!formId || formId.length > 128) return null;
  const db = getDb();
  const form = await db.registrationForm.findUnique({ where: { id: formId }, select: { id: true, isActive: true, fields: true, projectId: true, vendorId: true } });
  if (!form?.isActive) return null;
  if (form.projectId && !await db.salesProject.findFirst({ where: { id: form.projectId, vendorId: form.vendorId, status: "published", publishedAt: { not: null } }, select: { id: true } })) return null;
  const fields = parseRegistrationFormFields(form.fields);
  return fields.success ? { id: form.id, vendorId: form.vendorId, keys: new Set(fields.data.map((field) => field.key)) } : null;
}
function stringField(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : undefined;
}

/**
 * Native (no-JavaScript) error path: always a 303 with only an opaque status
 * in the URL. Fields are retained only for a same-origin POST back to a
 * public registration path, encrypted and bound to that path and form.
 */
export async function registrationRetryResponse(request: Request, data: FormData | null, status: number) {
  const returnPath = data ? stringField(data, "__registrationReturnPath") : undefined;
  const sourcePath = returnPath ? registrationRetrySourcePath(returnPath) : null;
  if (!trustedNativeRetryRequest(request) || !sourcePath) return NextResponse.redirect(new URL("/registration-error", registrationRetryOrigin(request)), { status: 303, headers: { "Cache-Control": "no-store" } });
  const target = new URL(sourcePath, registrationRetryOrigin(request));
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
        if (!form?.keys.has(key) || typeof value !== "string" || Object.hasOwn(answers, key)) { valid = false; break; }
        Object.defineProperty(answers, key, { value, enumerable: true });
      }
      if (form && valid) saved = await saveRegistrationRetryDraft(getDb(), {
        vendorId: form.vendorId, formId: form.id, sourcePath, answers,
        attribution: registrationAttribution({ ref: stringField(data, "referralCode"), share: stringField(data, "shareCode"), lp: stringField(data, "landingPageId") }),
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
