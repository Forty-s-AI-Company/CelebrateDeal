import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A2-08: a merchant save holds the automation rule row FOR UPDATE (the step
// editor's withLockedRule, switching a rule on or off, deleting it, the funnel
// editor), each in a Prisma transaction with a 15 s timeout. A request-path
// event inserts its execution log, whose foreign key to the rule waits for
// that lock: before this change the registration (or booking, or payment
// hook) waited for the whole save, up to those 15 s. On the disposable
// PostgreSQL database, with a second connection holding the row like a slow
// save, this file checks that the request path now gives up after about 2 s,
// records the rule for the e-mail job, and that the job runs it exactly once
// after the save, bound to the vendor. Only the e-mail provider, the immediate
// dispatch and monitoring are synthetic.
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: monitoring.captureOperationalError,
}));
vi.mock("@/lib/email-delivery-immediate", async (original) => ({
  ...await original<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: vi.fn(),
}));

import {
  DEFERRED_DISPATCH_RETRY_DELAYS_MS,
  DEFERRED_DISPATCH_SAVE_GRACE_MS,
  DEFERRED_DISPATCH_WINDOW_MS,
  runDeferredAutomationDispatches,
} from "@/lib/automation-deferred-dispatch";
import {
  AUTOMATION_EXECUTION_RECLAIM_AFTER_MS,
  automationCustomerKeyHash,
  deferrableExecutionIdempotencyKey,
  dispatchAutomationEvent,
} from "@/lib/automation-workflow";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { runPaymentPaidAutomationCatchup } from "@/lib/payment-paid-automation-catchup";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

const db = getDb();
const MINUTE = 60_000;
/** How long the synthetic save holds the rule row (the brief's 5 s). */
const HOLD_MS = 5_000;
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
/** A second job instance racing the first. */
let racerClient: PrismaClient;

beforeAll(() => {
  holderClient = boundedClient(1);
  racerClient = boundedClient(2);
});

afterAll(async () => {
  await Promise.all([holderClient.$disconnect(), racerClient.$disconnect()]);
});

beforeEach(() => {
  // Synthetic secrets, so the file does not depend on the developer's environment.
  vi.stubEnv("CSRF_SECRET", "automation-dispatch-lock-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://automation-dispatch-lock.example.test");
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { vendorId: { in: createdVendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

type Trigger = "form_registered" | "consultation_booked" | "consultation_no_show" | "payment_paid" | "form_no_show";

async function fixture(options: { trigger?: Trigger; grants?: string[]; tag?: string } = {}) {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `存檔鎖商家 ${suffix}`,
      slug: `automation-dispatch-lock-${suffix}`,
      email: `merchant-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
      betaFeatureGrants: options.grants ?? ["automation_delayed_steps"],
    },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `dispatch-lock-form-${suffix}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const trigger = options.trigger ?? "form_registered";
  const tag = options.tag ?? `已觸發-${suffix.slice(0, 6)}`;
  const rule = await db.automationRule.create({
    data: {
      vendorId: vendor.id,
      name: "請求路徑規則",
      trigger,
      condition: (trigger === "payment_paid" ? { type: "order_amount_gte", amountCents: 100 } : { type: "always" }) as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag }] as Prisma.InputJsonArray,
    },
  });
  const step = await db.automationRuleStep.create({
    data: {
      vendorId: vendor.id,
      ruleId: rule.id,
      delayMinutes: 120,
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag: `${tag}-兩小時後` }] as Prisma.InputJsonArray,
    },
  });
  const consultation = await db.consultationEvent.create({
    data: { vendorId: vendor.id, title: "1 對 1 諮詢", weeklySchedule: {}, intakeFormFields: [] },
  });
  return { vendor, form, rule, step, consultation, tag };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function registration(f: Fixture) {
  const row = await db.formSubmission.create({
    data: { formId: f.form.id, name: "王小明", email: `lead-${randomUUID().slice(0, 8)}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
  return { id: row.id, email: row.email };
}

async function booking(f: Fixture, status: "scheduled" | "no_show" | "cancelled" = "scheduled") {
  const start = new Date(Date.now() + 3 * 24 * 60 * MINUTE);
  const row = await db.consultationBooking.create({
    data: {
      vendorId: f.vendor.id,
      eventId: f.consultation.id,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * MINUTE),
      clientName: "林小姐",
      clientEmail: `client-${randomUUID().slice(0, 8)}@example.test`,
      clientPhone: "0912000000",
      meetingUrl: "https://meet.example.test/room",
      status,
    },
  });
  return { id: row.id, email: row.clientEmail };
}

/** The live event exactly as the form route and the consultation actions build it. */
function liveEvent(f: Fixture, subject: { id: string; email: string }, client: PrismaClient = db) {
  const trigger = f.rule.trigger as Exclude<Trigger, "payment_paid">;
  const eventId = trigger === "form_registered"
    ? `form-registered:${subject.id}`
    : trigger === "consultation_booked"
      ? `consultation-booked:${subject.id}`
      : trigger === "consultation_no_show" ? `consultation-no-show:${subject.id}` : `form-no-show:${subject.id}:session-1`;
  return dispatchAutomationEvent(client, {
    vendorId: f.vendor.id,
    eventId,
    trigger,
    subjectType: "buyer_registration",
    subjectId: subject.id,
    subjectKeyHash: automationCustomerKeyHash(f.vendor.id, subject.email),
    recipientEmail: subject.email,
    ...(trigger.startsWith("consultation") ? { consultationUrl: "https://meet.example.test/room" } : {}),
  });
}

/**
 * Holds the rule row FOR UPDATE on the holder connection, the way every rule
 * writer does, and runs `inside` in the same transaction (a save's change),
 * until `release` is called or `holdMs` passed; `beforeCommit` runs in the
 * same transaction after that (a change the save writes last). The
 * transaction timeout bounds it even if a test fails before releasing.
 */
function holdRule(f: Fixture, options: {
  holdMs?: number;
  inside?: (tx: Prisma.TransactionClient) => Promise<unknown>;
  beforeCommit?: (tx: Prisma.TransactionClient) => Promise<unknown>;
} = {}) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => { locked = resolve; });
  const done = holderClient.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${f.rule.id} AND "vendorId" = ${f.vendor.id} FOR UPDATE`;
    await options.inside?.(tx);
    locked();
    await Promise.race([gate, new Promise((resolve) => setTimeout(resolve, options.holdMs ?? 12_000))]);
    await options.beforeCommit?.(tx);
  }, { maxWait: 5_000, timeout: 15_000 });
  return { isLocked, release, done: done.catch(() => {}) };
}

/** Waits until another connection is blocked on a lock in a statement matching `pattern`; returns its start (PostgreSQL clock). */
async function waitForLockWait(pattern: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await db.$queryRaw<Array<{ queryStart: Date }>>`
      SELECT query_start AS "queryStart" FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${pattern}
      ORDER BY query_start ASC LIMIT 1
    `;
    if (row) return row.queryStart;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No statement waited on a lock for ${pattern}`);
}

/** Answers whether the rule row is still held by someone else right now (NOWAIT gets 55P03 exactly then). */
function ruleStillHeld(f: Fixture) {
  return db.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${f.rule.id} AND "vendorId" = ${f.vendor.id} FOR UPDATE NOWAIT`
    .then(() => false, (error: unknown) => /55P03|could not obtain lock/.test(String(error)));
}

const pgNow = async () => (await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`)[0]!.now;

/**
 * Runs `request` while the save holds the rule row for HOLD_MS and returns its
 * outcome with PostgreSQL's own evidence: the claim's INSERT was seen waiting
 * on a lock (pg_stat_activity), the request came back while the row was STILL
 * held (so the wait ended by its own timeout, not by the save letting go), and
 * the time from that INSERT's start to the return, on the server's clock.
 */
async function duringSave<T>(f: Fixture, request: () => Promise<T>, save: Pick<Parameters<typeof holdRule>[1] & object, "inside" | "beforeCommit"> = {}) {
  const holder = holdRule(f, { holdMs: HOLD_MS, ...save });
  try {
    await holder.isLocked;
    const startedWall = Date.now();
    const pending = request();
    const waitStarted = await Promise.race([
      waitForLockWait("%INSERT%AutomationExecutionLog%"),
      pending.then(() => { throw new Error("The request returned without ever waiting on the save's lock"); }),
    ]);
    const outcome = await pending;
    const stillHeld = await ruleStillHeld(f);
    const pgWaitMs = (await pgNow()).getTime() - waitStarted.getTime();
    const wallMs = Date.now() - startedWall;
    return { outcome, stillHeld, pgWaitMs, wallMs };
  } finally {
    holder.release();
    await holder.done;
  }
}

function deferredRows(vendorId: string) {
  return db.automationDeferredDispatch.findMany({ where: { vendorId } });
}

function logsOf(f: Fixture) {
  return db.automationExecutionLog.findMany({ where: { vendorId: f.vendor.id, ruleId: f.rule.id } });
}

function tagsOf(f: Fixture) {
  return db.customerTagAssignment.count({ where: { vendorId: f.vendor.id, tag: f.tag } });
}

/** Measurements for the report (PostgreSQL-side wait and the wall clock), printed once per measured case. */
const measured: Array<Record<string, unknown>> = [];
afterAll(() => {
  if (measured.length) console.info(`A2-08 request-path waits: ${JSON.stringify(measured)}`);
});

describe("A2-08 請求路徑：商家存檔持有規則列 5 秒", () => {
  it("a registration gives up after about 2 s while the save still holds the row, records the rule for the job and runs nothing", async () => {
    const f = await fixture();
    const lead = await registration(f);
    const { outcome, stillHeld, pgWaitMs, wallMs } = await duringSave(f, () => liveEvent(f, lead));
    measured.push({ case: "form_registered", pgWaitMs, wallMs });

    expect(outcome).toEqual([{ ruleId: f.rule.id, status: "deferred" }]);
    // The save still held the row when the request came back: the wait ended
    // by the claim's own lock_timeout (2 s, statement_timeout 3 s), not because
    // the save let go after its 5 s.
    expect(stillHeld).toBe(true);
    // On the server's clock, from the waiting INSERT's start to the return:
    // well under the 5 s hold (and far from the 15 s it used to reach).
    expect(pgWaitMs).toBeLessThan(HOLD_MS - 500);
    // Nothing ran and nothing half-written: no log, no tag, no run.
    expect(await logsOf(f)).toEqual([]);
    expect(await tagsOf(f)).toBe(0);
    expect(await db.delayedStepRun.count({ where: { vendorId: f.vendor.id } })).toBe(0);
    // References only: rule, trigger, the registration's id.
    const rows = await deferredRows(f.vendor.id);
    expect(rows).toEqual([expect.objectContaining({ ruleId: f.rule.id, trigger: "form_registered", subjectId: lead.id, attempts: 0 })]);
    expect(JSON.stringify(rows)).not.toContain(lead.email);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(
      expect.anything(),
      { source: "automation_dispatch", operation: "claim_deferred" },
      { level: "warning" },
    );
  }, 30_000);

  it("a consultation booking and a no-show give up the same way", async () => {
    for (const trigger of ["consultation_booked", "consultation_no_show"] as const) {
      const f = await fixture({ trigger });
      const subject = await booking(f, trigger === "consultation_no_show" ? "no_show" : "scheduled");
      const { outcome, stillHeld, pgWaitMs, wallMs } = await duringSave(f, () => liveEvent(f, subject));
      measured.push({ case: trigger, pgWaitMs, wallMs });
      expect(outcome).toEqual([{ ruleId: f.rule.id, status: "deferred" }]);
      expect(stillHeld).toBe(true);
      expect(pgWaitMs).toBeLessThan(HOLD_MS - 500);
      expect(await deferredRows(f.vendor.id)).toEqual([expect.objectContaining({ ruleId: f.rule.id, trigger, subjectId: subject.id })]);
    }
  }, 45_000);

  it("a job-run trigger (form_no_show) still waits for the save, as before: no request is held there", async () => {
    const f = await fixture({ trigger: "form_no_show", grants: ["automation_delayed_steps", "automation_form_no_show"] });
    const lead = await registration(f);
    const holder = holdRule(f);
    let dispatched: ReturnType<typeof liveEvent> | undefined;
    try {
      await holder.isLocked;
      dispatched = liveEvent(f, lead);
      await waitForLockWait("%INSERT%AutomationExecutionLog%");
      // Still waiting after 2.5 s (seen by PostgreSQL), unlike a request-path trigger.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await waitForLockWait("%INSERT%AutomationExecutionLog%");
    } finally {
      holder.release();
      await holder.done;
    }
    await expect(dispatched).resolves.toEqual([{ ruleId: f.rule.id, status: "completed" }]);
    expect(await deferredRows(f.vendor.id)).toEqual([]);
  }, 30_000);
});

describe("A2-08 job：鎖釋放後補跑，只執行一次", () => {
  it("runs the deferred rule once after the save, with its delayed-step run, and nothing repeats it", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await duringSave(f, () => liveEvent(f, lead));

    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "dispatched" }] });
    const logs = await logsOf(f);
    expect(logs).toEqual([expect.objectContaining({ status: "completed", conditionMatched: true, eventId: `form-registered:${lead.id}`, delayedStepsPendingSubjectId: null })]);
    expect(await tagsOf(f)).toBe(1);
    // The rule's delayed steps start like the live path's, from the execution.
    const runs = await db.delayedStepRun.findMany({ where: { vendorId: f.vendor.id } });
    expect(runs).toEqual([expect.objectContaining({ automationRuleId: f.rule.id, sourceExecutionLogId: logs[0]!.id, formSubmissionId: lead.id, status: "active" })]);
    expect(await deferredRows(f.vendor.id)).toEqual([]);

    // Another round, and the live event replayed: nothing runs again.
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [] });
    await expect(liveEvent(f, lead)).resolves.toEqual([{ ruleId: f.rule.id, status: "duplicate" }]);
    expect(await logsOf(f)).toHaveLength(1);
    expect(await tagsOf(f)).toBe(1);
    expect(await db.delayedStepRun.count({ where: { vendorId: f.vendor.id } })).toBe(1);
  }, 30_000);

  it("keeps the row while the save still holds the rule (attempt not counted), then runs it once released", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await duringSave(f, () => liveEvent(f, lead));

    const holder = holdRule(f);
    try {
      await holder.isLocked;
      await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "deferred" }] });
      expect(await ruleStillHeld(f)).toBe(true);
    } finally {
      holder.release();
      await holder.done;
    }
    expect(await deferredRows(f.vendor.id)).toEqual([expect.objectContaining({ attempts: 0 })]);
    expect(await logsOf(f)).toEqual([]);

    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "dispatched" }] });
    expect(await tagsOf(f)).toBe(1);
    expect(await deferredRows(f.vendor.id)).toEqual([]);
  }, 40_000);

  it("two job rounds on different connections and a replayed event at the same time: one execution", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await duringSave(f, () => liveEvent(f, lead));

    const [first, second] = await Promise.all([
      runDeferredAutomationDispatches({ vendorId: f.vendor.id }),
      runDeferredAutomationDispatches({ vendorId: f.vendor.id }, racerClient),
      liveEvent(f, lead, racerClient),
    ]);
    const jobResults = [...first.results, ...second.results];
    // At least one round took the row (the other may have found it already gone).
    expect(jobResults.length, JSON.stringify(jobResults)).toBeGreaterThanOrEqual(1);
    expect(jobResults.length, JSON.stringify(jobResults)).toBeLessThanOrEqual(2);
    // A round that met another one's claim still running keeps the row (R-1); the next round settles it.
    expect(jobResults.every((result) => result.status === "dispatched" || result.status === "running_elsewhere"), JSON.stringify(jobResults)).toBe(true);
    const next = await runDeferredAutomationDispatches({ vendorId: f.vendor.id });
    expect(next.results.every((result) => result.status === "settled"), JSON.stringify(next)).toBe(true);
    expect(await logsOf(f)).toHaveLength(1);
    expect(await tagsOf(f)).toBe(1);
    expect(await db.delayedStepRun.count({ where: { vendorId: f.vendor.id } })).toBe(1);
    expect(await deferredRows(f.vendor.id)).toEqual([]);
  }, 40_000);

  it("a save that switched the rule off or deleted it: the row settles and nothing runs", async () => {
    const off = await fixture();
    const offLead = await registration(off);
    await duringSave(off, () => liveEvent(off, offLead));
    await db.automationRule.update({ where: { id: off.rule.id }, data: { isActive: false } });

    const gone = await fixture();
    const goneLead = await registration(gone);
    await duringSave(gone, () => liveEvent(gone, goneLead));
    await db.automationRule.delete({ where: { id: gone.rule.id } });

    for (const f of [off, gone]) {
      await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "settled" }] });
      expect(await db.automationExecutionLog.count({ where: { vendorId: f.vendor.id } })).toBe(0);
      expect(await tagsOf(f)).toBe(0);
      expect(await deferredRows(f.vendor.id)).toEqual([]);
    }
  }, 40_000);

  it("rebuilds a consultation event from the booking: a booking cancelled meanwhile and a no-show no longer marked are settled", async () => {
    const booked = await fixture({ trigger: "consultation_booked" });
    const kept = await booking(booked);
    const cancelled = await booking(booked);
    await duringSave(booked, () => liveEvent(booked, kept));
    await duringSave(booked, () => liveEvent(booked, cancelled));
    await db.consultationBooking.update({ where: { id: cancelled.id }, data: { status: "cancelled" } });

    const noShow = await fixture({ trigger: "consultation_no_show" });
    const reverted = await booking(noShow, "no_show");
    await duringSave(noShow, () => liveEvent(noShow, reverted));
    await db.consultationBooking.update({ where: { id: reverted.id }, data: { status: "completed" } });

    const bookedRound = await runDeferredAutomationDispatches({ vendorId: booked.vendor.id });
    expect(bookedRound.results.map((result) => result.status).sort()).toEqual(["dispatched", "settled"]);
    const logs = await logsOf(booked);
    expect(logs).toEqual([expect.objectContaining({ eventId: `consultation-booked:${kept.id}`, status: "completed" })]);
    expect(await db.customerTagAssignment.findMany({ where: { vendorId: booked.vendor.id, tag: booked.tag }, select: { customerKeyHash: true } }))
      .toEqual([{ customerKeyHash: automationCustomerKeyHash(booked.vendor.id, kept.email) }]);

    await expect(runDeferredAutomationDispatches({ vendorId: noShow.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "settled" }] });
    expect(await logsOf(noShow)).toEqual([]);
  }, 60_000);

  it("backs a failing row off in time (1, 2, 5, 10, then 30 minutes), keeps it inside the 48-hour window and then drops it, reported (#671 review MINOR-5)", async () => {
    const f = await fixture();
    const old = await registration(f);
    const failing = await registration(f);
    const createdAt = new Date();
    await db.automationDeferredDispatch.createMany({
      data: [
        { vendorId: f.vendor.id, ruleId: f.rule.id, trigger: "form_registered", subjectId: old.id, createdAt: new Date(Date.now() - DEFERRED_DISPATCH_WINDOW_MS - MINUTE) },
        { vendorId: f.vendor.id, ruleId: f.rule.id, trigger: "form_registered", subjectId: failing.id, createdAt, nextAttemptAt: createdAt },
      ],
    });
    // A failure other than the rule lock (e.g. the database going away mid-read).
    const outage = vi.spyOn(db.formSubmission, "findFirst").mockRejectedValue(new Error("synthetic outage"));

    let now = new Date(createdAt.getTime() + 1_000);
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id, now })).resolves.toEqual({ expired: 1, results: [{ status: "failed" }] });
    const expectedDelays = [1, 2, 5, 10, 30, 30].map((minutes) => minutes * MINUTE);
    expect(DEFERRED_DISPATCH_RETRY_DELAYS_MS).toEqual(expectedDelays.slice(0, 5));
    for (const [index, delay] of expectedDelays.entries()) {
      const [row] = await deferredRows(f.vendor.id);
      expect(row).toMatchObject({ subjectId: failing.id, attempts: index + 1, nextAttemptAt: new Date(now.getTime() + delay) });
      // Not taken before its time ...
      await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id, now: new Date(now.getTime() + delay - 1_000) })).resolves.toEqual({ expired: 0, results: [] });
      // ... and taken again when it is due (the last pass of the loop leaves a 7th failure).
      now = new Date(now.getTime() + delay);
      await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id, now })).resolves.toEqual({ expired: 0, results: [{ status: "failed" }] });
    }
    expect((await deferredRows(f.vendor.id))[0]).toMatchObject({ attempts: 7 });

    // No count limit: still kept, until the 48-hour window ends.
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id, now: new Date(createdAt.getTime() + DEFERRED_DISPATCH_WINDOW_MS - MINUTE) }))
      .resolves.toEqual({ expired: 0, results: [{ status: "failed" }] });
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id, now: new Date(createdAt.getTime() + DEFERRED_DISPATCH_WINDOW_MS + MINUTE) }))
      .resolves.toEqual({ expired: 1, results: [] });
    expect(await deferredRows(f.vendor.id)).toEqual([]);
    const operations = monitoring.captureOperationalError.mock.calls.map((call) => (call[1] as { operation?: string }).operation);
    expect(new Set(operations)).toEqual(new Set(["dispatch_expired", "dispatch_failed"]));
    // Safe keys only.
    for (const call of monitoring.captureOperationalError.mock.calls) expect(Object.keys(call[1] as object).sort()).toEqual(["operation", "source"]);
    outage.mockRestore();
    expect(await logsOf(f)).toEqual([]);
  }, 30_000);

  it("a claim that stopped mid-run elsewhere: the row is kept without an attempt, then the stale claim is finished once (#671 review MINOR-2)", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await duringSave(f, () => liveEvent(f, lead));
    // Another process (a replayed event, or an earlier round of this job) claimed the
    // execution and stopped before finishing: its log is `running`, nothing ran.
    const rule = await db.automationRule.findUniqueOrThrow({ where: { id: f.rule.id }, select: { version: true } });
    const claimed = await db.automationExecutionLog.create({
      data: {
        vendorId: f.vendor.id,
        ruleId: f.rule.id,
        idempotencyKey: deferrableExecutionIdempotencyKey({ vendorId: f.vendor.id, ruleId: f.rule.id, ruleVersion: rule.version, trigger: "form_registered", subjectId: lead.id }),
        eventId: `form-registered:${lead.id}`,
        trigger: "form_registered",
        subjectType: "buyer_registration",
        subjectKeyHash: automationCustomerKeyHash(f.vendor.id, lead.email),
        status: "running",
      },
    });

    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "running_elsewhere" }] });
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "running_elsewhere" }] });
    expect(await deferredRows(f.vendor.id)).toEqual([expect.objectContaining({ attempts: 0 })]);
    expect(await tagsOf(f)).toBe(0);

    // Past the reclaim threshold the same dispatch reclaims the stale claim and finishes it.
    await db.automationExecutionLog.update({ where: { id: claimed.id }, data: { startedAt: new Date(Date.now() - AUTOMATION_EXECUTION_RECLAIM_AFTER_MS - MINUTE) } });
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "dispatched" }] });
    expect(await logsOf(f)).toEqual([expect.objectContaining({ id: claimed.id, status: "completed" })]);
    expect(await tagsOf(f)).toBe(1);
    expect(await db.delayedStepRun.count({ where: { vendorId: f.vendor.id } })).toBe(1);
    expect(await deferredRows(f.vendor.id)).toEqual([]);
    await expect(liveEvent(f, lead)).resolves.toEqual([{ ruleId: f.rule.id, status: "duplicate" }]);
    expect(await logsOf(f)).toHaveLength(1);
  }, 30_000);

  /**
   * R-1: a claim made under version v (another process, or an earlier round)
   * and still `running`, then a save bumps the rule to v + 1 within the grace
   * window. The new version's key is free, so a dispatch would claim the rule
   * a second time (second voucher, e-mail, LINE).
   */
  async function claimThenBumpVersion(f: Fixture, lead: { id: string; email: string }, startedAt: Date) {
    const before = await db.automationRule.findUniqueOrThrow({ where: { id: f.rule.id }, select: { version: true } });
    const claimed = await db.automationExecutionLog.create({
      data: {
        vendorId: f.vendor.id,
        ruleId: f.rule.id,
        idempotencyKey: deferrableExecutionIdempotencyKey({ vendorId: f.vendor.id, ruleId: f.rule.id, ruleVersion: before.version, trigger: "form_registered", subjectId: lead.id }),
        eventId: `form-registered:${lead.id}`,
        trigger: "form_registered",
        subjectType: "buyer_registration",
        subjectKeyHash: automationCustomerKeyHash(f.vendor.id, lead.email),
        status: "running",
        startedAt,
      },
    });
    await db.automationRule.update({ where: { id: f.rule.id }, data: { version: { increment: 1 } } });
    return claimed;
  }

  it("a claim still running under the old version after a save bumped it: the row is kept, no second log (#671 re-review R-1)", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await duringSave(f, () => liveEvent(f, lead));
    const claimed = await claimThenBumpVersion(f, lead, new Date());

    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "running_elsewhere" }] });
    expect(await logsOf(f)).toEqual([expect.objectContaining({ id: claimed.id, status: "running" })]);
    expect(await tagsOf(f)).toBe(0);
    expect(await deferredRows(f.vendor.id)).toEqual([expect.objectContaining({ attempts: 0 })]);
  }, 30_000);

  it("a stale claim under the old version after a save bumped it: the row is settled and reported, never run again (#671 re-review R-1)", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await duringSave(f, () => liveEvent(f, lead));
    const claimed = await claimThenBumpVersion(f, lead, new Date(Date.now() - AUTOMATION_EXECUTION_RECLAIM_AFTER_MS - MINUTE));

    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "settled" }] });
    expect(await logsOf(f)).toEqual([expect.objectContaining({ id: claimed.id, status: "running" })]);
    expect(await tagsOf(f)).toBe(0);
    expect(await deferredRows(f.vendor.id)).toEqual([]);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(
      expect.any(Error),
      { source: "automation_deferred_dispatch", operation: "dispatch_stale_claim_settled" },
      { level: "warning" },
    );
    // Nothing later runs it under the new version either.
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [] });
    expect(await logsOf(f)).toHaveLength(1);
  }, 30_000);

  it("a rule switched off and on again after the save that deferred it does not run late for that event (#671 review MINOR-3)", async () => {
    const deferredAgo = async (f: Fixture) => {
      const lead = await registration(f);
      await duringSave(f, () => liveEvent(f, lead));
      // The deferral, and the save behind it, happened 10 minutes ago.
      const then = new Date(Date.now() - 10 * MINUTE);
      await db.automationDeferredDispatch.updateMany({ where: { vendorId: f.vendor.id }, data: { createdAt: then, nextAttemptAt: then } });
      await db.automationRule.update({ where: { id: f.rule.id }, data: { updatedAt: new Date(then.getTime() - 5_000) } });
      expect((await db.automationRule.findUniqueOrThrow({ where: { id: f.rule.id } })).updatedAt).toEqual(new Date(then.getTime() - 5_000));
    };
    // Control: nothing changed the rule since, so it runs.
    const kept = await fixture();
    await deferredAgo(kept);
    await expect(runDeferredAutomationDispatches({ vendorId: kept.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "dispatched" }] });
    expect(await tagsOf(kept)).toBe(1);

    // The merchant switches the rule off and on now, long after the save that deferred the event.
    const toggled = await fixture();
    await deferredAgo(toggled);
    await db.automationRule.update({ where: { id: toggled.rule.id }, data: { isActive: false } });
    await db.automationRule.update({ where: { id: toggled.rule.id }, data: { isActive: true } });
    await expect(runDeferredAutomationDispatches({ vendorId: toggled.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "settled" }] });
    expect(await logsOf(toggled)).toEqual([]);
    expect(await tagsOf(toggled)).toBe(0);
    expect(await deferredRows(toggled.vendor.id)).toEqual([]);
    expect(DEFERRED_DISPATCH_SAVE_GRACE_MS).toBe(75_000);
  }, 30_000);

  it("the funnel editor's save that bumped the version while the event was deferred: the new version runs once, one log (#671 review MINOR-4)", async () => {
    const f = await fixture();
    const lead = await registration(f);
    // Like updateFunnelAutomationRule: new actions and version + 1, under the rule lock.
    const saved = { type: "add_customer_tag", tag: `${f.tag}-v2` };
    await duringSave(f, () => liveEvent(f, lead), {
      inside: (tx) => tx.automationRule.update({ where: { id: f.rule.id }, data: { actions: [saved] as Prisma.InputJsonArray, version: { increment: 1 } } }),
    });
    const rule = await db.automationRule.findUniqueOrThrow({ where: { id: f.rule.id }, select: { version: true } });
    expect(rule.version).toBe(2);

    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "dispatched" }] });
    const logs = await logsOf(f);
    expect(logs).toEqual([expect.objectContaining({
      status: "completed",
      idempotencyKey: deferrableExecutionIdempotencyKey({ vendorId: f.vendor.id, ruleId: f.rule.id, ruleVersion: 2, trigger: "form_registered", subjectId: lead.id }),
    })]);
    expect(await db.customerTagAssignment.count({ where: { vendorId: f.vendor.id, tag: saved.tag } })).toBe(1);
    expect(await tagsOf(f)).toBe(0);
    // A replay and another round repeat nothing.
    await expect(liveEvent(f, lead)).resolves.toEqual([{ ruleId: f.rule.id, status: "duplicate" }]);
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [] });
    expect(await logsOf(f)).toHaveLength(1);
  }, 30_000);
});

describe("A2-08 跨租戶", () => {
  it("another vendor's event is not held by this vendor's save, and the job only runs a row's own vendor's rule and subject", async () => {
    const a = await fixture();
    const b = await fixture();
    const leadA = await registration(a);
    const leadB = await registration(b);

    // Vendor B's registration while A's rule is held: B's own rule runs at once.
    const holder = holdRule(a);
    try {
      await holder.isLocked;
      await expect(liveEvent(b, leadB)).resolves.toEqual([{ ruleId: b.rule.id, status: "completed" }]);
      expect(await ruleStillHeld(a)).toBe(true);
    } finally {
      holder.release();
      await holder.done;
    }
    expect(await deferredRows(b.vendor.id)).toEqual([]);

    await duringSave(a, () => liveEvent(a, leadA));
    // Rows a writer could never produce, bound to B but naming A's rule or A's registration.
    await db.automationDeferredDispatch.createMany({
      data: [
        { vendorId: b.vendor.id, ruleId: a.rule.id, trigger: "form_registered", subjectId: leadB.id },
        { vendorId: b.vendor.id, ruleId: b.rule.id, trigger: "form_registered", subjectId: leadA.id },
      ],
    });

    // B's round never touches A's row.
    const roundB = await runDeferredAutomationDispatches({ vendorId: b.vendor.id });
    expect(roundB.results).toEqual([{ status: "settled" }, { status: "settled" }]);
    expect(await deferredRows(a.vendor.id)).toHaveLength(1);
    expect(await logsOf(a)).toEqual([]);
    expect(await tagsOf(a)).toBe(0);
    // B: only its own live execution, no second one for A's registration.
    expect(await logsOf(b)).toEqual([expect.objectContaining({ eventId: `form-registered:${leadB.id}` })]);
    expect(await tagsOf(b)).toBe(1);

    // A's own round runs A's rule for A's registration.
    await expect(runDeferredAutomationDispatches({ vendorId: a.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "dispatched" }] });
    expect(await logsOf(a)).toEqual([expect.objectContaining({ eventId: `form-registered:${leadA.id}` })]);
    expect(await db.customerTagAssignment.findMany({ where: { vendorId: a.vendor.id, tag: a.tag }, select: { customerKeyHash: true } }))
      .toEqual([{ customerKeyHash: automationCustomerKeyHash(a.vendor.id, leadA.email) }]);
  }, 45_000);

  it("a suspended vendor's rows wait (not taken) and the database refuses a row of a vendor that does not exist", async () => {
    const f = await fixture();
    const lead = await registration(f);
    await duringSave(f, () => liveEvent(f, lead));
    await db.vendor.update({ where: { id: f.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "synthetic" } });
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [] });
    expect(await deferredRows(f.vendor.id)).toHaveLength(1);
    await expect(db.automationDeferredDispatch.create({
      data: { vendorId: `missing-${randomUUID()}`, ruleId: f.rule.id, trigger: "form_registered", subjectId: lead.id },
    })).rejects.toThrow();
    await expect(db.$executeRaw`
      INSERT INTO "AutomationDeferredDispatch" ("id", "vendorId", "ruleId", "trigger", "subjectId")
      VALUES (${randomUUID()}, ${f.vendor.id}, ${f.rule.id}, 'viewer_watch_progress', ${lead.id})
    `).rejects.toThrow(/AutomationDeferredDispatch_trigger_check/);
  }, 30_000);
});

describe("A2-08 payment_paid（付款 webhook 之後的自動化）", () => {
  const PRICE_CENTS = 2_000;

  async function paidCheckout(f: Fixture) {
    const product = await db.product.create({
      data: { vendorId: f.vendor.id, name: "付款商品", slug: `lock-paid-${randomUUID()}`, priceCents: PRICE_CENTS, currency: "TWD", inventory: 50, isActive: true, fulfillmentTypeConfirmed: true },
    });
    const orderNumber = `LOCK-PAID-${randomUUID()}`;
    const checkoutIdempotencyKey = randomUUID();
    const transaction = await createReservedPaymentTransaction({
      vendorId: f.vendor.id,
      productId: product.id,
      checkoutIdempotencyKey,
      transactionData: {
        vendorId: f.vendor.id, checkoutIdempotencyKey, providerName: "payuni", orderNumber, paymentMode: "platform",
        grossAmountCents: PRICE_CENTS, netAmountCents: PRICE_CENTS, currency: "TWD", status: "pending", metadata: { productId: product.id },
      },
      createCommerceOrder: async (tx, payment) => {
        await createCommerceOrderForCheckout(tx, {
          vendorId: f.vendor.id, productId: product.id, orderNumber, checkoutIdempotencyKey, paymentTransactionId: payment.id,
          totalAmountCents: PRICE_CENTS, currency: "TWD", buyer: { name: "合成買家", email: "lock.buyer@example.test", phone: "0912345678" }, shipping: null,
        });
      },
    });
    const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: f.vendor.id, primaryPaymentTransactionId: transaction.id } });
    const paid = () => processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "payuni", eventId: `lock-paid-${randomUUID()}`, eventType: "paid", vendorId: f.vendor.id, orderNumber, grossAmountCents: PRICE_CENTS, currency: "TWD",
    }));
    return { orderId: order.id, paid };
  }

  it("the paid callback's automation gives up after about 2 s (the payment itself unaffected), and the job runs the rule once afterwards", async () => {
    const f = await fixture({ trigger: "payment_paid" });
    const c = await paidCheckout(f);
    // Outside a request scope the webhook runs the automation inline (`after` throws there).
    const { stillHeld, pgWaitMs, wallMs } = await duringSave(f, () => c.paid());
    measured.push({ case: "payment_paid", pgWaitMs, wallMs });
    expect(stillHeld).toBe(true);
    expect(pgWaitMs).toBeLessThan(HOLD_MS - 500);
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId }, select: { status: true, paidAmountCents: true } }))
      .toEqual({ status: "paid", paidAmountCents: PRICE_CENTS });
    expect(await logsOf(f)).toEqual([]);
    expect(await deferredRows(f.vendor.id)).toEqual([expect.objectContaining({ ruleId: f.rule.id, trigger: "payment_paid", subjectId: c.orderId })]);

    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "dispatched" }] });
    expect(await logsOf(f)).toEqual([expect.objectContaining({ eventId: `payment-paid:${c.orderId}`, status: "completed" })]);
    expect(await tagsOf(f)).toBe(1);
    // Q-09: the order's delayed-step run, once.
    expect(await db.delayedStepRun.findMany({ where: { vendorId: f.vendor.id } })).toEqual([expect.objectContaining({ commerceOrderId: c.orderId })]);

    // A replayed paid callback repeats nothing.
    await c.paid();
    expect(await logsOf(f)).toHaveLength(1);
    expect(await tagsOf(f)).toBe(1);
  }, 45_000);

  it("an order refunded before the job runs is settled without running the rule", async () => {
    const f = await fixture({ trigger: "payment_paid" });
    const c = await paidCheckout(f);
    await duringSave(f, () => c.paid());
    await db.commerceOrder.update({ where: { id: c.orderId }, data: { refundedAmountCents: PRICE_CENTS } });
    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "settled" }] });
    expect(await logsOf(f)).toEqual([]);
    expect(await deferredRows(f.vendor.id)).toEqual([]);
  }, 30_000);

  it("a deferred payment and the webhook-retry catch-up (#613) running at the same time: one execution (#671 review MINOR-4)", async () => {
    const f = await fixture({ trigger: "payment_paid" });
    const c = await paidCheckout(f);
    await duringSave(f, () => c.paid());
    expect(await deferredRows(f.vendor.id)).toHaveLength(1);

    // The catch-up only takes orders recorded at least 10 minutes ago: its clock is moved on.
    const [catchup, job] = await Promise.all([
      runPaymentPaidAutomationCatchup({ db: racerClient, now: new Date(Date.now() + 11 * MINUTE) }),
      runDeferredAutomationDispatches({ vendorId: f.vendor.id }),
    ]);
    expect(catchup.errors, JSON.stringify(catchup)).toBe(0);
    expect(job.results, JSON.stringify(job)).toEqual([{ status: "dispatched" }]);
    expect(await logsOf(f)).toEqual([expect.objectContaining({ eventId: `payment-paid:${c.orderId}`, status: "completed" })]);
    expect(await tagsOf(f)).toBe(1);
    expect(await db.delayedStepRun.count({ where: { vendorId: f.vendor.id } })).toBe(1);
    expect(await deferredRows(f.vendor.id)).toEqual([]);
  }, 45_000);

  it("a step-editor save that deferred the payment and edited the step after it: the rule runs, its delayed steps do not (Q-09 cut-off, #671 review MINOR-4)", async () => {
    const f = await fixture({ trigger: "payment_paid" });
    const c = await paidCheckout(f);
    // The save edits the step last, after the payment was recorded (it held the rule meanwhile).
    await duringSave(f, () => c.paid(), {
      beforeCommit: (tx) => tx.automationRuleStep.update({ where: { id: f.step.id }, data: { delayMinutes: 180 } }),
    });
    const step = await db.automationRuleStep.findUniqueOrThrow({ where: { id: f.step.id } });
    const paidEvent = await db.commerceOrderEvent.findFirstOrThrow({ where: { orderId: c.orderId, eventType: "payment.paid" } });
    expect(step.updatedAt.getTime()).toBeGreaterThan(paidEvent.createdAt.getTime());

    await expect(runDeferredAutomationDispatches({ vendorId: f.vendor.id })).resolves.toEqual({ expired: 0, results: [{ status: "dispatched" }] });
    expect(await logsOf(f)).toEqual([expect.objectContaining({ status: "completed", delayedStepsPendingSubjectId: null })]);
    expect(await tagsOf(f)).toBe(1);
    expect(await db.delayedStepRun.count({ where: { vendorId: f.vendor.id } })).toBe(0);
  }, 30_000);
});
