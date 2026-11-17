import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Q-11 `viewer_watch_progress` on the disposable PostgreSQL database:
// registrations, Lives, watch progress, rules, execution logs, tags,
// delayed-step runs and automation e-mails are real. Synthetic: the
// post-response e-mail send (`after`) and monitoring. No provider, e-mail or
// LINE service is called.
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
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { createLiveAttendanceToken, liveAttendanceCookieName } from "@/lib/live-attendance-cookie";
import { recordAttendanceForAdmission } from "@/lib/live-registration-attendance";
import {
  LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS,
  LIVE_WATCH_PROGRESS_MAX_GAP_MS,
  creditLiveWatchProgress,
} from "@/lib/live-watch-progress";
import { runWatchProgressAutomation, watchProgressEventId } from "@/lib/watch-progress-automation";

vi.setConfig({ testTimeout: 30_000 });

const db = getDb();
const vendorIds: string[] = [];
const SECOND = 1_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const VIDEO_SECONDS = 600;
const APP_URL = "https://watch-progress.example.test";
/** Every fixture time is relative to the real clock: the pass and execution logs use it. */
const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "watch-progress-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** `watch`: the closed-beta grant of viewer_watch_progress (on unless a test says otherwise); `steps`: delayed steps. */
async function tenant(options: { watch?: boolean; steps?: boolean } = {}) {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `觀看進度商家 ${key}`,
      slug: `watch-progress-${key}`,
      email: `vendor-${key}@example.test`,
      passwordHash: "synthetic-only",
      betaFeatureGrants: [
        ...(options.steps ? ["automation_delayed_steps"] : []),
        ...(options.watch === false ? [] : ["automation_watch_progress"]),
      ],
    },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `watch-form-${key}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "預錄影片", videoUrl: "https://media.example.test/watch.mp4", durationSec: VIDEO_SECONDS, status: "ready", sourceType: "url" },
  });
  return { vendor, form, video };
}

function live(t: Tenant, data: Partial<Prisma.LiveUncheckedCreateInput> = {}) {
  return db.live.create({
    data: {
      vendorId: t.vendor.id,
      formId: t.form.id,
      videoId: t.video.id,
      title: "觀看進度直播",
      slug: `watch-live-${randomUUID().slice(0, 12)}`,
      scheduledAt: ago(HOUR),
      status: "scheduled",
      streamMode: "vod",
      ...data,
    },
  });
}

function registrant(t: Tenant, liveId: string, options: { verified?: boolean } = {}) {
  const verified = options.verified ?? true;
  return db.formSubmission.create({
    data: {
      formId: t.form.id,
      liveId,
      name: "王小明",
      email: `lead-${randomUUID().slice(0, 8)}@example.test`,
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      verifiedAt: verified ? ago(5 * HOUR) : null,
      createdAt: ago(6 * HOUR),
    },
  });
}

function watchRule(t: Tenant, percent: number, options: { isActive?: boolean; updatedAt?: Date; actions?: unknown[]; condition?: unknown; funnelPageId?: string } = {}) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `觀看 ${percent}% ${randomUUID().slice(0, 6)}`,
      trigger: "viewer_watch_progress",
      condition: (options.condition ?? { type: "watch_percent_gte", percent }) as Prisma.InputJsonValue,
      actions: (options.actions ?? [{ type: "add_customer_tag", tag: `看過${percent}` }]) as Prisma.InputJsonArray,
      isActive: options.isActive ?? true,
      updatedAt: options.updatedAt ?? ago(3 * HOUR),
    },
  });
}

/** A progress row as the admission credits leave it (the credit path itself is tested below). */
function progress(t: Tenant, liveId: string, formSubmissionId: string, watchedSeconds: number, lastCreditedAt = ago(10 * MINUTE)) {
  return db.liveWatchProgress.create({
    data: { vendorId: t.vendor.id, liveId, formSubmissionId, watchedSeconds, firstCreditedAt: new Date(lastCreditedAt.getTime() - watchedSeconds * SECOND), lastCreditedAt },
  });
}

function logsOf(t: Tenant) {
  return db.automationExecutionLog.findMany({
    where: { vendorId: t.vendor.id, trigger: "viewer_watch_progress" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, ruleId: true, eventId: true, status: true, subjectType: true, subjectKeyHash: true, liveId: true },
  });
}

const run = (vendors: Tenant[], options: Omit<Parameters<typeof runWatchProgressAutomation>[0] & object, "vendorIds"> = {}) =>
  runWatchProgressAutomation({ ...options, vendorIds: vendors.map((t) => t.vendor.id) });

const registrationCookie = (submissionId: string) => `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${createFormSubmissionChatSessionToken({ submissionId })}`;

/** What /api/live-admission does after granting playback to a browser carrying these cookies. */
function admit(t: Tenant, liveId: string, cookies: string[], now: Date, creditWatchTime = true) {
  const request = new Request(`${APP_URL}/api/live-admission`, { method: "POST", headers: { cookie: cookies.join("; ") } });
  return recordAttendanceForAdmission({ request, vendorId: t.vendor.id, liveId, creditWatchTime, now });
}

async function storedProgress(t: Tenant, formSubmissionId: string) {
  return db.liveWatchProgress.findUnique({
    where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId } },
    select: { watchedSeconds: true, liveId: true, lastCreditedAt: true },
  });
}

describe("watch time credited by admission renewals (Q-11 viewer_watch_progress)", () => {
  it("adds wall-clock time at most once a minute and never across a long gap", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const start = ago(HOUR);
    const at = (ms: number) => new Date(start.getTime() + ms);
    const credit = (ms: number) => creditLiveWatchProgress({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: lead.id, now: at(ms) });

    await expect(credit(0)).resolves.toBe("recorded");
    expect(await storedProgress(t, lead.id)).toMatchObject({ watchedSeconds: 0 });
    // Renewals every 30 s: inside the credit interval nothing changes (a refresh or a second tab neither).
    await expect(credit(30 * SECOND)).resolves.toBe("unchanged");
    await expect(credit(LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS - 1)).resolves.toBe("unchanged");
    await expect(credit(60 * SECOND)).resolves.toBe("recorded");
    await expect(credit(90 * SECOND)).resolves.toBe("unchanged");
    await expect(credit(150 * SECOND)).resolves.toBe("recorded");
    expect(await storedProgress(t, lead.id)).toMatchObject({ watchedSeconds: 150 });
    // The viewer left for ten minutes: that time is not credited; the count restarts.
    await expect(credit(150 * SECOND + 10 * MINUTE)).resolves.toBe("recorded");
    expect(await storedProgress(t, lead.id)).toMatchObject({ watchedSeconds: 150 });
    // A gap of exactly the maximum still counts.
    await expect(credit(150 * SECOND + 10 * MINUTE + LIVE_WATCH_PROGRESS_MAX_GAP_MS)).resolves.toBe("recorded");
    expect(await storedProgress(t, lead.id)).toMatchObject({ watchedSeconds: 150 + LIVE_WATCH_PROGRESS_MAX_GAP_MS / SECOND });
  });

  it("credits only a VERIFIED registration of this Live through a form of this vendor (forged or foreign ids write nothing)", async () => {
    const a = await tenant();
    const b = await tenant();
    const sessionA = await live(a);
    const otherLiveA = await live(a);
    const sessionB = await live(b);
    const unverified = await registrant(a, sessionA.id, { verified: false });
    const ofOtherLive = await registrant(a, otherLiveA.id);
    const ofOtherVendor = await registrant(b, sessionB.id);
    const now = new Date();
    for (const formSubmissionId of [unverified.id, ofOtherLive.id, ofOtherVendor.id, "not-a-registration", "bad id with spaces"]) {
      await expect(creditLiveWatchProgress({ vendorId: a.vendor.id, liveId: sessionA.id, formSubmissionId, now })).resolves.not.toBe("recorded");
    }
    // Another vendor's id with this Live, or this vendor's Live under another vendor id.
    await expect(creditLiveWatchProgress({ vendorId: b.vendor.id, liveId: sessionA.id, formSubmissionId: ofOtherLive.id, now })).resolves.toBe("unchanged");
    await expect(creditLiveWatchProgress({ vendorId: b.vendor.id, liveId: sessionB.id, formSubmissionId: unverified.id, now })).resolves.toBe("unchanged");
    await expect(db.liveWatchProgress.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).resolves.toBe(0);
  });

  it("reads only the verified cookies of the admitted Live, and only while the session plays", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    // The signed cookies are checked against the request time: the real clock.
    const start = new Date();
    // No cookie, or a forged one: nothing.
    await expect(admit(t, session.id, [], start)).resolves.toBe("skipped");
    await admit(t, session.id, [`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=v1.${lead.id}.9999999999.forged`], start);
    await expect(db.liveWatchProgress.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);
    // Admitted to the replay (not playing): attendance only.
    await expect(admit(t, session.id, [registrationCookie(lead.id)], start, false)).resolves.toBe("recorded");
    await expect(db.liveWatchProgress.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);
    await admit(t, session.id, [registrationCookie(lead.id)], start);
    await admit(t, session.id, [registrationCookie(lead.id)], new Date(start.getTime() + 61 * SECOND));
    expect(await storedProgress(t, lead.id)).toMatchObject({ watchedSeconds: 61, liveId: session.id });
  });

  it("counts two devices of the same registrant once: the attendance cookie of a personal link and the registration cookie share one clock", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const attendance = `${liveAttendanceCookieName(session.id)}=${createLiveAttendanceToken({ vendorId: t.vendor.id, liveId: session.id, submissionId: lead.id, expiresAt: new Date(Date.now() + 7 * 24 * HOUR) })}`;
    const start = new Date();
    for (let minute = 0; minute <= 5; minute += 1) {
      const now = new Date(start.getTime() + minute * MINUTE);
      // Phone (personal link) and laptop (verified browser) renew at the same moments.
      await Promise.all([admit(t, session.id, [attendance], now), admit(t, session.id, [registrationCookie(lead.id)], now)]);
    }
    expect(await storedProgress(t, lead.id)).toMatchObject({ watchedSeconds: 5 * 60 });
  });

  it("adds a minute once when many renewals of one registration race (concurrency)", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const start = ago(HOUR);
    await creditLiveWatchProgress({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: lead.id, now: start });
    const url = new URL(process.env.DATABASE_URL ?? "");
    url.searchParams.set("connection_limit", "2");
    const clients = Array.from({ length: 4 }, () => new PrismaClient({ datasourceUrl: url.toString() }));
    try {
      const now = new Date(start.getTime() + 90 * SECOND);
      const outcomes = await Promise.all(clients.flatMap((client) => [0, 1].map(() => creditLiveWatchProgress({ vendorId: t.vendor.id, liveId: session.id, formSubmissionId: lead.id, now }, client))));
      expect(outcomes.filter((outcome) => outcome === "recorded")).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
    expect(await storedProgress(t, lead.id)).toMatchObject({ watchedSeconds: 90 });
  });

  it("is deleted with its registration and its Live, and a fired rule never blocks deleting the Live", async () => {
    const t = await tenant();
    await watchRule(t, 50);
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const other = await registrant(t, session.id);
    await progress(t, session.id, lead.id, VIDEO_SECONDS);
    await progress(t, session.id, other.id, VIDEO_SECONDS);
    await expect(run([t])).resolves.toMatchObject({ completed: 2 });
    expect((await logsOf(t)).map((log) => log.liveId)).toEqual([null, null]);
    await db.formSubmission.delete({ where: { id: lead.id } });
    await expect(db.liveWatchProgress.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
    await db.live.delete({ where: { id: session.id } });
    await expect(db.liveWatchProgress.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);
  });
});

describe("觀看直播達到指定進度 (Q-11 viewer_watch_progress)", () => {
  it("fires once when a registrant reaches the threshold, not below it, and never again on a rerun", async () => {
    const t = await tenant();
    const rule = await watchRule(t, 50, { actions: [{ type: "add_customer_tag", tag: "看一半" }] });
    const session = await live(t);
    const reached = await registrant(t, session.id);
    const below = await registrant(t, session.id);
    await progress(t, session.id, reached.id, VIDEO_SECONDS / 2);
    await progress(t, session.id, below.id, VIDEO_SECONDS / 2 - 1);

    await expect(run([t])).resolves.toMatchObject({ vendors: 1, candidates: 1, examined: 1, completed: 1, failed: 0, errors: 0 });
    expect(await logsOf(t)).toEqual([expect.objectContaining({
      ruleId: rule.id, eventId: watchProgressEventId(reached.id, 50), status: "completed", subjectType: "buyer_registration",
      subjectKeyHash: automationCustomerKeyHash(t.vendor.id, reached.email), liveId: null,
    })]);
    await expect(db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id }, select: { customerKeyHash: true, tag: true } }))
      .resolves.toEqual([{ customerKeyHash: automationCustomerKeyHash(t.vendor.id, reached.email), tag: "看一半" }]);

    // Rerun, more viewing, the job replayed: still one execution.
    await db.liveWatchProgress.update({ where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId: reached.id } }, data: { watchedSeconds: VIDEO_SECONDS, lastCreditedAt: ago(MINUTE) } });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0, examined: 0 });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
    expect(await logsOf(t)).toHaveLength(1);

    // The other registrant crosses the threshold later: their own single execution.
    await db.liveWatchProgress.update({ where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId: below.id } }, data: { watchedSeconds: VIDEO_SECONDS / 2, lastCreditedAt: ago(MINUTE) } });
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId).sort()).toEqual([watchProgressEventId(reached.id, 50), watchProgressEventId(below.id, 50)].sort());
  });

  it("runs each threshold rule once per registrant: 25 / 50 / 75 / 90 %", async () => {
    const t = await tenant();
    const rules = await Promise.all([25, 50, 75, 90].map((percent) => watchRule(t, percent)));
    const session = await live(t);
    const lead = await registrant(t, session.id);
    await progress(t, session.id, lead.id, Math.round(VIDEO_SECONDS * 0.8));
    await expect(run([t])).resolves.toMatchObject({ completed: 3 });
    expect((await logsOf(t)).map((log) => log.ruleId).sort()).toEqual(rules.slice(0, 3).map((rule) => rule.id).sort());
    await db.liveWatchProgress.update({ where: { vendorId_formSubmissionId: { vendorId: t.vendor.id, formSubmissionId: lead.id } }, data: { watchedSeconds: VIDEO_SECONDS * 2, lastCreditedAt: ago(MINUTE) } });
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect(await logsOf(t)).toHaveLength(4);
    expect(new Set((await logsOf(t)).map((log) => log.eventId))).toEqual(new Set([25, 50, 75, 90].map((percent) => watchProgressEventId(lead.id, percent))));
  });

  it("keeps tenants apart: a vendor's rule never runs for another vendor's registrants or progress", async () => {
    const a = await tenant();
    const b = await tenant();
    await watchRule(a, 50);
    const ruleB = await watchRule(b, 50);
    const sessionA = await live(a);
    const leadA = await registrant(a, sessionA.id);
    await progress(a, sessionA.id, leadA.id, VIDEO_SECONDS);
    // Only vendor B is scanned: vendor A's progress is never B's event.
    await expect(run([b])).resolves.toMatchObject({ vendors: 1, candidates: 0 });
    await expect(db.automationExecutionLog.count({ where: { ruleId: ruleB.id } })).resolves.toBe(0);
    await expect(run([a, b])).resolves.toMatchObject({ completed: 1 });
    expect(await logsOf(b)).toEqual([]);
    expect(await logsOf(a)).toHaveLength(1);
  });

  it("scans only vendors holding the closed-beta grant, not suspended", async () => {
    const closed = await tenant({ watch: false });
    await watchRule(closed, 50);
    const session = await live(closed);
    const lead = await registrant(closed, session.id);
    await progress(closed, session.id, lead.id, VIDEO_SECONDS);
    await expect(run([closed])).resolves.toMatchObject({ vendors: 0, candidates: 0 });

    const suspended = await tenant();
    await watchRule(suspended, 50);
    const suspendedLive = await live(suspended);
    const suspendedLead = await registrant(suspended, suspendedLive.id);
    await progress(suspended, suspendedLive.id, suspendedLead.id, VIDEO_SECONDS);
    await db.vendor.update({ where: { id: suspended.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    await expect(run([suspended])).resolves.toMatchObject({ vendors: 0 });
    expect(await logsOf(closed)).toEqual([]);
    expect(await logsOf(suspended)).toEqual([]);
  });

  it("runs only active, vendor-wide percentage rules that existed while the registrant was still watching", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    await progress(t, session.id, lead.id, VIDEO_SECONDS, ago(2 * HOUR));
    await watchRule(t, 50, { isActive: false });
    // Created (or switched on) after the registrant's last credit.
    await watchRule(t, 50, { updatedAt: ago(HOUR) });
    // Saved while the trigger was hidden, with the old watch-seconds condition.
    await watchRule(t, 50, { condition: { type: "watch_seconds_gte", seconds: 60 } });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
    // Credited longer ago than the look-back.
    const old = await registrant(t, session.id);
    await progress(t, session.id, old.id, VIDEO_SECONDS, ago(25 * HOUR));
    await watchRule(t, 50, { updatedAt: ago(30 * HOUR) });
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([watchProgressEventId(lead.id, 50)]);
  });

  it("does not count a registration that is no longer verified", async () => {
    const t = await tenant();
    await watchRule(t, 50);
    const session = await live(t);
    const lead = await registrant(t, session.id);
    await progress(t, session.id, lead.id, VIDEO_SECONDS);
    await db.formSubmission.update({ where: { id: lead.id }, data: { verificationStatus: "UNVERIFIED" } });
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
  });

  it("judges a real live stream only after it ended, against the broadcast length", async () => {
    const t = await tenant();
    await watchRule(t, 50);
    const startedAt = ago(2 * HOUR);
    const stream = await live(t, { streamMode: "live", status: "live", scheduledAt: startedAt, startedAt, videoId: null });
    const lead = await registrant(t, stream.id);
    await progress(t, stream.id, lead.id, 40 * 60);
    // Still on air: its length is unknown.
    await expect(run([t])).resolves.toMatchObject({ candidates: 0 });
    // Ended after 60 minutes: 40 of 60 minutes is past 50 %.
    await db.live.update({ where: { id: stream.id }, data: { status: "ended", endedAt: new Date(startedAt.getTime() + HOUR) } });
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
  });

  it("runs each event once when two jobs scan and dispatch the same events at the same time", async () => {
    const t = await tenant();
    await watchRule(t, 50, { actions: [{ type: "add_customer_tag", tag: "看一半" }] });
    const session = await live(t);
    const leads = [];
    for (let index = 0; index < 6; index += 1) {
      const lead = await registrant(t, session.id);
      await progress(t, session.id, lead.id, VIDEO_SECONDS);
      leads.push(lead);
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

  it("queues no e-mail without a link, and the voucher follow-up only next to a voucher (Q-18 matrix)", async () => {
    const t = await tenant();
    const product = await db.product.create({ data: { vendorId: t.vendor.id, name: "進階課", slug: `watch-product-${randomUUID()}`, priceCents: 100_000, isActive: true } });
    await watchRule(t, 50, { actions: [{ type: "issue_repurchase_voucher", productId: product.id, discountType: "percentage", discountValue: 10, expiresInDays: 3, lineNotification: false }, { type: "send_email_notification", template: "repurchase_followup" }] });
    const session = await live(t);
    const lead = await registrant(t, session.id);
    await progress(t, session.id, lead.id, VIDEO_SECONDS);
    await expect(run([t])).resolves.toMatchObject({ completed: 1 });
    await expect(db.emailDelivery.count({ where: { vendorId: t.vendor.id, trigger: "automation" } })).resolves.toBe(1);
    await expect(db.automationVoucherGrant.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
  });

  it("starts the rule's delayed steps only for a vendor holding the delayed-steps grant", async () => {
    for (const steps of [true, false]) {
      const t = await tenant({ steps });
      const rule = await watchRule(t, 50);
      await db.automationRuleStep.create({ data: { vendorId: t.vendor.id, ruleId: rule.id, delayMinutes: 1_440, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "看一半隔天" }] } });
      const session = await live(t);
      const lead = await registrant(t, session.id);
      await progress(t, session.id, lead.id, VIDEO_SECONDS);
      await run([t]);
      const runs = await db.delayedStepRun.findMany({ where: { vendorId: t.vendor.id }, select: { automationRuleId: true, formSubmissionId: true, status: true } });
      expect(runs).toEqual(steps ? [{ automationRuleId: rule.id, formSubmissionId: lead.id, status: "active" }] : []);
    }
  });

  it("offers a first action_failed again only after the retry delay, and never another failure", async () => {
    const t = await tenant();
    const rule = await watchRule(t, 50);
    const session = await live(t);
    const leads = [];
    for (let index = 0; index < 4; index += 1) {
      const lead = await registrant(t, session.id);
      await progress(t, session.id, lead.id, VIDEO_SECONDS);
      leads.push(lead);
    }
    const [recent, due, retried, other] = leads as [typeof leads[number], typeof leads[number], typeof leads[number], typeof leads[number]];
    const failed = (lead: typeof recent, at: Date, errorCode: string, startedAt = at) => db.automationExecutionLog.create({
      data: { vendorId: t.vendor.id, ruleId: rule.id, idempotencyKey: `synthetic-${randomUUID()}`, eventId: watchProgressEventId(lead.id, 50), trigger: "viewer_watch_progress", subjectType: "buyer_registration", subjectKeyHash: automationCustomerKeyHash(t.vendor.id, lead.email), status: "failed", errorCode, createdAt: at, startedAt, completedAt: at },
    });
    await failed(recent, ago(2 * MINUTE), "action_failed");
    await failed(due, ago(20 * MINUTE), "action_failed");
    // Already retried once (startedAt moved past createdAt).
    await failed(retried, ago(20 * MINUTE), "action_failed", ago(15 * MINUTE));
    await failed(other, ago(20 * MINUTE), "unsubscribe_url_unavailable");
    const summary = await run([t]);
    expect(summary).toMatchObject({ candidates: 1, examined: 1 });
    const logs = await logsOf(t);
    expect(logs.filter((log) => log.eventId === watchProgressEventId(due.id, 50))).toHaveLength(2);
    expect(logs).toHaveLength(5);
  });

  it("caps each run and shares it across vendors round-robin", async () => {
    const a = await tenant();
    const b = await tenant();
    for (const t of [a, b]) {
      await watchRule(t, 50);
      const session = await live(t);
      for (let index = 0; index < 3; index += 1) {
        const lead = await registrant(t, session.id);
        await progress(t, session.id, lead.id, VIDEO_SECONDS);
      }
    }
    await expect(run([a, b], { limit: 4 })).resolves.toMatchObject({ candidates: 4, completed: 4 });
    expect((await logsOf(a)).length).toBe(2);
    expect((await logsOf(b)).length).toBe(2);
    await expect(run([a, b])).resolves.toMatchObject({ completed: 2 });
  });
});
