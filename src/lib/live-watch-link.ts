import type { PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { createLiveAttendanceToken, createLiveSessionHintToken, liveAttendanceCookieName, liveSessionHintCookieName } from "@/lib/live-attendance-cookie";
import { fixedSessionReplayAvailableUntil, isFixedSessionLive } from "@/lib/live-fixed-sessions";
import { verifyLiveWatchLinkToken } from "@/lib/live-watch-link-token";
import { ACTIVE_VENDOR_RELATION } from "@/lib/vendor-suspension-state";

type Database = Pick<PrismaClient, "formSubmission" | "live">;

export type LiveWatchLinkResolution =
  /**
   * Give this browser the attendance-only cookie (live-attendance-cookie.ts)
   * for this Live, then show the Live. Never the registration cookie.
   */
  | {
    kind: "admit";
    submissionId: string;
    liveSlug: string;
    attendanceCookie: { name: string; value: string; expiresAt: Date };
    /**
     * A2-10: only for a fixed-session Live (指定場次), the session-hint cookie
     * that makes this browser's watch page, playback and admission follow the
     * registration's own session instead of the public schedule; null
     * otherwise, so every other Live behaves exactly as before.
     */
    sessionHintCookie: { name: string; value: string; expiresAt: Date } | null;
  }
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
 * belong to this vendor, which must not be suspended (F-036). The browser's
 * registration cookie is neither read nor replaced.
 */
export async function resolveLiveWatchLink(
  input: { token: string | null; now?: Date },
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
  const cookieName = liveAttendanceCookieName(claim.liveId);
  if (!cookieName) return fallback();

  const submission = await db.formSubmission.findFirst({
    where: {
      id: claim.submissionId,
      liveId: claim.liveId,
      verificationStatus: "VERIFIED",
      form: { vendorId: claim.vendorId },
      live: { is: { id: claim.liveId, vendorId: claim.vendorId, ...ACTIVE_VENDOR_RELATION } },
    },
    select: {
      id: true,
      live: { select: { id: true, vendorId: true, slug: true, sessionMode: true, ...SESSION_HINT_LIVE_SELECT } },
      liveSession: { select: { vendorId: true, liveId: true, startAt: true } },
    },
  });
  const live = submission?.live;
  if (!submission || !live || live.id !== claim.liveId || live.vendorId !== claim.vendorId) return fallback();

  const binding = { vendorId: claim.vendorId, liveId: live.id, submissionId: submission.id, expiresAt: claim.expiresAt };
  const session = submission.liveSession;
  const hintName = isFixedSessionLive(live) && session && session.vendorId === live.vendorId && session.liveId === live.id
    ? liveSessionHintCookieName(live.id)
    : null;
  const hintExpiresAt = hintName && session ? sessionHintExpiresAt(live, session, claim.expiresAt, now) : null;
  return {
    kind: "admit",
    submissionId: submission.id,
    liveSlug: live.slug,
    attendanceCookie: {
      name: cookieName,
      // Expires with the link that set it.
      value: createLiveAttendanceToken(binding),
      expiresAt: claim.expiresAt,
    },
    // Names only the registration; the session itself is read from the
    // database on every request, so a later switch or cancellation applies.
    sessionHintCookie: hintName && hintExpiresAt
      ? { name: hintName, value: createLiveSessionHintToken({ ...binding, expiresAt: hintExpiresAt }), expiresAt: hintExpiresAt }
      : null,
  };
}

/** Live fields sessionHintExpiresAt reads. */
const SESSION_HINT_LIVE_SELECT = {
  replayEnabled: true,
  replayAvailableUntil: true,
  sessionReplayWindowHours: true,
  video: { select: { vendorId: true, durationSec: true } },
} as const;

/**
 * When the session hint stops being useful (A2-10 review MINOR-3), whole
 * seconds: the earlier of the link's expiry and the end of the viewing window
 * of the session the registration holds when the link is opened (the session
 * end, or the end of its replay when replays are on; no replay deadline at
 * all leaves the link's expiry). Null when that window is already over: the
 * hint would never change anything, so no cookie is set. A registrant who
 * later moves to a later session keeps the hint until the old window closes
 * and then gets a new one from the next reminder's link.
 */
export function sessionHintExpiresAt(
  live: {
    vendorId: string;
    replayEnabled: boolean;
    replayAvailableUntil: Date | null;
    sessionReplayWindowHours: number | null;
    video: { vendorId: string; durationSec: number | null } | null;
  },
  session: { startAt: Date },
  linkExpiresAt: Date,
  now: Date,
): Date | null {
  const durationSeconds = live.video?.vendorId === live.vendorId ? live.video.durationSec ?? 0 : 0;
  const sessionEndMs = session.startAt.getTime() + Math.max(0, durationSeconds) * 1_000;
  const replayUntil = fixedSessionReplayAvailableUntil(session, live, durationSeconds);
  const windowEndMs = !live.replayEnabled
    ? sessionEndMs
    : replayUntil
      ? Math.max(sessionEndMs, replayUntil.getTime())
      : Number.POSITIVE_INFINITY;
  const expiryMs = Math.floor(Math.min(linkExpiresAt.getTime(), windowEndMs) / 1_000) * 1_000;
  return expiryMs - now.getTime() >= 1_000 ? new Date(expiryMs) : null;
}
