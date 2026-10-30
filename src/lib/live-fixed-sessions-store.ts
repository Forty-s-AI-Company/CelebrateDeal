import type { Prisma, PrismaClient } from "@prisma/client";
import { readCookieHeaderValue } from "@/lib/evergreen-viewer-session";
import {
  FORM_SUBMISSION_CHAT_SESSION_COOKIE,
  verifyFormSubmissionChatSessionToken,
} from "@/lib/form-submission-chat-session";
import {
  DEFAULT_SESSION_TIMEZONE,
  fixedSessionRegistrationState,
  groupOpenFixedSessionsByDate,
  isFixedSessionLive,
  pickPublicFixedSession,
  type FixedSessionRecord,
  type FixedSessionRegistrationState,
  type ParsedFixedSession,
  type PublicFixedSessionDay,
} from "@/lib/live-fixed-sessions";

/**
 * Database side of 指定場次 (see live-fixed-sessions.ts). Every statement
 * repeats the vendorId + liveId binding of the session it touches.
 */

/** Live fields every fixed-session decision reads. */
export const FIXED_SESSION_LIVE_SELECT = {
  sessionMode: true,
  sessionRegistrationCutoffMinutes: true,
  sessionReplayWindowHours: true,
} as const;

export const FIXED_SESSION_SELECT = {
  id: true,
  startAt: true,
  capacity: true,
  registeredCount: true,
  status: true,
} as const satisfies Prisma.LiveSessionSelect;

type SessionDb = Pick<Prisma.TransactionClient, "liveSession">;

export class FixedSessionCapacityBelowRegistrationsError extends Error {
  constructor(public readonly startAt: Date) {
    super("fixed_session_capacity_below_registrations");
    this.name = "FixedSessionCapacityBelowRegistrationsError";
  }
}

export type LiveSessionSyncResult = {
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  /** Sessions that changed to cancelled; their registrants lose playback and reminders. */
  cancelledSessionIds: string[];
  /** Cancelled sessions that were added back; their registrants are scheduled again. */
  reopenedSessionIds: string[];
};

/**
 * Makes the stored sessions match the studio rows, identified by start time.
 * A start that disappears is deleted when nobody registered for it and
 * cancelled otherwise, so registrations are never lost. Runs inside the
 * caller's transaction after the Live row is locked by its update.
 */
export async function syncLiveSessions(
  tx: SessionDb,
  input: { vendorId: string; liveId: string; sessions: readonly ParsedFixedSession[] },
): Promise<LiveSessionSyncResult> {
  const existing = await tx.liveSession.findMany({
    where: { vendorId: input.vendorId, liveId: input.liveId },
    select: FIXED_SESSION_SELECT,
  });
  const byStart = new Map(existing.map((session) => [session.startAt.getTime(), session]));
  const wanted = new Set(input.sessions.map((session) => session.startAt.getTime()));
  const result: LiveSessionSyncResult = { createdCount: 0, updatedCount: 0, deletedCount: 0, cancelledSessionIds: [], reopenedSessionIds: [] };

  for (const session of input.sessions) {
    const current = byStart.get(session.startAt.getTime());
    if (!current) {
      await tx.liveSession.create({
        data: {
          vendorId: input.vendorId,
          liveId: input.liveId,
          startAt: session.startAt,
          capacity: session.capacity,
          status: session.status,
        },
        select: { id: true },
      });
      result.createdCount += 1;
      continue;
    }
    if (session.capacity !== null && session.capacity < current.registeredCount) {
      throw new FixedSessionCapacityBelowRegistrationsError(session.startAt);
    }
    if (current.capacity === session.capacity && current.status === session.status) continue;
    // The capacity predicate keeps a concurrent registration from slipping
    // past a lowered capacity; the table CHECK is the final guard.
    const updated = await tx.liveSession.updateMany({
      where: {
        id: current.id,
        vendorId: input.vendorId,
        liveId: input.liveId,
        ...(session.capacity !== null ? { registeredCount: { lte: session.capacity } } : {}),
      },
      data: { capacity: session.capacity, status: session.status },
    });
    if (updated.count !== 1) throw new FixedSessionCapacityBelowRegistrationsError(session.startAt);
    if (current.status === "cancelled") result.reopenedSessionIds.push(current.id);
    result.updatedCount += 1;
  }

  for (const session of existing) {
    if (wanted.has(session.startAt.getTime()) || session.status === "cancelled") continue;
    const deleted = await tx.liveSession.deleteMany({
      where: {
        id: session.id,
        vendorId: input.vendorId,
        liveId: input.liveId,
        registeredCount: 0,
        submissions: { none: {} },
      },
    });
    if (deleted.count === 1) {
      result.deletedCount += 1;
      continue;
    }
    await tx.liveSession.updateMany({
      where: { id: session.id, vendorId: input.vendorId, liveId: input.liveId },
      data: { status: "cancelled" },
    });
    result.cancelledSessionIds.push(session.id);
  }
  return result;
}

/** Removes every session of a Live switching back to one shared start (only allowed with no session registrations). */
export async function deleteUnusedLiveSessions(tx: SessionDb, input: { vendorId: string; liveId: string }) {
  return tx.liveSession.deleteMany({
    where: { vendorId: input.vendorId, liveId: input.liveId, registeredCount: 0, submissions: { none: {} } },
  });
}

export type FixedSessionClaimFailure = Exclude<FixedSessionRegistrationState, "open"> | "not_found";

/**
 * Takes one seat atomically: the single conditional UPDATE re-checks the
 * tenant, Live, status, registration cutoff and capacity on the row it
 * locks, so concurrent registrations can never exceed the capacity. Returns
 * null on success, or why the seat could not be taken.
 */
export async function claimFixedSessionSeat(
  tx: Pick<Prisma.TransactionClient, "liveSession">,
  input: {
    vendorId: string;
    liveId: string;
    sessionId: string;
    sessionRegistrationCutoffMinutes: number;
    now: Date;
  },
): Promise<FixedSessionClaimFailure | null> {
  const opensBefore = new Date(input.now.getTime() - Math.max(0, input.sessionRegistrationCutoffMinutes) * 60_000);
  const claimed = await tx.liveSession.updateMany({
    where: {
      id: input.sessionId,
      vendorId: input.vendorId,
      liveId: input.liveId,
      status: "open",
      startAt: { gt: opensBefore },
      OR: [
        { capacity: null },
        { registeredCount: { lt: tx.liveSession.fields.capacity } },
      ],
    },
    data: { registeredCount: { increment: 1 } },
  });
  if (claimed.count === 1) return null;
  const session = await tx.liveSession.findFirst({
    where: { id: input.sessionId, vendorId: input.vendorId, liveId: input.liveId },
    select: FIXED_SESSION_SELECT,
  });
  if (!session) return "not_found";
  const state = fixedSessionRegistrationState(session, { sessionRegistrationCutoffMinutes: input.sessionRegistrationCutoffMinutes }, input.now);
  // A row that changed between the UPDATE and this read still failed the claim.
  return state === "open" ? "full" : state;
}

/** Every stored session of one Live, oldest first, with its seat count. */
export async function loadLiveSessions(db: SessionDb, input: { vendorId: string; liveId: string }) {
  return db.liveSession.findMany({
    where: { vendorId: input.vendorId, liveId: input.liveId },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
    select: FIXED_SESSION_SELECT,
  });
}

export type PublicLiveSessionsResult = {
  liveId: string;
  timeZone: string;
  registrationClosesAfterStartMinutes: number;
  days: PublicFixedSessionDay[];
};

/**
 * The open sessions of one public fixed-session Live, grouped by local date.
 * Returns null for a Live that does not exist publicly or has no fixed
 * sessions, so the caller answers both the same way.
 */
export async function loadPublicLiveSessions(
  db: Pick<PrismaClient, "live" | "liveSession">,
  input: { liveId?: string; slug?: string; vendorId?: string; now?: Date },
): Promise<PublicLiveSessionsResult | null> {
  if (!input.liveId && !input.slug) return null;
  const now = input.now ?? new Date();
  const live = await db.live.findFirst({
    where: {
      ...(input.liveId ? { id: input.liveId } : {}),
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
      status: { in: ["scheduled", "live"] },
      sessionMode: "fixed_sessions",
    },
    select: {
      id: true,
      vendorId: true,
      sessionRegistrationCutoffMinutes: true,
      vendor: { select: { timezone: true } },
    },
  });
  if (!live) return null;
  const sessions = await db.liveSession.findMany({
    where: { vendorId: live.vendorId, liveId: live.id, status: "open" },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
    select: FIXED_SESSION_SELECT,
  });
  const timeZone = live.vendor.timezone || DEFAULT_SESSION_TIMEZONE;
  return {
    liveId: live.id,
    timeZone,
    registrationClosesAfterStartMinutes: live.sessionRegistrationCutoffMinutes,
    days: groupOpenFixedSessionsByDate(sessions, live, { now, timeZone }),
  };
}

export function registrationSessionTokenFromCookieHeader(header: string | null | undefined) {
  const value = readCookieHeaderValue(header, FORM_SUBMISSION_CHAT_SESSION_COOKIE);
  return value && value.length <= 320 ? value : null;
}

export function registrationSessionTokenFromRequest(request: Request) {
  return registrationSessionTokenFromCookieHeader(request.headers.get("cookie"));
}

export type ViewerFixedSession = FixedSessionRecord & {
  /** True when the session comes from the visitor's own verified registration. */
  registered: boolean;
};

/**
 * The session a viewer of a fixed-session Live follows. A visitor holding the
 * signed registration cookie of a VERIFIED registration for this exact Live
 * and vendor follows the session they chose (even a cancelled one, which then
 * never plays). Anyone else follows the public schedule: the session playing
 * now, else the next one, else the latest (for its replay).
 */
export async function resolveViewerFixedSession(
  db: Pick<Prisma.TransactionClient, "formSubmission" | "liveSession">,
  input: {
    vendorId: string;
    liveId: string;
    registrationToken: string | null | undefined;
    durationSeconds: number;
    now: Date;
  },
): Promise<ViewerFixedSession | null> {
  const claim = input.registrationToken ? verifyFormSubmissionChatSessionToken(input.registrationToken, input.now) : null;
  if (claim) {
    const submission = await db.formSubmission.findFirst({
      where: {
        id: claim.submissionId,
        liveId: input.liveId,
        verificationStatus: "VERIFIED",
        form: { vendorId: input.vendorId },
        liveSession: { is: { vendorId: input.vendorId, liveId: input.liveId } },
      },
      select: { liveSession: { select: FIXED_SESSION_SELECT } },
    });
    if (submission?.liveSession) return { ...submission.liveSession, registered: true };
  }
  const sessions = await db.liveSession.findMany({
    where: { vendorId: input.vendorId, liveId: input.liveId, status: { not: "cancelled" } },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
    select: FIXED_SESSION_SELECT,
  });
  const picked = pickPublicFixedSession(sessions, input.durationSeconds, input.now);
  return picked ? { ...picked, registered: false } : null;
}

/**
 * resolveViewerFixedSession for any Live: null unless the Live is in
 * fixed-session mode, so viewer paths can call it unconditionally.
 */
export async function resolveViewerFixedSessionForLive(
  db: Pick<Prisma.TransactionClient, "formSubmission" | "liveSession">,
  live: { id: string; vendorId: string; sessionMode?: string | null; video?: { durationSec: number | null } | null },
  input: { registrationToken: string | null | undefined; now: Date },
) {
  if (!isFixedSessionLive(live)) return null;
  return resolveViewerFixedSession(db, {
    vendorId: live.vendorId,
    liveId: live.id,
    registrationToken: input.registrationToken,
    durationSeconds: live.video?.durationSec ?? 0,
    now: input.now,
  });
}