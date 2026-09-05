import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { getCurrentAuth } from "@/lib/auth";
import { resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { getDb } from "@/lib/db";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE, verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { beginLineLogin, type LineLoginSubjectType } from "@/lib/line-login";
import { checkRateLimit } from "@/lib/rate-limit";

const StartRequest = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("user"), redirectPath: z.string().max(1_024).default("/dashboard") }).strict(),
  z.object({ mode: z.literal("promoter"), redirectPath: z.string().max(1_024).default("/affiliate") }).strict(),
  z.object({ mode: z.literal("buyer"), grantId: z.string().min(1).max(128), redirectPath: z.string().max(1_024).default("/support/orders") }).strict(),
  z.object({ mode: z.literal("registration"), redirectPath: z.string().max(1_024).default("/verify-registration") }).strict(),
  z.object({
    mode: z.literal("login"),
    vendorSlug: z.string().min(1).max(128).optional(),
    affiliateCode: z.string().min(1).max(80).optional(),
    redirectPath: z.string().max(1_024).default("/dashboard"),
  }).strict().refine((value) => Boolean(value.vendorSlug) !== Boolean(value.affiliateCode), { message: "Exactly one LINE tenant selector is required." }),
]);

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "line-login-start", 15, 60_000);
  if (limited) return limited;
  const parsed = StartRequest.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  let vendorId: string;
  let subjectType: LineLoginSubjectType;
  let subjectId: string;
  if (parsed.data.mode === "login") {
    const vendor = parsed.data.vendorSlug
      ? await getDb().vendor.findUnique({ where: { slug: parsed.data.vendorSlug }, select: { id: true } })
      : (await getDb().affiliate.findUnique({
        where: { code: parsed.data.affiliateCode! },
        select: { vendor: { select: { id: true } } },
      }))?.vendor ?? null;
    if (!vendor) return NextResponse.json({ error: "line_login_unavailable" }, { status: 404 });
    vendorId = vendor.id;
    subjectType = "login";
    subjectId = vendor.id;
  } else if (parsed.data.mode === "buyer") {
    const grant = await resolveBuyerSupportGrant(getDb(), await cookies(), parsed.data.grantId);
    if (!grant) return NextResponse.json({ error: "buyer_authorization_required" }, { status: 403 });
    vendorId = grant.vendorId;
    subjectType = "buyer_order";
    subjectId = grant.orderId;
  } else if (parsed.data.mode === "registration") {
    const cookieStore = await cookies();
    const claim = verifyFormSubmissionChatSessionToken(cookieStore.get(FORM_SUBMISSION_CHAT_SESSION_COOKIE)?.value ?? "");
    if (!claim) return NextResponse.json({ error: "buyer_authorization_required" }, { status: 403 });
    const submission = await getDb().formSubmission.findFirst({
      where: { id: claim.submissionId, verificationStatus: "VERIFIED" },
      select: { id: true, form: { select: { vendorId: true } } },
    });
    if (!submission) return NextResponse.json({ error: "buyer_authorization_required" }, { status: 403 });
    vendorId = submission.form.vendorId;
    subjectType = "buyer_registration";
    subjectId = submission.id;
  } else {
    const auth = await getCurrentAuth();
    if (!auth?.vendor) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    vendorId = auth.vendor.id;
    if (parsed.data.mode === "promoter") {
      const affiliate = await getDb().affiliate.findFirst({
        where: { vendorId, userId: auth.user.id, isActive: true },
        select: { id: true },
      });
      if (!affiliate) return NextResponse.json({ error: "promoter_authorization_required" }, { status: 403 });
      subjectType = "promoter";
      subjectId = affiliate.id;
    } else {
      subjectType = "user";
      subjectId = auth.user.id;
    }
  }

  try {
    const result = await beginLineLogin(getDb(), {
      vendorId,
      subjectType,
      subjectId,
      redirectPath: parsed.data.redirectPath,
    });
    return NextResponse.json({ authorizationUrl: result.authorizationUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "line_login_unavailable" }, { status: 503 });
  }
}
