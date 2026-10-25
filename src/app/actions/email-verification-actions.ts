"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { assertServerActionSecurity } from "@/lib/csrf";
import { sendMerchantEmailVerification } from "@/lib/merchant-email-verification";
import { checkRateLimit } from "@/lib/rate-limit";
import { TURNSTILE_ACTIONS, TURNSTILE_RESPONSE_FIELD, turnstileErrorCode, verifyTurnstileToken } from "@/lib/turnstile";

const VERIFY_EMAIL_PATH = "/verify-email";

/**
 * Re-sends the verification link to the signed-in user's own stored address.
 * Nothing in the form names a user or an address. Order: CSRF, session,
 * already verified, IP limit, Turnstile, then the per-recipient account limit
 * inside `sendMerchantEmailVerification` (shared with the registration send).
 */
export async function resendMerchantEmailVerificationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth({ nextPath: VERIFY_EMAIL_PATH });
  if (auth.user.emailVerifiedAt) redirect(`${VERIFY_EMAIL_PATH}?status=already_verified`);

  const incoming = await headers();
  const forwarded = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const limited = await checkRateLimit(new Request(getCanonicalAppUrl(), { headers: forwarded }), "merchant-email-verification-resend-source", 10, 15 * 60 * 1000);
  if (limited) redirect(`${VERIFY_EMAIL_PATH}?error=${limited.status === 429 ? "rate_limited" : "temporarily_unavailable"}`);

  const turnstile = await verifyTurnstileToken({
    token: formData.get(TURNSTILE_RESPONSE_FIELD),
    action: TURNSTILE_ACTIONS.resendVerification,
    remoteIp: incoming.get("cf-connecting-ip") ?? incoming.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  if (!turnstile.ok) redirect(`${VERIFY_EMAIL_PATH}?error=${turnstileErrorCode(turnstile)}`);

  const result = await sendMerchantEmailVerification({ userId: auth.user.id, vendorId: auth.vendor?.id ?? null, source: "resend" });
  if (result.status === "sent") redirect(`${VERIFY_EMAIL_PATH}?status=sent`);
  if (result.status === "already_verified") redirect(`${VERIFY_EMAIL_PATH}?status=already_verified`);
  if (result.status === "rate_limited") redirect(`${VERIFY_EMAIL_PATH}?error=rate_limited`);
  redirect(`${VERIFY_EMAIL_PATH}?error=send_failed`);
}
