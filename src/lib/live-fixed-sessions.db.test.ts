import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/form-submissions/route";
import { getDb } from "@/lib/db";
import { ensureLiveReminderDelivery, isCurrentEmailDeliverySnapshot } from "@/lib/email-delivery";
import { resolveViewerLiveRuntime } from "@/lib/evergreen-viewer-session";
import { createFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";
import {
  claimFixedSessionSeat,
  FixedSessionCapacityBelowRegistrationsError,
  loadPublicLiveSessions,
  resolveViewerFixedSession,
  syncLiveSessions,
} from "@/lib/live-fixed-sessions-store";
import { ensureLiveNotificationDelivery, supersedeFixedSessionDeliveries } from "@/lib/live-notification-delivery";
import { applyLiveSessionChanges, LiveSessionModeConflict } from "@/lib/live-fixed-sessions-studio";
import {
  processLiveReminderReconciliationJobs,
  queueLiveReminderReconciliationForCurrentLive,
} from "@/lib/live-reminder-reconciliation";

/**
 * 指定場次 (fixed sessions) against the disposable loopback PostgreSQL the
 * Vitest config asserts. Synthetic vendors only; each is removed with its
 * cascades afterwards.
 */

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const vendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "live-fixed-sessions-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fixed-sessions.example.test");
});
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture(label: string, options: { sessionMode?: "single" | "fixed_sessions"; cutoffMinutes?: number } = {}) {
  const db = getDb();
  const suffix = `${label}-${randomUUID()}`;
  const vendor = await db.vendor.create({
    data: { name: `Sessions ${label}`, slug: `sessions-${suffix}`, email: `sessions-${suffix}@example.test`, passwordHash: "synthetic-only", timezone: "Asia/Taipei" },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "Form",
      slug: `sessions-form-${suffix}`,
      headline: "Synthetic",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "Recording", sourceType: "url", videoUrl: "https://video.example.test/recording.m3u8", durationSec: 3_600, status: "ready" },
  });
  const confirmationTemplate = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "Confirmed", channel: "email", trigger: "registration_confirmed", subject: "報名成功 {{live_title}}", body: "{{name}} {{live_start_at}} {{live_url}}\n{{unsubscribe_url}}", isActive: true },
  });
  const reminderTemplate = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "Reminder", channel: "email", trigger: "live_reminder", subject: "{{live_title}} {{live_start_at}}", body: "Hello {{name}} {{live_start_at}}\n{{unsubscribe_url}}", isActive: true },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      videoId: video.id,
      title: "Synthetic sessions",
      slug: `sessions-live-${suffix}`,
      scheduledAt: new Date(Date.now() + 10 * DAY),
      status: "scheduled",
      streamMode: "vod",
      sessionMode: options.sessionMode ?? "fixed_sessions",
      sessionRegistrationCutoffMinutes: options.cutoffMinutes ?? 0,
      liveReminderTemplateId: reminderTemplate.id,
      liveReminderOffsetMinutes: 60,
      messageTemplateId: confirmationTemplate.id,
    },
  });
  return { vendor, form, video, live, reminderTemplate, confirmationTemplate, suffix };
}

function session(startAt: Date, capacity: number | null = null, status: "open" | "closed" = "open") {
  return { startAt, capacity, status };
}

async function sync(fx: Awaited<ReturnType<typeof fixture>>, sessions: ReturnType<typeof session>[]) {
  await getDb().$transaction((tx) => syncLiveSessions(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, sessions }));
  return getDb().liveSession.findMany({ where: { vendorId: fx.vendor.id, liveId: fx.live.id }, orderBy: { startAt: "asc" } });
}

function registrationRequest(input: { formId: string; liveId: string; email: string; liveSessionId?: string | null }) {
  return new Request("https://fixed-sessions.example.test/api/form-submissions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://fixed-sessions.example.test", "x-celebratedeal-client": "web" },
    body: JSON.stringify({
      formId: input.formId,
      liveId: input.liveId,
      ...(input.liveSessionId !== undefined ? { liveSessionId: input.liveSessionId } : {}),
      payload: { name: "Synthetic Lead", email: input.email },
    }),
  });
}

async function register(fx: Awaited<ReturnType<typeof fixture>>, email: string, liveSessionId?: string | null) {
  const response = await POST(registrationRequest({ formId: fx.form.id, liveId: fx.live.id, email, liveSessionId }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function verifiedRegistrant(fx: Awaited<ReturnType<typeof fixture>>, sessionId: string, label: string) {
  const db = getDb();
  await db.liveSession.update({ where: { id: sessionId }, data: { registeredCount: { increment: 1 } } });
  return db.formSubmission.create({
    data: {
      formId: fx.form.id,
      liveId: fx.live.id,
      liveSessionId: sessionId,
      name: `Lead ${label}`,
      email: `lead-${label}-${fx.suffix}@example.test`,
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
    },
  });
}

describe("fixed session storage and tenant binding", () => {
  it("creates, updates, deletes unused and cancels used sessions without losing registrations", async () => {
    const fx = await fixture("crud");
    const a = new Date(Date.now() + 2 * DAY);
    const b = new Date(Date.now() + 3 * DAY);
    const c = new Date(Date.now() + 4 * DAY);
    const created = await sync(fx, [session(b), session(a, 20), session(c)]);
    expect(created.map((row) => [row.startAt.getTime(), row.capacity, row.status])).toEqual([
      [a.getTime(), 20, "open"],
      [b.getTime(), null, "open"],
      [c.getTime(), null, "open"],
    ]);
    const registrant = await verifiedRegistrant(fx, created[1]!.id, "kept");

    // Drop b (has a registration) and c (none); change a's capacity and close it.
    const after = await sync(fx, [session(a, 30, "closed")]);
    expect(after.map((row) => [row.startAt.getTime(), row.capacity, row.status])).toEqual([
      [a.getTime(), 30, "closed"],
      [b.getTime(), null, "cancelled"],
    ]);
    expect(await getDb().formSubmission.findUnique({ where: { id: registrant.id }, select: { liveSessionId: true } }))
      .toEqual({ liveSessionId: created[1]!.id });

    // Adding the same start back reopens the cancelled session with its registrations.
    const reopened = await sync(fx, [session(a, 30, "closed"), session(b, 5)]);
    expect(reopened.find((row) => row.id === created[1]!.id)).toMatchObject({ status: "open", capacity: 5, registeredCount: 1 });
  });

  it("refuses a capacity below the registrations already held", async () => {
    const fx = await fixture("capacity");
    const [only] = await sync(fx, [session(new Date(Date.now() + 2 * DAY), 3)]);
    await verifiedRegistrant(fx, only!.id, "one");
    await verifiedRegistrant(fx, only!.id, "two");
    await expect(sync(fx, [session(only!.startAt, 1)])).rejects.toBeInstanceOf(FixedSessionCapacityBelowRegistrationsError);
    // The table CHECK is the last guard against oversubscription.
    await expect(getDb().$executeRaw`UPDATE "LiveSession" SET "registeredCount" = 4 WHERE "id" = ${only!.id}`).rejects.toThrow();
  });

  it("never writes a session for another tenant's Live and never claims across tenants", async () => {
    const owner = await fixture("owner");
    const other = await fixture("other");
    const [ownerSession] = await sync(owner, [session(new Date(Date.now() + 2 * DAY), 2)]);
    // The (vendorId, liveId) FK rejects a session row bound to a Live of another vendor.
    await expect(getDb().$transaction((tx) => syncLiveSessions(tx, {
      vendorId: other.vendor.id,
      liveId: owner.live.id,
      sessions: [session(new Date(Date.now() + 5 * DAY))],
    }))).rejects.toThrow();
    const claim = await getDb().$transaction((tx) => claimFixedSessionSeat(tx, {
      vendorId: other.vendor.id,
      liveId: owner.live.id,
      sessionId: ownerSession!.id,
      sessionRegistrationCutoffMinutes: 0,
      now: new Date(),
    }));
    expect(claim).toBe("not_found");
    expect(await getDb().liveSession.findUnique({ where: { id: ownerSession!.id }, select: { registeredCount: true } })).toEqual({ registeredCount: 0 });
    expect(await getDb().liveSession.count({ where: { liveId: owner.live.id } })).toBe(1);
  });

  it("lists only open, not yet closed sessions grouped by Taipei date", async () => {
    const fx = await fixture("public", { cutoffMinutes: 15 });
    const base = new Date("2030-10-30T06:00:00.000Z"); // 2030-10-30 14:00 Asia/Taipei
    const sessions = await sync(fx, [
      session(base, 1),
      session(new Date(base.getTime() + 5 * HOUR)), // 19:00
      session(new Date(base.getTime() + 23 * HOUR), null, "closed"), // 10/31 13:00, closed
      session(new Date(base.getTime() + 30 * HOUR)), // 10/31 20:00
    ]);
    await verifiedRegistrant(fx, sessions[0]!.id, "full");
    const now = new Date(base.getTime() + 10 * 60_000); // 14:10, inside the 15-minute cutoff
    const result = await loadPublicLiveSessions(getDb(), { liveId: fx.live.id, now });
    expect(result).toMatchObject({ liveId: fx.live.id, timeZone: "Asia/Taipei", registrationClosesAfterStartMinutes: 15 });
    expect(result!.days.map((day) => [day.date, day.sessions.map((entry) => [entry.timeLabel, entry.full])])).toEqual([
      ["2030-10-30", [["14:00", true], ["19:00", false]]],
      ["2030-10-31", [["20:00", false]]],
    ]);
    // Another vendor id never resolves the Live.
    const other = await fixture("public-other");
    expect(await loadPublicLiveSessions(getDb(), { liveId: fx.live.id, vendorId: other.vendor.id, now })).toBeNull();
    // A Live with one shared start has no session list.
    const single = await fixture("public-single", { sessionMode: "single" });
    expect(await loadPublicLiveSessions(getDb(), { liveId: single.live.id, now })).toBeNull();
  });
});

describe("registration with a fixed session", () => {
  it("records the chosen session and rejects foreign, past, closed and full sessions", async () => {
    const fx = await fixture("register");
    const sibling = await fixture("register-sibling");
    const [open, closed, past] = await sync(fx, [
      session(new Date(Date.now() + 2 * DAY), 1),
      session(new Date(Date.now() + 3 * DAY), null, "closed"),
    ]).then(async (rows) => {
      const pastRow = await getDb().liveSession.create({
        data: { vendorId: fx.vendor.id, liveId: fx.live.id, startAt: new Date(Date.now() - HOUR), status: "open" },
      });
      return [...rows, pastRow];
    });
    const [foreign] = await sync(sibling, [session(new Date(Date.now() + 2 * DAY))]);

    expect(await register(fx, `missing-${fx.suffix}@example.test`)).toEqual({ status: 400, body: { error: "Fixed session selection required" } });
    expect(await register(fx, `foreign-${fx.suffix}@example.test`, foreign!.id)).toEqual({ status: 404, body: { error: "Live session not found" } });
    expect(await register(fx, `past-${fx.suffix}@example.test`, past!.id)).toEqual({ status: 409, body: { error: "Live session closed" } });
    expect(await register(fx, `closed-${fx.suffix}@example.test`, closed!.id)).toEqual({ status: 409, body: { error: "Live session closed" } });

    const ok = await register(fx, `ok-${fx.suffix}@example.test`, open!.id);
    expect(ok).toMatchObject({ status: 200, body: { ok: true, verificationRequired: true, liveSession: { id: open!.id } } });
    expect(await register(fx, `full-${fx.suffix}@example.test`, open!.id)).toEqual({ status: 409, body: { error: "Live session full" } });

    const rows = await getDb().formSubmission.findMany({ where: { liveId: fx.live.id }, select: { email: true, liveSessionId: true } });
    expect(rows).toEqual([{ email: `ok-${fx.suffix}@example.test`, liveSessionId: open!.id }]);
    expect(await getDb().liveSession.findUnique({ where: { id: open!.id }, select: { registeredCount: true } })).toEqual({ registeredCount: 1 });
    expect(await getDb().formSubmission.count({ where: { liveId: sibling.live.id } })).toBe(0);

    // The same email again converges on the existing registration and keeps its seat count.
    expect((await register(fx, `ok-${fx.suffix}@example.test`, open!.id)).status).toBe(200);
    expect(await getDb().liveSession.findUnique({ where: { id: open!.id }, select: { registeredCount: true } })).toEqual({ registeredCount: 1 });
  });

  it("never exceeds the capacity under concurrent registrations", async () => {
    const fx = await fixture("concurrent");
    const [target] = await sync(fx, [session(new Date(Date.now() + 2 * DAY), 3)]);
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => register(fx, `c${index}-${fx.suffix}@example.test`, target!.id)));
    const statuses = results.map((result) => result.status).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(3);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    expect(await getDb().formSubmission.count({ where: { liveId: fx.live.id, liveSessionId: target!.id } })).toBe(3);
    expect(await getDb().liveSession.findUnique({ where: { id: target!.id }, select: { registeredCount: true } })).toEqual({ registeredCount: 3 });
  });

  it("keeps a Live without sessions exactly as before", async () => {
    const fx = await fixture("single", { sessionMode: "single" });
    expect(await register(fx, `single-${fx.suffix}@example.test`)).toEqual({ status: 200, body: { ok: true, verificationRequired: true } });
    expect(await getDb().formSubmission.findMany({ where: { liveId: fx.live.id }, select: { liveSessionId: true } })).toEqual([{ liveSessionId: null }]);
    // A session id is only accepted by a fixed-session Live.
    expect(await register(fx, `single-extra-${fx.suffix}@example.test`, "session-synthetic")).toEqual({ status: 400, body: { error: "Invalid payload" } });
  });

  it("deletes a Live together with its sessions while registrations keep their rows", async () => {
    const fx = await fixture("delete");
    const [only] = await sync(fx, [session(new Date(Date.now() + 2 * DAY))]);
    const registrant = await verifiedRegistrant(fx, only!.id, "delete");
    await getDb().live.delete({ where: { id: fx.live.id } });
    expect(await getDb().liveSession.count({ where: { liveId: fx.live.id } })).toBe(0);
    expect(await getDb().formSubmission.findUnique({ where: { id: registrant.id }, select: { liveId: true, liveSessionId: true } }))
      .toEqual({ liveId: null, liveSessionId: only!.id });
  });
});

describe("downstream timing follows the chosen session", () => {
  it("confirms and reminds at the registrant's own session start", async () => {
    const fx = await fixture("verify");
    const early = new Date(Date.now() + 2 * DAY);
    const late = new Date(Date.now() + 5 * DAY);
    const [, lateSession] = await sync(fx, [session(early), session(late)]);
    const expiresAt = new Date(Date.now() + DAY);
    const submission = await getDb().formSubmission.create({
      data: { formId: fx.form.id, liveId: fx.live.id, liveSessionId: lateSession!.id, name: "Lead", email: `verify-${fx.suffix}@example.test`, verificationExpiresAt: expiresAt },
    });
    const token = createFormSubmissionVerificationToken({ submissionId: submission.id, expiresAt, version: 1 });
    const result = await verifyFormSubmission(getDb(), token, new Date());
    expect(result.status).toBe("verified");
    const confirmation = result.status === "verified" ? result.confirmation! : null;
    expect(confirmation?.liveScheduledAt.toISOString()).toBe(late.toISOString());
    expect(confirmation?.fixedSession).toMatchObject({ id: lateSession!.id, status: "open", cancelledAt: null });
    expect(confirmation?.evergreen).toBeNull();

    const reminder = await ensureLiveReminderDelivery({
      ...confirmation!,
      template: confirmation!.reminderTemplate,
      reminderOffsetMinutes: 60,
    });
    expect(reminder).toMatchObject({ status: "scheduled" });
    const row = await getDb().emailDelivery.findFirstOrThrow({ where: { vendorId: fx.vendor.id, trigger: "live_reminder" } });
    expect(row.nextAttemptAt?.toISOString()).toBe(new Date(late.getTime() - HOUR).toISOString());
    const identity = { id: row.id, vendorId: row.vendorId, sourceLiveId: row.sourceLiveId, sourceFormSubmissionId: row.sourceFormSubmissionId, trigger: row.trigger, idempotencyKey: row.idempotencyKey };
    expect(await isCurrentEmailDeliverySnapshot(identity, new Date())).toBe(true);

    // Cancelling the session makes the queued reminder stale at send time and supersedes it.
    await getDb().liveSession.update({ where: { id: lateSession!.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    expect(await isCurrentEmailDeliverySnapshot(identity, new Date())).toBe(false);
    const superseded = await getDb().$transaction((tx) => supersedeFixedSessionDeliveries(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, sessionIds: [lateSession!.id] }));
    expect(superseded).toBe(1);
    expect(await getDb().emailDelivery.findUnique({ where: { id: row.id }, select: { status: true, lastErrorCode: true } }))
      .toEqual({ status: "superseded", lastErrorCode: "session_cancelled" });
  });

  it("schedules before_live and during_live rules at each registrant's session", async () => {
    const fx = await fixture("rules");
    await getDb().live.update({ where: { id: fx.live.id }, data: { liveReminderTemplateId: null } });
    const first = new Date(Date.now() + 2 * DAY);
    const second = new Date(Date.now() + 4 * DAY);
    const [firstSession, secondSession] = await sync(fx, [session(first), session(second)]);
    const before = await getDb().liveNotificationRule.create({
      data: { vendorId: fx.vendor.id, liveId: fx.live.id, messageTemplateId: fx.reminderTemplate.id, trigger: "before_live", offsetMinutes: 30 },
    });
    const during = await getDb().liveNotificationRule.create({
      data: { vendorId: fx.vendor.id, liveId: fx.live.id, messageTemplateId: fx.reminderTemplate.id, trigger: "during_live", offsetMinutes: 5 },
    });
    const a = await verifiedRegistrant(fx, firstSession!.id, "a");
    const b = await verifiedRegistrant(fx, secondSession!.id, "b");
    const now = new Date();
    for (const submission of [a, b]) {
      for (const rule of [before, during]) {
        const result = await ensureLiveNotificationDelivery({ vendorId: fx.vendor.id, liveId: fx.live.id, ruleId: rule.id, submissionId: submission.id }, now, { scheduleFuture: true });
        expect(result.status).toBe("queued");
      }
    }
    const rows = await getDb().emailDelivery.findMany({
      where: { vendorId: fx.vendor.id },
      select: { sourceFormSubmissionId: true, trigger: true, nextAttemptAt: true },
    });
    const at = (submissionId: string, trigger: string) => rows.find((row) => row.sourceFormSubmissionId === submissionId && row.trigger === trigger)?.nextAttemptAt?.toISOString();
    expect(at(a.id, "before_live")).toBe(new Date(first.getTime() - 30 * 60_000).toISOString());
    expect(at(b.id, "before_live")).toBe(new Date(second.getTime() - 30 * 60_000).toISOString());
    expect(at(a.id, "during_live")).toBe(new Date(first.getTime() + 5 * 60_000).toISOString());
    expect(at(b.id, "during_live")).toBe(new Date(second.getTime() + 5 * 60_000).toISOString());

    // A cancelled session gets nothing new.
    await getDb().liveSession.update({ where: { id: secondSession!.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    const c = await getDb().formSubmission.create({
      data: { formId: fx.form.id, liveId: fx.live.id, liveSessionId: secondSession!.id, name: "Late", email: `late-${fx.suffix}@example.test`, verificationStatus: "VERIFIED", verifiedAt: now },
    });
    expect(await ensureLiveNotificationDelivery({ vendorId: fx.vendor.id, liveId: fx.live.id, ruleId: before.id, submissionId: c.id }, now, { scheduleFuture: true }))
      .toEqual({ status: "not_due" });
  });

  it("reconciles legacy reminders per session and changes the digest when a session is cancelled", async () => {
    const fx = await fixture("reconcile");
    const first = new Date(Date.now() + 2 * DAY);
    const second = new Date(Date.now() + 4 * DAY);
    const [firstSession, secondSession] = await sync(fx, [session(first), session(second)]);
    const a = await verifiedRegistrant(fx, firstSession!.id, "a");
    const b = await verifiedRegistrant(fx, secondSession!.id, "b");
    const now = new Date();
    const queued = await getDb().$transaction((tx) => queueLiveReminderReconciliationForCurrentLive(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, now }));
    expect(queued?.status).toBe("queued");
    await processLiveReminderReconciliationJobs({ vendorId: fx.vendor.id, liveId: fx.live.id, now });
    const rows = await getDb().emailDelivery.findMany({ where: { vendorId: fx.vendor.id, trigger: "live_reminder" }, select: { sourceFormSubmissionId: true, nextAttemptAt: true } });
    expect(rows.find((row) => row.sourceFormSubmissionId === a.id)?.nextAttemptAt?.toISOString()).toBe(new Date(first.getTime() - HOUR).toISOString());
    expect(rows.find((row) => row.sourceFormSubmissionId === b.id)?.nextAttemptAt?.toISOString()).toBe(new Date(second.getTime() - HOUR).toISOString());

    const job = await getDb().liveReminderReconciliationJob.findFirstOrThrow({ where: { vendorId: fx.vendor.id, liveId: fx.live.id } });
    await getDb().liveSession.update({ where: { id: secondSession!.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    const requeued = await getDb().$transaction((tx) => queueLiveReminderReconciliationForCurrentLive(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, now }));
    expect(requeued?.jobId).not.toBe(job.id);
  });

  it("resolves the viewer's own session from the signed registration cookie", async () => {
    const fx = await fixture("viewer");
    const now = new Date();
    const running = new Date(now.getTime() - 10 * 60_000);
    const upcoming = new Date(now.getTime() + 2 * DAY);
    const [runningSession, upcomingSession] = await sync(fx, [session(running), session(upcoming)]);
    const registrant = await verifiedRegistrant(fx, upcomingSession!.id, "viewer");
    const live = await getDb().live.findUniqueOrThrow({ where: { id: fx.live.id }, include: { video: true } });
    const token = createFormSubmissionChatSessionToken({ submissionId: registrant.id, now });

    const own = await resolveViewerFixedSession(getDb(), { vendorId: fx.vendor.id, liveId: fx.live.id, registrationToken: token, durationSeconds: 3_600, now });
    expect(own).toMatchObject({ id: upcomingSession!.id, registered: true });
    expect(resolveViewerLiveRuntime(live, { vendorTimezone: "Asia/Taipei", evergreenToken: null, now, fixedSession: own }))
      .toMatchObject({ state: "waiting", playbackStartSeconds: null });

    // Without a registration (or with another Live's registration) the viewer follows the session playing now.
    const other = await fixture("viewer-other");
    const [otherSession] = await sync(other, [session(upcoming)]);
    const foreign = await verifiedRegistrant(other, otherSession!.id, "foreign");
    const foreignToken = createFormSubmissionChatSessionToken({ submissionId: foreign.id, now });
    for (const registrationToken of [null, foreignToken, "fss1.tampered.1.x"]) {
      const publicSession = await resolveViewerFixedSession(getDb(), { vendorId: fx.vendor.id, liveId: fx.live.id, registrationToken, durationSeconds: 3_600, now });
      expect(publicSession).toMatchObject({ id: runningSession!.id, registered: false });
      const runtime = resolveViewerLiveRuntime(live, { vendorTimezone: "Asia/Taipei", evergreenToken: null, now, fixedSession: publicSession });
      expect(runtime.state).toBe("playing");
      expect(runtime.playbackStartSeconds).toBeCloseTo(600, 0);
    }
  });
});

describe("studio mode switches", () => {
  const apply = (fx: Awaited<ReturnType<typeof fixture>>, fixedSessions: ReturnType<typeof session>[] | null, previousSessionMode: string) =>
    getDb().$transaction((tx) => applyLiveSessionChanges(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, fixedSessions, previousSessionMode }));

  it("refuses fixed sessions on a Live whose registrations have no session", async () => {
    const fx = await fixture("switch-on", { sessionMode: "single" });
    await getDb().formSubmission.create({
      data: { formId: fx.form.id, liveId: fx.live.id, name: "Earlier", email: `earlier-${fx.suffix}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
    });
    await expect(apply(fx, [session(new Date(Date.now() + 2 * DAY))], "single")).rejects.toBeInstanceOf(LiveSessionModeConflict);
    expect(await getDb().liveSession.count({ where: { liveId: fx.live.id } })).toBe(0);
  });

  it("refuses one shared start while registrations point at sessions, and clears unused sessions otherwise", async () => {
    const used = await fixture("switch-off-used");
    const [usedSession] = await sync(used, [session(new Date(Date.now() + 2 * DAY))]);
    await verifiedRegistrant(used, usedSession!.id, "bound");
    await expect(apply(used, null, "fixed_sessions")).rejects.toBeInstanceOf(LiveSessionModeConflict);
    expect(await getDb().liveSession.count({ where: { liveId: used.live.id } })).toBe(1);

    const unused = await fixture("switch-off-unused");
    await sync(unused, [session(new Date(Date.now() + 2 * DAY)), session(new Date(Date.now() + 3 * DAY))]);
    await apply(unused, null, "fixed_sessions");
    expect(await getDb().liveSession.count({ where: { liveId: unused.live.id } })).toBe(0);
  });
});