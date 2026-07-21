import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { readFormDataBody, readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  attributionCookieFromRequest,
  recordLeadAttribution,
  referralCodeFromRequest,
  resolveReferral,
  resolveTeamFunnelAttribution,
  sourcePageSlugFromRequest,
} from "@/lib/team-funnel-attribution";
import {
  parseRegistrationFormFields,
  REGISTRATION_FORM_FIELD_KEY,
  REGISTRATION_FORM_RESERVED_FIELDS,
} from "@/lib/registration-form-fields";
import { normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";

const FORM_SUBMISSION_COOKIE = "celebratedeal_form_submission";
const FORM_SUBMISSION_COOKIE_TTL_SECONDS = 60 * 30;
const SubmissionAnswers = z.record(
  z.string().regex(REGISTRATION_FORM_FIELD_KEY),
  z.string().max(2_000),
).refine((answers) => Object.keys(answers).length <= 32);

const SubmissionPayload = z.object({
  formId: z.string().min(1).max(128),
  liveId: z.string().min(1).max(128).nullable().optional(),
  payload: SubmissionAnswers,
  referralCode: z.string().min(1).max(80).nullable().optional(),
  redirectTo: z.string().max(2_048).optional(),
});

function stableSubmissionId(formId: string, liveId: string | null, email: string) {
  const digest = createHash("sha256")
    .update(JSON.stringify([formId, liveId, email]))
    .digest("hex")
    .slice(0, 32);
  return `formsub_${digest}`;
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isNativeFormPost = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: !isNativeFormPost });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "form-submissions", 10, 60_000);
  if (limited) return limited;

  const nativeFormData = isNativeFormPost ? await readFormDataBody(request) : null;
  const parsed = SubmissionPayload.safeParse(
    isNativeFormPost ? nativeFormPayload(nativeFormData) : await readJsonBody(request),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const name = parsed.data.payload.name?.trim() ?? "";
  const email = normalizeBlacklistIdentifier("email", parsed.data.payload.email ?? "") ?? "";
  const submittedPhone = parsed.data.payload.phone?.trim() || null;
  const phone = submittedPhone ? normalizeBlacklistIdentifier("phone", submittedPhone) : null;

  if (!z.string().min(1).max(160).safeParse(name).success || !z.string().email().max(320).safeParse(email).success) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  }
  if (submittedPhone && !phone) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }

  const form = await getDb().registrationForm.findUnique({ where: { id: parsed.data.formId } });
  if (!form || !form.isActive) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const fieldSpecs = parseRegistrationFormFields(form.fields);
  if (!fieldSpecs.success) {
    return NextResponse.json({ error: "Form configuration unavailable" }, { status: 503 });
  }
  const allowedFields = new Set(fieldSpecs.data.map((field) => field.key));
  const hasUnexpectedField = Object.keys(parsed.data.payload).some((key) => !allowedFields.has(key));
  const missingRequiredField = fieldSpecs.data.some(
    (field) => field.required && !parsed.data.payload[field.key]?.trim(),
  );
  if (hasUnexpectedField || missingRequiredField || !allowedFields.has("name") || !allowedFields.has("email")) {
    return NextResponse.json({ error: "Invalid form answers" }, { status: 400 });
  }

  if (parsed.data.liveId) {
    const live = await getDb().live.findFirst({
      where: { id: parsed.data.liveId, vendorId: form.vendorId, formId: form.id },
      select: { id: true },
    });
    if (!live) {
      return NextResponse.json({ error: "Live not found" }, { status: 404 });
    }
  }

  const blocked = await getDb().blacklist.findFirst({
    where: {
      vendorId: form.vendorId,
      isActive: true,
      OR: [
        { identifierType: "email", identifier: email },
        ...(phone ? [{ identifierType: "phone", identifier: phone }] : []),
      ],
    },
  });

  if (blocked) {
    return NextResponse.json({ error: "Submission blocked" }, { status: 403 });
  }

  const duplicate = await getDb().formSubmission.findFirst({
    where: { formId: form.id, liveId: parsed.data.liveId ?? null, email },
    select: { id: true },
  });

  const attributionCookie = attributionCookieFromRequest(request);
  const referral = await resolveReferral({
    vendorId: form.vendorId,
    queryCode: referralCodeFromRequest(request),
    legacyCode: parsed.data.referralCode,
    cookie: attributionCookie,
  });
  const attribution = await resolveTeamFunnelAttribution({
    vendorId: form.vendorId,
    liveId: parsed.data.liveId ?? null,
    sourcePageSlug: sourcePageSlugFromRequest(request),
    referral,
  });
  if (duplicate) {
    await recordLeadAttribution(duplicate.id, attribution);
    return submissionResponse(request, parsed.data.redirectTo, isNativeFormPost, true, duplicate.id);
  }

  const submissionId = stableSubmissionId(parsed.data.formId, parsed.data.liveId ?? null, email);
  const normalizedAnswers = {
    ...parsed.data.payload,
    name,
    email,
    ...(allowedFields.has("phone") ? { phone: phone ?? "" } : {}),
  };
  let submission: { id: string };
  try {
    submission = await getDb().formSubmission.create({
      data: {
        id: submissionId,
        formId: parsed.data.formId,
        liveId: parsed.data.liveId ?? null,
        name,
        email,
        phone,
        source: parsed.data.liveId ? "live" : "form",
        answers: normalizedAnswers as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const concurrentSubmission = await getDb().formSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });
    if (!concurrentSubmission) throw error;
    await recordLeadAttribution(concurrentSubmission.id, attribution);
    return submissionResponse(request, parsed.data.redirectTo, isNativeFormPost, true, concurrentSubmission.id);
  }
  await recordLeadAttribution(submission.id, attribution);

  if (parsed.data.liveId) {
    await getDb().analyticsEvent.create({
      data: {
        vendorId: form.vendorId,
        liveId: parsed.data.liveId,
        visitorId: attributionCookie?.visitorId ?? submission.id,
        eventType: "lead_submit",
        payload: { formId: parsed.data.formId, ref: referral?.code ?? null },
      },
    });
  }

  if (referral) {
    await getDb().affiliateClick.updateMany({
      where: {
        vendorId: form.vendorId,
        referralCode: referral.code,
        convertedAt: null,
      },
      data: { convertedAt: new Date() },
    });
  }

  return submissionResponse(request, parsed.data.redirectTo, isNativeFormPost, false, submission.id);
}

function submissionResponse(
  request: Request,
  redirectTo: string | undefined,
  isNativeFormPost: boolean,
  duplicate: boolean,
  formSubmissionId: string,
) {
  const response = isNativeFormPost && redirectTo && isSameOriginRedirect(redirectTo, request.url)
    ? NextResponse.redirect(withSubmittedSearchParam(redirectTo, request.url), { status: 303 })
    : NextResponse.json({ ok: true, ...(duplicate ? { duplicate: true } : {}) });

  response.cookies.set(FORM_SUBMISSION_COOKIE, formSubmissionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: FORM_SUBMISSION_COOKIE_TTL_SECONDS,
  });
  return response;
}

function withSubmittedSearchParam(redirectTo: string, requestUrl: string) {
  const redirectUrl = new URL(redirectTo, requestUrl);
  redirectUrl.searchParams.set("submitted", "1");
  return redirectUrl;
}

function isSameOriginRedirect(redirectTo: string, requestUrl: string) {
  try {
    return redirectTo.startsWith("/")
      && new URL(redirectTo, requestUrl).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

function nativeFormPayload(formData: FormData | null) {
  if (!formData) return {};
  const payload: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (!REGISTRATION_FORM_RESERVED_FIELDS.has(key)) {
      if (typeof value !== "string") return {};
      payload[key] = value;
    }
  }

  const liveId = formData.get("liveId");
  const referralCode = formData.get("referralCode");
  const redirectTo = formData.get("redirectTo");
  return {
    formId: String(formData.get("formId") ?? ""),
    liveId: typeof liveId === "string" && liveId ? liveId : null,
    payload,
    referralCode: typeof referralCode === "string" && referralCode ? referralCode : null,
    redirectTo: typeof redirectTo === "string" && redirectTo.startsWith("/") ? redirectTo : undefined,
  };
}
