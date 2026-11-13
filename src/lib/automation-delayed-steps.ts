import { Prisma, type PrismaClient } from "@prisma/client";
import {
  AVAILABLE_AUTOMATION_TRIGGERS,
  executeAutomationStep,
  isAvailableAutomationTrigger,
  parseAutomationRule,
  automationStepEventId,
  type AutomationEvent,
} from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { isLockTimeout } from "@/lib/serializable-retry";
import {
  cancelLeasedRun,
  DELAYED_STEP_LEASE_MS,
  DELAYED_STEP_STALE_AFTER_MS,
  LeaseLostError,
  leaseWhere,
  reportDelayedStepFailure,
  utcTimestamp,
  type DelayedStepResult,
  type Lease,
} from "@/lib/delayed-step-runs";

/**
 * F-4 PR 2: delayed steps of automation rules (docs/product/delayed-steps-
 * design.md §8). A rule's immediate actions run inside the triggering request
 * (automation-workflow.ts); its AutomationRuleStep rows run later, one
 * DelayedStepRun per rule and event, advanced by the shared worker
 * (processDueDelayedStepRuns) on the same lease, lateness, retry and quota
 * rules as e-mail sequences. Every step's position is its delay from the
 * event, so editing steps while people are part-way through is deterministic
 * (§3「步驟的定位方式」).
 */

/** 1 hour: the job's precision (§3「時間精度」); the back office offers hours and days only. */
export const AUTOMATION_STEP_MIN_DELAY_MINUTES = 60;
/** 90 days, the same ceiling as an e-mail sequence step (CHECK AutomationRuleStep_delayMinutes_check). */
export const AUTOMATION_STEP_MAX_DELAY_MINUTES = 129_600;
/** Delayed steps per rule, the same as e-mail sequence steps per sequence. */
export const MAX_AUTOMATION_RULE_STEPS = 10;

type Database = PrismaClient;

class RuleGoneError extends Error {
  constructor() {
    super("Automation rule is gone.");
    this.name = "RuleGoneError";
  }
}

type AutomationSubject = {
  subjectId: string;
  recipientEmail?: string;
  consultationUrl?: string;
};

/**
 * The run's subject, read again now and bound to the vendor. A registration
 * that is still unverified keeps its run but gets no e-mail from this step
 * (the e-mail action records `recipient_not_linked`): the delayed steps never
 * mail an address its owner has not confirmed. A booking the merchant
 * cancelled ends a `consultation_booked` run.
 */
async function readSubject(
  db: Pick<Database, "formSubmission" | "consultationBooking">,
  vendorId: string,
  trigger: string,
  run: { formSubmissionId: string | null; consultationBookingId: string | null },
): Promise<AutomationSubject | null> {
  if (trigger === "form_registered") {
    if (!run.formSubmissionId) return null;
    const submission = await db.formSubmission.findFirst({
      where: { id: run.formSubmissionId, form: { vendorId } },
      select: { id: true, email: true, verificationStatus: true },
    });
    if (!submission) return null;
    return { subjectId: submission.id, ...(submission.verificationStatus === "VERIFIED" ? { recipientEmail: submission.email } : {}) };
  }
  if (trigger === "consultation_booked" || trigger === "consultation_no_show") {
    if (!run.consultationBookingId) return null;
    const booking = await db.consultationBooking.findFirst({
      where: { id: run.consultationBookingId, vendorId },
      select: { id: true, clientEmail: true, meetingUrl: true, status: true },
    });
    if (!booking) return null;
    if (trigger === "consultation_booked" && booking.status === "cancelled") return null;
    return { subjectId: booking.id, recipientEmail: booking.clientEmail, ...(booking.meetingUrl ? { consultationUrl: booking.meetingUrl } : {}) };
  }
  return null;
}

/** E-mails a step's actions would queue (the worker only starts it when the round's quota has room for all of them). */
export function automationStepEmailCount(actions: unknown) {
  return Array.isArray(actions)
    ? actions.filter((action) => Boolean(action) && typeof action === "object" && (action as { type?: unknown }).type === "send_email_notification").length
    : 0;
}

/**
 * Moves the cursor to `cursorDelayMinutes` and waits for the first active step
 * after it, or completes the run. In one transaction that first reads the rule
 * row FOR SHARE: a merchant saving steps holds it FOR UPDATE while it changes
 * the steps and re-times the runs, so the next step is computed from the saved
 * steps and never overwrites the save's re-timing with an older reading.
 */
async function settleRun(
  db: Database,
  lease: Lease,
  run: { anchorAt: Date; ruleId: string },
  cursorDelayMinutes: number,
  status: DelayedStepResult["status"],
  emailsQueued = 0,
): Promise<DelayedStepResult> {
  try {
    await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AutomationRule" WHERE "id" = ${run.ruleId} AND "vendorId" = ${lease.vendorId} FOR SHARE
      `;
      if (locked.length === 0) throw new RuleGoneError();
      const next = await tx.automationRuleStep.findFirst({
        where: { vendorId: lease.vendorId, ruleId: run.ruleId, isActive: true, delayMinutes: { gt: cursorDelayMinutes } },
        orderBy: { delayMinutes: "asc" },
        select: { delayMinutes: true },
      });
      const data: Prisma.DelayedStepRunUpdateManyMutationInput = next
        ? { cursorDelayMinutes, nextRunAt: new Date(run.anchorAt.getTime() + next.delayMinutes * 60_000), claimedAt: null, attemptCount: 0 }
        : { cursorDelayMinutes, status: "completed", nextRunAt: null, claimedAt: null, attemptCount: 0 };
      const updated = await tx.delayedStepRun.updateMany({ where: leaseWhere(lease), data });
      if (updated.count !== 1) throw new LeaseLostError();
    });
    return { runId: lease.id, status, ...(emailsQueued > 0 ? { emailsQueued } : {}) };
  } catch (error) {
    if (error instanceof LeaseLostError) return { runId: lease.id, status: "claimed_elsewhere", ...(emailsQueued > 0 ? { emailsQueued } : {}) };
    if (error instanceof RuleGoneError) return cancelLeasedRun(db, lease, "definition_deleted");
    throw error;
  }
}

/**
 * One due automation run, already leased by processDueDelayedStepRuns (which
 * passes `emailRoom`, the e-mails the round may still create). The worker
 * takes no id from outside: vendorId comes from the run and every read below
 * is bound to it.
 */
export async function processClaimedAutomationRun(
  db: Database,
  lease: Lease,
  now: Date,
  emailRoom: number,
): Promise<DelayedStepResult> {
  const run = await db.delayedStepRun.findFirst({
    where: { id: lease.id, vendorId: lease.vendorId, status: "active", automationRuleId: { not: null } },
    select: { id: true, anchorAt: true, automationRuleId: true, formSubmissionId: true, consultationBookingId: true, subjectKeyHash: true },
  });
  if (!run?.automationRuleId || !run.subjectKeyHash) return { runId: lease.id, status: "claimed_elsewhere" };
  const rule = await db.automationRule.findFirst({
    where: { id: run.automationRuleId, vendorId: lease.vendorId },
    select: {
      id: true,
      trigger: true,
      isActive: true,
      steps: {
        where: { vendorId: lease.vendorId, isActive: true, delayMinutes: { gt: lease.cursorDelayMinutes } },
        orderBy: { delayMinutes: "asc" },
        take: 1,
        select: { id: true, delayMinutes: true, condition: true, actions: true },
      },
    },
  });
  if (!rule) return cancelLeasedRun(db, lease, "definition_deleted");
  // A switched-off rule, or one whose trigger was hidden from merchants
  // (AVAILABLE_AUTOMATION_TRIGGERS), stops; switching it on again does not
  // revive the run (the same as a paused sequence).
  if (!rule.isActive || !isAvailableAutomationTrigger(rule.trigger)) return cancelLeasedRun(db, lease, "definition_paused");
  const subject = await readSubject(db, lease.vendorId, rule.trigger, run);
  if (!subject) return cancelLeasedRun(db, lease, "subject_gone");

  const settle = { anchorAt: run.anchorAt, ruleId: rule.id };
  const [step] = rule.steps;
  // No step left after the cursor: settleRun completes the run.
  if (!step) return settleRun(db, lease, settle, lease.cursorDelayMinutes, "completed");
  const dueAt = new Date(run.anchorAt.getTime() + step.delayMinutes * 60_000);
  // The step moved later (or an earlier one was switched off): wait for it.
  if (dueAt > now) return settleRun(db, lease, settle, lease.cursorDelayMinutes, "rescheduled");
  if (now.getTime() - dueAt.getTime() > DELAYED_STEP_STALE_AFTER_MS) return settleRun(db, lease, settle, step.delayMinutes, "skipped_stale");
  if (!parseAutomationRule({ id: rule.id, condition: step.condition, actions: step.actions })) {
    // Stored outside the current schema: retrying cannot fix it.
    reportDelayedStepFailure(new Error("Stored automation step does not parse."), "automation_step_invalid", "skipped");
    return settleRun(db, lease, settle, step.delayMinutes, "skipped_invalid");
  }

  // The step's e-mails must fit into what this round may still create (the
  // sequence queue cap, §3「吞吐量」). If they do not, give the lease back
  // without using an attempt; the run stays due for a later round.
  if (automationStepEmailCount(step.actions) > emailRoom) {
    const released = await db.delayedStepRun.updateMany({
      where: leaseWhere(lease),
      data: { claimedAt: null, attemptCount: Math.max(0, lease.attemptCount - 1) },
    });
    return { runId: lease.id, status: released.count === 1 ? "waiting_capacity" : "claimed_elsewhere" };
  }

  const event: AutomationEvent = {
    vendorId: lease.vendorId,
    eventId: automationStepEventId(run.id, step.id),
    trigger: rule.trigger as AutomationEvent["trigger"],
    subjectType: "buyer_registration",
    subjectId: subject.subjectId,
    subjectKeyHash: run.subjectKeyHash,
    ...(subject.recipientEmail ? { recipientEmail: subject.recipientEmail } : {}),
    ...(subject.consultationUrl ? { consultationUrl: subject.consultationUrl } : {}),
  };
  const outcome = await executeAutomationStep(db, {
    ruleId: rule.id,
    runId: run.id,
    stepId: step.id,
    condition: step.condition,
    actions: step.actions,
    event,
  });
  if (outcome.status === "rule_deleted") return cancelLeasedRun(db, lease, "definition_deleted");
  if (outcome.status === "failed") {
    // The lease stays: the run is claimable again after DELAYED_STEP_LEASE_MS
    // and the same step resumes on the same execution log (nothing repeats).
    // After DELAYED_STEP_MAX_ATTEMPTS claims it is cancelled as `failed`.
    reportDelayedStepFailure(new Error("Delayed automation step failed."), "automation_step", "failed");
    return { runId: lease.id, status: "failed", ...(outcome.emailsQueued > 0 ? { emailsQueued: outcome.emailsQueued } : {}) };
  }
  const status: DelayedStepResult["status"] = outcome.status === "skipped"
    ? "condition_not_met"
    : outcome.status === "already_done"
      ? "skipped_already_sent"
      : outcome.status === "invalid_step" ? "skipped_invalid" : "executed";
  return settleRun(db, lease, settle, step.delayMinutes, status, outcome.emailsQueued);
}

/**
 * Steps more than 24 hours late are skipped in bulk before any run is claimed,
 * like skipStaleSteps does for sequences: they run nothing, so they must not
 * take a vendor's turn. Each pass moves every such run past one step. The
 * rules involved are read FOR SHARE first, in the same transaction, so a
 * merchant save (rule FOR UPDATE) and this pass never interleave.
 */
export async function skipStaleAutomationSteps(db: Database, now: Date, vendorId: string | undefined, pastDeadline: () => boolean, maxPasses: number) {
  const staleBefore = new Date(now.getTime() - DELAYED_STEP_STALE_AFTER_MS);
  const leaseCutoff = new Date(now.getTime() - DELAYED_STEP_LEASE_MS);
  const triggers = [...AVAILABLE_AUTOMATION_TRIGGERS] as string[];
  let skipped = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (pastDeadline()) break;
    const updated = await db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT q."id" FROM "AutomationRule" q
        JOIN "Vendor" v ON v."id" = q."vendorId"
        WHERE q."isActive"
          AND q."trigger" = ANY(${triggers}::text[])
          ${vendorId ? Prisma.sql`AND q."vendorId" = ${vendorId}` : Prisma.empty}
          AND v."suspendedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "DelayedStepRun" r
            WHERE r."vendorId" = q."vendorId" AND r."automationRuleId" = q."id"
              AND r."status" = 'active' AND r."nextRunAt" <= ${utcTimestamp(now)}
          )
        ORDER BY q."id"
        FOR SHARE OF q
      `;
      return tx.$executeRaw`
      WITH due AS (
        SELECT r."id",
          (
            SELECT MIN(s."delayMinutes") FROM "AutomationRuleStep" s
            WHERE s."vendorId" = r."vendorId" AND s."ruleId" = r."automationRuleId"
              AND s."isActive" AND s."delayMinutes" > r."cursorDelayMinutes"
          ) AS "nextDelay"
        FROM "DelayedStepRun" r
        JOIN "AutomationRule" q ON q."id" = r."automationRuleId" AND q."vendorId" = r."vendorId"
          AND q."isActive" AND q."trigger" = ANY(${triggers}::text[])
        JOIN "Vendor" v ON v."id" = r."vendorId"
        WHERE r."status" = 'active'
          ${vendorId ? Prisma.sql`AND r."vendorId" = ${vendorId}` : Prisma.empty}
          AND r."nextRunAt" <= ${utcTimestamp(now)}
          AND (r."claimedAt" IS NULL OR r."claimedAt" <= ${utcTimestamp(leaseCutoff)})
          AND v."suspendedAt" IS NULL
      )
      UPDATE "DelayedStepRun" AS r
      SET "cursorDelayMinutes" = due."nextDelay",
          "nextRunAt" = COALESCE(
            r."anchorAt" + make_interval(mins => (
              SELECT MIN(s."delayMinutes") FROM "AutomationRuleStep" s
              WHERE s."vendorId" = r."vendorId" AND s."ruleId" = r."automationRuleId"
                AND s."isActive" AND s."delayMinutes" > due."nextDelay"
            )),
            ${utcTimestamp(now)}
          ),
          "claimedAt" = NULL,
          "updatedAt" = ${utcTimestamp(now)}
      FROM due
      WHERE r."id" = due."id"
        AND r."status" = 'active'
        AND due."nextDelay" IS NOT NULL
        AND r."anchorAt" + make_interval(mins => due."nextDelay") < ${utcTimestamp(staleBefore)}
    `;
    });
    skipped += updated;
    if (updated === 0) break;
  }
  return skipped;
}

/**
 * After a rule's steps change, every active run waits for the first active
 * step after its cursor at the new time. A run with no step left is due now so
 * the worker completes it. Caller holds the rule row FOR UPDATE.
 */
export async function rescheduleActiveRunsForAutomationRule(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: { vendorId: string; ruleId: string; now: Date },
) {
  return tx.$executeRaw`
    UPDATE "DelayedStepRun" AS r
    SET "nextRunAt" = COALESCE(
          r."anchorAt" + make_interval(mins => (
            SELECT MIN(s."delayMinutes")
            FROM "AutomationRuleStep" s
            WHERE s."vendorId" = r."vendorId"
              AND s."ruleId" = r."automationRuleId"
              AND s."isActive"
              AND s."delayMinutes" > r."cursorDelayMinutes"
          )),
          ${utcTimestamp(input.now)}
        ),
        "updatedAt" = ${utcTimestamp(input.now)}
    WHERE r."vendorId" = ${input.vendorId}
      AND r."automationRuleId" = ${input.ruleId}
      AND r."status" = 'active'
  `;
}

// ---------------------------------------------------------------------------
// Merchant-side step changes (Server Actions in src/app/actions/automation-actions.ts).
// ---------------------------------------------------------------------------

export type AutomationStepInput = {
  delayMinutes: number;
  condition: unknown;
  actions: unknown[];
  isActive: boolean;
};

export type AutomationStepChangeResult =
  | { ok: true; id: string; before?: { delayMinutes: number; isActive: boolean; actions: unknown }; after?: { delayMinutes: number; isActive: boolean; actions: unknown } }
  | { ok: false; code: "not_found" | "trigger_unavailable" | "invalid_step" | "invalid_delay" | "duplicate_delay" | "step_limit" | "invalid_product" | "step_busy" };

class StepChangeRejected extends Error {
  constructor(readonly code: Extract<AutomationStepChangeResult, { ok: false }>["code"]) {
    super(code);
    this.name = "StepChangeRejected";
  }
}

/** A change waits at most this long for the worker or another tab holding the rule row. */
const STEP_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * Every step change: in one transaction, the rule row is locked FOR UPDATE
 * (bound to the vendor), so two tabs, the worker's settle (FOR SHARE) and the
 * stale-step pass serialize on it; then the change, then every active run of
 * the rule is re-timed (§3「步驟的定位方式」).
 */
async function withLockedRule(
  db: Database,
  input: { vendorId: string; ruleId: string; now: Date; requireAvailableTrigger: boolean },
  change: (tx: Prisma.TransactionClient, rule: { id: string; trigger: string }) => Promise<Extract<AutomationStepChangeResult, { ok: true }>>,
): Promise<AutomationStepChangeResult> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      const locked = await tx.$queryRaw<Array<{ id: string; trigger: string }>>`
        SELECT "id", "trigger" FROM "AutomationRule" WHERE "id" = ${input.ruleId} AND "vendorId" = ${input.vendorId} FOR UPDATE
      `;
      const rule = locked[0];
      if (!rule) throw new StepChangeRejected("not_found");
      if (input.requireAvailableTrigger && !isAvailableAutomationTrigger(rule.trigger)) throw new StepChangeRejected("trigger_unavailable");
      const result = await change(tx, rule);
      await rescheduleActiveRunsForAutomationRule(tx, { vendorId: input.vendorId, ruleId: rule.id, now: input.now });
      return result;
    }, STEP_TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof StepChangeRejected) return { ok: false, code: error.code };
    if (isBusy(error)) return { ok: false, code: "step_busy" };
    throw error;
  }
}

/** lock_timeout (55P03) on the rule row, or the transaction could not start or finish in time (P2028). */
function isBusy(error: unknown) {
  return isLockTimeout(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028");
}

async function validateStep(tx: Prisma.TransactionClient, vendorId: string, ruleId: string, input: AutomationStepInput) {
  if (!Number.isInteger(input.delayMinutes) || input.delayMinutes < AUTOMATION_STEP_MIN_DELAY_MINUTES || input.delayMinutes > AUTOMATION_STEP_MAX_DELAY_MINUTES) {
    throw new StepChangeRejected("invalid_delay");
  }
  const parsed = parseAutomationRule({ id: ruleId, condition: input.condition, actions: input.actions });
  if (!parsed) throw new StepChangeRejected("invalid_step");
  // A voucher can only name an active product of this vendor.
  for (const action of parsed.actions) {
    if (action.type !== "issue_repurchase_voucher") continue;
    const product = await tx.product.findFirst({ where: { id: action.productId, vendorId, isActive: true }, select: { id: true } });
    if (!product) throw new StepChangeRejected("invalid_product");
  }
  return parsed;
}

async function assertDelayFree(tx: Prisma.TransactionClient, vendorId: string, ruleId: string, delayMinutes: number, exceptStepId?: string) {
  const taken = await tx.automationRuleStep.findFirst({
    where: { vendorId, ruleId, delayMinutes, ...(exceptStepId ? { id: { not: exceptStepId } } : {}) },
    select: { id: true },
  });
  if (taken) throw new StepChangeRejected("duplicate_delay");
}

export async function createAutomationRuleStep(
  input: { vendorId: string; ruleId: string; step: AutomationStepInput; now?: Date },
  db: Database = getDb(),
): Promise<AutomationStepChangeResult> {
  return withLockedRule(db, { vendorId: input.vendorId, ruleId: input.ruleId, now: input.now ?? new Date(), requireAvailableTrigger: true }, async (tx, rule) => {
    const count = await tx.automationRuleStep.count({ where: { vendorId: input.vendorId, ruleId: rule.id } });
    if (count >= MAX_AUTOMATION_RULE_STEPS) throw new StepChangeRejected("step_limit");
    const parsed = await validateStep(tx, input.vendorId, rule.id, input.step);
    await assertDelayFree(tx, input.vendorId, rule.id, input.step.delayMinutes);
    const created = await tx.automationRuleStep.create({
      data: {
        vendorId: input.vendorId,
        ruleId: rule.id,
        delayMinutes: input.step.delayMinutes,
        condition: parsed.condition as Prisma.InputJsonValue,
        actions: parsed.actions as Prisma.InputJsonArray,
        isActive: input.step.isActive,
      },
      select: { id: true, delayMinutes: true, isActive: true, actions: true },
    });
    return { ok: true, id: created.id, after: { delayMinutes: created.delayMinutes, isActive: created.isActive, actions: created.actions } };
  });
}

/**
 * Edits a step in place: it keeps its id also when its delay changes, and the
 * id is part of every execution's identity (one execution log per run and
 * step), so moving a step a person already received never runs it for them
 * again (#598 review B1).
 */
export async function updateAutomationRuleStep(
  input: { vendorId: string; ruleId: string; stepId: string; step: AutomationStepInput; now?: Date },
  db: Database = getDb(),
): Promise<AutomationStepChangeResult> {
  return withLockedRule(db, { vendorId: input.vendorId, ruleId: input.ruleId, now: input.now ?? new Date(), requireAvailableTrigger: true }, async (tx, rule) => {
    const existing = await tx.automationRuleStep.findFirst({
      where: { id: input.stepId, vendorId: input.vendorId, ruleId: rule.id },
      select: { id: true, delayMinutes: true, isActive: true, actions: true },
    });
    if (!existing) throw new StepChangeRejected("not_found");
    const parsed = await validateStep(tx, input.vendorId, rule.id, input.step);
    await assertDelayFree(tx, input.vendorId, rule.id, input.step.delayMinutes, existing.id);
    const updated = await tx.automationRuleStep.updateMany({
      where: { id: existing.id, vendorId: input.vendorId, ruleId: rule.id },
      data: {
        delayMinutes: input.step.delayMinutes,
        condition: parsed.condition as Prisma.InputJsonValue,
        actions: parsed.actions as Prisma.InputJsonArray,
        isActive: input.step.isActive,
      },
    });
    if (updated.count !== 1) throw new StepChangeRejected("not_found");
    return {
      ok: true,
      id: existing.id,
      before: { delayMinutes: existing.delayMinutes, isActive: existing.isActive, actions: existing.actions },
      after: { delayMinutes: input.step.delayMinutes, isActive: input.step.isActive, actions: parsed.actions },
    };
  });
}

/** Deleting a step lets every run go on with the next one; it is allowed whatever the rule's trigger (like switching a rule off). */
export async function deleteAutomationRuleStep(
  input: { vendorId: string; ruleId: string; stepId: string; now?: Date },
  db: Database = getDb(),
): Promise<AutomationStepChangeResult> {
  return withLockedRule(db, { vendorId: input.vendorId, ruleId: input.ruleId, now: input.now ?? new Date(), requireAvailableTrigger: false }, async (tx, rule) => {
    const existing = await tx.automationRuleStep.findFirst({
      where: { id: input.stepId, vendorId: input.vendorId, ruleId: rule.id },
      select: { id: true, delayMinutes: true, isActive: true, actions: true },
    });
    if (!existing) throw new StepChangeRejected("not_found");
    await tx.automationRuleStep.deleteMany({ where: { id: existing.id, vendorId: input.vendorId, ruleId: rule.id } });
    return { ok: true, id: existing.id, before: { delayMinutes: existing.delayMinutes, isActive: existing.isActive, actions: existing.actions } };
  });
}

export type AutomationRuleRunCounts = { active: number; completed: number; cancelled: number };

/** 進行中／完成／停止 per rule, for this vendor only. */
export async function automationRuleRunCounts(vendorId: string, db: Database = getDb()) {
  const rows = await db.delayedStepRun.groupBy({
    by: ["automationRuleId", "status"],
    where: { vendorId, automationRuleId: { not: null } },
    _count: { _all: true },
  });
  const counts = new Map<string, AutomationRuleRunCounts>();
  for (const row of rows) {
    if (!row.automationRuleId) continue;
    const entry = counts.get(row.automationRuleId) ?? { active: 0, completed: 0, cancelled: 0 };
    if (row.status === "active" || row.status === "completed" || row.status === "cancelled") entry[row.status] += row._count._all;
    counts.set(row.automationRuleId, entry);
  }
  return counts;
}
