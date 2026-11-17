import type { PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { createFormSubmissionChatSessionToken, verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { verifyLiveWatchLinkToken } from "@/lib/live-watch-link-token";
import { ACTIVE_VENDOR_RELATION } from "@/lib/vendor-suspension-state";

type Database = Pick<PrismaClient, "formSubmission" | "live">;

export type LiveWatchLinkResolution =
  /** Give this browser the registration cookie (registrationCookie), then show the Live. */
  | { kind: "admit"; submissionId: string; liveSlug: string; registrationCookie: string }
  /**
   * This browser already holds the cookie of another VERIFIED registration of
   * the same Live: keep it (a forwarded link does not take over the browser
   * of someone who registered themselves) and show the Live.
   */
  | { kind: "keep_existing"; liveSlug: string }
  /**
   * Nothing is set. liveSlug: the Live the genuine (possibly expired) link
   * names, or null for a forged or malformed link (the caller shows the home
   * page). Every refusal reason shares this answer.
   */
  | { kind: "fallback"; liveSlug: string | null };

/**
 * Resolves a personal watch link (live-watch-link-token.ts). Only reads: the
 * link never writes a row, so an e-mail scanner or link preview that fetches
 * it records no attendance. Attendance is written only by /api/live-admission
 * once playback is actually granted (live-registration-attendance.ts).
 *
 * The final query binds every id of the signed claim again: the registration
 * must be this Live's, VERIFIED, from a form of this vendor, and the Live must
 * belong to this vendor, which must not be suspended (F-036).
 */
export async function resolveLiveWatchLink(
  input: { token: string | null; existingRegistrationToken: string | null; now?: Date },
  db: Database = getDb(),
): Promise<LiveWatchLinkResolution> {
  const now = input.now ?? new Date();
  const verified = verifyLiveWatchLinkToken(input.token, now);
  if (!verified) return { kind: "fallback", liveSlug: null };
  const { claim } = verified;

  const fallback = async (): Promise<LiveWatchLinkResolution> => {
    const live = await db.live.findFirst({
      where: { id: claim.liveId, vendorId: claim.vendorId },
      select: { slug: true },
    });
    return { kind: "fallback", liveSlug: live?.slug ?? null };
  };
  if (verified.status !== "valid") return fallback();

  const submission = await db.formSubmission.findFirst({
    where: {
      id: claim.submissionId,
      liveId: claim.liveId,
      verificationStatus: "VERIFIED",
      form: { vendorId: claim.vendorId },
      live: { is: { id: claim.liveId, vendorId: claim.vendorId, ...ACTIVE_VENDOR_RELATION } },
    },
    select: { id: true, live: { select: { id: true, vendorId: true, slug: true } } },
  });
  const live = submission?.live;
  if (!submission || !live || live.id !== claim.liveId || live.vendorId !== claim.vendorId) return fallback();

  const existingSubmissionId = input.existingRegistrationToken
    ? verifyFormSubmissionChatSessionToken(input.existingRegistrationToken, now)?.submissionId ?? null
    : null;
  if (existingSubmissionId && existingSubmissionId !== submission.id) {
    const existing = await db.formSubmission.findFirst({
      where: {
        id: existingSubmissionId,
        liveId: claim.liveId,
        verificationStatus: "VERIFIED",
        form: { vendorId: claim.vendorId },
      },
      select: { id: true },
    });
    if (existing) return { kind: "keep_existing", liveSlug: live.slug };
  }

  return {
    kind: "admit",
    submissionId: submission.id,
    liveSlug: live.slug,
    registrationCookie: createFormSubmissionChatSessionToken({ submissionId: submission.id, now }),
  };
}
