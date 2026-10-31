import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { resolveFixedSessionRechooseUrl } from "@/lib/live-fixed-session-notices";
import { liveSessionSwitchRedemptionId, verifyLiveSessionSwitchToken } from "@/lib/live-session-switch-token";

/** Only a same-site public registration path (landing page, form or live page) is ever linked. */
const RECHOOSE_PATH = /^\/(?:lp|form|live)\/[^/\\\s?#][^\\\s#]*$/u;

export type LiveSessionSwitchRedemptionResult =
  | { ok: true; submissionId: string; rechoosePath: string }
  /** Forged, expired, already used, or the registration no longer holds that session: one answer for all. */
  | { ok: false };

/**
 * Redeems a 「更換場次」 link (see live-session-switch-token.ts). On success
 * the caller gives this browser the registration's signed cookie, exactly as
 * confirming the email does, and sends it to the public registration page,
 * where the existing switch rules (resolveRepeatedFixedSessionRegistration)
 * now treat it as the registration's own browser.
 *
 * The link is valid only while the registration is VERIFIED, still holds the
 * session the link names (so a switch made since invalidates it) and that
 * session has not started (cancelled sessions may always choose again).
 * Every lookup is bound to the vendor in the signed claims. The redemption
 * row is inserted last; its primary key makes a second use, including a
 * concurrent one, fail.
 */
export async function redeemLiveSessionSwitchToken(token: string, now = new Date()): Promise<LiveSessionSwitchRedemptionResult> {
  const claim = verifyLiveSessionSwitchToken(token, now);
  if (!claim) return { ok: false };
  const db = getDb();
  const submission = await db.formSubmission.findFirst({
    where: {
      id: claim.submissionId,
      liveSessionId: claim.sessionId,
      verificationStatus: "VERIFIED",
      form: { vendorId: claim.vendorId },
      live: { is: { vendorId: claim.vendorId } },
    },
    select: {
      id: true,
      live: { select: { id: true, vendorId: true, slug: true, formId: true } },
      liveSession: { select: { id: true, vendorId: true, liveId: true, startAt: true, status: true } },
    },
  });
  const live = submission?.live;
  const session = submission?.liveSession;
  if (!submission || !live || !session || live.vendorId !== claim.vendorId || session.vendorId !== claim.vendorId || session.liveId !== live.id) {
    return { ok: false };
  }
  // A session that started can no longer be left (same rule as the switch itself).
  if (session.status !== "cancelled" && session.startAt.getTime() <= now.getTime()) return { ok: false };

  const url = new URL(await resolveFixedSessionRechooseUrl({ vendorId: claim.vendorId, liveId: live.id, slug: live.slug, formId: live.formId }));
  const rechoosePath = `${url.pathname}${url.search}`;
  if (rechoosePath.length > 600 || !RECHOOSE_PATH.test(rechoosePath)) return { ok: false };

  try {
    await db.liveSessionSwitchRedemption.create({
      data: {
        id: liveSessionSwitchRedemptionId(claim.nonce),
        vendorId: claim.vendorId,
        formSubmissionId: submission.id,
        liveSessionId: session.id,
        expiresAt: claim.expiresAt,
        redeemedAt: now,
      },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false };
    throw error;
  }
  return { ok: true, submissionId: submission.id, rechoosePath };
}
