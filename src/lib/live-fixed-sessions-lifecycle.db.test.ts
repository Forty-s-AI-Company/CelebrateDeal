import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/form-submissions/route";
import { POST as VERIFY } from "@/app/api/form-submissions/verify/route";
import { getDb } from "@/lib/db";
import { dispatchEmailDelivery, ensureLiveReminderDelivery, isCurrentEmailDeliverySnapshot, isSuppressionExempt, processDuePostLiveFollowups } from "@/lib/email-delivery";
import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";
import { queueFixedSessionCancellationNotices, resolveFixedSessionRechooseUrl } from "@/lib/live-fixed-session-notices";
import { loadPublicRegistrationForm } from "@/lib/public-registration-form";
import {
  loadPublicLiveSessions,
  releaseExpiredFixedSessionSeats,
  releaseFixedSessionSeatIfExpired,
  syncLiveSessions,
} from "@/lib/live-fixed-sessions-store";
import { processDueLiveNotifications, supersedeFixedSessionDeliveries } from "@/lib/live-notification-delivery";
import { fixedSessionLabel } from "@/lib/live-fixed-sessions";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * 指定場次 lifecycle (PR #529 review): temporary unverified seats, session
 * switches, cancellation notices, per-session follow-ups and per-session
 * materialization, against the disposable loopback PostgreSQL. Synthetic
 * vendors only; each is removed with its cascades afterwards.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const APP = "https://fixed-sessions-lifecycle.example.test";
const vendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "live-fixed-sessions-lifecycle-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
});
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture(label: string) {
  const db = getDb();
  const suffix = `${label}-${randomUUID()}`;
  const vendor = await db.vendor.create({
    data: { name: `Lifecycle ${label}`, slug: `lifecycle-${suffix}`, email: `lifecycle-${suffix}@example.test`, passwordHash: "synthetic-only", timezone: "Asia/Taipei" },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id, name: "Form", slug: `lifecycle-form-${suffix}`, headline: "Synthetic",
      fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
    },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "Recording", sourceType: "url", videoUrl: "https://video.example.test/recording.m3u8", durationSec: 3_600, status: "ready" },
  });
  const reminderTemplate = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "Reminder", channel: "email", trigger: "live_reminder", subject: "{{live_title}} {{live_start_at}}", body: "Hello {{name}} {{live_start_at}}\n{{unsubscribe_url}}", isActive: true },
  });
  const confirmationTemplate = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "Confirmed", channel: "email", trigger: "registration_confirmed", subject: "報名成功", body: "{{name}} {{live_url}}\n{{unsubscribe_url}}", isActive: true },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id, formId: form.id, videoId: video.id, title: "Lifecycle sessions", slug: `lifecycle-live-${suffix}`,
      scheduledAt: new Date(Date.now() + 10 * DAY), status: "scheduled", streamMode: "vod", sessionMode: "fixed_sessions",
      liveReminderTemplateId: reminderTemplate.id, liveReminderOffsetMinutes: 60, messageTemplateId: confirmationTemplate.id,
    },
  });
  return { vendor, form, video, live, reminderTemplate, suffix };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const session = (startAt: Date, capacity: number | null = null, status: "open" | "closed" = "open") => ({ startAt, capacity, status });

async function sync(fx: Fixture, sessions: ReturnType<typeof session>[], now = new Date()) {
  await getDb().$transaction((tx) => syncLiveSessions(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, sessions, now }));
  return getDb().liveSession.findMany({ where: { vendorId: fx.vendor.id, liveId: fx.live.id }, orderBy: { startAt: "asc" } });
}

function seats(sessionId: string) {
  return getDb().liveSession.findUniqueOrThrow({ where: { id: sessionId }, select: { registeredCount: true } }).then((row) => row.registeredCount);
}

async function register(fx: Fixture, email: string, liveSessionId: string, cookie?: string) {
  const response = await POST(new Request(`${APP}/api/form-submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP, "x-celebratedeal-client": "web", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ formId: fx.form.id, liveId: fx.live.id, liveSessionId, payload: { name: "Synthetic Lead", email } }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function submissionByEmail(fx: Fixture, email: string) {
  return getDb().formSubmission.findFirstOrThrow({
    where: { liveId: fx.live.id, email },
    select: { id: true, liveSessionId: true, liveSessionSeatReleasedAt: true, verificationStatus: true, verificationVersion: true, verificationExpiresAt: true },
  });
}

async function verifiedRegistrant(fx: Fixture, sessionId: string, label: string) {
  const db = getDb();
  await db.liveSession.update({ where: { id: sessionId }, data: { registeredCount: { increment: 1 } } });
  return db.formSubmission.create({
    data: { formId: fx.form.id, liveId: fx.live.id, liveSessionId: sessionId, name: `Lead ${label}`, email: `lead-${label}-${fx.suffix}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
}

function chatCookie(submissionId: string) {
  return `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(createFormSubmissionChatSessionToken({ submissionId }))}`;
}

function reveal(row: { id: string; vendorId: string; payloadEncryptedEnvelope: string }) {
  return revealEmailDeliveryPayload(row.payloadEncryptedEnvelope, { vendorId: row.vendorId, deliveryId: row.id });
}

function identity(row: { id: string; vendorId: string; sourceLiveId: string | null; sourceFormSubmissionId: string | null; trigger: string; idempotencyKey: string }) {
  return { id: row.id, vendorId: row.vendorId, sourceLiveId: row.sourceLiveId, sourceFormSubmissionId: row.sourceFormSubmissionId, trigger: row.trigger, idempotencyKey: row.idempotencyKey };
}

describe("unverified seats are temporary (M-1)", () => {
  it("releases an expired unverified seat exactly once and frees it for someone else", async () => {
    const fx = await fixture("release");
    const [target] = await sync(fx, [session(new Date(Date.now() + 3 * DAY), 1)]);
    const email = `first-${fx.suffix}@example.test`;
    expect((await register(fx, email, target!.id)).status).toBe(200);
    expect(vi.mocked(checkRateLimit)).toHaveBeenCalledWith(expect.any(Request), `form-submissions-session:${target!.id}`, 5, 10 * MINUTE);
    expect(await seats(target!.id)).toBe(1);
    const first = await submissionByEmail(fx, email);
    await getDb().formSubmission.update({ where: { id: first.id }, data: { verificationExpiresAt: new Date(Date.now() - MINUTE) } });

    const now = new Date();
    const counts = await Promise.all([
      releaseExpiredFixedSessionSeats(getDb(), { now }),
      releaseExpiredFixedSessionSeats(getDb(), { now }),
      releaseFixedSessionSeatIfExpired(getDb(), { submissionId: first.id, now }).then((released) => (released ? 1 : 0)),
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await seats(target!.id)).toBe(0);
    expect((await submissionByEmail(fx, email)).liveSessionSeatReleasedAt).not.toBeNull();
    expect(await releaseExpiredFixedSessionSeats(getDb(), { now: new Date() })).toBe(0);

    // The freed seat goes to the next registrant; the first one now finds the session full.
    expect((await register(fx, `second-${fx.suffix}@example.test`, target!.id)).status).toBe(200);
    expect(await register(fx, email, target!.id)).toEqual({ status: 409, body: { error: "Live session full" } });
    expect(await seats(target!.id)).toBe(1);
  });

  it("keeps the seat of a registration verified inside the window", async () => {
    const fx = await fixture("keep");
    const [target] = await sync(fx, [session(new Date(Date.now() + 3 * DAY), 2)]);
    const email = `keep-${fx.suffix}@example.test`;
    await register(fx, email, target!.id);
    const submission = await submissionByEmail(fx, email);
    const token = createFormSubmissionVerificationToken({ submissionId: submission.id, expiresAt: submission.verificationExpiresAt!, version: submission.verificationVersion });
    expect((await verifyFormSubmission(getDb(), token, new Date())).status).toBe("verified");
    expect(await releaseExpiredFixedSessionSeats(getDb(), { now: new Date(submission.verificationExpiresAt!.getTime() + HOUR) })).toBe(0);
    expect(await seats(target!.id)).toBe(1);
  });

  it("gives the seat back when an expired link is opened, and takes it again on a new registration", async () => {
    const fx = await fixture("expired-link");
    const [target] = await sync(fx, [session(new Date(Date.now() + 3 * DAY), 3)]);
    const email = `late-${fx.suffix}@example.test`;
    await register(fx, email, target!.id);
    const submission = await submissionByEmail(fx, email);
    const expiredAt = new Date(Date.now() - MINUTE);
    await getDb().formSubmission.update({ where: { id: submission.id }, data: { verificationExpiresAt: expiredAt } });
    const token = createFormSubmissionVerificationToken({ submissionId: submission.id, expiresAt: expiredAt, version: submission.verificationVersion });
    const response = await VERIFY(new Request(`${APP}/api/form-submissions/verify`, {
      method: "POST",
      headers: { origin: APP, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }));
    expect(response.headers.get("location")).toContain("status=invalid");
    expect(await seats(target!.id)).toBe(0);

    expect((await register(fx, email, target!.id)).status).toBe(200);
    const again = await submissionByEmail(fx, email);
    expect(again).toMatchObject({ liveSessionId: target!.id, liveSessionSeatReleasedAt: null, verificationStatus: "UNVERIFIED" });
    expect(again.verificationVersion).toBe(submission.verificationVersion + 1);
    expect(await seats(target!.id)).toBe(1);
  });
});

describe("re-registering moves between sessions (M-2)", () => {
  it("moves an unverified registration while its session has not started", async () => {
    const fx = await fixture("switch-unverified");
    const [a, b] = await sync(fx, [session(new Date(Date.now() + 2 * DAY), 5), session(new Date(Date.now() + 3 * DAY), 5)]);
    const email = `move-${fx.suffix}@example.test`;
    await register(fx, email, a!.id);
    expect((await register(fx, email, b!.id)).status).toBe(200);
    expect((await submissionByEmail(fx, email)).liveSessionId).toBe(b!.id);
    expect([await seats(a!.id), await seats(b!.id)]).toEqual([0, 1]);
    expect(await getDb().formSubmission.count({ where: { liveId: fx.live.id } })).toBe(1);
  });

  it("moves a confirmed registrant only from their own browser, and the reminders follow", async () => {
    const fx = await fixture("switch-verified");
    const first = new Date(Date.now() + 2 * DAY);
    const second = new Date(Date.now() + 4 * DAY);
    const [a, b] = await sync(fx, [session(first, 5), session(second, 5)]);
    const registrant = await verifiedRegistrant(fx, a!.id, "verified");
    await ensureLiveReminderDelivery({
      vendorId: fx.vendor.id, vendorName: fx.vendor.name, liveId: fx.live.id, liveSlug: fx.live.slug, liveTitle: fx.live.title,
      formSubmissionId: registrant.id, recipientName: registrant.name, recipientEmail: registrant.email,
      liveScheduledAt: first, reminderOffsetMinutes: 60, template: fx.reminderTemplate,
    });

    // Knowing the email is not enough to move a confirmed registration, and the 409 reveals nothing about it.
    expect(await register(fx, registrant.email, b!.id)).toEqual({ status: 409, body: { error: "Already registered for another session" } });
    // A cookie of another registration does not count as this registrant's browser.
    const stranger = await verifiedRegistrant(fx, b!.id, "stranger");
    expect(await register(fx, registrant.email, b!.id, chatCookie(stranger.id))).toEqual({ status: 409, body: { error: "Already registered for another session" } });
    await getDb().liveSession.update({ where: { id: b!.id }, data: { registeredCount: { decrement: 1 } } });
    await getDb().formSubmission.delete({ where: { id: stranger.id } });
    expect((await submissionByEmail(fx, registrant.email)).liveSessionId).toBe(a!.id);

    const moved = await register(fx, registrant.email, b!.id, chatCookie(registrant.id));
    expect(moved).toEqual({ status: 200, body: { ok: true, verificationRequired: true, liveSession: { id: b!.id, startAt: second.toISOString(), label: fixedSessionLabel(second) } } });
    expect((await submissionByEmail(fx, registrant.email)).liveSessionId).toBe(b!.id);
    expect([await seats(a!.id), await seats(b!.id)]).toEqual([0, 1]);
    const reminders = await getDb().emailDelivery.findMany({
      where: { vendorId: fx.vendor.id, trigger: "live_reminder", sourceFormSubmissionId: registrant.id },
      select: { status: true, nextAttemptAt: true, lastErrorCode: true },
      orderBy: { createdAt: "asc" },
    });
    expect(reminders).toEqual([
      { status: "superseded", nextAttemptAt: null, lastErrorCode: "session_changed" },
      { status: "queued", nextAttemptAt: new Date(second.getTime() - HOUR), lastErrorCode: null },
    ]);
  });

  it("lets a registrant of a cancelled session choose again, but never leaves a session that already started", async () => {
    const fx = await fixture("switch-cancelled");
    const [started, cancelled, open, full] = await sync(fx, [
      session(new Date(Date.now() - 10 * MINUTE)),
      session(new Date(Date.now() + 2 * DAY)),
      session(new Date(Date.now() + 3 * DAY)),
      session(new Date(Date.now() + 4 * DAY), 1),
    ]);
    const stranded = await verifiedRegistrant(fx, cancelled!.id, "stranded");
    await sync(fx, [session(started!.startAt), session(open!.startAt), session(full!.startAt, 1)]);
    expect((await getDb().liveSession.findUniqueOrThrow({ where: { id: cancelled!.id } })).status).toBe("cancelled");
    expect((await register(fx, stranded.email, open!.id)).status).toBe(200);
    expect((await submissionByEmail(fx, stranded.email)).liveSessionId).toBe(open!.id);

    const watching = await verifiedRegistrant(fx, started!.id, "watching");
    // Its own browser (signed registration cookie) is told which session it holds...
    expect(await register(fx, watching.email, open!.id, chatCookie(watching.id))).toEqual({
      status: 409,
      body: { error: "Already registered for another session", startAt: started!.startAt.toISOString(), sessionLabel: fixedSessionLabel(started!.startAt) },
    });
    // ...anyone else who only knows the email is not.
    expect(await register(fx, watching.email, open!.id)).toEqual({ status: 409, body: { error: "Already registered for another session" } });
    expect((await submissionByEmail(fx, watching.email)).liveSessionId).toBe(started!.id);

    await verifiedRegistrant(fx, full!.id, "full");
    expect(await register(fx, stranded.email, full!.id, chatCookie(stranded.id))).toEqual({ status: 409, body: { error: "Live session full" } });
    expect((await submissionByEmail(fx, stranded.email)).liveSessionId).toBe(open!.id);
    expect([await seats(open!.id), await seats(full!.id)]).toEqual([1, 1]);
  });
});

describe("cancellation notices (M-2)", () => {
  it("notifies each verified registrant once per cancellation with a link to choose again", async () => {
    const fx = await fixture("notice");
    const [a, b] = await sync(fx, [session(new Date("2030-10-30T06:00:00.000Z")), session(new Date("2030-10-31T12:00:00.000Z"))]);
    const verified = await verifiedRegistrant(fx, a!.id, "notice");
    await getDb().liveSession.update({ where: { id: a!.id }, data: { registeredCount: { increment: 1 } } });
    await getDb().formSubmission.create({
      data: { formId: fx.form.id, liveId: fx.live.id, liveSessionId: a!.id, name: "Unverified", email: `unverified-${fx.suffix}@example.test` },
    });
    await sync(fx, [session(b!.startAt)]);

    expect(await queueFixedSessionCancellationNotices({ vendorId: fx.vendor.id, liveId: fx.live.id })).toHaveLength(1);
    expect(await queueFixedSessionCancellationNotices({ vendorId: fx.vendor.id, liveId: fx.live.id })).toEqual([]);
    expect((await getDb().liveSession.findUniqueOrThrow({ where: { id: a!.id } })).cancellationNoticesQueuedAt).not.toBeNull();
    const notices = await getDb().emailDelivery.findMany({ where: { vendorId: fx.vendor.id, trigger: "fixed_session_cancelled" } });
    expect(notices.map((row) => row.sourceFormSubmissionId)).toEqual([verified.id]);
    const body = reveal(notices[0]!).body;
    expect(body).toContain("你報名的場次已取消，請重新選擇場次");
    expect(body).toContain(`${APP}/form/${fx.form.slug}`);
    expect(await isCurrentEmailDeliverySnapshot(identity(notices[0]!), new Date())).toBe(true);

    // Reopening makes the notice stale; cancelling again sends a new one.
    await sync(fx, [session(a!.startAt), session(b!.startAt)]);
    expect(await isCurrentEmailDeliverySnapshot(identity(notices[0]!), new Date())).toBe(false);
    await sync(fx, [session(b!.startAt)], new Date(Date.now() + 1_000));
    expect(await queueFixedSessionCancellationNotices({ vendorId: fx.vendor.id, liveId: fx.live.id })).toHaveLength(1);
    expect(await getDb().emailDelivery.count({ where: { vendorId: fx.vendor.id, trigger: "fixed_session_cancelled" } })).toBe(2);
  });
});

describe("per-session timing (M-3, m-7)", () => {
  it("follows up each registrant after their own session and skips cancelled ones", async () => {
    const fx = await fixture("followup");
    const now = new Date();
    const pastStart = new Date(now.getTime() - 3 * HOUR);
    const [past, cancelledPast, future] = await sync(fx, [session(pastStart), session(new Date(pastStart.getTime() + MINUTE)), session(new Date(now.getTime() + DAY))]);
    const template = await getDb().messageTemplate.create({
      data: { vendorId: fx.vendor.id, name: "Follow-up", channel: "email", trigger: "post_live_followup", subject: "感謝參加", body: "{{name}} {{live_start_at}}\n{{unsubscribe_url}}", isActive: true },
    });
    await getDb().liveNotificationRule.create({
      data: { vendorId: fx.vendor.id, liveId: fx.live.id, messageTemplateId: template.id, trigger: "post_live_followup", offsetMinutes: 10 },
    });
    const due = await verifiedRegistrant(fx, past!.id, "due");
    await verifiedRegistrant(fx, cancelledPast!.id, "cancelled");
    await verifiedRegistrant(fx, future!.id, "future");
    await getDb().liveSession.update({ where: { id: cancelledPast!.id }, data: { status: "cancelled", cancelledAt: now } });

    await processDuePostLiveFollowups({ now });
    const rows = await getDb().emailDelivery.findMany({ where: { vendorId: fx.vendor.id, trigger: "post_live_followup" } });
    expect(rows.map((row) => row.sourceFormSubmissionId)).toEqual([due.id]);
    const expectedStart = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(pastStart);
    expect(reveal(rows[0]!).body).toContain(expectedStart);
    expect(await isCurrentEmailDeliverySnapshot(identity(rows[0]!), now)).toBe(true);
  });

  it("materializes before_live per session through processDueLiveNotifications, also after a session is re-added", async () => {
    const fx = await fixture("materialize");
    await getDb().live.update({ where: { id: fx.live.id }, data: { liveReminderTemplateId: null } });
    const first = new Date(Date.now() + 2 * DAY);
    const second = new Date(Date.now() + 4 * DAY);
    const [a, b] = await sync(fx, [session(first), session(second)]);
    const rule = await getDb().liveNotificationRule.create({
      data: { vendorId: fx.vendor.id, liveId: fx.live.id, messageTemplateId: fx.reminderTemplate.id, trigger: "before_live", offsetMinutes: 30 },
    });
    const ra = await verifiedRegistrant(fx, a!.id, "a");
    const rb = await verifiedRegistrant(fx, b!.id, "b");
    const run = () => processDueLiveNotifications({ vendorId: fx.vendor.id, ruleIds: [rule.id], includeFuture: true, now: new Date() });
    const queuedAt = async () => Object.fromEntries((await getDb().emailDelivery.findMany({
      where: { vendorId: fx.vendor.id, trigger: "before_live", status: "queued" },
      select: { sourceFormSubmissionId: true, nextAttemptAt: true },
    })).map((row) => [row.sourceFormSubmissionId, row.nextAttemptAt?.toISOString()]));

    await run();
    expect(await queuedAt()).toEqual({
      [ra.id]: new Date(first.getTime() - 30 * MINUTE).toISOString(),
      [rb.id]: new Date(second.getTime() - 30 * MINUTE).toISOString(),
    });

    // Cancelling b supersedes its row; re-adding the same start reopens it and the next run schedules it again.
    await getDb().$transaction(async (tx) => {
      const result = await syncLiveSessions(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, sessions: [session(first)] });
      await supersedeFixedSessionDeliveries(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, sessionIds: result.cancelledSessionIds });
    });
    await run();
    expect(Object.keys(await queuedAt())).toEqual([ra.id]);
    const reopened = await sync(fx, [session(first), session(second)]);
    expect(reopened.find((row) => row.id === b!.id)).toMatchObject({ status: "open", cancelledAt: null, cancellationNoticesQueuedAt: null, registeredCount: 1 });
    await run();
    expect(await queuedAt()).toEqual({
      [ra.id]: new Date(first.getTime() - 30 * MINUTE).toISOString(),
      [rb.id]: new Date(second.getTime() - 30 * MINUTE).toISOString(),
    });
  });

  it("never lets a seat taken during a cancellation escape the ledger", async () => {
    const fx = await fixture("race");
    const [target, other] = await sync(fx, [session(new Date(Date.now() + 2 * DAY), 20), session(new Date(Date.now() + 3 * DAY))]);
    await verifiedRegistrant(fx, target!.id, "anchor");
    const registrations = Array.from({ length: 6 }, (_, index) => register(fx, `race-${index}-${fx.suffix}@example.test`, target!.id));
    const cancellation = getDb().$transaction(async (tx) => {
      // Same order as the studio: the Live row first, then the sessions.
      await tx.$executeRaw`UPDATE "Live" SET "title" = "title" WHERE "id" = ${fx.live.id} AND "vendorId" = ${fx.vendor.id}`;
      return syncLiveSessions(tx, { vendorId: fx.vendor.id, liveId: fx.live.id, sessions: [session(other!.startAt)] });
    });
    const [results, cancelled] = await Promise.all([Promise.all(registrations), cancellation]);
    expect(cancelled.cancelledSessionIds).toEqual([target!.id]);
    const accepted = results.filter((result) => result.status === 200).length;
    expect(results.every((result) => [200, 409].includes(result.status))).toBe(true);
    const held = await getDb().formSubmission.count({ where: { liveSessionId: target!.id, liveSessionSeatReleasedAt: null } });
    expect(held).toBe(accepted + 1);
    expect(await seats(target!.id)).toBe(held);
    expect((await getDb().liveSession.findUniqueOrThrow({ where: { id: target!.id } })).status).toBe("cancelled");
    // Once cancelled, nobody else gets in.
    expect(await register(fx, `after-${fx.suffix}@example.test`, target!.id)).toEqual({ status: 409, body: { error: "Live session closed" } });
  });

  it("hides the session list of a Live that is not publish-ready", async () => {
    const fx = await fixture("readiness");
    await sync(fx, [session(new Date(Date.now() + 2 * DAY))]);
    expect(await loadPublicLiveSessions(getDb(), { liveId: fx.live.id })).not.toBeNull();
    await getDb().live.update({ where: { id: fx.live.id }, data: { messageTemplateId: null } });
    expect(await loadPublicLiveSessions(getDb(), { liveId: fx.live.id })).toBeNull();
  });
});

describe("second review of PR #529", () => {
  it("answers a confirmed registration with the session it holds and sets the thank-you cookie", async () => {
    const fx = await fixture("confirmed");
    const [a] = await sync(fx, [session(new Date("2030-10-30T06:00:00.000Z"), 5)]);
    const response = await POST(new Request(`${APP}/api/form-submissions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP, "x-celebratedeal-client": "web" },
      body: JSON.stringify({ formId: fx.form.id, liveId: fx.live.id, liveSessionId: a!.id, payload: { name: "Lead", email: `cookie-${fx.suffix}@example.test` } }),
    }));
    expect(await response.json()).toEqual({ ok: true, verificationRequired: true, liveSession: { id: a!.id, startAt: "2030-10-30T06:00:00.000Z", label: "10月30日（週三） 14:00" } });
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("celebratedeal_live_session_result="));
    expect(cookie).toBeDefined();
    expect(cookie).not.toMatch(/HttpOnly/iu);
    expect(JSON.parse(decodeURIComponent(cookie!.split(";")[0]!.split("=").slice(1).join("=")))).toEqual({ id: a!.id, startAt: "2030-10-30T06:00:00.000Z", label: "10月30日（週三） 14:00", liveId: fx.live.id });
  });

  it("sends the cancellation notice, not a confirmation, when a registrant verifies after their session was cancelled", async () => {
    const fx = await fixture("verify-cancelled");
    const [a, b] = await sync(fx, [session(new Date(Date.now() + 2 * DAY), 5), session(new Date(Date.now() + 3 * DAY), 5)]);
    const email = `late-cancel-${fx.suffix}@example.test`;
    await register(fx, email, a!.id);
    const submission = await submissionByEmail(fx, email);
    await sync(fx, [session(b!.startAt, 5)]);
    // The studio/job pass already ran for this cancellation (the registrant was not verified yet).
    expect(await queueFixedSessionCancellationNotices({ vendorId: fx.vendor.id, liveId: fx.live.id })).toEqual([]);

    const token = createFormSubmissionVerificationToken({ submissionId: submission.id, expiresAt: submission.verificationExpiresAt!, version: submission.verificationVersion });
    const response = await VERIFY(new Request(`${APP}/api/form-submissions/verify`, {
      method: "POST",
      headers: { origin: APP, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("status")).toBe("session_cancelled");
    expect(location.searchParams.get("rechoose")).toBe(`/form/${fx.form.slug}`);
    const rows = await getDb().emailDelivery.findMany({ where: { vendorId: fx.vendor.id, sourceFormSubmissionId: submission.id }, select: { trigger: true } });
    expect(rows.map((row) => row.trigger).sort()).toEqual(["fixed_session_cancelled", "form_submission_verification"]);
    // Same identity as the studio/job notice: a later pass adds nothing.
    await getDb().liveSession.update({ where: { id: a!.id }, data: { cancellationNoticesQueuedAt: null } });
    await queueFixedSessionCancellationNotices({ vendorId: fx.vendor.id, liveId: fx.live.id });
    expect(await getDb().emailDelivery.count({ where: { vendorId: fx.vendor.id, trigger: "fixed_session_cancelled" } })).toBe(1);
  });

  it("treats the cancellation notice as a service message: an unsubscribe lets it through, a bounce or the blacklist does not", async () => {
    expect(isSuppressionExempt("fixed_session_cancelled", "recipient_request")).toBe(true);
    expect(isSuppressionExempt("fixed_session_cancelled", "hard_bounce")).toBe(false);
    expect(isSuppressionExempt("live_reminder", "recipient_request")).toBe(false);

    const fx = await fixture("transactional");
    const [a, b] = await sync(fx, [session(new Date(Date.now() + 2 * DAY)), session(new Date(Date.now() + 3 * DAY))]);
    const unsubscribed = await verifiedRegistrant(fx, a!.id, "unsubscribed");
    const bounced = await verifiedRegistrant(fx, a!.id, "bounced");
    const blocked = await verifiedRegistrant(fx, a!.id, "blocked");
    const { protectEmailDeliveryPayload } = await import("@/lib/email-delivery-pii");
    const hash = (address: string) => protectEmailDeliveryPayload({ recipientEmail: address, subject: "x", body: "x" }, { vendorId: fx.vendor.id, deliveryId: "email_hash" }).recipientHash;
    await getDb().emailSuppression.createMany({ data: [
      { vendorId: fx.vendor.id, recipientHash: hash(unsubscribed.email), recipientMaskedEmail: "u***", reason: "recipient_request", source: "unsubscribe_link" },
      { vendorId: fx.vendor.id, recipientHash: hash(bounced.email), recipientMaskedEmail: "b***", reason: "hard_bounce", source: "provider" },
    ] });
    await getDb().blacklist.create({ data: { vendorId: fx.vendor.id, identifierType: "email", identifier: blocked.email, reason: "synthetic" } });
    await sync(fx, [session(b!.startAt)]);
    await queueFixedSessionCancellationNotices({ vendorId: fx.vendor.id, liveId: fx.live.id });
    const rows = await getDb().emailDelivery.findMany({ where: { vendorId: fx.vendor.id, trigger: "fixed_session_cancelled" }, select: { id: true, sourceFormSubmissionId: true, status: true } });
    const byRecipient = Object.fromEntries(rows.map((row) => [row.sourceFormSubmissionId, row]));
    expect(byRecipient[unsubscribed.id]!.status).toBe("queued");
    expect(byRecipient[bounced.id]!.status).toBe("queued");
    expect(byRecipient[blocked.id]!.status).toBe("suppressed");
    // At send time the bounce still suppresses it (before any provider call).
    expect(await dispatchEmailDelivery(byRecipient[bounced.id]!.id)).toEqual({ status: "suppressed" });
    // The copy is the platform's own service text with no unsubscribe link.
    const notice = await getDb().emailDelivery.findUniqueOrThrow({ where: { id: byRecipient[unsubscribed.id]!.id } });
    const body = reveal(notice).body;
    expect(body).toContain("這是依你的報名寄出的服務通知");
    expect(body).not.toContain("退訂");
  });

  it("lists a fixed-session live on /form with its open sessions, and links there only while the form is public", async () => {
    const fx = await fixture("form-page");
    await sync(fx, [session(new Date("2030-10-30T06:00:00.000Z")), session(new Date("2030-10-31T12:00:00.000Z"), 3)]);
    const page = await loadPublicRegistrationForm(fx.form.slug);
    const option = page!.sessions.find((item) => item.id === fx.live.id)!;
    expect(option.fixedSessions!.days.map((day) => [day.date, day.sessions.map((entry) => entry.timeLabel)])).toEqual([["2030-10-30", ["14:00"]], ["2030-10-31", ["20:00"]]]);
    const rechoose = () => resolveFixedSessionRechooseUrl({ vendorId: fx.vendor.id, liveId: fx.live.id, slug: fx.live.slug, formId: fx.form.id });
    expect(await rechoose()).toBe(`${APP}/form/${fx.form.slug}`);

    // The form moves into an unpublished project: /form would 404, so the link falls back to the watch page.
    const project = await getDb().salesProject.create({ data: { vendorId: fx.vendor.id, name: "Draft", slug: `draft-${fx.suffix}`, mode: "live_course", primaryFlow: "live" } });
    await getDb().registrationForm.update({ where: { id: fx.form.id }, data: { projectId: project.id } });
    expect(await loadPublicRegistrationForm(fx.form.slug)).toBeNull();
    expect(await rechoose()).toBe(`${APP}/live/${fx.live.slug}`);
  });

  it("never turns a switch racing a seat release into a 500", async () => {
    const fx = await fixture("race-release");
    const [a, b] = await sync(fx, [session(new Date(Date.now() + 2 * DAY), 10), session(new Date(Date.now() + 3 * DAY), 10)]);
    const emails = Array.from({ length: 4 }, (_, index) => `race-${index}-${fx.suffix}@example.test`);
    for (const email of emails) await register(fx, email, a!.id);
    await getDb().formSubmission.updateMany({ where: { liveId: fx.live.id }, data: { verificationExpiresAt: new Date(Date.now() - MINUTE) } });
    const now = new Date();
    const ids = (await getDb().formSubmission.findMany({ where: { liveId: fx.live.id }, select: { id: true } })).map((row) => row.id);
    const [switches] = await Promise.all([
      Promise.all(emails.map((email) => register(fx, email, b!.id))),
      Promise.all(ids.map((submissionId) => releaseFixedSessionSeatIfExpired(getDb(), { submissionId, now }).catch((error: unknown) => error))),
      releaseExpiredFixedSessionSeats(getDb(), { now }),
    ]);
    expect(switches.every((result) => result.status === 200)).toBe(true);
    const rows = await getDb().formSubmission.findMany({ where: { liveId: fx.live.id }, select: { liveSessionId: true, liveSessionSeatReleasedAt: true } });
    const held = (sessionId: string) => rows.filter((row) => row.liveSessionId === sessionId && row.liveSessionSeatReleasedAt === null).length;
    expect([await seats(a!.id), await seats(b!.id)]).toEqual([held(a!.id), held(b!.id)]);
    expect(rows.every((row) => row.liveSessionId === b!.id)).toBe(true);
  });

  it("follows up only sessions that played to their end before the merchant ended or withdrew the live", async () => {
    const fx = await fixture("followup-ended");
    const now = new Date();
    const early = new Date(now.getTime() - 6 * HOUR);
    const late = new Date(now.getTime() - 3 * HOUR);
    const [earlySession, lateSession] = await sync(fx, [session(early), session(late)]);
    const template = await getDb().messageTemplate.create({
      data: { vendorId: fx.vendor.id, name: "Follow-up", channel: "email", trigger: "post_live_followup", subject: "感謝參加", body: "{{name}}\n{{unsubscribe_url}}", isActive: true },
    });
    await getDb().liveNotificationRule.create({ data: { vendorId: fx.vendor.id, liveId: fx.live.id, messageTemplateId: template.id, trigger: "post_live_followup", offsetMinutes: 10 } });
    const watchedEarly = await verifiedRegistrant(fx, earlySession!.id, "early");
    await verifiedRegistrant(fx, lateSession!.id, "late");
    // Ended between the two sessions: the later one never finished.
    await getDb().live.update({ where: { id: fx.live.id }, data: { status: "ended", endedAt: new Date(late.getTime() - HOUR) } });
    await processDuePostLiveFollowups({ now });
    const rows = await getDb().emailDelivery.findMany({ where: { vendorId: fx.vendor.id, trigger: "post_live_followup" }, select: { sourceFormSubmissionId: true } });
    expect(rows.map((row) => row.sourceFormSubmissionId)).toEqual([watchedEarly.id]);

    // Withdrawn to draft: nothing more is sent.
    const withdrawn = await fixture("followup-draft");
    const [played] = await sync(withdrawn, [session(early)]);
    const draftTemplate = await getDb().messageTemplate.create({
      data: { vendorId: withdrawn.vendor.id, name: "Follow-up", channel: "email", trigger: "post_live_followup", subject: "感謝參加", body: "{{name}}\n{{unsubscribe_url}}", isActive: true },
    });
    await getDb().liveNotificationRule.create({ data: { vendorId: withdrawn.vendor.id, liveId: withdrawn.live.id, messageTemplateId: draftTemplate.id, trigger: "post_live_followup", offsetMinutes: 10 } });
    await verifiedRegistrant(withdrawn, played!.id, "draft");
    await getDb().live.update({ where: { id: withdrawn.live.id }, data: { status: "draft" } });
    await processDuePostLiveFollowups({ now });
    expect(await getDb().emailDelivery.count({ where: { vendorId: withdrawn.vendor.id, trigger: "post_live_followup" } })).toBe(0);
  });
});