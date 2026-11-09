import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { createEmailRecipientHash, revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { writeAuditLog } from "@/lib/audit";
import { isWp4BoundNonProductionRuntime } from "@/lib/wp4-runtime-boundary";
import { MERCHANT_INVITATION_AUDIT_ACTION } from "@/lib/merchant-invitation-admin";
import { createMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
import {
  maskedMerchantInviteEmail,
  MERCHANT_INVITE_AUDIT_TARGET_TYPE,
  merchantInviteEmailHash,
} from "@/lib/merchant-registration-invite-records";

/**
 * Staging-only support for the O-13 first-success runner
 * (scripts/staging-first-success.mjs). Both ops routes that use this module sit
 * behind `authorizeWp4Ops` (JOB_SECRET, bound staging Preview runtime, exact
 * source SHA, no query and no body), so nothing here is reachable in
 * Production.
 *
 * Every mailbox is a Resend test address (`delivered+<label>@resend.dev`):
 * Resend accepts and simulates delivery without reaching a real person. A run
 * id derives both the merchant and the buyer address, so the status lookup
 * never accepts a caller-chosen email and cannot read another tenant's data.
 */
export const FIRST_SUCCESS_RUN_ID_HEADER = "x-celebratedeal-first-success-run";
export const FIRST_SUCCESS_RUN_ID = /^[a-f0-9]{24}$/u;
/** Short-lived on purpose: the runner uses it within minutes. */
export const FIRST_SUCCESS_INVITE_TTL_MS = 30 * 60 * 1_000;

const RESEND_EVENTS = new Set([
  "queued", "scheduled", "sent", "delivered", "delivery_delayed", "bounced", "complained",
  "opened", "clicked", "failed", "canceled", "suppressed",
]);
const DELIVERY_STATUSES = new Set([
  "queued", "sending", "sent", "failed", "exhausted", "suppressed", "superseded", "recovered",
]);

export function firstSuccessOwnerEmail(runId: string) {
  return `delivered+cdfs-owner-${runId}@resend.dev`;
}

export function firstSuccessBuyerEmail(runId: string) {
  return `delivered+cdfs-buyer-${runId}@resend.dev`;
}

const OWNER_EMAIL = /^delivered\+cdfs-owner-[a-f0-9]{24}@resend\.dev$/u;

/**
 * Registration skips Turnstile only for this runner's own Resend test mailbox
 * and only on the bound staging Preview runtime (never Production or any other
 * deployment). The caller must already hold a valid, unrevoked signed invite
 * for that address, which only JOB_SECRET or a platform admin can issue.
 */
export function isFirstSuccessTurnstileExempt(invitedEmail: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  return OWNER_EMAIL.test(invitedEmail) && isWp4BoundNonProductionRuntime(env);
}

export function readFirstSuccessRunId(request: Request) {
  const value = request.headers.get(FIRST_SUCCESS_RUN_ID_HEADER);
  return value && FIRST_SUCCESS_RUN_ID.test(value) ? value : null;
}

/**
 * Signs the invite and records it exactly like an admin-issued one (masked
 * address and keyed hash only), so it shows in /admin/merchant-invitations and
 * can be revoked there. The link is returned only after the entry is stored.
 */
export async function createFirstSuccessInvite(now = new Date()) {
  const runId = randomBytes(12).toString("hex");
  const invite = createMerchantRegistrationInvite({
    email: firstSuccessOwnerEmail(runId),
    now,
    ttlMs: FIRST_SUCCESS_INVITE_TTL_MS,
  });
  await writeAuditLog({
    vendorId: null,
    actorId: null,
    actorLabel: "job:staging-first-success",
    action: MERCHANT_INVITATION_AUDIT_ACTION,
    targetType: MERCHANT_INVITE_AUDIT_TARGET_TYPE,
    targetId: invite.jti,
    after: {
      maskedEmail: maskedMerchantInviteEmail(invite.email),
      emailHash: merchantInviteEmailHash(invite.email),
      expiresAt: invite.expiresAt.toISOString(),
    },
  });
  return { runId, invitePath: `/register?invite=${encodeURIComponent(invite.token)}`, expiresAt: invite.expiresAt };
}

export type ProviderEvent = "NOT_LOOKED_UP" | "LOOKUP_UNAVAILABLE" | "OTHER" | Uppercase<string>;
type ProviderEmail = { event: ProviderEvent; html: string; text: string };

/** Read one sent email back from Resend. Only the event and the bodies are used; nothing is returned raw. */
export async function lookupProviderEmail(
  providerMessageId: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
  retryAfter429 = true,
): Promise<ProviderEmail> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!providerMessageId) return { event: "NOT_LOOKED_UP", html: "", text: "" };
  if (!apiKey || !/^[A-Za-z0-9-]{8,64}$/u.test(providerMessageId)) return { event: "LOOKUP_UNAVAILABLE", html: "", text: "" };
  try {
    const response = await fetchImpl(`https://api.resend.com/emails/${providerMessageId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429 && retryAfter429) {
      // Resend allows only a few requests per second per team: wait once as asked, then give up.
      const seconds = Number(response.headers.get("retry-after"));
      await new Promise((resolve) => { setTimeout(resolve, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3) * 1_000 : 1_000); });
      return lookupProviderEmail(providerMessageId, fetchImpl, false);
    }
    if (response.status !== 200) return { event: "LOOKUP_UNAVAILABLE", html: "", text: "" };
    const body = await response.json() as { last_event?: unknown; html?: unknown; text?: unknown };
    const event = typeof body.last_event === "string" && RESEND_EVENTS.has(body.last_event)
      ? body.last_event.toUpperCase() as ProviderEvent
      : "OTHER";
    return {
      event,
      html: typeof body.html === "string" ? body.html : "",
      text: typeof body.text === "string" ? body.text : "",
    };
  } catch {
    return { event: "LOOKUP_UNAVAILABLE", html: "", text: "" };
  }
}

/**
 * Return `pathname?token=...` of the first link in `content` that points at this
 * deployment's own `path`. Any other host, path or query shape is ignored.
 */
export function extractOwnLinkPath(content: string, path: string, appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  let origin: string;
  try { origin = new URL(appUrl ?? "").origin; } catch { return null; }
  for (const match of content.replaceAll("&amp;", "&").matchAll(/https?:\/\/[^\s"'<>]+/gu)) {
    try {
      const url = new URL(match[0]);
      const token = url.searchParams.get("token");
      if (url.origin === origin && url.pathname === path && token && /^[A-Za-z0-9._~-]{16,2048}$/u.test(token)
        && [...url.searchParams.keys()].length === 1 && !url.hash) {
        return `${path}?token=${encodeURIComponent(token)}`;
      }
    } catch { /* Not a URL. */ }
  }
  return null;
}

function deliveryStatus(value: string | null | undefined) {
  if (!value) return "NOT_FOUND";
  return DELIVERY_STATUSES.has(value) ? value.toUpperCase() : "OTHER";
}

export type FirstSuccessStatus = {
  ownerRegistered: boolean;
  ownerConsentRecorded: boolean;
  ownerEmailVerified: boolean;
  merchantVerificationEmail: { status: string; providerEvent: ProviderEvent };
  merchantVerificationLinkPath: string | null;
  buyerSubmissions: number;
  buyerVerifiedSubmissions: number;
  buyerVerificationEmail: { status: string; providerEvent: ProviderEvent; linkSource: "PROVIDER" | "LOCAL_ENVELOPE" | "NONE" };
  buyerVerificationLinkPath: string | null;
  registrationConfirmationEmail: { status: string; providerEvent: ProviderEvent };
};

/**
 * Status of one runner's synthetic merchant and buyer, in fixed categories.
 * The only free-form values are the two verification link paths of this run's
 * own Resend test mailboxes, which the runner opens to finish the journey.
 */
export async function readFirstSuccessStatus(runId: string, fetchImpl: typeof fetch = fetch): Promise<FirstSuccessStatus> {
  const db = getDb();
  const status: FirstSuccessStatus = {
    ownerRegistered: false,
    ownerConsentRecorded: false,
    ownerEmailVerified: false,
    merchantVerificationEmail: { status: "NOT_FOUND", providerEvent: "NOT_LOOKED_UP" },
    merchantVerificationLinkPath: null,
    buyerSubmissions: 0,
    buyerVerifiedSubmissions: 0,
    buyerVerificationEmail: { status: "NOT_FOUND", providerEvent: "NOT_LOOKED_UP", linkSource: "NONE" },
    buyerVerificationLinkPath: null,
    registrationConfirmationEmail: { status: "NOT_FOUND", providerEvent: "NOT_LOOKED_UP" },
  };
  const user = await db.user.findUnique({
    where: { email: firstSuccessOwnerEmail(runId) },
    select: { id: true, emailVerifiedAt: true },
  });
  if (!user) return status;
  status.ownerRegistered = true;
  status.ownerEmailVerified = user.emailVerifiedAt !== null;
  status.ownerConsentRecorded = await db.userPolicyConsent.count({
    where: { userId: user.id, context: "merchant_registration" },
  }) > 0;

  const verificationAudit = await db.auditLog.findFirst({
    where: {
      actorId: user.id,
      targetType: "User",
      targetId: user.id,
      action: { in: ["merchant_email_verification_sent", "merchant_email_verification_email_failed", "merchant_email_verification_suppressed"] },
    },
    orderBy: { createdAt: "desc" },
    select: { action: true, after: true },
  });
  if (verificationAudit) {
    status.merchantVerificationEmail.status = verificationAudit.action === "merchant_email_verification_sent"
      ? "SENT" : verificationAudit.action === "merchant_email_verification_email_failed" ? "FAILED" : "SUPPRESSED";
    const after = verificationAudit.after as { providerMessageId?: unknown } | null;
    // Once the owner is verified the mail has done its job; skip the provider call (rate limit).
    if (status.merchantVerificationEmail.status === "SENT" && !status.ownerEmailVerified) {
      const provider = await lookupProviderEmail(typeof after?.providerMessageId === "string" ? after.providerMessageId : null, fetchImpl);
      status.merchantVerificationEmail.providerEvent = provider.event;
      status.merchantVerificationLinkPath = extractOwnLinkPath(`${provider.text}\n${provider.html}`, "/verify-email");
    }
  }

  // The registration creates exactly one vendor whose active owner is this user.
  const vendor = await db.vendor.findFirst({
    where: { email: firstSuccessOwnerEmail(runId), members: { some: { userId: user.id, role: "owner", status: "active" } } },
    select: { id: true },
  });
  if (!vendor) return status;
  const buyerEmail = firstSuccessBuyerEmail(runId);
  const recipientHash = createEmailRecipientHash(buyerEmail, vendor.id);
  const deliveries = await db.emailDelivery.findMany({
    where: { vendorId: vendor.id, recipientHash, trigger: { in: ["form_submission_verification", "registration_confirmed"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, vendorId: true, trigger: true, status: true, providerMessageId: true, payloadEncryptedEnvelope: true, sourceFormSubmissionId: true },
  });
  const submissionIds = [...new Set(deliveries.map((delivery) => delivery.sourceFormSubmissionId).filter((id): id is string => Boolean(id)))];
  if (submissionIds.length > 0) {
    const owned = { id: { in: submissionIds }, form: { vendorId: vendor.id } };
    status.buyerSubmissions = await db.formSubmission.count({ where: owned });
    status.buyerVerifiedSubmissions = await db.formSubmission.count({ where: { ...owned, verificationStatus: "VERIFIED" } });
  }
  const verification = deliveries.find((delivery) => delivery.trigger === "form_submission_verification");
  if (verification) {
    status.buyerVerificationEmail.status = deliveryStatus(verification.status);
    // After the buyer confirmed, the verification mail is not looked up again (rate limit).
    if (status.buyerVerifiedSubmissions === 0) {
      const provider = await lookupProviderEmail(verification.providerMessageId, fetchImpl);
      status.buyerVerificationEmail.providerEvent = provider.event;
      status.buyerVerificationLinkPath = extractOwnLinkPath(`${provider.text}\n${provider.html}`, "/verify-registration");
      if (status.buyerVerificationLinkPath) status.buyerVerificationEmail.linkSource = "PROVIDER";
      else if (verification.status === "sent") {
        // The provider copy could not be read: fall back to the envelope that was sent, and say so.
        try {
          const payload = revealEmailDeliveryPayload(verification.payloadEncryptedEnvelope, { vendorId: verification.vendorId, deliveryId: verification.id });
          if (payload.recipientEmail === buyerEmail) status.buyerVerificationLinkPath = extractOwnLinkPath(payload.body, "/verify-registration");
          if (status.buyerVerificationLinkPath) status.buyerVerificationEmail.linkSource = "LOCAL_ENVELOPE";
        } catch { /* Stays NONE. */ }
      }
    }
  }
  const confirmation = deliveries.find((delivery) => delivery.trigger === "registration_confirmed");
  if (confirmation) {
    status.registrationConfirmationEmail.status = deliveryStatus(confirmation.status);
    status.registrationConfirmationEmail.providerEvent = (await lookupProviderEmail(confirmation.providerMessageId, fetchImpl)).event;
  }
  return status;
}
