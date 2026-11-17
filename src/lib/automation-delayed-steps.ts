import { Prisma, type PrismaClient } from "@prisma/client";
import {
  AUTOMATION_DELAYED_STEPS_FEATURE,
  AUTOMATION_FORM_NO_SHOW_FEATURE,
  DELAYED_STEP_AUTOMATION_TRIGGERS,
  automationTriggerSupportsDelayedSteps,
  executeAutomationStep,
  plannedAutomationStepEmailCount,
  isAutomationTriggerAvailableForVendor,
  formNoShowWebinarUrl,
  AUTOMATION_REPLAY_VIDEO_SELECT,
  parseAutomationRule,
  automationStepEventId,
  startDelayedSteps,
  type AutomationEvent,
  type DelayedStepStartOutcome,
} from "@/lib/automation-workflow";
import {
  automationActionsSendLine,
  LINE_PUSH_OWNER_ONLY,
  storedAutomationRuleSendsLine,
  withVoucherLineNotification,
} from "@/lib/automation-line-push-policy";
import { reportCancelledRuleLockWait } from "@/lib/automation-rule-lock";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { automationCustomerKeyHash } from "@/lib/customer-key-hash";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";
import { PAYMENT_PAID_RUN_ORDER_SELECT, paymentPaidRunOrderCounts } from "@/lib/payment-paid-run-order";
import { isRuleWriteBusy } from "@/lib/serializable-retry";
import {
  cancelLeasedRun,
  DELAYED_STEP_LEASE_MS,
  DELAYED_STEP_STALE_AFTER_MS,
  LeaseLostError,
  leaseWhere,
  processDueDelayedStepRuns,
  reportDelayedStepFailure,
  utcTimestamp,
  type AutomationRunProcessor,
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

/**
 * Claims a step whose recorded snapshot does not parse gets before its run is
 * stopped (Q-12, review MINOR-1): one retry after the lease expires, in case
 * the first claim ran on a build that cannot read a newer snapshot.
 */
export const AUTOMATION_SNAPSHOT_INVALID_ATTEMPTS = 2;

type Database = PrismaClient;

class RuleGoneError extends Error {
  constructor() {
    super("Automation rule is gone.");
    this.name = "RuleGoneError";
  }
}

type AutomationSubject = {
  subjectType: AutomationEvent["subjectType"];
  subjectId: string;
  /** Absent when an order's buyer e-mail cannot be read: the e-mail action then records `recipient_not_linked`. */
  recipientEmail?: string;
  /** Someone confirmed `recipientEmail` at this vendor (M2). */
  recipientVerified: boolean;
  consultationUrl?: string;
  webinarUrl?: string;
  /** payment_paid (Q-09): the server's paid amount, for a step condition only. */
  orderAmountCents?: number;
  currency?: string;
};

/** The order's vendor was suspended after the worker claimed the run: nothing runs and the run is kept. */
const VENDOR_SUSPENDED = "vendor_suspended" as const;

/**
 * Q-09: the buyer e-mail of an order counts as confirmed only when the
 * vendor's own records show that someone controls that mailbox: a VERIFIED
 * registration with exactly the same address (hasVerifiedRegistration, the
 * same rule as a consultation booking), or a learner who signed in to the
 * vendor's student portal with it (a consumed `magic_link` token: the link was
 * e-mailed to that address and opened). Paying proves neither: checkout takes
 * whatever address is typed and nothing confirms it. The portal check uses
 * the customer key (automationCustomerKeyHash, trim + lowercase), bound to the
 * vendor, through the (vendorId, customerKeyHash, expiresAt) index; a
 * signed-out learner (row deleted) no longer counts.
 */
async function buyerEmailConfirmed(
  db: Pick<Database, "$queryRaw" | "studentPortalAccessToken">,
  vendorId: string,
  email: string,
) {
  if (await hasVerifiedRegistration(db, vendorId, email)) return true;
  const signedIn = await db.studentPortalAccessToken.findFirst({
    where: { vendorId, customerKeyHash: automationCustomerKeyHash(vendorId, email), purpose: "magic_link", consumedAt: { not: null } },
    select: { id: true },
  });
  return Boolean(signedIn);
}

/** The buyer e-mail from the order's encrypted envelope, or undefined (reported, no id) when it cannot be read. */
function orderBuyerEmail(order: { id: string; buyerEncryptedEnvelope: string; shippingEncryptedEnvelope: string | null }, vendorId: string) {
  try {
    const email = revealCommerceOrderPii({
      buyerEncrypted: order.buyerEncryptedEnvelope,
      shippingEncrypted: order.shippingEncryptedEnvelope,
    }, { vendorId, orderId: order.id }).buyer.email;
    return email || undefined;
  } catch (error) {
    try {
      captureOperationalError(error, { source: "automation_delayed_steps", operation: "buyer_email" });
    } catch {
      // Monitoring must never change the step's outcome.
    }
    return undefined;
  }
}

/**
 * M2: a booking's address is typed into the public booking form and nobody
 * confirms it there. It counts as confirmed only when this vendor has a
 * VERIFIED registration with exactly the same address after the customer-key
 * normalization (trim + lowercase, automationCustomerKeyHash), bound through
 * the registration's form (review MINOR-1: an exact match, no fuzzy candidates).
 * The expression and the VERIFIED predicate must stay exactly as written: they
 * match the partial index FormSubmission_verified_email_normalized_idx (Q-12),
 * without which this lookup scans the whole FormSubmission table.
 */
async function hasVerifiedRegistration(db: Pick<Database, "$queryRaw">, vendorId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT f."id" FROM "FormSubmission" f
    JOIN "RegistrationForm" rf ON rf."id" = f."formId"
    WHERE rf."vendorId" = ${vendorId}
      AND f."verificationStatus" = 'VERIFIED'
      AND lower(btrim(f."email")) = ${normalized}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * The run's subject, read again now and bound to the vendor.
 * - `form_registered`: the registration; its e-mail counts as confirmed once it
 *   is VERIFIED.
 * - `form_no_show` (Q-11): the same registration (always VERIFIED when its run
 *   started), with its Live's viewer page as `{{webinar_url}}` while the
 *   replay is open (otherwise the replay e-mail is skipped as
 *   `replay_unavailable`). Once the registrant has been admitted to play the
 *   Live after the run started (LiveRegistrationAttendance.lastAdmittedAt >
 *   anchorAt), they are no longer a no-show and the run ends (review m-7).
 * - consultation triggers: the booking; its address counts as confirmed only
 *   with a verified registration of the same address (M2). A
 *   `consultation_booked` run ends once the booking is cancelled or marked
 *   no-show (a follow-up of a completed consultation goes on). A
 *   `consultation_no_show` run starts from a no-show booking, whose status
 *   no action changes any more, so only a deleted booking ends it.
 * - `payment_paid` (Q-09): the order, bound to the vendor. The run ends
 *   (`subject_gone`) once the order no longer counts as a purchase: fully
 *   refunded, cancelled or a test order (paymentPaidRunOrderCounts; a partial
 *   refund goes on). The buyer e-mail is decrypted now (never stored on the
 *   run) and counts as confirmed only per buyerEmailConfirmed. A vendor
 *   suspended after the run was claimed gets VENDOR_SUSPENDED: nothing runs
 *   and the run is kept, like every run of a suspended vendor.
 * An unconfirmed address keeps the run: the step's e-mail action is skipped as
 * `recipient_unverified` and its other actions run.
 */
async function readSubject(
  db: Pick<Database, "formSubmission" | "consultationBooking" | "liveRegistrationAttendance" | "commerceOrder" | "studentPortalAccessToken" | "$queryRaw">,
  vendorId: string,
  trigger: string,
  run: { formSubmissionId: string | null; consultationBookingId: string | null; commerceOrderId: string | null; subjectKeyHash: string; anchorAt: Date },
  now: Date,
): Promise<AutomationSubject | typeof VENDOR_SUSPENDED | null> {
  if (trigger === "form_registered") {
    if (!run.formSubmissionId) return null;
    const submission = await db.formSubmission.findFirst({
      where: { id: run.formSubmissionId, form: { vendorId } },
      select: { id: true, email: true, verificationStatus: true },
    });
    if (!submission) return null;
    return { subjectType: "buyer_registration", subjectId: submission.id, recipientEmail: submission.email, recipientVerified: submission.verificationStatus === "VERIFIED" };
  }
  if (trigger === "payment_paid") {
    if (!run.commerceOrderId) return null;
    const order = await db.commerceOrder.findFirst({
      where: { id: run.commerceOrderId, vendorId },
      select: {
        ...PAYMENT_PAID_RUN_ORDER_SELECT,
        currency: true,
        buyerEncryptedEnvelope: true,
        shippingEncryptedEnvelope: true,
        vendor: { select: { suspendedAt: true } },
      },
    });
    if (!order || !paymentPaidRunOrderCounts(order)) return null;
    if (order.vendor.suspendedAt) return VENDOR_SUSPENDED;
    const recipientEmail = orderBuyerEmail(order, vendorId);
    return {
      subjectType: "buyer_order",
      subjectId: order.id,
      ...(recipientEmail ? { recipientEmail } : {}),
      recipientVerified: recipientEmail ? await buyerEmailConfirmed(db, vendorId, recipientEmail) : false,
      orderAmountCents: order.paidAmountCents,
      currency: order.currency,
    };
  }
  if (trigger === "form_no_show") {
    if (!run.formSubmissionId) return null;
    const submission = await db.formSubmission.findFirst({
      where: { id: run.formSubmissionId, form: { vendorId } },
      select: {
        id: true,
        email: true,
        verificationStatus: true,
        live: { select: { vendorId: true, slug: true, replayEnabled: true, replayAvailableUntil: true, sessionReplayWindowHours: true, video: { select: AUTOMATION_REPLAY_VIDEO_SELECT } } },
        liveSession: { select: { vendorId: true, startAt: true } },
      },
    });
    if (!submission) return null;
    const watched = await db.liveRegistrationAttendance.findFirst({
      where: { vendorId, formSubmissionId: submission.id, lastAdmittedAt: { gt: run.anchorAt } },
      select: { id: true },
    });
    if (watched) return null;
    const live = submission.live?.vendorId === vendorId ? submission.live : null;
    const session = submission.liveSession?.vendorId === vendorId ? submission.liveSession : null;
    const webinarUrl = live ? formNoShowWebinarUrl(live, session, now) : undefined;
    return {
      subjectType: "buyer_registration",
      subjectId: submission.id,
      recipientEmail: submission.email,
      recipientVerified: submission.verificationStatus === "VERIFIED",
      ...(webinarUrl ? { webinarUrl } : {}),
    };
  }
  if (trigger === "consultation_booked" || trigger === "consultation_no_show") {
    if (!run.consultationBookingId) return null;
    const booking = await db.consultationBooking.findFirst({
      where: { id: run.consultationBookingId, vendorId },
      select: { id: true, clientEmail: true, meetingUrl: true, status: true },
    });
    if (!booking) return null;
    if (trigger === "consultation_booked" && (booking.status === "cancelled" || booking.status === "no_show")) return null;
    return {
      subjectType: "buyer_registration",
      subjectId: booking.id,
      recipientEmail: booking.clientEmail,
      recipientVerified: await hasVerifiedRegistration(db, vendorId, booking.clientEmail),
      ...(booking.meetingUrl ? { consultationUrl: booking.meetingUrl } : {}),
    };
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

/** Gives the lease back without using an attempt; the run stays due for a later round. */
async function releaseLease(db: Database, lease: Lease, status: "rescheduled" | "waiting_capacity"): Promise<DelayedStepResult> {
  const released = await db.delayedStepRun.updateMany({
    where: leaseWhere(lease),
    data: { claimedAt: null, attemptCount: Math.max(0, lease.attemptCount - 1) },
  });
  return { runId: lease.id, status: released.count === 1 ? status : "claimed_elsewhere" };
}

/** The event a delayed step runs with: rebuilt from the run's references and the subject read now, never the original event. */
function stepEvent(vendorId: string, trigger: string, eventId: string, subjectKeyHash: string, subject: AutomationSubject): AutomationEvent {
  return {
    vendorId,
    eventId,
    trigger: trigger as AutomationEvent["trigger"],
    // The order for payment_paid (its LINE identity is bound to the order), else the registration or booking.
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    subjectKeyHash,
    ...(subject.recipientEmail ? { recipientEmail: subject.recipientEmail } : {}),
    recipientVerified: subject.recipientVerified,
    ...(subject.consultationUrl ? { consultationUrl: subject.consultationUrl } : {}),
    ...(subject.webinarUrl ? { webinarUrl: subject.webinarUrl } : {}),
    // payment_paid: the server's paid amount (and currency), read now, for a step condition only.
    ...(subject.orderAmountCents !== undefined ? { orderAmountCents: subject.orderAmountCents } : {}),
    ...(subject.currency ? { currency: subject.currency } : {}),
  };
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
    select: { id: true, anchorAt: true, automationRuleId: true, formSubmissionId: true, consultationBookingId: true, commerceOrderId: true, subjectKeyHash: true },
  });
  if (!run?.automationRuleId) return { runId: lease.id, status: "claimed_elsewhere" };
  // The CHECK guarantees the customer key; without it no tag could be written.
  if (!run.subjectKeyHash) return cancelLeasedRun(db, lease, "subject_gone");
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
  // (AVAILABLE_AUTOMATION_TRIGGERS) or takes no delayed steps
  // (DELAYED_STEP_AUTOMATION_TRIGGERS), stops; switching it
  // on again does not revive the run (the same as a paused sequence).
  // form_no_show also stops once the vendor's closed-beta grant is closed (Q-11 M-1).
  const vendor = rule.trigger === "form_no_show"
    ? await db.vendor.findUnique({ where: { id: lease.vendorId }, select: { betaFeatureGrants: true } })
    : null;
  if (!rule.isActive || !isAutomationTriggerAvailableForVendor(rule.trigger, vendor) || !automationTriggerSupportsDelayedSteps(rule.trigger)) {
    return cancelLeasedRun(db, lease, "definition_paused");
  }
  const subject = await readSubject(db, lease.vendorId, rule.trigger, { ...run, subjectKeyHash: run.subjectKeyHash }, now);
  // Suspended between the claim and this read (the claim skips suspended
  // vendors): the run waits, unclaimed, until the vendor is resumed.
  if (subject === VENDOR_SUSPENDED) return releaseLease(db, lease, "rescheduled");
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
  // sequence queue cap, §3「吞吐量」). Counted from what the execution will
  // really run: a resumed step runs its recorded snapshot (review MINOR-2).
  // If they do not fit (also: room 0 without an e-mail provider), give the
  // lease back without using an attempt; the run stays due for a later round.
  const plannedEmails = await plannedAutomationStepEmailCount(db, {
    vendorId: lease.vendorId, ruleId: rule.id, runId: run.id, stepId: step.id, condition: step.condition, actions: step.actions,
  });
  if (plannedEmails > emailRoom) return releaseLease(db, lease, "waiting_capacity");

  const event = stepEvent(lease.vendorId, rule.trigger, automationStepEventId(run.id, step.id), run.subjectKeyHash, subject);
  const outcome = await executeAutomationStep(db, {
    ruleId: rule.id,
    runId: run.id,
    stepId: step.id,
    condition: step.condition,
    actions: step.actions,
    event,
  });
  if (outcome.status === "rule_deleted") return cancelLeasedRun(db, lease, "definition_deleted");
  // Switched off (or the run stopped) after the rule was read: nothing ran.
  if (outcome.status === "rule_inactive") return cancelLeasedRun(db, lease, "definition_paused");
  if (outcome.status === "snapshot_invalid") {
    // Q-12: the recorded action list of this step does not parse. Retrying
    // the same code cannot fix that, but a deployment hand-over or a rollback
    // can: an older build running for a moment may not read a snapshot a
    // newer one wrote (review MINOR-1; action schema changes ship in two
    // steps, see docs/domain-workflows.md). So the first time the lease is
    // kept (the run is claimed again once it expires, on whatever build runs
    // then), and the second claim stops the run with the same outcome the
    // retry limit would reach (cancelled / failed), reports once and leaves
    // the remaining attempts' budget to other runs. Its execution log says
    // why (failed / snapshot_invalid). Monitoring gets no id, only safe keys.
    if (lease.attemptCount < AUTOMATION_SNAPSHOT_INVALID_ATTEMPTS) return { runId: lease.id, status: "failed" };
    const cancelled = await cancelLeasedRun(db, lease, "failed");
    if (cancelled.status === "cancelled") {
      reportDelayedStepFailure(new Error("Recorded automation step snapshot does not parse."), "automation_step_snapshot_invalid", "cancelled");
    }
    return cancelled;
  }
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
  const triggers = [...DELAYED_STEP_AUTOMATION_TRIGGERS] as string[];
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
          AND ${AUTOMATION_DELAYED_STEPS_FEATURE} = ANY(v."betaFeatureGrants")
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
          AND ${AUTOMATION_DELAYED_STEPS_FEATURE} = ANY(v."betaFeatureGrants")
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

/**
 * Ceiling on e-mail-free due automation runs taken per round (M3); the round's
 * remaining run budget (DELAYED_STEP_BATCH_LIMIT minus what the fair loop
 * used) can make it lower.
 */
export const EMAIL_FREE_SCAN_LIMIT = 200;

/**
 * M3: due automation runs whose next active step has no e-mail action (or
 * that have no step left and only need completing). They run even while the
 * e-mail capacity is used up or no e-mail provider is configured. Same
 * vendor conditions as the fair loop: not suspended, holding the grant.
 *
 * Q-12: taken round-robin between vendors, like the payment_paid catch-up
 * (#613) and the form_no_show scan (#623): every vendor's oldest due run comes
 * before any vendor's second, then every vendor's second, and so on (within a
 * turn, the oldest due first). So one vendor with a large backlog of
 * e-mail-free steps cannot hold back another vendor's: it only gets the room
 * the others leave. At most `limit` (≤ EMAIL_FREE_SCAN_LIMIT) runs per round;
 * a vendor never gets more than `limit` either.
 */
export async function dueAutomationRunsWithoutEmail(
  db: Database,
  input: { now: Date; vendorId: string | undefined; exclude: string[]; limit: number },
) {
  const leaseCutoff = new Date(input.now.getTime() - DELAYED_STEP_LEASE_MS);
  const limit = Math.max(0, Math.min(input.limit, EMAIL_FREE_SCAN_LIMIT));
  if (limit === 0) return [];
  const rows = await db.$queryRaw<Array<{ id: string; vendorId: string; updatedAt: Date; cursorDelayMinutes: number; attemptCount: number; automationRuleId: string | null }>>`
    WITH "due" AS (
      SELECT r."id", r."vendorId", r."updatedAt", r."cursorDelayMinutes", r."attemptCount", r."automationRuleId", r."nextRunAt",
             ROW_NUMBER() OVER (PARTITION BY r."vendorId" ORDER BY r."nextRunAt" ASC, r."id" ASC) AS "vendorRank"
      FROM "DelayedStepRun" r
      JOIN "Vendor" v ON v."id" = r."vendorId"
      LEFT JOIN LATERAL (
        SELECT s."actions" FROM "AutomationRuleStep" s
        WHERE s."vendorId" = r."vendorId" AND s."ruleId" = r."automationRuleId"
          AND s."isActive" AND s."delayMinutes" > r."cursorDelayMinutes"
        ORDER BY s."delayMinutes" ASC
        LIMIT 1
      ) n ON TRUE
      WHERE r."automationRuleId" IS NOT NULL
        AND r."status" = 'active'
        AND r."nextRunAt" <= ${utcTimestamp(input.now)}
        AND (r."claimedAt" IS NULL OR r."claimedAt" <= ${utcTimestamp(leaseCutoff)})
        AND v."suspendedAt" IS NULL
        AND ${AUTOMATION_DELAYED_STEPS_FEATURE} = ANY(v."betaFeatureGrants")
        ${input.vendorId ? Prisma.sql`AND r."vendorId" = ${input.vendorId}` : Prisma.empty}
        AND NOT (r."id" = ANY(${input.exclude}::text[]))
        AND (n."actions" IS NULL OR NOT (n."actions" @> '[{"type":"send_email_notification"}]'::jsonb))
    )
    SELECT "id", "vendorId", "updatedAt", "cursorDelayMinutes", "attemptCount", "automationRuleId"
    FROM "due"
    WHERE "vendorRank" <= ${limit}
    ORDER BY "vendorRank" ASC, "nextRunAt" ASC, "id" ASC
    LIMIT ${limit}
  `;
  return rows;
}

/** The automation half of the shared worker. */
export const AUTOMATION_RUN_PROCESSOR: AutomationRunProcessor = {
  processClaimed: processClaimedAutomationRun,
  skipStale: skipStaleAutomationSteps,
  dueWithoutEmail: dueAutomationRunsWithoutEmail,
};

/**
 * The job's delayed-step worker: processDueDelayedStepRuns with the
 * automation processor, so e-mail sequence runs and automation runs share one
 * round, one lease rule and one e-mail capacity. The processor is passed in
 * (not imported by delayed-step-runs.ts) because this module reaches
 * email-delivery.ts through the automation engine, and email-delivery.ts
 * imports delayed-step-runs.ts.
 */
export function runDelayedStepWorker(
  options: Omit<NonNullable<Parameters<typeof processDueDelayedStepRuns>[0]>, "automation"> = {},
  db: Database = getDb(),
) {
  return processDueDelayedStepRuns({ ...options, automation: AUTOMATION_RUN_PROCESSOR }, db);
}

/**
 * Q-13: a run owed by an event is left to the job only after this long, so
 * the event's own attempt (right after its immediate actions, waiting at most
 * 2 s for the rule row) has long finished. Racing it would still be safe (the
 * run's unique key), just wasted work.
 */
export const PENDING_RUN_START_MIN_AGE_MS = 2 * 60_000;
/**
 * Owed runs are created for events completed within this window, the same
 * 48 hours as the e-mail sequence back-fill. A log still owing a run after it
 * (the job stopped that long, or the creation keeps failing) is left as it is:
 * steps more than 24 hours late are skipped anyway.
 */
export const PENDING_RUN_START_WINDOW_MS = 48 * 60 * 60_000;
/** Owed runs created per job round, taken round-robin between vendors. */
export const PENDING_RUN_START_LIMIT = 50;
/**
 * Review MINOR-1: the job's attempts at one owed run that end in an error
 * other than a lock wait given up. The attempt that reaches this count clears
 * the mark and reports `start_run_abandoned` once, so a log that can never get
 * its run stops taking every round's budget before its 48-hour window ends.
 */
export const PENDING_RUN_START_MAX_ATTEMPTS = 5;
/** Review NIT-2: this part of the round stops after this long, whatever the round's own deadline. */
export const PENDING_RUN_START_BUDGET_MS = 20_000;
/**
 * Review NIT-2: consecutive lock waits given up (each up to 2 s) after which
 * the round stops taking owed runs: merchants are saving right now, and the
 * logs keep their mark for the next round.
 */
export const PENDING_RUN_START_MAX_CONSECUTIVE_DEFERRED = 3;

/**
 * Q-13 (#601 review): creates the delayed-step runs events still owe — an
 * event whose run could not be created right after its immediate actions,
 * because a merchant save held the rule row past the 2 s lock timeout (or the
 * process stopped). The event marked its execution log with the subject when
 * it completed (`delayedStepsPendingSubjectId`), and only those logs are read
 * here: a rule that got its first step after the event, or a vendor granted
 * delayed steps later, never enrols past events.
 *
 * Each log goes through the same startDelayedSteps as the event: vendor grant
 * and suspension, the subject bound to the vendor, the rule row FOR SHARE and
 * still active, the first active step as saved now. The run is anchored at the
 * log's createdAt (the event, not this round), so a step already due runs in
 * this round's worker and one more than 24 hours late is skipped as usual.
 * Idempotent on (vendorId, automationRuleId, sourceExecutionLogId). A lock wait
 * given up again leaves the log for the next round.
 *
 * The job takes no id from outside: every id comes from the log row and
 * startDelayedSteps binds them to the log's vendor. Logs of suspended vendors,
 * of vendors without the grant, or of a trigger the vendor's grants do not
 * open (`form_no_show` without `automation_form_no_show`,
 * isAutomationTriggerAvailableForVendor) are not taken and keep their mark.
 *
 * Review MINOR-1 and NIT-2: within a vendor (and between equal turns), logs
 * with fewer failed attempts come first, then the oldest. An attempt that
 * fails for any reason but a lock wait counts; the one reaching
 * PENDING_RUN_START_MAX_ATTEMPTS clears the mark and reports once. The pass
 * stops at min(deadline, start + PENDING_RUN_START_BUDGET_MS), or after
 * PENDING_RUN_START_MAX_CONSECUTIVE_DEFERRED lock waits given up in a row.
 */
export async function startPendingAutomationRuns(
  options: { now?: Date; vendorId?: string; deadline?: number; limit?: number } = {},
  db: Database = getDb(),
): Promise<Array<{ status: DelayedStepStartOutcome }>> {
  const now = options.now ?? new Date();
  const deadline = Math.min(options.deadline ?? Number.POSITIVE_INFINITY, Date.now() + PENDING_RUN_START_BUDGET_MS);
  const pastDeadline = () => Date.now() >= deadline;
  const limit = Math.max(0, Math.min(options.limit ?? PENDING_RUN_START_LIMIT, PENDING_RUN_START_LIMIT));
  if (limit === 0 || pastDeadline()) return [];
  const triggers = [...DELAYED_STEP_AUTOMATION_TRIGGERS] as string[];
  const rows = await db.$queryRaw<Array<{
    id: string; vendorId: string; ruleId: string; trigger: string; subjectType: string;
    subjectKeyHash: string | null; delayedStepsPendingSubjectId: string; createdAt: Date; betaFeatureGrants: string[];
  }>>`
    WITH "owed" AS (
      SELECT l."id", l."vendorId", l."ruleId", l."trigger", l."subjectType", l."subjectKeyHash",
             l."delayedStepsPendingSubjectId", l."delayedStepsPendingAttempts", l."createdAt", l."completedAt",
             v."betaFeatureGrants",
             ROW_NUMBER() OVER (
               PARTITION BY l."vendorId"
               ORDER BY l."delayedStepsPendingAttempts" ASC, l."completedAt" ASC, l."id" ASC
             ) AS "vendorRank"
      FROM "AutomationExecutionLog" l
      JOIN "Vendor" v ON v."id" = l."vendorId"
      WHERE l."delayedStepsPendingSubjectId" IS NOT NULL
        AND l."completedAt" >= ${utcTimestamp(new Date(now.getTime() - PENDING_RUN_START_WINDOW_MS))}
        AND l."completedAt" <= ${utcTimestamp(new Date(now.getTime() - PENDING_RUN_START_MIN_AGE_MS))}
        AND l."status" IN ('completed', 'failed')
        AND l."trigger" = ANY(${triggers}::text[])
        AND v."suspendedAt" IS NULL
        AND ${AUTOMATION_DELAYED_STEPS_FEATURE} = ANY(v."betaFeatureGrants")
        -- isAutomationTriggerAvailableForVendor: form_no_show needs its own grant (Q-11 M-1).
        AND (l."trigger" <> 'form_no_show' OR ${AUTOMATION_FORM_NO_SHOW_FEATURE} = ANY(v."betaFeatureGrants"))
        ${options.vendorId ? Prisma.sql`AND l."vendorId" = ${options.vendorId}` : Prisma.empty}
    )
    SELECT "id", "vendorId", "ruleId", "trigger", "subjectType", "subjectKeyHash", "delayedStepsPendingSubjectId", "createdAt", "betaFeatureGrants"
    FROM "owed"
    WHERE "vendorRank" <= ${limit}
    ORDER BY "vendorRank" ASC, "delayedStepsPendingAttempts" ASC, "completedAt" ASC, "id" ASC
    LIMIT ${limit}
  `;
  const results: Array<{ status: DelayedStepStartOutcome }> = [];
  let deferredInARow = 0;
  for (const row of rows) {
    if (pastDeadline() || deferredInARow >= PENDING_RUN_START_MAX_CONSECUTIVE_DEFERRED) break;
    // The same rule as the query, in code (the query is the one that keeps such logs out of the limit).
    if (!isAutomationTriggerAvailableForVendor(row.trigger, { betaFeatureGrants: row.betaFeatureGrants })) continue;
    const status = await startDelayedSteps(db, {
      vendorId: row.vendorId,
      ruleId: row.ruleId,
      logId: row.id,
      anchorAt: row.createdAt,
      trigger: row.trigger,
      subjectType: row.subjectType,
      subjectId: row.delayedStepsPendingSubjectId,
      subjectKeyHash: row.subjectKeyHash,
    });
    deferredInARow = status === "deferred" ? deferredInARow + 1 : 0;
    if (status === "failed") await countFailedPendingRunStart(db, row);
    results.push({ status });
  }
  return results;
}

/**
 * One failed attempt at an owed run (MINOR-1): counted on the log, bound to
 * its vendor and only while it still owes the run; the attempt reaching
 * PENDING_RUN_START_MAX_ATTEMPTS clears the mark in the same statement and is
 * reported once, with safe keys only.
 */
async function countFailedPendingRunStart(db: Database, log: { id: string; vendorId: string }) {
  const counted = await db.$queryRaw<Array<{ attempts: number; abandoned: boolean }>>`
    UPDATE "AutomationExecutionLog"
    SET "delayedStepsPendingAttempts" = "delayedStepsPendingAttempts" + 1,
        "delayedStepsPendingSubjectId" = CASE
          WHEN "delayedStepsPendingAttempts" + 1 >= ${PENDING_RUN_START_MAX_ATTEMPTS} THEN NULL
          ELSE "delayedStepsPendingSubjectId"
        END
    WHERE "id" = ${log.id} AND "vendorId" = ${log.vendorId} AND "delayedStepsPendingSubjectId" IS NOT NULL
    RETURNING "delayedStepsPendingAttempts" AS "attempts", ("delayedStepsPendingSubjectId" IS NULL) AS "abandoned"
  `;
  if (!counted[0]?.abandoned) return;
  try {
    captureOperationalError(new Error("Gave up creating an owed delayed-step run."), { source: "automation_delayed_steps", operation: "start_run_abandoned" });
  } catch {
    // Monitoring must never change the round's outcome.
  }
}

/**
 * Switching a rule off stops its people part-way through (review M1): every
 * active run becomes cancelled / definition_paused, so switching the rule on
 * again never revives them. The caller holds the rule row FOR UPDATE in the
 * same transaction (the order every writer of runs uses: rule, then runs).
 */
export async function stopDelayedStepRunsOfRule(
  tx: Pick<Prisma.TransactionClient, "delayedStepRun">,
  input: { vendorId: string; ruleId: string },
) {
  const cancelled = await tx.delayedStepRun.updateMany({
    where: { vendorId: input.vendorId, automationRuleId: input.ruleId, status: "active" },
    data: { status: "cancelled", cancelReason: "definition_paused", nextRunAt: null, claimedAt: null },
  });
  return cancelled.count;
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
  | { ok: false; code: "not_found" | "trigger_unavailable" | "steps_unsupported" | "invalid_step" | "invalid_delay" | "duplicate_delay" | "step_limit" | "invalid_product" | "step_busy" | typeof LINE_PUSH_OWNER_ONLY };

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
      if (input.requireAvailableTrigger) {
        // form_no_show also needs the vendor's closed-beta grant (Q-11 M-1).
        const vendor = rule.trigger === "form_no_show"
          ? await tx.vendor.findUnique({ where: { id: input.vendorId }, select: { betaFeatureGrants: true } })
          : null;
        if (!isAutomationTriggerAvailableForVendor(rule.trigger, vendor)) throw new StepChangeRejected("trigger_unavailable");
      }
      // Every available trigger takes delayed steps since Q-09 (payment_paid); kept as a guard for a trigger that does not.
      if (input.requireAvailableTrigger && !automationTriggerSupportsDelayedSteps(rule.trigger)) throw new StepChangeRejected("steps_unsupported");
      const result = await change(tx, rule);
      await rescheduleActiveRunsForAutomationRule(tx, { vendorId: input.vendorId, ruleId: rule.id, now: input.now });
      return result;
    }, STEP_TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof StepChangeRejected) return { ok: false, code: error.code };
    if (!isRuleWriteBusy(error)) throw error;
    reportCancelledRuleLockWait(error);
    return { ok: false, code: "step_busy" };
  }
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

/**
 * Owner decisions 2026-11-14 and 2026-11-15 (src/lib/automation-line-push-
 * policy.ts): without `linePushAllowed` (the actor is not the vendor owner), a
 * step may neither send LINE (a LINE push, or a voucher with its LINE
 * notification on) nor be added to or edited on a rule that already does (its
 * immediate actions or any step). `input.step` is already normalized
 * (stepWithVoucherLineNotification), so an admin's voucher counts as silent.
 * Read after the rule row is locked FOR UPDATE, so an owner's concurrent LINE
 * step is serialized with it.
 */
async function assertLinePushPolicy(tx: Prisma.TransactionClient, input: { vendorId: string; linePushAllowed: boolean; step: AutomationStepInput }, ruleId: string) {
  if (input.linePushAllowed) return;
  if (automationActionsSendLine(input.step.actions)) throw new StepChangeRejected(LINE_PUSH_OWNER_ONLY);
  const stored = await storedAutomationRuleSendsLine(tx, { vendorId: input.vendorId, ruleId });
  if (stored === null) throw new StepChangeRejected("not_found");
  if (stored) throw new StepChangeRejected(LINE_PUSH_OWNER_ONLY);
}

/**
 * Every voucher action of the step saved with its LINE notification flag set
 * explicitly: false for a non-owner whatever was asked, the requested value
 * (on unless `false`) for the owner (withVoucherLineNotification).
 */
function stepWithVoucherLineNotification<T extends { step: AutomationStepInput; linePushAllowed: boolean }>(input: T): T {
  return { ...input, step: { ...input.step, actions: withVoucherLineNotification(input.step.actions, input.linePushAllowed) } };
}

/** `linePushAllowed`: the actor is the vendor owner (mayConfigureAutomationLinePush); every caller decides it. */
export async function createAutomationRuleStep(
  rawInput: { vendorId: string; ruleId: string; step: AutomationStepInput; linePushAllowed: boolean; now?: Date },
  db: Database = getDb(),
): Promise<AutomationStepChangeResult> {
  const input = stepWithVoucherLineNotification(rawInput);
  return withLockedRule(db, { vendorId: input.vendorId, ruleId: input.ruleId, now: input.now ?? new Date(), requireAvailableTrigger: true }, async (tx, rule) => {
    await assertLinePushPolicy(tx, input, rule.id);
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
  rawInput: { vendorId: string; ruleId: string; stepId: string; step: AutomationStepInput; linePushAllowed: boolean; now?: Date },
  db: Database = getDb(),
): Promise<AutomationStepChangeResult> {
  const input = stepWithVoucherLineNotification(rawInput);
  return withLockedRule(db, { vendorId: input.vendorId, ruleId: input.ruleId, now: input.now ?? new Date(), requireAvailableTrigger: true }, async (tx, rule) => {
    // A step that sends LINE is part of the rule, so an admin cannot edit it
    // either, even into one that does not (deleting it stays possible).
    await assertLinePushPolicy(tx, input, rule.id);
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
