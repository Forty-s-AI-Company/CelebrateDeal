import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Q-11 `webinar_attended_duration_gte` (觀看直播累計達指定時間) on the disposable
// PostgreSQL database: registrations, Lives, watch progress, rules, execution
// logs, tags and delayed-step runs are real. Synthetic: the post-response
// e-mail send (`after`) and monitoring. No provider, e-mail or LINE service is
// called. The watch time itself is the LiveWatchProgress row #647 added (its
// credit path is covered in watch-progress-automation.db.test.ts).
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
import { creditLiveWatchProgress } from "@/lib/live-watch-progress";
import { runWatchProgressAutomation, watchDurationEventId, watchProgressEventId } from "@/lib/watch-progress-automation";

vi.setConfig({ testTimeout: 30_000 });

const db = getDb();
const vendorIds: string[] = [];
const SECOND = 1_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const VIDEO_SECONDS = 3_600;
/** Every fixture time is relative to the real clock: the pass and execution logs use it. */
const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "watch-duration-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://watch-duration.example.test");
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** `grants`: the vendor's closed-beta grants (the duration trigger's own by default). */
async function tenant(grants: string[] = ["automation_watch_duration"]) {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: { name: `觀看時長商家 ${key}`, slug: `watch-duration-${key}`, email: `vendor-${key}@example.test`, passwordHash: "synthetic-only", betaFeatureGrants: grants },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `duration-form-${key}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "預錄影片", videoUrl: "https://media.example.test/duration.mp4", durationSec: VIDEO_SECONDS, status: "ready", sourceType: "url" },
  });
  return { vendor, form, video };
}

function live(t: Tenant, data: Partial<Prisma.LiveUncheckedCreateInput> = {}) {
  return db.live.create({
    data: {
      vendorId: t.vendor.id,
      formId: t.form.id,
      videoId: t.video.id,
      title: "觀看時長直播",
      slug: `duration-live-${randomUUID().slice(0, 12)}`,
      scheduledAt: ago(HOUR),
      status: "scheduled",
      streamMode: "vod",
      ...data,
    },
  });
}

function registrant(t: Tenant, liveId: string, options: { verified?: boolean; email?: string } = {}) {
  const verified = options.verified ?? true;
  return db.formSubmission.create({
    data: {
      formId: t.form.id,
      liveId,
      name: "王小明",
      email: options.email ?? `lead-${randomUUID().slice(0, 8)}@example.test`,
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      verifiedAt: verified ? ago(5 * HOUR) : null,
      createdAt: ago(6 * HOUR),
    },
  });
}

function durationRule(t: Tenant, minutes: number, options: { isActive?: boolean; updatedAt?: Date; actions?: unknown[]; condition?: unknown } = {}) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `看滿 ${minutes} 分 ${randomUUID().slice(0, 6)}`,
      trigger: "webinar_attended_duration_gte",
      condition: (options.condition ?? { type: "watch_minutes_gte", minutes }) as Prisma.InputJsonValue,
      actions: (options.actions ?? [{ type: "add_customer_tag", tag: `看滿${minutes}分` }]) as Prisma.InputJsonArray,
      isActive: options.isActive ?? true,
      updatedAt: options.updatedAt ?? ago(5 * HOUR),
    },
  });
}

function progressRule(t: Tenant, percent: number) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `看 ${percent}%`,
      trigger: "viewer_watch_progress",
      condition: { type: "watch_percent_gte", percent },
      actions: [{ type: "add_customer_tag", tag: `看${percent}%` }],
      updatedAt: ago(5 * HOUR),
    },
  });
}

/** A progress row as the admission credits leave it. */
function progress(t: Tenant, liveId: string, formSubmissionId: string, watchedSeconds: number, lastCreditedAt = ago(10 * MINUTE)) {
  return db.liveWatchProgress.create({
    data: { vendorId: t.vendor.id, liveId, formSubmissionId, watchedSeconds, firstCreditedAt: new Date(lastCreditedAt.getTime() - watchedSeconds * SECOND), lastCreditedAt },
  });
}

/** What steady admission renewals (every 30 s, `from` for `seconds`) credit, through the real credit statement. */
async function watch(t: Tenant, liveId: string, formSubmissionId: string, from: Date, seconds: number, liveSessionId?: string) {
  for (let second = 0; second <= seconds; second += 30) {
    await creditLiveWatchProgress({ vendorId: t.vendor.id, liveId, formSubmissionId, liveSessionId, now: new Date(from.getTime() + second * SECOND) });
  }
}

function logsOf(t: Tenant, trigger = "webinar_attended_duration_gte") {
  return db.automationExecutionLog.findMany({
    where: { vendorId: t.vendor.id, trigger },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, ruleId: true, eventId: true, status: true, subjectType: true, subjectKeyHash: true, liveId: true },
  });
}

async function storedSeconds(t: Tenant, formSubmissionId: string) {
  const row = await db.liveWatchProgress.findUnique({ where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId } }, select: { watchedSeconds: true } });
  return row?.watchedSeconds ?? null;
}

const run = (vendors: Tenant[], options: Omit<Parameters<typeof runWatchProgressAutomation>[0] & object, "vendorIds"> = {}) =>
  runWatchProgressAutomation({ ...options, vendorIds: vendors.map((t) => t.vendor.id) });

describe("觀看直播累計達指定時間 (Q-11 webinar_attended_duration_gte)", () => {
  it("fires once when a registrant reaches the minutes, not below them, and never again on a rerun", async () => {
    const t = await tenant();
    const rule = await durationRule(t, 15, { actions: [{ type: "add_customer_tag", tag: "看滿15分" }] });
    const session = await live(t);
    const reached = await registrant(t, session.id);
    const below = await registrant(t, session.id);
    await progress(t, session.id, reached.id, 15 * 60);
    await progress(t, session.id, below.id, 15 * 60 - 1);

    await expect(run([t])).resolves.toMatchObject({ vendors: 1, candidates: 1, examined: 1, completed: 1, failed: 0, errors: 0 });
    expect(await logsOf(t)).toEqual([expect.objectContaining({
      ruleId: rule.id, eventId: watchDurationEventId(reached.id, 15), status: "completed", subjectType: "buyer_registration",
      subjectKeyHash: automationCustomerKeyHash(t.vendor.id, reached.email), liveId: null,
    })]);
    await expect(db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id }, select: { customerKeyHash: true, tag: true } }))
      .resolves.toEqual([{ customerKeyHash: automationCustomerKeyHash(t.vendor.id, reached.email), tag: "看滿15分" }]);

    // More viewing, a rerun, a replayed job: still one execution.
    await db.liveWatchProgress.update({ where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId: reached.id } }, data: { watchedSeconds: 50 * 60, lastCreditedAt: ago(MINUTE) } });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0, examined: 0 });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
    expect(await logsOf(t)).toHaveLength(1);

    // The other registrant reaches it later: their own single execution.
    await db.liveWatchProgress.update({ where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId: below.id } }, data: { watchedSeconds: 15 * 60, lastCreditedAt: ago(MINUTE) } });
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId).sort()).toEqual([watchDurationEventId(reached.id, 15), watchDurationEventId(below.id, 15)].sort());
  });

  it("runs each minutes rule once per registrant: 5 / 15 / 30 / 60", async () => {
    const t = await tenant();
    const rules = await Promise.all([5, 15, 30, 60].map((minutes) => durationRule(t, minutes)));
    const session = await live(t);
    const lead = await registrant(t, session.id);
    await progress(t, session.id, lead.id, 40 * 60);
    await expect(run([t])).resolves.toMatchObject({ completed: 3 });
    expect((await logsOf(t)).map((log) => log.ruleId).sort()).toEqual(rules.slice(0, 3).map((rule) => rule.id).sort());
    await db.liveWatchProgress.update({ where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId: lead.id } }, data: { watchedSeconds: 61 * 60, lastCreditedAt: ago(MINUTE) } });
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect(new Set((await logsOf(t)).map((log) => log.eventId))).toEqual(new Set([5, 15, 30, 60].map((minutes) => watchDurationEventId(lead.id, minutes))));
  });

  it("keeps tenants apart: a vendor's rule never runs for another vendor's registrants or watch time", async () => {
    const a = await tenant();
    const b = await tenant();
    await durationRule(a, 15);
    const ruleB = await durationRule(b, 15);
    const sessionA = await live(a);
    const leadA = await registrant(a, sessionA.id);
    await progress(a, sessionA.id, leadA.id, 60 * 60);
    // Only vendor B is scanned: vendor A's watch time is never B's event.
    await expect(run([b])).resolves.toMatchObject({ vendors: 1, candidates: 0 });
    await expect(db.automationExecutionLog.count({ where: { ruleId: ruleB.id } })).resolves.toBe(0);
    await expect(run([a, b])).resolves.toMatchObject({ completed: 1 });
    expect(await logsOf(b)).toEqual([]);
    expect(await logsOf(a)).toHaveLength(1);
  });

  it("scans only vendors holding its own grant (not the watch-progress one), not suspended", async () => {
    // No grant, or only the percentage trigger's grant: never scanned for minutes rules.
    for (const grants of [[], ["automation_watch_progress"], ["automation_form_no_show", "automation_delayed_steps"]]) {
      const closed = await tenant(grants);
      await durationRule(closed, 15);
      const session = await live(closed);
      const lead = await registrant(closed, session.id);
      await progress(closed, session.id, lead.id, 60 * 60);
      await expect(run([closed])).resolves.toMatchObject({ vendors: 0, candidates: 0 });
      expect(await logsOf(closed)).toEqual([]);
    }
    const suspended = await tenant();
    await durationRule(suspended, 15);
    const suspendedLive = await live(suspended);
    const suspendedLead = await registrant(suspended, suspendedLive.id);
    await progress(suspended, suspendedLive.id, suspendedLead.id, 60 * 60);
    await db.vendor.update({ where: { id: suspended.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    await expect(run([suspended])).resolves.toMatchObject({ vendors: 0 });
    expect(await logsOf(suspended)).toEqual([]);
  });

  it("runs the percentage and the minutes rules of one vendor each under its own grant, as separate events", async () => {
    const both = await tenant(["automation_watch_progress", "automation_watch_duration"]);
    await progressRule(both, 50);
    await durationRule(both, 15);
    const session = await live(both);
    const lead = await registrant(both, session.id);
    await progress(both, session.id, lead.id, 30 * 60);
    await expect(run([both])).resolves.toMatchObject({ vendors: 1, candidates: 2, completed: 2 });
    expect((await logsOf(both)).map((log) => log.eventId)).toEqual([watchDurationEventId(lead.id, 15)]);
    expect((await logsOf(both, "viewer_watch_progress")).map((log) => log.eventId)).toEqual([watchProgressEventId(lead.id, 50)]);

    // Only the percentage grant: the minutes rule is left alone.
    const progressOnly = await tenant(["automation_watch_progress"]);
    await progressRule(progressOnly, 50);
    await durationRule(progressOnly, 15);
    const other = await live(progressOnly);
    const viewer = await registrant(progressOnly, other.id);
    await progress(progressOnly, other.id, viewer.id, 30 * 60);
    await expect(run([progressOnly])).resolves.toMatchObject({ vendors: 1, completed: 1 });
    expect(await logsOf(progressOnly)).toEqual([]);
  });

  it("runs only active, vendor-wide minutes rules that existed while the registrant was still watching", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    await progress(t, session.id, lead.id, 60 * 60, ago(2 * HOUR));
    await durationRule(t, 15, { isActive: false });
    // Created (or switched on) after the registrant's last credit.
    await durationRule(t, 15, { updatedAt: ago(HOUR) });
    // Saved while the trigger was hidden, with the old watch-seconds conditions.
    await durationRule(t, 15, { condition: { type: "watch_seconds_gte", seconds: 60 } });
    await durationRule(t, 15, { condition: { type: "watch_seconds_gte_and_not_purchased", seconds: 60 } });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
    expect(await logsOf(t)).toEqual([]);
    // Credited longer ago than the look-back.
    const old = await registrant(t, session.id);
    await progress(t, session.id, old.id, 60 * 60, ago(25 * HOUR));
    await durationRule(t, 15, { updatedAt: ago(30 * HOUR) });
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([watchDurationEventId(lead.id, 15)]);
  });

  it("does not count a registration that is no longer verified", async () => {
    const t = await tenant();
    await durationRule(t, 15);
    const session = await live(t);
    const lead = await registrant(t, session.id);
    await progress(t, session.id, lead.id, 60 * 60);
    await db.formSubmission.update({ where: { id: lead.id }, data: { verificationStatus: "UNVERIFIED" } });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
  });

  it("fires while a real live stream is still on air, without waiting for its end (no session length needed)", async () => {
    const t = await tenant(["automation_watch_duration", "automation_watch_progress"]);
    await durationRule(t, 15);
    // The percentage of the same stream is unknown until it ends.
    await progressRule(t, 10);
    const startedAt = ago(40 * MINUTE);
    const stream = await live(t, { streamMode: "live", status: "live", scheduledAt: startedAt, startedAt, videoId: null });
    const lead = await registrant(t, stream.id);
    await watch(t, stream.id, lead.id, startedAt, 20 * 60);
    expect(await storedSeconds(t, lead.id)).toBeGreaterThanOrEqual(15 * 60);
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([watchDurationEventId(lead.id, 15)]);
    expect(await logsOf(t, "viewer_watch_progress")).toEqual([]);
    // Ending it later does not repeat the minutes rule (the percentage is judged then, once).
    await db.live.update({ where: { id: stream.id }, data: { status: "ended", endedAt: ago(MINUTE) } });
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect(await logsOf(t)).toHaveLength(1);
    expect(await logsOf(t, "viewer_watch_progress")).toHaveLength(1);
  });

  it("counts only the time actually watched on a stream started late, never the minutes since its scheduled start", async () => {
    const t = await tenant();
    await durationRule(t, 15);
    const scheduledAt = ago(40 * MINUTE);
    const startedAt = new Date(scheduledAt.getTime() + 10 * MINUTE);
    const stream = await live(t, { streamMode: "live", status: "live", scheduledAt, startedAt, videoId: null });
    // Both registrants were on the page since the scheduled time, but the
    // admission only credits while the stream plays (from its actual start).
    const early = await registrant(t, stream.id);
    const full = await registrant(t, stream.id);
    await watch(t, stream.id, early.id, startedAt, 12 * 60);
    await watch(t, stream.id, full.id, startedAt, 16 * 60);
    expect(await storedSeconds(t, early.id)).toBeLessThan(15 * 60);
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([watchDurationEventId(full.id, 15)]);
  });

  it("adds up one registration's watch time across sessions of the Live (a fixed-session switch)", async () => {
    const t = await tenant();
    await durationRule(t, 15);
    const start = ago(4 * HOUR);
    const fixed = await live(t, { sessionMode: "fixed_sessions", scheduledAt: start });
    const first = await db.liveSession.create({ data: { vendorId: t.vendor.id, liveId: fixed.id, startAt: start } });
    const second = await db.liveSession.create({ data: { vendorId: t.vendor.id, liveId: fixed.id, startAt: new Date(start.getTime() + 2 * HOUR) } });
    const lead = await registrant(t, fixed.id);
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: first.id } });
    // Ten minutes of the first session, then the registrant moves to the second one and watches six more.
    await watch(t, fixed.id, lead.id, start, 10 * 60, first.id);
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: second.id } });
    // The first session's time does not count for the second one's admission, but it stays on the registration.
    await watch(t, fixed.id, lead.id, second.startAt, 6 * 60, second.id);
    expect(await storedSeconds(t, lead.id)).toBe(16 * 60);
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([watchDurationEventId(lead.id, 15)]);
  });

  it("runs each event once when two jobs scan and dispatch the same events at the same time", async () => {
    const t = await tenant();
    await durationRule(t, 15, { actions: [{ type: "add_customer_tag", tag: "看滿15分" }] });
    const session = await live(t);
    for (let index = 0; index < 6; index += 1) {
      const lead = await registrant(t, session.id);
      await progress(t, session.id, lead.id, 20 * 60);
    }
    const url = new URL(process.env.DATABASE_URL ?? "");
    url.searchParams.set("connection_limit", "3");
    const clients = [new PrismaClient({ datasourceUrl: url.toString() }), new PrismaClient({ datasourceUrl: url.toString() })];
    try {
      const [first, second] = await Promise.all(clients.map((client) => runWatchProgressAutomation({ db: client as never, vendorIds: [t.vendor.id] })));
      expect(first.completed + second.completed).toBe(6);
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
    const logs = await logsOf(t);
    expect(logs).toHaveLength(6);
    expect(new Set(logs.map((log) => log.eventId)).size).toBe(6);
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(6);
  });

  it("starts the rule's delayed steps only for a vendor holding the delayed-steps grant", async () => {
    for (const steps of [true, false]) {
      const t = await tenant(steps ? ["automation_watch_duration", "automation_delayed_steps"] : ["automation_watch_duration"]);
      const rule = await durationRule(t, 15);
      await db.automationRuleStep.create({ data: { vendorId: t.vendor.id, ruleId: rule.id, delayMinutes: 1_440, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "看滿隔天" }] } });
      const session = await live(t);
      const lead = await registrant(t, session.id);
      await progress(t, session.id, lead.id, 20 * 60);
      await run([t]);
      const runs = await db.delayedStepRun.findMany({ where: { vendorId: t.vendor.id }, select: { automationRuleId: true, formSubmissionId: true, status: true } });
      expect(runs).toEqual(steps ? [{ automationRuleId: rule.id, formSubmissionId: lead.id, status: "active" }] : []);
    }
  });

  it("never names the Live on its log, so a fired rule never blocks deleting the Live", async () => {
    const t = await tenant();
    await durationRule(t, 15);
    const session = await live(t);
    const lead = await registrant(t, session.id);
    await progress(t, session.id, lead.id, 20 * 60);
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect((await logsOf(t)).map((log) => log.liveId)).toEqual([null]);
    await db.live.delete({ where: { id: session.id } });
    await expect(db.liveWatchProgress.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);
  });

  it("shares the run's cap with the percentage trigger and across vendors round-robin", async () => {
    const a = await tenant(["automation_watch_duration", "automation_watch_progress"]);
    const b = await tenant();
    await durationRule(a, 15);
    await progressRule(a, 50);
    await durationRule(b, 15);
    for (const t of [a, b]) {
      const session = await live(t);
      for (let index = 0; index < 2; index += 1) {
        const lead = await registrant(t, session.id);
        await progress(t, session.id, lead.id, 40 * 60);
      }
    }
    // Vendor A owes four events (two triggers × two registrants), B two.
    await expect(run([a, b], { limit: 4 })).resolves.toMatchObject({ candidates: 4, completed: 4 });
    expect((await logsOf(b)).length).toBe(2);
    expect((await logsOf(a)).length + (await logsOf(a, "viewer_watch_progress")).length).toBe(2);
    await expect(run([a, b])).resolves.toMatchObject({ completed: 2 });
  });
});
