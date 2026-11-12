import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";
import { automationCustomerKeyHash } from "@/lib/customer-key-hash";
import { getDb } from "@/lib/db";
import { ensureEmailUnsubscribeFooter, formatLiveStartAt } from "@/lib/email-delivery-format";
import {
  createEmailRecipientHash,
  createEmailUnsubscribeUrl,
  protectEmailDeliveryPayload,
} from "@/lib/email-delivery-pii";
import { EVERGREEN_ACTIVATION_SELECT, evergreenScheduleForLive } from "@/lib/evergreen-activation";
import { EVERGREEN_NEUTRAL_START_TEXT } from "@/lib/evergreen-viewer-session";
import { createLiveViewerUrl } from "@/lib/live-public-url";
import { isFixedSessionLive } from "@/lib/live-fixed-sessions";
import { hasOnlySupportedMessageTemplateVariables, renderMessageTemplate } from "@/lib/message-template";
import { captureOperationalError } from "@/lib/monitoring";
import { isFeatureEnabled } from "@/lib/vendor-feature-toggles";

/**
 * Shared delayed-step mechanism (docs/product/delayed-steps-design.md §3).
 * One DelayedStepRun is one subject's progress through one definition; PR 1
 * only has e-mail sequences (F-3). The job advances a run one step at a time;
 * each step's position is its delay from `anchorAt`, so a merchant editing the
 * steps while people are part-way through stays deterministic.
 */

export const SEQUENCE_EMAIL_TRIGGER = "sequence_email";
export const EMAIL_SEQUENCES_FEATURE = "email_sequences";
/** A claimed run whose worker died is claimable again after this long. */
export const DELAYED_STEP_LEASE_MS = 10 * 60 * 1_000;
/** Claims (each failed attempt holds one) before a run is cancelled as `failed`. */
export const DELAYED_STEP_MAX_ATTEMPTS = 5;
/**
 * A step whose time passed more than this long ago is skipped, not sent: when
 * the job stalls and comes back, a day-old follow-up no longer fits the
 * sequence, and sending it would also bunch it together with the next one.
 * The cursor still moves past it.
 */
export const DELAYED_STEP_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
export const DELAYED_STEP_BATCH_LIMIT = 100;
/** The job re-checks registrations verified this recently that have no run yet (§4「補漏」). */
export const SEQUENCE_BACKFILL_WINDOW_MS = 48 * 60 * 60 * 1_000;
const SEQUENCE_BACKFILL_PAGE_SIZE = 100;
const SEQUENCE_BACKFILL_SCAN_LIMIT = 200;
const MAX_ATTEMPTS_PER_DELIVERY = 5;

export const DELAYED_STEP_CANCEL_REASONS = [
  "unsubscribed",
  "blacklisted",
  "purchased",
  "definition_paused",
  "definition_deleted",
  "subject_gone",
  "failed",
] as const;
export type DelayedStepCancelReason = (typeof DELAYED_STEP_CANCEL_REASONS)[number];

type Database = PrismaClient;

const utcTimestamp = (value: Date) => Prisma.sql`(${value.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function reportFailure(error: unknown, operation: string, status: string) {
  try {
    captureOperationalError(error, { source: "delayed_step_run", operation, status });
  } catch {
    // Monitoring must never change the run state.
  }
}

/** Deterministic id of one step's e-mail: re-running the same step only hits the primary key. */
export function stableSequenceDeliveryId(input: {
  vendorId: string;
  runId: string;
  stepId: string;
  template: { id: string; subject: string; body: string };
}) {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      input.vendorId,
      input.runId,
      input.stepId,
      input.template.id,
      input.template.subject,
      input.template.body,
      SEQUENCE_EMAIL_TRIGGER,
    ]))
    .digest("hex")
    .slice(0, 32);
  return `email_${digest}`;
}

export function sequenceEmailIdempotencyKey(runId: string, stepId: string, deliveryId: string) {
  return `sequence-email/${runId}/${stepId}/${deliveryId}`;
}

function parseSequenceEmailIdempotencyKey(value: string | undefined) {
  const match = /^sequence-email\/([A-Za-z0-9_-]{1,191})\/([A-Za-z0-9_-]{1,191})\/(email_[a-f0-9]{32})$/u.exec(value ?? "");
  return match ? { runId: match[1]!, stepId: match[2]!, deliveryId: match[3]! } : null;
}

type SequenceTemplate = {
  id: string;
  vendorId: string;
  channel: string;
  trigger: string;
  subject: string | null;
  body: string;
  isActive: boolean;
};

function usableSequenceTemplate(template: SequenceTemplate | null | undefined, vendorId: string): template is SequenceTemplate & { subject: string } {
  return Boolean(
    template
    && template.isActive
    && template.vendorId === vendorId
    && template.channel === "email"
    && template.trigger === SEQUENCE_EMAIL_TRIGGER
    && template.subject?.trim()
    && template.body.trim()
    && hasOnlySupportedMessageTemplateVariables(template.subject)
    && hasOnlySupportedMessageTemplateVariables(template.body),
  );
}

type RecipientCheckDatabase = Pick<Prisma.TransactionClient, "emailSuppression" | "blacklist">;

/** Whether the recipient may receive this vendor's marketing mail right now. */
async function recipientBlock(db: RecipientCheckDatabase, vendorId: string, email: string) {
  const normalized = normalizeBlacklistIdentifier("email", email);
  if (!normalized) return { blocked: "subject_gone" as const };
  let recipientHash: string;
  try {
    recipientHash = createEmailRecipientHash(normalized, vendorId);
  } catch {
    return { blocked: "subject_gone" as const };
  }
  const [suppression, blacklist] = await Promise.all([
    db.emailSuppression.findUnique({
      where: { vendorId_recipientHash: { vendorId, recipientHash } },
      select: { resubscribedAt: true },
    }),
    db.blacklist.findFirst({
      where: { vendorId, identifierType: "email", identifier: normalized, isActive: true, unblockedAt: null },
      select: { id: true },
    }),
  ]);
  if (suppression && !suppression.resubscribedAt) return { blocked: "unsubscribed" as const };
  if (blacklist) return { blocked: "blacklisted" as const };
  return { blocked: null, normalized, recipientHash };
}

async function emailSequencesEnabled(db: Pick<Database, "vendor">, vendorId: string) {
  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { enabledFeatureModules: true, betaFeatureGrants: true, suspendedAt: true },
  });
  return Boolean(vendor && !vendor.suspendedAt && isFeatureEnabled(vendor, EMAIL_SEQUENCES_FEATURE));
}

export type EnrollmentResult = {
  status: "enrolled" | "duplicate" | "feature_disabled" | "not_eligible" | "no_sequence" | "unsubscribed" | "blacklisted" | "subject_gone";
  created: number;
};

/**
 * Adds one VERIFIED registration to every active sequence of its Live that
 * was activated before the registration was verified. Called from the verify
 * route and the job's backfill; a second call only meets the unique key.
 * Everything is read for `vendorId`: the registration through its form, the
 * sequences through their own vendorId and Live.
 */
export async function enrollSubmissionInEmailSequences(
  input: { vendorId: string; liveId: string; formSubmissionId: string; now?: Date },
  db: Database = getDb(),
): Promise<EnrollmentResult> {
  const now = input.now ?? new Date();
  if (!await emailSequencesEnabled(db, input.vendorId)) return { status: "feature_disabled", created: 0 };
  const submission = await db.formSubmission.findFirst({
    where: {
      id: input.formSubmissionId,
      liveId: input.liveId,
      verificationStatus: "VERIFIED",
      verifiedAt: { not: null, lte: now },
      form: { vendorId: input.vendorId },
    },
    select: { id: true, email: true, verifiedAt: true },
  });
  if (!submission?.verifiedAt) return { status: "not_eligible", created: 0 };
  const sequences = await db.emailSequence.findMany({
    where: {
      vendorId: input.vendorId,
      liveId: input.liveId,
      status: "active",
      // Activating a sequence never reaches back to earlier registrations.
      activatedAt: { lte: submission.verifiedAt },
    },
    select: {
      id: true,
      steps: { where: { isActive: true }, orderBy: { delayMinutes: "asc" }, take: 1, select: { delayMinutes: true } },
    },
  });
  if (sequences.length === 0) return { status: "no_sequence", created: 0 };
  const recipient = await recipientBlock(db, input.vendorId, submission.email);
  if (recipient.blocked) return { status: recipient.blocked, created: 0 };
  let subjectKeyHash: string;
  try {
    subjectKeyHash = automationCustomerKeyHash(input.vendorId, recipient.normalized);
  } catch {
    return { status: "subject_gone", created: 0 };
  }
  const anchorAt = submission.verifiedAt;
  const created = await db.delayedStepRun.createMany({
    data: sequences.map((sequence) => ({
      vendorId: input.vendorId,
      emailSequenceId: sequence.id,
      formSubmissionId: submission.id,
      subjectKeyHash,
      recipientHash: recipient.recipientHash,
      anchorAt,
      cursorDelayMinutes: -1,
      // No active step yet: due now, so the worker completes it.
      nextRunAt: sequence.steps[0] ? new Date(anchorAt.getTime() + sequence.steps[0].delayMinutes * 60_000) : anchorAt,
      status: "active",
    })),
    skipDuplicates: true,
  });
  return { status: created.count > 0 ? "enrolled" : "duplicate", created: created.count };
}

type BackfillCandidate = { formSubmissionId: string; vendorId: string; liveId: string; verifiedAt: Date };

/**
 * Safety net for the verify route (§4「補漏」): registrations verified in the
 * last 48 hours for a Live with an active sequence, activated before the
 * verification, that still have no run. Keyset-paged and bounded per round.
 */
export async function backfillEmailSequenceEnrollments(
  options: { now?: Date; scanLimit?: number; vendorId?: string } = {},
  db: Database = getDb(),
) {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - SEQUENCE_BACKFILL_WINDOW_MS);
  const scanLimit = Math.min(Math.max(options.scanLimit ?? SEQUENCE_BACKFILL_SCAN_LIMIT, 1), 1_000);
  const results: Array<{ status: EnrollmentResult["status"] }> = [];
  let after: BackfillCandidate | null = null;
  while (results.length < scanLimit) {
    const take = Math.min(SEQUENCE_BACKFILL_PAGE_SIZE, scanLimit - results.length);
    const cursor: BackfillCandidate | null = after;
    const page: BackfillCandidate[] = await db.$queryRaw<BackfillCandidate[]>`
      SELECT DISTINCT f."id" AS "formSubmissionId", s."vendorId", s."liveId", f."verifiedAt"
      FROM "EmailSequence" s
      JOIN "Vendor" v ON v."id" = s."vendorId"
      JOIN "FormSubmission" f ON f."liveId" = s."liveId"
      JOIN "RegistrationForm" rf ON rf."id" = f."formId" AND rf."vendorId" = s."vendorId"
      WHERE s."status" = 'active'
        AND v."suspendedAt" IS NULL
        AND ${EMAIL_SEQUENCES_FEATURE} = ANY(v."betaFeatureGrants")
        ${options.vendorId ? Prisma.sql`AND s."vendorId" = ${options.vendorId}` : Prisma.empty}
        AND f."verificationStatus" = 'VERIFIED'
        AND f."verifiedAt" >= ${utcTimestamp(since)}
        AND f."verifiedAt" <= ${utcTimestamp(now)}
        AND f."verifiedAt" >= s."activatedAt"
        AND NOT EXISTS (
          SELECT 1 FROM "DelayedStepRun" r
          WHERE r."vendorId" = s."vendorId" AND r."emailSequenceId" = s."id" AND r."formSubmissionId" = f."id"
        )
        ${cursor ? Prisma.sql`AND (f."verifiedAt", f."id") > (${utcTimestamp(cursor.verifiedAt)}, ${cursor.formSubmissionId})` : Prisma.empty}
      ORDER BY f."verifiedAt" ASC, f."id" ASC
      LIMIT ${take}
    `;
    for (const candidate of page) {
      after = candidate;
      try {
        const result = await enrollSubmissionInEmailSequences({
          vendorId: candidate.vendorId,
          liveId: candidate.liveId,
          formSubmissionId: candidate.formSubmissionId,
          now,
        }, db);
        results.push({ status: result.status });
      } catch (error) {
        reportFailure(error, "backfill_enrollment", "failed");
        results.push({ status: "not_eligible" });
      }
    }
    if (page.length < take) break;
  }
  return results;
}

type Lease = {
  id: string;
  vendorId: string;
  claimedAt: Date;
  attemptCount: number;
  cursorDelayMinutes: number;
};

/** Every write after the claim must still hold this exact lease. */
function leaseWhere(lease: Lease): Prisma.DelayedStepRunWhereInput {
  return {
    id: lease.id,
    vendorId: lease.vendorId,
    status: "active",
    claimedAt: lease.claimedAt,
    attemptCount: lease.attemptCount,
    cursorDelayMinutes: lease.cursorDelayMinutes,
  };
}

class LeaseLostError extends Error {
  constructor() {
    super("Delayed step run lease lost.");
    this.name = "LeaseLostError";
  }
}

export type DelayedStepResult = {
  runId: string;
  status:
    | "queued"
    | "skipped_stale"
    | "skipped_template"
    | "rescheduled"
    | "completed"
    | "cancelled"
    | "claimed_elsewhere"
    | "failed";
  cancelReason?: DelayedStepCancelReason;
};

async function cancelLeasedRun(db: Database, lease: Lease, reason: DelayedStepCancelReason): Promise<DelayedStepResult> {
  const cancelled = await db.delayedStepRun.updateMany({
    where: leaseWhere(lease),
    data: { status: "cancelled", cancelReason: reason, nextRunAt: null, claimedAt: null },
  });
  return cancelled.count === 1
    ? { runId: lease.id, status: "cancelled", cancelReason: reason }
    : { runId: lease.id, status: "claimed_elsewhere" };
}

const LIVE_SELECT = {
  id: true,
  vendorId: true,
  slug: true,
  title: true,
  scheduledAt: true,
  ...EVERGREEN_ACTIVATION_SELECT,
  video: { select: { durationSec: true } },
  vendor: { select: { name: true, timezone: true, senderName: true, supportEmail: true, contactUrl: true } },
} as const;

type SequenceLive = Prisma.LiveGetPayload<{ select: typeof LIVE_SELECT }>;

/**
 * {{live_start_at}} follows the existing rules: a fixed-session (指定場次)
 * registrant's own session, an evergreen Live's shared anchor or the
 * registrant's recorded session (neutral phrase when neither exists),
 * otherwise the Live's scheduled start.
 */
async function sequenceLiveStartText(
  db: Database,
  live: SequenceLive,
  submission: { id: string; liveSession: { vendorId: string; liveId: string; startAt: Date; status: string } | null },
  now: Date,
) {
  if (isFixedSessionLive(live)) {
    const session = submission.liveSession;
    if (session && session.vendorId === live.vendorId && session.liveId === live.id && session.status !== "cancelled") {
      return formatLiveStartAt(session.startAt);
    }
    return formatLiveStartAt(live.scheduledAt);
  }
  const evergreen = evergreenScheduleForLive(live, live.vendor.timezone, now);
  if (!evergreen) return formatLiveStartAt(live.scheduledAt);
  if (evergreen.sharedStartAt) return formatLiveStartAt(evergreen.sharedStartAt);
  const assignment = await db.evergreenSessionAssignment.findFirst({
    where: { vendorId: live.vendorId, liveId: live.id, formSubmissionId: submission.id },
    select: { sessionStartAt: true },
  });
  return assignment ? formatLiveStartAt(assignment.sessionStartAt) : EVERGREEN_NEUTRAL_START_TEXT;
}

async function processClaimedRun(db: Database, lease: Lease, now: Date): Promise<DelayedStepResult> {
  // The worker never takes an id from outside: vendorId comes from the run
  // row and every read below is scoped to it.
  const run = await db.delayedStepRun.findFirst({
    where: { id: lease.id, vendorId: lease.vendorId, status: "active" },
    select: {
      id: true,
      vendorId: true,
      formSubmissionId: true,
      anchorAt: true,
      emailSequence: {
        select: {
          id: true,
          vendorId: true,
          liveId: true,
          status: true,
          steps: {
            where: { isActive: true, delayMinutes: { gt: lease.cursorDelayMinutes } },
            orderBy: { delayMinutes: "asc" },
            take: 2,
            select: {
              id: true,
              delayMinutes: true,
              messageTemplate: {
                select: { id: true, vendorId: true, channel: true, trigger: true, subject: true, body: true, isActive: true },
              },
            },
          },
        },
      },
    },
  });
  if (!run) return { runId: lease.id, status: "claimed_elsewhere" };
  const sequence = run.emailSequence;
  if (!sequence || sequence.vendorId !== lease.vendorId) return cancelLeasedRun(db, lease, "definition_deleted");
  if (sequence.status !== "active") return cancelLeasedRun(db, lease, "definition_paused");
  if (!run.formSubmissionId) return cancelLeasedRun(db, lease, "subject_gone");

  const [live, submission] = await Promise.all([
    db.live.findFirst({ where: { id: sequence.liveId, vendorId: lease.vendorId }, select: LIVE_SELECT }),
    db.formSubmission.findFirst({
      where: {
        id: run.formSubmissionId,
        liveId: sequence.liveId,
        verificationStatus: "VERIFIED",
        form: { vendorId: lease.vendorId },
      },
      select: {
        id: true,
        name: true,
        email: true,
        liveSession: { select: { vendorId: true, liveId: true, startAt: true, status: true } },
      },
    }),
  ]);
  if (!live) return cancelLeasedRun(db, lease, "definition_deleted");
  if (!submission) return cancelLeasedRun(db, lease, "subject_gone");
  const recipient = await recipientBlock(db, lease.vendorId, submission.email);
  if (recipient.blocked) return cancelLeasedRun(db, lease, recipient.blocked);

  const [step, following] = sequence.steps;
  if (!step) {
    const completed = await db.delayedStepRun.updateMany({
      where: leaseWhere(lease),
      data: { status: "completed", nextRunAt: null, claimedAt: null, attemptCount: 0 },
    });
    return { runId: lease.id, status: completed.count === 1 ? "completed" : "claimed_elsewhere" };
  }

  const dueAt = new Date(run.anchorAt.getTime() + step.delayMinutes * 60_000);
  if (dueAt > now) {
    // The step moved later (or the earlier one was switched off): wait for it.
    const rescheduled = await db.delayedStepRun.updateMany({
      where: leaseWhere(lease),
      data: { nextRunAt: dueAt, claimedAt: null, attemptCount: 0 },
    });
    return { runId: lease.id, status: rescheduled.count === 1 ? "rescheduled" : "claimed_elsewhere" };
  }

  const advance: Prisma.DelayedStepRunUpdateManyMutationInput = following
    ? {
        cursorDelayMinutes: step.delayMinutes,
        nextRunAt: new Date(run.anchorAt.getTime() + following.delayMinutes * 60_000),
        claimedAt: null,
        attemptCount: 0,
      }
    : { cursorDelayMinutes: step.delayMinutes, status: "completed", nextRunAt: null, claimedAt: null, attemptCount: 0 };

  let delivery: Prisma.EmailDeliveryCreateManyInput | null = null;
  let outcome: DelayedStepResult["status"] = "queued";
  const template = step.messageTemplate;
  if (now.getTime() - dueAt.getTime() > DELAYED_STEP_STALE_AFTER_MS) {
    outcome = "skipped_stale";
  } else if (!usableSequenceTemplate(template, lease.vendorId)) {
    // A template switched off, re-purposed or broken: skip this step like a
    // disabled one instead of holding the whole sequence back.
    outcome = "skipped_template";
  } else {
    const deliveryId = stableSequenceDeliveryId({
      vendorId: lease.vendorId,
      runId: run.id,
      stepId: step.id,
      template: { id: template.id, subject: template.subject, body: template.body },
    });
    try {
      const unsubscribeUrl = createEmailUnsubscribeUrl(deliveryId);
      const variables = {
        name: submission.name,
        live_title: live.title,
        live_url: createLiveViewerUrl(live.slug),
        live_start_at: await sequenceLiveStartText(db, live, submission, now),
        vendor_name: live.vendor.name,
        unsubscribe_url: unsubscribeUrl,
      };
      const payload = protectEmailDeliveryPayload({
        recipientEmail: recipient.normalized,
        subject: renderMessageTemplate(template.subject, variables).replace(/\s+/gu, " ").trim(),
        // Marketing mail: the unsubscribe link is always there.
        body: ensureEmailUnsubscribeFooter(renderMessageTemplate(template.body, variables), unsubscribeUrl),
        brand: {
          senderName: live.vendor.senderName,
          supportEmail: live.vendor.supportEmail,
          contactUrl: live.vendor.contactUrl,
        },
      }, { vendorId: lease.vendorId, deliveryId });
      delivery = {
        id: deliveryId,
        vendorId: lease.vendorId,
        sourceTemplateId: template.id,
        sourceLiveId: live.id,
        sourceFormSubmissionId: submission.id,
        trigger: SEQUENCE_EMAIL_TRIGGER,
        ...payload,
        idempotencyKey: sequenceEmailIdempotencyKey(run.id, step.id, deliveryId),
        status: "queued",
        maxAttempts: MAX_ATTEMPTS_PER_DELIVERY,
        nextAttemptAt: now,
      };
    } catch (error) {
      // The rendered mail does not fit the delivery limits; retrying cannot fix it.
      reportFailure(error, "render_step", "skipped");
      outcome = "skipped_template";
    }
  }

  try {
    await db.$transaction(async (tx) => {
      // Moving the cursor and creating the step's e-mail commit together.
      const advanced = await tx.delayedStepRun.updateMany({ where: leaseWhere(lease), data: advance });
      if (advanced.count !== 1) throw new LeaseLostError();
      if (delivery) await tx.emailDelivery.createMany({ data: [delivery], skipDuplicates: true });
    });
  } catch (error) {
    if (error instanceof LeaseLostError) return { runId: lease.id, status: "claimed_elsewhere" };
    throw error;
  }
  return { runId: lease.id, status: outcome };
}

/**
 * The job's worker (§3「Worker」). Each round takes up to `limit` due active
 * runs of active, non-suspended vendors that hold the email_sequences grant
 * (a closed grant keeps the runs but never runs them), claims each with a
 * compare-and-set and executes at most one step per run.
 */
export async function processDueDelayedStepRuns(
  /** `vendorId` scopes one run to a single tenant (tests, operations); the job runs unscoped. */
  options: { now?: Date; limit?: number; vendorId?: string } = {},
  db: Database = getDb(),
): Promise<DelayedStepResult[]> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? DELAYED_STEP_BATCH_LIMIT, 1), 500);
  const leaseCutoff = new Date(now.getTime() - DELAYED_STEP_LEASE_MS);
  const candidates = await db.delayedStepRun.findMany({
    where: {
      ...(options.vendorId ? { vendorId: options.vendorId } : {}),
      status: "active",
      nextRunAt: { lte: now },
      OR: [{ claimedAt: null }, { claimedAt: { lte: leaseCutoff } }],
      vendor: { is: { suspendedAt: null, betaFeatureGrants: { has: EMAIL_SEQUENCES_FEATURE } } },
    },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, vendorId: true, updatedAt: true, cursorDelayMinutes: true, attemptCount: true },
  });
  const results: DelayedStepResult[] = [];
  for (const candidate of candidates) {
    try {
      if (candidate.attemptCount >= DELAYED_STEP_MAX_ATTEMPTS) {
        const exhausted = await db.delayedStepRun.updateMany({
          where: { id: candidate.id, vendorId: candidate.vendorId, status: "active", updatedAt: candidate.updatedAt },
          data: { status: "cancelled", cancelReason: "failed", nextRunAt: null, claimedAt: null },
        });
        if (exhausted.count === 1) reportFailure(new Error("Delayed step run exhausted its attempts."), "retry_limit", "cancelled");
        results.push(exhausted.count === 1
          ? { runId: candidate.id, status: "cancelled", cancelReason: "failed" }
          : { runId: candidate.id, status: "claimed_elsewhere" });
        continue;
      }
      const claimedAt = now;
      const claimed = await db.delayedStepRun.updateMany({
        where: {
          id: candidate.id,
          vendorId: candidate.vendorId,
          status: "active",
          updatedAt: candidate.updatedAt,
          cursorDelayMinutes: candidate.cursorDelayMinutes,
          attemptCount: candidate.attemptCount,
        },
        data: { claimedAt, attemptCount: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        results.push({ runId: candidate.id, status: "claimed_elsewhere" });
        continue;
      }
      results.push(await processClaimedRun(db, {
        id: candidate.id,
        vendorId: candidate.vendorId,
        claimedAt,
        attemptCount: candidate.attemptCount + 1,
        cursorDelayMinutes: candidate.cursorDelayMinutes,
      }, now));
    } catch (error) {
      // The lease stays; the run is claimable again after DELAYED_STEP_LEASE_MS.
      reportFailure(error, "process_step", "failed");
      results.push({ runId: candidate.id, status: "failed" });
    }
  }
  return results;
}

/**
 * Unsubscribe link: in the same transaction as the suppression, every active
 * run of this recipient at this vendor stops (matched by the same vendor-bound
 * recipient hash as EmailDelivery; no address is compared or stored).
 */
export async function cancelDelayedStepRunsForRecipient(
  tx: Pick<Prisma.TransactionClient, "delayedStepRun">,
  input: { vendorId: string; recipientHash: string },
) {
  const result = await tx.delayedStepRun.updateMany({
    where: { vendorId: input.vendorId, recipientHash: input.recipientHash, status: "active" },
    data: { status: "cancelled", cancelReason: "unsubscribed", nextRunAt: null, claimedAt: null },
  });
  return result.count;
}

/**
 * After a sequence's steps change, every active run waits for the first
 * active step after its cursor at the new time (§3「步驟的定位方式」). A run
 * with no step left is due now so the worker completes it.
 */
export async function rescheduleActiveRunsForSequence(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: { vendorId: string; emailSequenceId: string; now: Date },
) {
  return tx.$executeRaw`
    UPDATE "DelayedStepRun" AS r
    SET "nextRunAt" = COALESCE(
          r."anchorAt" + make_interval(mins => (
            SELECT MIN(s."delayMinutes")
            FROM "EmailSequenceStep" s
            WHERE s."vendorId" = r."vendorId"
              AND s."emailSequenceId" = r."emailSequenceId"
              AND s."isActive"
              AND s."delayMinutes" > r."cursorDelayMinutes"
          )),
          ${utcTimestamp(input.now)}
        ),
        "updatedAt" = ${utcTimestamp(input.now)}
    WHERE r."vendorId" = ${input.vendorId}
      AND r."emailSequenceId" = ${input.emailSequenceId}
      AND r."status" = 'active'
  `;
}

type SequenceSnapshotDatabase = Pick<Prisma.TransactionClient, "delayedStepRun" | "blacklist">;

/**
 * Send-time guard for `sequence_email` (§4「寄信」): the run is still active or
 * completed, its sequence is active, the step is still active, the template is
 * still usable and its id and content still produce this delivery's id, and
 * the recipient is not on the vendor's blacklist. Otherwise the delivery is
 * superseded.
 */
export async function isCurrentSequenceEmailDelivery(
  delivery: {
    id: string;
    vendorId: string;
    sourceLiveId: string | null;
    sourceFormSubmissionId: string | null;
    trigger: string;
    idempotencyKey?: string;
  },
  database: SequenceSnapshotDatabase,
) {
  if (delivery.trigger !== SEQUENCE_EMAIL_TRIGGER) return true;
  if (!delivery.sourceLiveId || !delivery.sourceFormSubmissionId) return false;
  // The idempotency key names the run and step, but the merchant retry path
  // does not read it, so the match is recomputed from the source records: a
  // registration has at most a few runs and each sequence at most 10 steps.
  const key = parseSequenceEmailIdempotencyKey(delivery.idempotencyKey);
  if (delivery.idempotencyKey !== undefined && (!key || key.deliveryId !== delivery.id)) return false;
  const runs = await database.delayedStepRun.findMany({
    where: {
      vendorId: delivery.vendorId,
      formSubmissionId: delivery.sourceFormSubmissionId,
      status: { in: ["active", "completed"] },
      ...(key ? { id: key.runId } : {}),
      emailSequence: { is: { vendorId: delivery.vendorId, liveId: delivery.sourceLiveId, status: "active" } },
      formSubmission: { is: { liveId: delivery.sourceLiveId, form: { vendorId: delivery.vendorId } } },
    },
    select: {
      id: true,
      emailSequence: {
        select: {
          steps: {
            where: { vendorId: delivery.vendorId, isActive: true, ...(key ? { id: key.stepId } : {}) },
            select: {
              id: true,
              messageTemplate: {
                select: { id: true, vendorId: true, channel: true, trigger: true, subject: true, body: true, isActive: true },
              },
            },
          },
        },
      },
      formSubmission: { select: { email: true } },
    },
  });
  const match = runs.find((run) => run.emailSequence?.steps.some((step) => (
    usableSequenceTemplate(step.messageTemplate, delivery.vendorId)
    && stableSequenceDeliveryId({
      vendorId: delivery.vendorId,
      runId: run.id,
      stepId: step.id,
      template: { id: step.messageTemplate.id, subject: step.messageTemplate.subject ?? "", body: step.messageTemplate.body },
    }) === delivery.id
  )));
  if (!match?.formSubmission) return false;
  const normalized = normalizeBlacklistIdentifier("email", match.formSubmission.email);
  if (!normalized) return false;
  const blacklisted = await database.blacklist.findFirst({
    where: { vendorId: delivery.vendorId, identifierType: "email", identifier: normalized, isActive: true, unblockedAt: null },
    select: { id: true },
  });
  return !blacklisted;
}
