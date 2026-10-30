import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { EVERGREEN_ACTIVATION_SELECT, isActiveEvergreenLive } from "@/lib/evergreen-activation";
import type { EvergreenLiveRecord } from "@/lib/evergreen-viewer-session";
import { verifyFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { enqueueAuthoritativeTrackingEvent } from "@/lib/tracking-event-outbox";
import type { TrackingBrowserContext } from "@/lib/tracking-browser-context";

export type FormSubmissionVerificationResult =
  | { status: "invalid" }
  | {
      status: "already_verified";
      chatSession: { submissionId: string };
    }
  | {
      status: "verified";
      chatSession: { submissionId: string };
      confirmation: {
        vendorId: string;
        vendorName: string;
        liveId: string;
        liveSlug: string;
        liveTitle: string;
        formSubmissionId: string;
        recipientName: string;
        recipientEmail: string;
        liveScheduledAt: Date;
        liveReminderOffsetMinutes: number;
        /**
         * Present only while the evergreen schedule governs this Live; the
         * caller resolves the visitor's own session for {{live_start_at}} and
         * skips fixed-time reminders.
         */
        evergreen: { live: EvergreenLiveRecord; vendorTimezone: string | null } | null;
        /**
         * The fixed session (指定場次) this registrant chose. liveScheduledAt
         * above is already that session's start; a cancelled session gets no
         * fixed-time reminder.
         */
        fixedSession: { id: string; status: string } | null;
        emailBrand: {
          senderName: string | null;
          supportEmail: string | null;
          contactUrl: string | null;
        };
        template: {
          id: string;
          vendorId: string;
          channel: string;
          trigger: string;
          subject: string | null;
          body: string;
          isActive: boolean;
        } | null;
        reminderTemplate: {
          id: string;
          vendorId: string;
          channel: string;
          trigger: string;
          subject: string | null;
          body: string;
          isActive: boolean;
        } | null;
      } | null;
    };

function matchesCurrentVerificationClaim(
  submission: {
    verificationVersion: number;
    verificationExpiresAt: Date | null;
  },
  verifiedToken: { version: number; expiresAt: Date },
  now: Date,
) {
  return submission.verificationVersion === verifiedToken.version
    && Boolean(submission.verificationExpiresAt)
    && Math.floor(submission.verificationExpiresAt!.getTime() / 1_000)
      === Math.floor(verifiedToken.expiresAt.getTime() / 1_000)
    && submission.verificationExpiresAt! > now;
}

export async function verifyFormSubmission(
  db: PrismaClient,
  token: string,
  now = new Date(),
  trackingContext?: TrackingBrowserContext | null,
): Promise<FormSubmissionVerificationResult> {
  const verifiedToken = verifyFormSubmissionVerificationToken(token, now);
  if (!verifiedToken) return { status: "invalid" };

  return db.$transaction(async (tx) => {
    const submission = await tx.formSubmission.findUnique({
      where: { id: verifiedToken.submissionId },
      select: {
        id: true,
        formId: true,
        liveId: true,
        name: true,
        email: true,
        verificationStatus: true,
        verificationVersion: true,
        verificationExpiresAt: true,
        form: {
          select: {
            vendorId: true,
            vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true, timezone: true } },
          },
        },
        affiliateClick: {
          select: { id: true, vendorId: true, affiliateId: true, referralCode: true },
        },
        liveSession: { select: { id: true, vendorId: true, liveId: true, startAt: true, status: true } },
        live: {
          select: {
            id: true,
            vendorId: true,
            ...EVERGREEN_ACTIVATION_SELECT,
            replayEnabled: true,
            replayAvailableUntil: true,
            formId: true,
            slug: true,
            title: true,
            scheduledAt: true,
            liveReminderOffsetMinutes: true,
            video: { select: { durationSec: true } },
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
            liveReminderTemplate: {
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
        },
      },
    });
    if (!submission) return { status: "invalid" as const };
    if (
      submission.liveId !== null
      && (!submission.live
        || submission.live.vendorId !== submission.form.vendorId
        || submission.live.formId !== submission.formId)
    ) {
      return { status: "invalid" as const };
    }
    // The composite FK already binds the session to this Live; the vendor is
    // re-checked so a registration never follows another tenant's session.
    const fixedSession = submission.live?.sessionMode === "fixed_sessions"
      && submission.liveSession
      && submission.liveSession.vendorId === submission.form.vendorId
      && submission.liveSession.liveId === submission.liveId
      ? submission.liveSession
      : null;
    if (submission.verificationStatus === "VERIFIED") {
      return matchesCurrentVerificationClaim(submission, verifiedToken, now)
        ? {
            status: "already_verified" as const,
            chatSession: { submissionId: submission.id },
          }
        : { status: "invalid" as const };
    }
    if (!matchesCurrentVerificationClaim(submission, verifiedToken, now)) {
      return { status: "invalid" as const };
    }

    const claimed = await tx.formSubmission.updateMany({
      where: {
        id: submission.id,
        verificationStatus: "UNVERIFIED",
        verificationVersion: verifiedToken.version,
        verificationExpiresAt: submission.verificationExpiresAt,
        // A fixed-session seat given back when the window passed is not
        // confirmed by a late click; the registrant registers again.
        OR: [{ liveSessionId: null }, { liveSessionSeatReleasedAt: null }],
      },
      data: {
        verificationStatus: "VERIFIED",
        verifiedAt: now,
      },
    });
    if (claimed.count !== 1) {
      const current = await tx.formSubmission.findUnique({
        where: { id: submission.id },
        select: {
          verificationStatus: true,
          verificationVersion: true,
          verificationExpiresAt: true,
        },
      });
      return current?.verificationStatus === "VERIFIED"
        && matchesCurrentVerificationClaim(current, verifiedToken, now)
        ? {
            status: "already_verified" as const,
            chatSession: { submissionId: submission.id },
          }
        : { status: "invalid" as const };
    }

    if (trackingContext) await enqueueAuthoritativeTrackingEvent(tx, {
      vendorId: submission.form.vendorId, eventName: "Lead", sourceId: submission.id, context: trackingContext,
    });

    if (submission.liveId) {
      await tx.analyticsEvent.create({
        data: {
          vendorId: submission.form.vendorId,
          liveId: submission.liveId,
          visitorId: createHash("sha256").update(submission.id).digest("hex"),
          eventType: "lead_submit",
          trustLevel: "VERIFIED_FORM_SUBMISSION",
          payload: {
            formId: submission.formId,
            ref: submission.affiliateClick?.referralCode ?? null,
          },
        },
      });
    }

    if (submission.affiliateClick) {
      await tx.affiliateClick.updateMany({
        where: {
          id: submission.affiliateClick.id,
          vendorId: submission.form.vendorId,
          affiliateId: submission.affiliateClick.affiliateId,
          referralCode: submission.affiliateClick.referralCode,
          convertedAt: null,
        },
        data: { convertedAt: now },
      });
    }

    return {
      status: "verified" as const,
      chatSession: { submissionId: submission.id },
      confirmation: submission.live ? {
        vendorId: submission.form.vendorId,
        vendorName: submission.form.vendor.name,
        liveId: submission.live.id,
        liveSlug: submission.live.slug,
        liveTitle: submission.live.title,
        formSubmissionId: submission.id,
        recipientName: submission.name,
        recipientEmail: submission.email,
        liveScheduledAt: fixedSession?.startAt ?? submission.live.scheduledAt,
        liveReminderOffsetMinutes: submission.live.liveReminderOffsetMinutes,
        evergreen: !fixedSession && isActiveEvergreenLive(submission.live, { vendorTimezone: submission.form.vendor.timezone, now })
          ? { live: submission.live, vendorTimezone: submission.form.vendor.timezone }
          : null,
        fixedSession: fixedSession ? { id: fixedSession.id, status: fixedSession.status } : null,
        emailBrand: {
          senderName: submission.form.vendor.senderName,
          supportEmail: submission.form.vendor.supportEmail,
          contactUrl: submission.form.vendor.contactUrl,
        },
        template: submission.live.messageTemplate,
        reminderTemplate: submission.live.liveReminderTemplate,
      } : null,
    };
  }, { isolationLevel: "Serializable" });
}
