import { NextResponse } from "next/server";
import { z } from "zod";
import { isTransientTransactionError, revertAccountEmailChange, type AccountEmailRevertResult } from "@/lib/account-email-change";
import { ACCOUNT_EMAIL_CHANGE_MAX_LENGTH, ACCOUNT_EMAIL_REVERT_PATH } from "@/lib/account-email-change-token";
import { readFormDataBody, requireSameOriginRequest } from "@/lib/api-security";
import { getBrowserReturnAppUrl } from "@/lib/app-url";
import { checkRateLimit } from "@/lib/rate-limit";

const RevertForm = z.object({
  token: z.string().min(1).max(ACCOUNT_EMAIL_CHANGE_MAX_LENGTH),
}).strict();

function redirectResult(request: Request, status: AccountEmailRevertResult["status"]) {
  const url = new URL(ACCOUNT_EMAIL_REVERT_PATH, getBrowserReturnAppUrl(request));
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

/**
 * "不是我操作，還原 Email". The security notice's link opens
 * `/revert-email-change?token=…`, which only shows a button; this POST acts,
 * so mail scanners that prefetch links change nothing. No session is read or
 * created: the token alone names the request, and every session of the
 * account ends instead.
 */
export async function POST(request: Request) {
  if (!request.headers.get("origin")) {
    return NextResponse.json({ error: "Missing request origin" }, { status: 403 });
  }
  const sameOrigin = requireSameOriginRequest(request);
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "account-email-change-revert", 20, 60_000);
  if (limited) return limited;

  const formData = await readFormDataBody(request);
  const parsed = RevertForm.safeParse({ token: formData?.get("token") });
  if (!parsed.success) return redirectResult(request, "invalid");
  try {
    const result = await revertAccountEmailChange(parsed.data.token);
    return redirectResult(request, result.status);
  } catch (error) {
    return redirectResult(request, isTransientTransactionError(error) ? "retry" : "invalid");
  }
}
