import { NextResponse } from "next/server";
import { z } from "zod";
import { readFormDataBody, requireSameOriginRequest } from "@/lib/api-security";
import { getBrowserReturnAppUrl } from "@/lib/app-url";
import { confirmMerchantEmailVerification } from "@/lib/merchant-email-verification";
import { MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH } from "@/lib/merchant-email-verification-token";
import { checkRateLimit } from "@/lib/rate-limit";

const ConfirmationForm = z.object({
  token: z.string().min(1).max(MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH),
}).strict();

function redirectResult(request: Request, status: "verified" | "already_verified" | "invalid") {
  const url = new URL("/verify-email", getBrowserReturnAppUrl(request));
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Applies a merchant email verification link. The e-mailed link opens
 * `/verify-email?token=…`, which only shows a confirm button; this POST does
 * the update, so mail scanners that prefetch links cannot verify an address
 * on their own. No session is needed: the token alone names the user and the
 * address, and the final update is bound to both.
 */
export async function POST(request: Request) {
  if (!request.headers.get("origin")) {
    return NextResponse.json({ error: "Missing request origin" }, { status: 403 });
  }
  const sameOrigin = requireSameOriginRequest(request);
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "merchant-email-verification-confirm", 20, 60_000);
  if (limited) return limited;

  const formData = await readFormDataBody(request);
  const parsed = ConfirmationForm.safeParse({ token: formData?.get("token") });
  if (!parsed.success) return redirectResult(request, "invalid");
  try {
    const result = await confirmMerchantEmailVerification(parsed.data.token);
    return redirectResult(request, result.status);
  } catch {
    return redirectResult(request, "invalid");
  }
}
