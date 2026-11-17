import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Q-11 `form_no_show` on the disposable PostgreSQL database: registrations,
// Lives, sessions, attendance, rules, execution logs, tags, delayed-step runs
// and automation e-mails are real. Synthetic: the post-response e-mail send
// (`after`) and monitoring. No provider, e-mail or LINE service is called.
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: monitoring.captureOperationalError,
}));
vi.mock("@/lib/email-delivery-immediate", async (original) => ({
  ...await original<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: vi.fn(),
}));

import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { createEmailRecipientHash, revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import {
  FORM_NO_SHOW_GRACE_MS,
  FORM_NO_SHOW_LOOKBACK_MS,
  formNoShowEventId,
  formNoShowSessionKey,
  runFormNoShowAutomation,
} from "@/lib/form-no-show-automation";
import { LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS, recordLiveRegistrationAttendance } from "@/lib/live-registration-attendance";

vi.setConfig({ testTimeout: 30_000 });

const db = getDb();
const vendorIds: string[] = [];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const VIDEO_SECONDS = 600;
const APP_URL = "https://no-show.example.test";
/** Every fixture time is relative to the real clock: execution logs use the database's. */
const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "form-no-show-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

type Tenant = Awaited<ReturnType<typeof tenant>>;

async function tenant(options: { grant?: boolean } = {}) {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `缺席商家 ${key}`,
      slug: `no-show-${key}`,
      email: `vendor-${key}@example.test`,
      passwordHash: "synthetic-only",
      betaFeatureGrants: options.grant ? ["automation_delayed_steps"] : [],
    },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `no-show-form-${key}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "預錄影片", videoUrl: "https://media.example.test/no-show.mp4", durationSec: VIDEO_SECONDS, status: "ready" },
  });
  return { vendor, form, video };
}

function live(t: Tenant, data: Partial<Prisma.LiveUncheckedCreateInput> = {}) {
  return db.live.create({
    data: {
      vendorId: t.vendor.id,
      formId: t.form.id,
      videoId: t.video.id,
      title: "缺席測試直播",
      slug: `no-show-live-${randomUUID().slice(0, 12)}`,
      scheduledAt: ago(3 * HOUR),
      status: "scheduled",
      streamMode: "vod",
      ...data,
    },
  });
}

function registrant(t: Tenant, liveId: string, options: { verified?: boolean; createdAt?: Date; liveSessionId?: string } = {}) {
  const verified = options.verified ?? true;
  return db.formSubmission.create({
    data: {
      formId: t.form.id,
      liveId,
      name: "王小明",
      email: `lead-${randomUUID().slice(0, 8)}@example.test`,
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      verifiedAt: verified ? ago(5 * HOUR) : null,
      createdAt: options.createdAt ?? ago(6 * HOUR),
      ...(options.liveSessionId ? { liveSessionId: options.liveSessionId } : {}),
    },
  });
}

function noShowRule(t: Tenant, options: { isActive?: boolean; updatedAt?: Date; actions?: unknown[] } = {}) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `缺席喚醒 ${randomUUID().slice(0, 6)}`,
      trigger: "form_no_show",
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: (options.actions ?? [{ type: "add_customer_tag", tag: "缺席" }]) as Prisma.InputJsonArray,
      isActive: options.isActive ?? true,
      updatedAt: options.updatedAt ?? ago(7 * HOUR),
    },
  });
}

function logsOf(t: Tenant) {
  return db.automationExecutionLog.findMany({
    where: { vendorId: t.vendor.id, trigger: "form_no_show" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, ruleId: true, eventId: true, status: true, subjectType: true, subjectKeyHash: true, liveId: true },
  });
}

const run = (vendors: Tenant[], options: Omit<Parameters<typeof runFormNoShowAutomation>[0] & object, "vendorIds"> = {}) =>
  runFormNoShowAutomation({ ...options, vendorIds: vendors.map((t) => t.vendor.id) });

describe("報名後未出席直播 (Q-11)", () => {
  it("fires once for a verified registrant who never watched, and not for watchers, unverified or late registrations", async () => {
    const t = await tenant();
    const rule = await noShowRule(t, { actions: [{ type: "add_customer_tag", tag: "缺席" }, { type: "send_email_notification", template: "webinar_replay" }] });
    const session = await live(t, { scheduledAt: ago(3 * HOUR) });
    const absent = await registrant(t, session.id);
    const watched = await registrant(t, session.id);
    const unverified = await registrant(t, session.id, { verified: false });
    // Registered after the session ended (e.g. for the replay): never a no-show of it.
    const late = await registrant(t, session.id, { createdAt: ago(2 * HOUR) });
    await expect(recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: watched.id, now: new Date(session.scheduledAt.getTime() + 2 * MINUTE) })).resolves.toBe("recorded");

    const summary = await run([t]);
    expect(summary).toMatchObject({ vendors: 1, candidates: 1, examined: 1, completed: 1, failed: 0, errors: 0 });
    const eventId = formNoShowEventId(absent.id, formNoShowSessionKey.single(session.scheduledAt));
    expect(await logsOf(t)).toEqual([expect.objectContaining({
      ruleId: rule.id, eventId, status: "completed", subjectType: "buyer_registration",
      subjectKeyHash: automationCustomerKeyHash(t.vendor.id, absent.email), liveId: null,
    })]);
    await expect(db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id }, select: { customerKeyHash: true, tag: true } }))
      .resolves.toEqual([{ customerKeyHash: automationCustomerKeyHash(t.vendor.id, absent.email), tag: "缺席" }]);
    // The replay e-mail links the Live's page and leaves out the missing consultation link.
    const mail = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: t.vendor.id, trigger: "automation" } });
    const payload = revealEmailDeliveryPayload(mail.payloadEncryptedEnvelope, { vendorId: t.vendor.id, deliveryId: mail.id });
    expect(payload.recipientEmail).toBe(absent.email);
    expect(payload.body).toContain(`精華回放：${APP_URL}/live/${session.slug}`);
    expect(payload.body).not.toContain("預約 1 對 1 諮詢");
    expect(payload.body).toContain("/unsubscribe");
    for (const other of [watched, unverified, late]) {
      expect(JSON.stringify(await logsOf(t))).not.toContain(other.id);
    }

    // A second run finds nothing to do and writes nothing.
    await expect(run([t])).resolves.toMatchObject({ candidates: 0, examined: 0 });
    expect(await logsOf(t)).toHaveLength(1);
    await expect(db.emailDelivery.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
  });

  it("waits for the grace period after the session ends, and ignores sessions past the look-back", async () => {
    const t = await tenant();
    await noShowRule(t);
    // Ends 10 minutes ago: inside the 30-minute grace.
    const recent = await live(t, { scheduledAt: ago(VIDEO_SECONDS * 1_000 + 10 * MINUTE) });
    const fresh = await registrant(t, recent.id);
    // Ended longer ago than grace + look-back.
    const old = await live(t, { scheduledAt: ago(FORM_NO_SHOW_GRACE_MS + FORM_NO_SHOW_LOOKBACK_MS + VIDEO_SECONDS * 1_000 + HOUR), status: "ended", endedAt: ago(FORM_NO_SHOW_GRACE_MS + FORM_NO_SHOW_LOOKBACK_MS + HOUR) });
    await registrant(t, old.id, { createdAt: new Date(old.scheduledAt.getTime() - HOUR) });

    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
    await expect(run([t], { now: new Date(Date.now() + 21 * MINUTE) })).resolves.toMatchObject({ candidates: 1, completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([formNoShowEventId(fresh.id, formNoShowSessionKey.single(recent.scheduledAt))]);
  });

  it("counts an admission at or after the session start, including the replay before the job ran, but not one from an earlier session", async () => {
    const t = await tenant();
    await noShowRule(t);
    const session = await live(t, { scheduledAt: ago(3 * HOUR) });
    const replay = await registrant(t, session.id);
    const before = await registrant(t, session.id);
    await recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: replay.id, now: ago(HOUR) });
    await recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: before.id, now: new Date(session.scheduledAt.getTime() - MINUTE) });
    await run([t]);
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([formNoShowEventId(before.id, formNoShowSessionKey.single(session.scheduledAt))]);
  });

  it("treats a rescheduled Live as a new session: one execution per registration and session", async () => {
    const t = await tenant();
    await noShowRule(t, { updatedAt: ago(10 * HOUR) });
    const first = ago(8 * HOUR);
    const session = await live(t, { scheduledAt: first });
    const absent = await registrant(t, session.id, { createdAt: ago(9 * HOUR) });
    const second = await registrant(t, session.id, { createdAt: ago(9 * HOUR) });
    await run([t]);
    expect(await logsOf(t)).toHaveLength(2);

    // The merchant runs it again later; `second` watches the new run.
    const rerun = ago(3 * HOUR);
    await db.live.update({ where: { id: session.id }, data: { scheduledAt: rerun } });
    await recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: second.id, now: new Date(rerun.getTime() + 5 * MINUTE) });
    await expect(run([t])).resolves.toMatchObject({ candidates: 1, completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId).sort()).toEqual([
      formNoShowEventId(absent.id, formNoShowSessionKey.single(first)),
      formNoShowEventId(second.id, formNoShowSessionKey.single(first)),
      formNoShowEventId(absent.id, formNoShowSessionKey.single(rerun)),
    ].sort());

    // Moved before its session ended: only the current time counts, nothing fires for the old one.
    const moved = await live(t, { scheduledAt: ago(VIDEO_SECONDS * 1_000 + 10 * MINUTE) });
    await registrant(t, moved.id);
    await db.live.update({ where: { id: moved.id }, data: { scheduledAt: new Date(Date.now() + HOUR) } });
    await expect(run([t], { now: new Date(Date.now() + 25 * MINUTE) })).resolves.toMatchObject({ candidates: 0 });
    expect(await logsOf(t)).toHaveLength(3);
  });

  it("follows a per-visitor evergreen registrant's own recorded session", async () => {
    const t = await tenant();
    await noShowRule(t);
    const evergreen = await live(t, { isEvergreen: true, evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15, scheduledAt: ago(30 * 24 * HOUR) });
    const ended = await registrant(t, evergreen.id);
    const playing = await registrant(t, evergreen.id);
    const watched = await registrant(t, evergreen.id);
    // Never opened the viewer page: no session, never a no-show (as the F-2 follow-up).
    await registrant(t, evergreen.id);
    const endedStart = ago(2 * HOUR);
    for (const [submission, sessionStartAt] of [[ended, endedStart], [playing, ago(5 * MINUTE)], [watched, endedStart]] as const) {
      await db.evergreenSessionAssignment.create({ data: { vendorId: t.vendor.id, liveId: evergreen.id, formSubmissionId: submission.id, sessionStartAt, scheduleFingerprint: "0".repeat(32) } });
    }
    await recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: evergreen.id, formSubmissionId: watched.id, now: new Date(endedStart.getTime() + MINUTE) });
    await expect(run([t])).resolves.toMatchObject({ candidates: 1, completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([formNoShowEventId(ended.id, formNoShowSessionKey.evergreen(endedStart))]);

    // A rejoin moves the registrant to a later session: that one is another session.
    const later = ago(HOUR);
    await db.evergreenSessionAssignment.update({ where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId: ended.id } }, data: { sessionStartAt: later } });
    await run([t]);
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([
      formNoShowEventId(ended.id, formNoShowSessionKey.evergreen(endedStart)),
      formNoShowEventId(ended.id, formNoShowSessionKey.evergreen(later)),
    ]);
  });

  it("uses a merchant-anchored evergreen start for every verified registrant", async () => {
    const t = await tenant();
    await noShowRule(t);
    const anchor = ago(2 * HOUR);
    const evergreen = await live(t, { isEvergreen: true, evergreenSessionStartAt: anchor, scheduledAt: ago(30 * 24 * HOUR) });
    const absent = await registrant(t, evergreen.id);
    await run([t]);
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([formNoShowEventId(absent.id, formNoShowSessionKey.shared(anchor))]);
  });

  it("follows each fixed-session registrant's own session, skipping cancelled and unplayed ones", async () => {
    const t = await tenant();
    await noShowRule(t);
    const fixed = await live(t, { sessionMode: "fixed_sessions", scheduledAt: ago(3 * HOUR) });
    const past = await db.liveSession.create({ data: { vendorId: t.vendor.id, liveId: fixed.id, startAt: ago(3 * HOUR) } });
    const future = await db.liveSession.create({ data: { vendorId: t.vendor.id, liveId: fixed.id, startAt: new Date(Date.now() + 2 * HOUR) } });
    const cancelled = await db.liveSession.create({ data: { vendorId: t.vendor.id, liveId: fixed.id, startAt: ago(4 * HOUR), status: "cancelled", cancelledAt: ago(5 * HOUR) } });
    const inPast = await registrant(t, fixed.id, { liveSessionId: past.id });
    await registrant(t, fixed.id, { liveSessionId: future.id });
    await registrant(t, fixed.id, { liveSessionId: cancelled.id });
    await expect(run([t])).resolves.toMatchObject({ candidates: 1, completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([formNoShowEventId(inPast.id, formNoShowSessionKey.fixed(past.id, past.startAt))]);

    // Ended by the merchant before a session finished: that session does not count.
    const cut = await live(t, { sessionMode: "fixed_sessions", status: "ended", endedAt: ago(2 * HOUR + 5 * MINUTE), scheduledAt: ago(3 * HOUR) });
    const cutSession = await db.liveSession.create({ data: { vendorId: t.vendor.id, liveId: cut.id, startAt: ago(2 * HOUR + 8 * MINUTE) } });
    await registrant(t, cut.id, { liveSessionId: cutSession.id });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
  });

  it("runs only active, vendor-wide rules unchanged since the session ended, of an unsuspended vendor", async () => {
    const t = await tenant();
    await noShowRule(t, { isActive: false });
    // Created (or switched on) after the session ended: never runs for it.
    const lateRule = await noShowRule(t, { updatedAt: ago(HOUR) });
    const session = await live(t, { scheduledAt: ago(3 * HOUR) });
    await registrant(t, session.id);
    await expect(run([t])).resolves.toMatchObject({ vendors: 1, candidates: 0 });
    expect(await logsOf(t)).toEqual([]);

    const onTime = await noShowRule(t);
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    await expect(run([t])).resolves.toMatchObject({ vendors: 0, candidates: 0 });
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: null, suspendedReason: null } });
    await run([t]);
    expect((await logsOf(t)).map((log) => log.ruleId)).toEqual([onTime.id]);
    expect((await logsOf(t)).map((log) => log.ruleId)).not.toContain(lateRule.id);
  });

  it("keeps tenants apart: a vendor's rule never runs for another vendor's registrants or attendance", async () => {
    const a = await tenant();
    const b = await tenant();
    await noShowRule(a);
    const liveA = await live(a, { scheduledAt: ago(3 * HOUR) });
    const liveB = await live(b, { scheduledAt: ago(3 * HOUR) });
    const leadA = await registrant(a, liveA.id);
    await registrant(b, liveB.id);
    // Attendance can only be written for the registration's own Live and vendor.
    await expect(recordLiveRegistrationAttendance({ vendorId: b.vendor.id, liveId: liveA.id, formSubmissionId: leadA.id })).resolves.toBe("unchanged");
    await expect(recordLiveRegistrationAttendance({ vendorId: a.vendor.id, liveId: liveB.id, formSubmissionId: leadA.id })).resolves.toBe("unchanged");
    await expect(db.liveRegistrationAttendance.count({ where: { formSubmissionId: leadA.id } })).resolves.toBe(0);

    await run([a, b]);
    expect((await logsOf(a)).map((log) => log.eventId)).toEqual([formNoShowEventId(leadA.id, formNoShowSessionKey.single(liveA.scheduledAt))]);
    expect(await logsOf(b)).toEqual([]);
  });

  it("skips the e-mail of an unsubscribed registrant and still records the execution", async () => {
    const t = await tenant();
    await noShowRule(t, { actions: [{ type: "send_email_notification", template: "webinar_replay" }] });
    const session = await live(t, { scheduledAt: ago(3 * HOUR) });
    const lead = await registrant(t, session.id);
    await db.emailSuppression.create({ data: { vendorId: t.vendor.id, recipientHash: createEmailRecipientHash(lead.email, t.vendor.id), recipientMaskedEmail: "l***@example.test", reason: "recipient_request", source: "unsubscribe" } });
    await run([t]);
    const [log] = await db.automationExecutionLog.findMany({ where: { vendorId: t.vendor.id }, select: { status: true, actionResults: true } });
    expect(log).toMatchObject({ status: "completed", actionResults: [expect.objectContaining({ type: "send_email_notification", status: "skipped", reason: "recipient_suppressed" })] });
    await expect(db.emailDelivery.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);
  });

  it("starts the rule's delayed steps only for a vendor holding the closed-beta grant", async () => {
    for (const grant of [true, false]) {
      const t = await tenant({ grant });
      const rule = await noShowRule(t);
      await db.automationRuleStep.create({ data: { vendorId: t.vendor.id, ruleId: rule.id, delayMinutes: 1_440, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "缺席隔天" }] } });
      const session = await live(t, { scheduledAt: ago(3 * HOUR) });
      const lead = await registrant(t, session.id);
      await run([t]);
      const runs = await db.delayedStepRun.findMany({ where: { vendorId: t.vendor.id }, select: { automationRuleId: true, formSubmissionId: true, status: true } });
      expect(runs).toEqual(grant ? [{ automationRuleId: rule.id, formSubmissionId: lead.id, status: "active" }] : []);
    }
  });

  it("retries a dead `running` claim and a first `action_failed` once, and nothing else", async () => {
    const t = await tenant();
    const rule = await noShowRule(t);
    const session = await live(t, { scheduledAt: ago(3 * HOUR) });
    const dead = await registrant(t, session.id);
    const failed = await registrant(t, session.id);
    const configFailed = await registrant(t, session.id);
    const key = formNoShowSessionKey.single(session.scheduledAt);
    await run([t]);
    const logs = await logsOf(t);
    expect(logs).toHaveLength(3);
    const old = ago(20 * MINUTE);
    const byEvent = (submissionId: string) => logs.find((log) => log.eventId === formNoShowEventId(submissionId, key))!;
    await db.automationExecutionLog.update({ where: { id: byEvent(dead.id).id }, data: { status: "running", startedAt: old, createdAt: old, completedAt: null } });
    await db.automationExecutionLog.update({ where: { id: byEvent(failed.id).id }, data: { status: "failed", errorCode: "action_failed", startedAt: old, createdAt: old, completedAt: old } });
    await db.automationExecutionLog.update({ where: { id: byEvent(configFailed.id).id }, data: { status: "failed", errorCode: "unsubscribe_url_unavailable", startedAt: old, createdAt: old, completedAt: old } });

    await expect(run([t])).resolves.toMatchObject({ candidates: 2, completed: 2 });
    const after = await db.automationExecutionLog.findMany({ where: { vendorId: t.vendor.id, ruleId: rule.id }, select: { eventId: true, status: true, errorCode: true } });
    expect(after).toHaveLength(3);
    expect(after.find((log) => log.eventId === formNoShowEventId(configFailed.id, key))).toMatchObject({ status: "failed", errorCode: "unsubscribe_url_unavailable" });
    expect(after.filter((log) => log.status === "completed")).toHaveLength(2);
    // The retried failure is now a reclaimed log: it is never retried again.
    await db.automationExecutionLog.updateMany({ where: { vendorId: t.vendor.id, eventId: formNoShowEventId(failed.id, key) }, data: { status: "failed", errorCode: "action_failed", completedAt: old } });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
  });

  it("caps each run and shares it across vendors round-robin, then stops at its deadline", async () => {
    const a = await tenant();
    const b = await tenant();
    for (const t of [a, b]) {
      await noShowRule(t);
      const session = await live(t, { scheduledAt: ago(3 * HOUR) });
      for (let index = 0; index < 3; index += 1) await registrant(t, session.id);
    }
    await expect(run([a, b], { limit: 2 })).resolves.toMatchObject({ vendors: 2, candidates: 2, examined: 2 });
    expect(await logsOf(a)).toHaveLength(1);
    expect(await logsOf(b)).toHaveLength(1);

    // A clock already past the deadline after the scan dispatches nothing more.
    let ticks = 0;
    const clock = () => (ticks++ < 3 ? 0 : 10_000);
    await expect(run([a, b], { deadlineMs: 5_000, clock, now: new Date() })).resolves.toMatchObject({ candidates: 4, examined: 0 });
    await expect(run([a, b])).resolves.toMatchObject({ candidates: 4, examined: 4, completed: 4 });
    expect(await logsOf(a)).toHaveLength(3);
    expect(await logsOf(b)).toHaveLength(3);
  });
});

describe("LiveRegistrationAttendance", () => {
  it("records only a VERIFIED registration of this Live and vendor, and moves forward at most every refresh interval", async () => {
    const t = await tenant();
    const session = await live(t);
    const verified = await registrant(t, session.id);
    const unverified = await registrant(t, session.id, { verified: false });
    const other = await live(t);
    const start = ago(2 * HOUR);
    await expect(recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: unverified.id, now: start })).resolves.toBe("unchanged");
    await expect(recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: other.id, formSubmissionId: verified.id, now: start })).resolves.toBe("unchanged");
    await expect(recordLiveRegistrationAttendance({ vendorId: "bad id!", liveId: session.id, formSubmissionId: verified.id })).resolves.toBe("skipped");
    await expect(recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: verified.id, now: start })).resolves.toBe("recorded");
    const soon = new Date(start.getTime() + LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS - 1);
    await expect(recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: verified.id, now: soon })).resolves.toBe("unchanged");
    const later = new Date(start.getTime() + LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS);
    await expect(recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: verified.id, now: later })).resolves.toBe("recorded");
    await expect(recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: verified.id, now: start })).resolves.toBe("unchanged");
    const rows = await db.liveRegistrationAttendance.findMany({ where: { vendorId: t.vendor.id }, select: { liveId: true, formSubmissionId: true, firstAdmittedAt: true, lastAdmittedAt: true } });
    expect(rows).toEqual([{ liveId: session.id, formSubmissionId: verified.id, firstAdmittedAt: start, lastAdmittedAt: later }]);
  });

  it("is deleted with its registration and its Live", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const other = await registrant(t, session.id);
    await recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: lead.id });
    await recordLiveRegistrationAttendance({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: other.id });
    await db.formSubmission.delete({ where: { id: lead.id } });
    await expect(db.liveRegistrationAttendance.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
    await db.live.delete({ where: { id: session.id } });
    await expect(db.liveRegistrationAttendance.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);
  });
});
