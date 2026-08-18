import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { readFormDataBody, readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  attributionCookieFromRequest,
  liveShareCodeFromRequest,
  recordLeadAttribution,
  referralCodeFromRequest,
  resolveReferral,
  resolveTeamFunnelAttribution,
  sourcePageSlugFromRequest,
  visitorIdFromRequest,
} from "@/lib/team-funnel-attribution";
import {
  parseRegistrationFormFields,
  REGISTRATION_FORM_FIELD_KEY,
  REGISTRATION_FORM_RESERVED_FIELDS,
} from "@/lib/registration-form-fields";
import { normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";
import { allowsLegacyAffiliateAttribution, defaultAffiliateCode } from "@/lib/live-quota-policy";
import { validateRegistrationFormAnswers } from "@/lib/registration-form-answers";
import { ensureFormSubmissionVerificationDelivery } from "@/lib/email-delivery";
import { captureOperationalError } from "@/lib/monitoring";
import { FORM_SUBMISSION_VERIFICATION_TTL_MS } from "@/lib/form-submission-verification";
import {
  hasPublicRegistrationSession,
  publicRegistrationSessionWhere,
} from "@/lib/public-registration-form";

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
  shareCode: z.string().regex(/^tls1\.[A-Za-z0-9_-]{32,155}$/u).max(160).nullable().optional(),
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

function submissionContactError({
  name,
  email,
  submittedPhone,
  phone,
}: {
  name: string;
  email: string;
  submittedPhone: string | null;
  phone: string | null;
}) {
  if (!z.string().min(1).max(160).safeParse(name).success || !z.string().email().max(320).safeParse(email).success) {
    return "Name and email are required";
  }
  if (submittedPhone && !phone) return "Invalid phone";
  return null;
}

async function resolveSubmissionAttribution({
  request,
  vendorId,
  liveId,
  referralCode,
  liveShareCode,
  liveQuotaPolicy,
}: {
  request: Request;
  vendorId: string;
  liveId: string | null;
  referralCode: string | null | undefined;
  liveShareCode: string | null | undefined;
  liveQuotaPolicy: unknown;
}) {
  const parsedAttributionCookie = attributionCookieFromRequest(request);
  const attributionCookie = parsedAttributionCookie && parsedAttributionCookie.visitorId === visitorIdFromRequest(request)
    ? parsedAttributionCookie
    : null;
  const sourcePageSlug = sourcePageSlugFromRequest(request);
  const resolvedLiveShareCode = liveShareCode ?? liveShareCodeFromRequest(request);
  const legacyAffiliateEnabled = !liveId || allowsLegacyAffiliateAttribution(liveQuotaPolicy);
  const defaultReferralCode = legacyAffiliateEnabled && !sourcePageSlug && !resolvedLiveShareCode
    ? defaultAffiliateCode(liveQuotaPolicy)
    : null;
  const referral = await resolveReferral({
    vendorId,
    queryCode: legacyAffiliateEnabled && !resolvedLiveShareCode ? referralCodeFromRequest(request) : null,
    legacyCode: legacyAffiliateEnabled && !resolvedLiveShareCode ? referralCode ?? defaultReferralCode : null,
    cookie: legacyAffiliateEnabled ? attributionCookie : null,
  });
  const attribution = await resolveTeamFunnelAttribution({
    vendorId,
    liveId,
    sourcePageSlug: resolvedLiveShareCode ? null : sourcePageSlug,
    referral,
    liveShareCode: resolvedLiveShareCode,
  });
  return { referral, attribution, liveShareCode: resolvedLiveShareCode };
}

async function loadFormLiveQuotaPolicy({
  formId,
  vendorId,
  liveId,
}: {
  formId: string;
  vendorId: string;
  liveId: string | null;
}) {
  if (!liveId) return { found: true, quotaPolicy: null as unknown, notification: null };

  const live = await getDb().live.findFirst({
    where: {
      id: liveId,
      ...publicRegistrationSessionWhere(formId, vendorId),
    },
    select: {
      id: true,
      title: true,
      quotaPolicy: true,
      vendor: { select: { name: true } },
      messageTemplate: {
        select: {
          id: true,
          vendorId: true,
          channel: true,
          trigger: true,
          subject: true,
          body: true,
          isActive: true,
        },
      },
    },
  });
  return live ? {
    found: true,
    quotaPolicy: live.quotaPolicy,
    notification: {
      liveId: live.id,
      liveTitle: live.title,
      vendorName: live.vendor.name,
      template: live.messageTemplate,
    },
  } : { found: false, quotaPolicy: null as unknown, notification: null };
}

async function hasVisiblePublicRegistrationSession({
  formId,
  vendorId,
  hideExpiredSessions,
}: {
  formId: string;
  vendorId: string;
  hideExpiredSessions: boolean;
}) {
  const sessions = await getDb().live.findMany({
    where: publicRegistrationSessionWhere(formId, vendorId),
    select: { scheduledAt: true, status: true },
  });
  return hasPublicRegistrationSession(sessions, {
    now: new Date(),
    hideExpiredSessions,
  });
}

type VerifiableSubmission = {
  id: string;
  name: string;
  email: string;
  liveId: string | null;
  verificationStatus: "UNVERIFIED" | "VERIFIED";
  verificationVersion: number;
  verificationExpiresAt: Date | null;
};

async function refreshExpiredVerification(submission: VerifiableSubmission, now = new Date()) {
  if (
    submission.verificationStatus === "VERIFIED"
    || (submission.verificationExpiresAt && submission.verificationExpiresAt > now)
  ) return submission;

  const verificationExpiresAt = new Date(now.getTime() + FORM_SUBMISSION_VERIFICATION_TTL_MS);
  await getDb().formSubmission.updateMany({
    where: {
      id: submission.id,
      verificationStatus: "UNVERIFIED",
      verificationVersion: submission.verificationVersion,
      OR: [
        { verificationExpiresAt: null },
        { verificationExpiresAt: { lte: now } },
      ],
    },
    data: {
      verificationVersion: { increment: 1 },
      verificationExpiresAt,
    },
  });
  return getDb().formSubmission.findUniqueOrThrow({
    where: { id: submission.id },
    select: {
      id: true,
      name: true,
      email: true,
      liveId: true,
      verificationStatus: true,
      verificationVersion: true,
      verificationExpiresAt: true,
    },
  });
}

async function enqueueSubmissionVerificationSafely({
  vendorId,
  vendorName,
  emailBrand,
  submission,
}: {
  vendorId: string;
  vendorName: string;
  emailBrand: { senderName: string | null; supportEmail: string | null; contactUrl: string | null };
  submission: VerifiableSubmission;
}) {
  if (submission.verificationStatus === "VERIFIED") return true;
  if (!submission.verificationExpiresAt) return false;
  try {
    const delivery = await ensureFormSubmissionVerificationDelivery({
      vendorId,
      vendorName,
      liveId: submission.liveId,
      formSubmissionId: submission.id,
      recipientName: submission.name,
      recipientEmail: submission.email,
      verificationVersion: submission.verificationVersion,
      verificationExpiresAt: submission.verificationExpiresAt,
      emailBrand,
    });
    return delivery.status !== "suppressed";
  } catch (error) {
    try {
      captureOperationalError(error, {
        source: "form_submission",
        operation: "verification_email_enqueue",
        status: "failed",
      });
    } catch {
      // Monitoring must not expose contact data or change the durable state.
    }
    return false;
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isNativeFormPost = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  if (isNativeFormPost && !request.headers.get("origin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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

  const contactError = submissionContactError({ name, email, submittedPhone, phone });
  if (contactError) {
    return NextResponse.json({ error: contactError }, { status: 400 });
  }

  const form = await getDb().registrationForm.findUnique({
    where: { id: parsed.data.formId },
    include: {
      vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
    },
  });
  if (!form || !form.isActive) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const fieldSpecs = parseRegistrationFormFields(form.fields);
  if (!fieldSpecs.success) {
    return NextResponse.json({ error: "Form configuration unavailable" }, { status: 503 });
  }
  const normalizedFieldAnswers = validateRegistrationFormAnswers(fieldSpecs.data, parsed.data.payload);
  if (!normalizedFieldAnswers.success) {
    return NextResponse.json({ error: "Invalid form answers" }, { status: 400 });
  }

  const submittedLiveId = parsed.data.liveId ?? null;
  if (!submittedLiveId) {
    const hasVisibleSession = await hasVisiblePublicRegistrationSession({
      formId: form.id,
      vendorId: form.vendorId,
      hideExpiredSessions: form.hideExpiredSessions,
    });
    if (hasVisibleSession) {
      return NextResponse.json({ error: "Live session selection required" }, { status: 400 });
    }
  }

  const liveContext = await loadFormLiveQuotaPolicy({
    formId: form.id,
    vendorId: form.vendorId,
    liveId: submittedLiveId,
  });
  if (!liveContext.found) {
    return NextResponse.json({ error: "Live not found" }, { status: 404 });
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
    where: { formId: form.id, liveId: submittedLiveId, email },
    select: {
      id: true,
      name: true,
      email: true,
      liveId: true,
      verificationStatus: true,
      verificationVersion: true,
      verificationExpiresAt: true,
    },
  });

  const { referral, attribution, liveShareCode } = await resolveSubmissionAttribution({
    request,
    vendorId: form.vendorId,
    liveId: submittedLiveId,
    referralCode: parsed.data.referralCode,
    liveShareCode: parsed.data.shareCode,
    liveQuotaPolicy: liveContext.quotaPolicy,
  });
  if (liveShareCode && !attribution) {
    return NextResponse.json({ error: "Live share unavailable" }, { status: 400 });
  }
  if (duplicate) {
    const refreshed = await refreshExpiredVerification(duplicate);
    const verificationQueued = await enqueueSubmissionVerificationSafely({
      vendorId: form.vendorId,
      vendorName: form.vendor.name,
      emailBrand: {
        senderName: form.vendor.senderName,
        supportEmail: form.vendor.supportEmail,
        contactUrl: form.vendor.contactUrl,
      },
      submission: refreshed,
    });
    if (!verificationQueued) {
      return NextResponse.json({ error: "Verification email unavailable" }, { status: 503 });
    }
    return submissionResponse(request, parsed.data.redirectTo, isNativeFormPost, duplicate.id);
  }

  const submissionId = stableSubmissionId(parsed.data.formId, submittedLiveId, email);
  const normalizedAnswers = {
    ...normalizedFieldAnswers.data,
    name,
    email,
    ...(fieldSpecs.data.some((field) => field.key === "phone") ? { phone: phone ?? "" } : {}),
  };
  const verificationExpiresAt = new Date(Date.now() + FORM_SUBMISSION_VERIFICATION_TTL_MS);
  let submission: VerifiableSubmission;
  try {
    submission = await getDb().formSubmission.create({
      data: {
        id: submissionId,
        formId: parsed.data.formId,
        liveId: submittedLiveId,
        name,
        email,
        phone,
        source: submittedLiveId ? "live" : "form",
        answers: normalizedAnswers as Prisma.InputJsonValue,
        verificationStatus: "UNVERIFIED",
        verificationVersion: 1,
        verificationExpiresAt,
        affiliateClickId: referral?.source === "cookie" ? referral.clickId ?? null : null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        liveId: true,
        verificationStatus: true,
        verificationVersion: true,
        verificationExpiresAt: true,
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const concurrentSubmission = await getDb().formSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        name: true,
        email: true,
        liveId: true,
        verificationStatus: true,
        verificationVersion: true,
        verificationExpiresAt: true,
      },
    });
    if (!concurrentSubmission) throw error;
    const verificationQueued = await enqueueSubmissionVerificationSafely({
      vendorId: form.vendorId,
      vendorName: form.vendor.name,
      emailBrand: {
        senderName: form.vendor.senderName,
        supportEmail: form.vendor.supportEmail,
        contactUrl: form.vendor.contactUrl,
      },
      submission: concurrentSubmission,
    });
    if (!verificationQueued) {
      return NextResponse.json({ error: "Verification email unavailable" }, { status: 503 });
    }
    return submissionResponse(request, parsed.data.redirectTo, isNativeFormPost, concurrentSubmission.id);
  }
  await recordLeadAttribution(submission.id, attribution);
  const verificationQueued = await enqueueSubmissionVerificationSafely({
    vendorId: form.vendorId,
    vendorName: form.vendor.name,
    emailBrand: {
      senderName: form.vendor.senderName,
      supportEmail: form.vendor.supportEmail,
      contactUrl: form.vendor.contactUrl,
    },
    submission,
  });
  if (!verificationQueued) {
    return NextResponse.json({ error: "Verification email unavailable" }, { status: 503 });
  }

  return submissionResponse(request, parsed.data.redirectTo, isNativeFormPost, submission.id);
}

function submissionResponse(
  request: Request,
  redirectTo: string | undefined,
  isNativeFormPost: boolean,
  formSubmissionId: string,
) {
  const response = isNativeFormPost && redirectTo && isSameOriginRedirect(redirectTo, request.url)
    ? NextResponse.redirect(withSubmittedSearchParam(redirectTo, request.url), { status: 303 })
    : NextResponse.json({ ok: true, verificationRequired: true });

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
  redirectUrl.searchParams.set("submitted", "verification_required");
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
  const shareCode = formData.get("shareCode");
  const redirectTo = formData.get("redirectTo");
  return {
    formId: String(formData.get("formId") ?? ""),
    liveId: typeof liveId === "string" && liveId ? liveId : null,
    payload,
    referralCode: typeof referralCode === "string" && referralCode ? referralCode : null,
    shareCode: typeof shareCode === "string" && shareCode ? shareCode : null,
    redirectTo: typeof redirectTo === "string" && redirectTo.startsWith("/") ? redirectTo : undefined,
  };
}
