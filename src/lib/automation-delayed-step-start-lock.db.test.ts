import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Q-13 (#601 review): a merchant save holds the automation rule row FOR UPDATE
// (withLockedRule in automation-delayed-steps.ts). Starting a rule's delayed
// steps after an event waits at most 2 s for that row (startDelayedSteps in
// automation-workflow.ts). On the disposable PostgreSQL database, with a
// second connection holding the row like a slow save, this file checks what
// an event that arrives meanwhile gets, and that the e-mail job's
// startPendingAutomationRuns creates exactly the runs such events still owe.
// Only the e-mail provider, the immediate dispatch and monitoring boundaries
// are synthetic.
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: monitoring.captureOperationalError }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: vi.fn() }));

import {
  PENDING_RUN_START_MIN_AGE_MS,
  PENDING_RUN_START_WINDOW_MS,
  runDelayedStepWorker,
  startPendingAutomationRuns,
} from "@/lib/automation-delayed-steps";
import { automationCustomerKeyHash, dispatchAutomationEvent } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";

const db = getDb();
const MINUTE = 60_000;
const createdVendorIds: string[] = [];

/** Bounded clients of their own, so the lock holder and the racers never wait on the shared pool. */
function boundedClient(connections: number) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.set("connection_limit", String(connections));
  url.searchParams.set("pool_timeout", "10");
  return new PrismaClient({ datasourceUrl: url.toString() });
}

/** The connection standing in for the merchant's save. */
let holderClient: PrismaClient;
/** A second job instance (or request) racing the first. */
let racerClient: PrismaClient;

beforeAll(() => {
  holderClient = boundedClient(1);
  racerClient = boundedClient(2);
});

afterAll(async () => {
  await Promise.all([holderClient.$disconnect(), racerClient.$disconnect()]);
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://automation-lock-gap.example.test");
  // Synthetic provider settings: the worker only checks that they exist.
  vi.stubEnv("RESEND_API_KEY", "re_synthetic_automation_lock_gap");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal <no-reply@example.test>");
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture(options: { grant?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `鎖等待商家 ${suffix}`,
      slug: `automation-lock-gap-${suffix}`,
      email: `merchant-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
      betaFeatureGrants: options.grant === false ? [] : ["automation_delayed_steps"],
    },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `lock-gap-form-${suffix}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const rule = await db.automationRule.create({
    data: {
      vendorId: vendor.id,
      name: "報名後追蹤",
      trigger: "form_registered",
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag: "報名" }] as Prisma.InputJsonArray,
    },
  });
  const step = await db.automationRuleStep.create({
    data: {
      vendorId: vendor.id,
      ruleId: rule.id,
      delayMinutes: 120,
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag: "兩小時後" }] as Prisma.InputJsonArray,
    },
  });
  return { vendor, form, rule, step };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function registration(f: Fixture) {
  return db.formSubmission.create({
    data: { formId: f.form.id, name: "王小明", email: `lead-${randomUUID().slice(0, 8)}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
}

function registered(f: Fixture, submission: { id: string; email: string }, client: PrismaClient = db) {
  return dispatchAutomationEvent(client, {
    vendorId: f.vendor.id,
    eventId: `form-registered:${submission.id}`,
    trigger: "form_registered",
    subjectType: "buyer_registration",
    subjectId: submission.id,
    subjectKeyHash: automationCustomerKeyHash(f.vendor.id, submission.email),
    recipientEmail: submission.email,
  });
}

/**
 * Holds the rule row FOR UPDATE on the holder connection, the way
 * withLockedRule does, and moves the step to `movedToMinutes` inside the same
 * transaction, until `release` is called. The transaction timeout bounds it
 * even if a test fails before releasing.
 */
function holdRule(f: Fixture, movedToMinutes: number) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => { locked = resolve; });
  const done = holderClient.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${f.rule.id} AND "vendorId" = ${f.vendor.id} FOR UPDATE`;
    await tx.automationRuleStep.updateMany({ where: { id: f.step.id, vendorId: f.vendor.id }, data: { delayMinutes: movedToMinutes } });
    locked();
    await gate;
  }, { maxWait: 5_000, timeout: 15_000 });
  return { isLocked, release, done: done.catch(() => {}) };
}

/** Waits until another connection is blocked on a lock in a statement matching `fragment`. */
async function waitForLockWait(fragment: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await db.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}
    `;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No statement waited on a lock for ${fragment}`);
}

/**
 * Dispatches the registration while a save takes the rule row right after the
 * event's execution log was inserted (between the insert and the log's
 * completion write, i.e. while the immediate actions run) and holds it until
 * the event returned. The event gives up after the 2 s lock timeout.
 */
async function registeredDuringSave(f: Fixture, lead: { id: string; email: string }, movedToMinutes = 180) {
  let holder: ReturnType<typeof holdRule> | undefined;
  const original = db.automationExecutionLog.update.bind(db.automationExecutionLog);
  vi.spyOn(db.automationExecutionLog, "update").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
    holder = holdRule(f, movedToMinutes);
    await holder.isLocked;
    return original(args);
  }) as never);
  const started = Date.now();
  try {
    const outcome = await registered(f, lead);
    return { outcome, elapsed: Date.now() - started };
  } finally {
    holder?.release();
    await holder?.done;
  }
}

async function logOf(f: Fixture) {
  return db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: f.vendor.id, ruleId: f.rule.id } });
}

function runsOf(f: Fixture) {
  return db.delayedStepRun.findMany({ where: { vendorId: f.vendor.id } });
}

/** A job round's `now` at which the event's log is old enough to be taken. */
const jobTimeFor = (log: { completedAt: Date | null }) => new Date(log.completedAt!.getTime() + PENDING_RUN_START_MIN_AGE_MS + MINUTE);

describe("Q-13 重現：商家存檔鎖住規則列時進來的事件", () => {
  it("a save that already holds the rule when the event arrives makes the whole event wait (the log insert's foreign key), then the run is created", async () => {
    const f = await fixture();
    const lead = await registration(f);
    const holder = holdRule(f, 180);
    let dispatched: ReturnType<typeof registered> | undefined;
    const started = Date.now();
    try {
      await holder.isLocked;
      dispatched = registered(f, lead);
      // The execution log's foreign key check (FOR KEY SHARE on the rule) waits.
      await waitForLockWait("AutomationExecutionLog");
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    } finally {
      holder.release();
      await holder.done;
    }
    await expect(dispatched).resolves.toEqual([{ ruleId: f.rule.id, status: "completed" }]);
    // The registration request was held for the whole save, longer than 2 s.
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_500);
    const log = await logOf(f);
    // Settled: the log owes nothing.
    expect(log.delayedStepsPendingSubjectId).toBeNull();
    const runs = await runsOf(f);
    expect(runs).toHaveLength(1);
    // The saved delay (180), anchored at the event's execution log.
    expect(runs[0]).toMatchObject({ sourceExecutionLogId: log.id, anchorAt: log.createdAt, nextRunAt: new Date(log.createdAt.getTime() + 180 * MINUTE) });
  }, 20_000);

  it("a save that takes the rule after the event's execution log and holds it over 2 s: the event goes on after 2 s without a run, and its log owes one", async () => {
    const f = await fixture();
    const lead = await registration(f);
    const { outcome, elapsed } = await registeredDuringSave(f, lead);
    expect(outcome).toEqual([{ ruleId: f.rule.id, status: "completed" }]);
    // lock_timeout 2 s, then the registration request goes on.
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(6_000);
    expect(await db.customerTagAssignment.count({ where: { vendorId: f.vendor.id, tag: "報名" } })).toBe(1);
    expect(await runsOf(f)).toEqual([]);
    const log = await logOf(f);
    expect(log).toMatchObject({ status: "completed", conditionMatched: true, delayedStepsPendingSubjectId: lead.id });
    // Visible to monitoring as a warning with safe keys only (no ids).
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(
      expect.anything(),
      { source: "automation_delayed_steps", operation: "start_run_deferred" },
      { level: "warning" },
    );
  }, 20_000);
});

describe("Q-13 修正：job 補建事件欠下的 run", () => {
  it("creates the run once, anchored at the event with the saved steps, and the step runs at its time from the event", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await registeredDuringSave(f, lead, 180);
    const log = await logOf(f);

    // Too fresh for the job: the event's own attempt has the first two minutes.
    await expect(startPendingAutomationRuns({ now: new Date(log.completedAt!.getTime() + 30_000), vendorId: f.vendor.id })).resolves.toEqual([]);

    const jobNow = jobTimeFor(log);
    await expect(startPendingAutomationRuns({ now: jobNow, vendorId: f.vendor.id })).resolves.toEqual([{ status: "started" }]);
    const runs = await runsOf(f);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      automationRuleId: f.rule.id,
      sourceExecutionLogId: log.id,
      formSubmissionId: lead.id,
      subjectKeyHash: automationCustomerKeyHash(f.vendor.id, lead.email),
      status: "active",
      cursorDelayMinutes: -1,
      // The event's time, not the job's: the save moved the step to 180 minutes.
      anchorAt: log.createdAt,
      nextRunAt: new Date(log.createdAt.getTime() + 180 * MINUTE),
    });
    expect((await logOf(f)).delayedStepsPendingSubjectId).toBeNull();

    // Another round, and a replay of the same event, add nothing.
    await expect(startPendingAutomationRuns({ now: jobNow, vendorId: f.vendor.id })).resolves.toEqual([]);
    await expect(registered(f, lead)).resolves.toEqual([{ ruleId: f.rule.id, status: "duplicate" }]);
    expect(await runsOf(f)).toHaveLength(1);

    // The worker runs the step 180 minutes after the event.
    const run = runs[0]!;
    await expect(runDelayedStepWorker({ now: new Date(log.createdAt.getTime() + 179 * MINUTE), vendorId: f.vendor.id })).resolves.toEqual([]);
    await expect(runDelayedStepWorker({ now: new Date(log.createdAt.getTime() + 181 * MINUTE), vendorId: f.vendor.id }))
      .resolves.toEqual([{ runId: run.id, status: "executed" }]);
    expect(await db.customerTagAssignment.count({ where: { vendorId: f.vendor.id, tag: "兩小時後" } })).toBe(1);
  }, 30_000);

  it("leaves the log owing the run while the save still holds the rule, and creates it in a later round", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await registeredDuringSave(f, lead);
    const log = await logOf(f);
    const holder = holdRule(f, 240);
    let first: unknown;
    try {
      await holder.isLocked;
      first = await startPendingAutomationRuns({ now: jobTimeFor(log), vendorId: f.vendor.id });
    } finally {
      holder.release();
      await holder.done;
    }
    expect(first).toEqual([{ status: "deferred" }]);
    expect(await runsOf(f)).toEqual([]);
    expect((await logOf(f)).delayedStepsPendingSubjectId).toBe(lead.id);

    await expect(startPendingAutomationRuns({ now: jobTimeFor(log), vendorId: f.vendor.id })).resolves.toEqual([{ status: "started" }]);
    const runs = await runsOf(f);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ anchorAt: log.createdAt, nextRunAt: new Date(log.createdAt.getTime() + 240 * MINUTE) });
  }, 30_000);

  it("two job rounds and a replay of the event racing on separate connections still create one run", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await registeredDuringSave(f, lead);
    const log = await logOf(f);
    const jobNow = jobTimeFor(log);
    const outcomes = await Promise.all([
      startPendingAutomationRuns({ now: jobNow, vendorId: f.vendor.id }, racerClient),
      startPendingAutomationRuns({ now: jobNow, vendorId: f.vendor.id }, holderClient),
      registered(f, lead),
    ]);
    expect(outcomes[2]).toEqual([{ ruleId: f.rule.id, status: "duplicate" }]);
    const runs = await runsOf(f);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ sourceExecutionLogId: log.id, anchorAt: log.createdAt });
    expect((await logOf(f)).delayedStepsPendingSubjectId).toBeNull();
  }, 30_000);

  it("settles without a run when the rule was switched off or the registration deleted meanwhile, and never back-fills events that owed nothing", async () => {
    // Switched off before the job came round: no run (as for the event itself).
    const off = await fixture();
    const offLead = await registration(off);
    await registeredDuringSave(off, offLead);
    await db.automationRule.update({ where: { id: off.rule.id }, data: { isActive: false } });
    const offLog = await logOf(off);
    await expect(startPendingAutomationRuns({ now: jobTimeFor(offLog), vendorId: off.vendor.id })).resolves.toEqual([{ status: "not_needed" }]);
    expect(await runsOf(off)).toEqual([]);
    expect((await logOf(off)).delayedStepsPendingSubjectId).toBeNull();

    // An event before the rule had any step owes nothing: adding a step later
    // never enrols it.
    const late = await fixture();
    await db.automationRuleStep.deleteMany({ where: { vendorId: late.vendor.id } });
    const lateLead = await registration(late);
    await registered(late, lateLead);
    const lateLog = await logOf(late);
    expect(lateLog.delayedStepsPendingSubjectId).toBeNull();
    await db.automationRuleStep.create({
      data: { vendorId: late.vendor.id, ruleId: late.rule.id, delayMinutes: 60, condition: { type: "always" } as Prisma.InputJsonValue, actions: [{ type: "add_customer_tag", tag: "後加" }] as Prisma.InputJsonArray },
    });
    await expect(startPendingAutomationRuns({ now: jobTimeFor(lateLog), vendorId: late.vendor.id })).resolves.toEqual([]);
    expect(await runsOf(late)).toEqual([]);
  }, 40_000);

  it("binds the owed subject to the log's vendor, skips vendors without the grant, and leaves logs outside the window", async () => {
    const a = await fixture();
    const b = await fixture();
    const aLead = await registration(a);
    await registeredDuringSave(a, aLead);
    const aLog = await logOf(a);
    // A log of A pointing at B's registration (only a direct database write can do this).
    const bLead = await registration(b);
    await db.automationExecutionLog.update({ where: { id: aLog.id }, data: { delayedStepsPendingSubjectId: bLead.id } });
    await expect(startPendingAutomationRuns({ now: jobTimeFor(aLog), vendorId: a.vendor.id })).resolves.toEqual([{ status: "not_needed" }]);
    expect(await db.delayedStepRun.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).toBe(0);
    expect((await logOf(a)).delayedStepsPendingSubjectId).toBeNull();

    // A vendor whose grant was closed: not taken, the mark stays.
    const closed = await fixture();
    const closedLead = await registration(closed);
    await registeredDuringSave(closed, closedLead);
    await db.vendor.update({ where: { id: closed.vendor.id }, data: { betaFeatureGrants: [] } });
    const closedLog = await logOf(closed);
    await expect(startPendingAutomationRuns({ now: jobTimeFor(closedLog), vendorId: closed.vendor.id })).resolves.toEqual([]);
    expect((await logOf(closed)).delayedStepsPendingSubjectId).toBe(closedLead.id);

    // Past the 48-hour window: left alone.
    const old = await fixture();
    const oldLead = await registration(old);
    await registeredDuringSave(old, oldLead);
    const oldLog = await logOf(old);
    await expect(startPendingAutomationRuns({ now: new Date(oldLog.completedAt!.getTime() + PENDING_RUN_START_WINDOW_MS + MINUTE), vendorId: old.vendor.id })).resolves.toEqual([]);
    expect(await runsOf(old)).toEqual([]);
  }, 40_000);

  it("takes owed runs round-robin between vendors within the round's limit", async () => {
    const a = await fixture();
    const b = await fixture();
    // Three owed events at A, one at B, marked directly (the same state a deferred start leaves).
    const completedAt = new Date(Date.now() - 10 * MINUTE);
    async function owed(f: Fixture) {
      const lead = await registration(f);
      await registered(f, lead);
      await db.delayedStepRun.deleteMany({ where: { vendorId: f.vendor.id, formSubmissionId: lead.id } });
      const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: f.vendor.id, eventId: `form-registered:${lead.id}` } });
      await db.automationExecutionLog.update({ where: { id: log.id }, data: { delayedStepsPendingSubjectId: lead.id, completedAt } });
      return log;
    }
    for (let index = 0; index < 3; index += 1) await owed(a);
    const bLog = await owed(b);
    const ids = [a.vendor.id, b.vendor.id];
    const round = await startPendingAutomationRuns({ now: new Date(), limit: 2 });
    expect(round.filter((result) => result.status === "started").length).toBeGreaterThanOrEqual(2);
    // B's single owed run is in the first round even though A has older ones.
    expect(await db.delayedStepRun.count({ where: { vendorId: b.vendor.id, sourceExecutionLogId: bLog.id } })).toBe(1);
    for (let round = 0; round < 5; round += 1) {
      if ((await startPendingAutomationRuns({ now: new Date(), limit: 2 })).length === 0) break;
    }
    expect(await db.delayedStepRun.count({ where: { vendorId: { in: ids } } })).toBe(4);
    expect(await db.automationExecutionLog.count({ where: { vendorId: { in: ids }, delayedStepsPendingSubjectId: { not: null } } })).toBe(0);
  }, 40_000);
});
