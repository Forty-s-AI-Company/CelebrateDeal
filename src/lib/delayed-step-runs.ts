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
import { isTransactionalEmailConfigured } from "@/lib/email";
import { captureOperationalError } from "@/lib/monitoring";
import { isFeatureEnabled } from "@/lib/vendor-feature-toggles";
import {
  AUTOMATION_STEP_EMAIL_TRIGGER,
  DELAYED_STEP_EMAIL_TRIGGERS,
  parseAutomationStepEmailIdempotencyKey,
  parseAutomationStepEventId,
  SEQUENCE_EMAIL_TRIGGER,
} from "@/lib/automation-email-trigger";

/**
 * Shared delayed-step mechanism (docs/product/delayed-steps-design.md §3).
 * One DelayedStepRun is one subject's progress through one definition; PR 1
 * only has e-mail sequences (F-3). The job advances a run one step at a time;
 * each step's position is its delay from `anchorAt`, so a merchant editing the
 * steps while people are part-way through stays deterministic.
 */

export { SEQUENCE_EMAIL_TRIGGER, DELAYED_STEP_EMAIL_TRIGGERS } from "@/lib/automation-email-trigger";
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
/** Runs claimed per round, all vendors together (skips and waits included). */
export const DELAYED_STEP_BATCH_LIMIT = 200;
/**
 * Sequence e-mails dispatched per job round, on their own quota after all
 * time-bound mail (processDueSequenceEmailDeliveries). Throughput is this
 * number per round: every 5 minutes that is 240 sequence e-mails an hour,
 * every hour 20.
 */
export const SEQUENCE_EMAIL_DISPATCH_LIMIT = 20;
/**
 * The worker creates step e-mails only into free dispatch capacity: each
 * round at most SEQUENCE_EMAIL_DISPATCH_LIMIT minus the sequence e-mails
 * still waiting to be sent (MAJOR 2). A backlog therefore waits as runs, whose
 * lateness is measured from each step's own due time, never as queued mail.
 */
export const SEQUENCE_EMAIL_CREATE_LIMIT = SEQUENCE_EMAIL_DISPATCH_LIMIT;
/**
 * A step e-mail is normally created and sent in the same round. One still
 * unsent this long after it was created is superseded at send time.
 */
export const SEQUENCE_EMAIL_SEND_STALE_MS = 6 * 60 * 60 * 1_000;
/**
 * Job round (/api/jobs/email-deliveries): past this point the sequence work is
 * skipped and left to the next round. The scheduled runner gives up on a call
 * after 120 s (scripts/scheduled-jobs-runner.mjs REQUEST_TIMEOUT_MS), so the
 * sequence work starts early enough to finish well inside that.
 */
export const EMAIL_SEQUENCE_START_CUTOFF_MS = 60_000;
/**
 * Job round: the sequence work starts no new item after this point. A provider
 * call already started can take up to 10 s more (src/lib/email.ts timeout), so
 * the round ends by about 110 s, before the runner's 120 s timeout; the route's
 * maxDuration (300 s) is only the platform ceiling.
 */
export const EMAIL_SEQUENCE_DEADLINE_MS = 100_000;
/** Vendors with due runs considered per round; the starting vendor is random every round. */
const DELAYED_STEP_VENDORS_PER_ROUND = 500;
/** Runs one vendor may claim per round beyond its e-mail share (waits, reschedules, cancellations). */
const DELAYED_STEP_EXTRA_RUNS_PER_VENDOR = 10;
/**
 * Passes over the vendors per round: one fair pass, then one pass that hands
 * capacity the first pass left unused to vendors that still have due runs.
 */
const DELAYED_STEP_VENDOR_PASSES = 2;
/** A step whose template is switched off is retried this much later (roughly the next round), until it is 24 hours late. */
export const DELAYED_STEP_TEMPLATE_RETRY_MS = 5 * 60 * 1_000;
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
  // A second registration with the same address for the same sequence (M3).
  "duplicate",
] as const;
export type DelayedStepCancelReason = (typeof DELAYED_STEP_CANCEL_REASONS)[number];

type Database = PrismaClient;

export const utcTimestamp = (value: Date) => Prisma.sql`(${value.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * A deployment problem (public URL, signing or encryption key) met while
 * building a step e-mail. It says nothing about the run, so the run keeps its
 * attempts and the round stops (MINOR 1).
 */
export class SequenceConfigurationError extends Error {
  constructor(readonly causeError: unknown) {
    super("Email sequences cannot build e-mails: deployment configuration is missing.");
    this.name = "SequenceConfigurationError";
  }
}

/** Runs the builder and turns any error into a SequenceConfigurationError. */
function configured<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    throw error instanceof SequenceConfigurationError ? error : new SequenceConfigurationError(error);
  }
}

/** Up to one pass per possible step: every overdue step of a run is skipped in one round. */
const MAX_STALE_SKIP_PASSES = 10;

function reportFailure(error: unknown, operation: string, status: string) {
  try {
    captureOperationalError(error, { source: "delayed_step_run", operation, status });
  } catch {
    // Monitoring must never change the run state.
  }
}

/** Monitoring for the automation half of the worker (automation-delayed-steps.ts). */
export const reportDelayedStepFailure = reportFailure;

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

export function sequenceEmailIdempotencyPrefix(runId: string, stepId: string) {
  return `sequence-email/${runId}/${stepId}/`;
}

export function sequenceEmailIdempotencyKey(runId: string, stepId: string, deliveryId: string) {
  return `${sequenceEmailIdempotencyPrefix(runId, stepId)}${deliveryId}`;
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

/** The template still belongs to this vendor and is an active sequence e-mail. */
function isSequenceTemplateAvailable(template: SequenceTemplate | null | undefined, vendorId: string): template is SequenceTemplate {
  return Boolean(
    template
    && template.isActive
    && template.vendorId === vendorId
    && template.channel === "email"
    && template.trigger === SEQUENCE_EMAIL_TRIGGER,
  );
}

/** Subject and body are present and use only the supported variables. */
function hasValidSequenceTemplateContent(template: Pick<SequenceTemplate, "subject" | "body">) {
  return Boolean(
    template.subject?.trim()
    && template.body.trim()
    && hasOnlySupportedMessageTemplateVariables(template.subject)
    && hasOnlySupportedMessageTemplateVariables(template.body),
  );
}

function usableSequenceTemplate(template: SequenceTemplate | null | undefined, vendorId: string): template is SequenceTemplate & { subject: string } {
  return isSequenceTemplateAvailable(template, vendorId) && hasValidSequenceTemplateContent(template);
}

type RecipientCheckDatabase = Pick<Prisma.TransactionClient, "emailSuppression" | "blacklist">;

const DELIVERABLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * Whether the recipient may receive this vendor's marketing mail right now.
 * Only an address that can never be sent to counts as `subject_gone`; a key
 * or configuration error while hashing is thrown (the caller retries).
 */
async function recipientBlock(db: RecipientCheckDatabase, vendorId: string, email: string) {
  const normalized = normalizeBlacklistIdentifier("email", email);
  if (!normalized || normalized.length > 320 || !DELIVERABLE_EMAIL.test(normalized)) return { blocked: "subject_gone" as const };
  const recipientHash = configured(() => createEmailRecipientHash(normalized, vendorId));
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
  if (suppression && !suppression.resubscribedAt) return { blocked: "unsubscribed" as const, normalized, recipientHash };
  if (blacklist) return { blocked: "blacklisted" as const, normalized, recipientHash };
  return { blocked: null, normalized, recipientHash };
}

async function emailSequencesEnabled(db: Pick<Prisma.TransactionClient, "vendor">, vendorId: string) {
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
  const hashes = recipient.blocked === "subject_gone"
    ? { subjectKeyHash: null, recipientHash: null }
    : { subjectKeyHash: configured(() => automationCustomerKeyHash(input.vendorId, recipient.normalized)), recipientHash: recipient.recipientHash };
  const anchorAt = submission.verifiedAt;
  let created = 0;
  for (const sequence of sequences) {
    const base = {
      vendorId: input.vendorId,
      emailSequenceId: sequence.id,
      formSubmissionId: submission.id,
      subjectKeyHash: hashes.subjectKeyHash,
      anchorAt,
      cursorDelayMinutes: -1,
    };
    // Not eligible right now: recorded as stopped, so the backfill never scans
    // this registration again. A later resubscribe or unblock does not revive it.
    const row: Prisma.DelayedStepRunCreateManyInput = recipient.blocked
      ? { ...base, recipientHash: hashes.recipientHash, status: "cancelled", cancelReason: recipient.blocked, nextRunAt: null }
      : {
          ...base,
          recipientHash: hashes.recipientHash,
          status: "active",
          // No active step yet: due now, so the worker completes it.
          nextRunAt: sequence.steps[0] ? new Date(anchorAt.getTime() + sequence.steps[0].delayMinutes * 60_000) : anchorAt,
        };
    const inserted = await db.delayedStepRun.createMany({ data: [row], skipDuplicates: true });
    if (inserted.count === 1) {
      if (!recipient.blocked) created += 1;
      continue;
    }
    // Nothing inserted: this registration already has its run, or another
    // registration with the same address (another form of this Live) holds
    // the recipient's place in the sequence. The latter gets a stopped
    // `duplicate` row without the hash, so the backfill skips it from now on.
    const own = await db.delayedStepRun.findFirst({
      where: { vendorId: input.vendorId, emailSequenceId: sequence.id, formSubmissionId: submission.id },
      select: { id: true },
    });
    if (!own) {
      await db.delayedStepRun.createMany({
        data: [{ ...base, recipientHash: null, status: "cancelled", cancelReason: "duplicate", nextRunAt: null }],
        skipDuplicates: true,
      });
    }
  }
  return { status: recipient.blocked ?? (created > 0 ? "enrolled" : "duplicate"), created };
}

type BackfillCandidate = { formSubmissionId: string; vendorId: string; liveId: string; verifiedAt: Date };

/** Rounds are numbered by this period to move the backfill's starting point. */
const SEQUENCE_BACKFILL_ROTATION_PERIOD_MS = 5 * 60 * 1_000;
/** About 0.618 of the window: consecutive rounds start far apart and cover it evenly. */
const SEQUENCE_BACKFILL_ROTATION_STEP = 0.6180339887;

/**
 * Safety net for the verify route (§4「補漏」): registrations verified in the
 * last 48 hours for a Live with an active sequence, activated before the
 * verification, that still have no run. Keyset-paged and bounded per round.
 * Each round starts at a different point of the 48-hour window and wraps
 * around, so a registration whose enrollment keeps failing cannot hold the
 * front of every scan (ineligible people get a stopped run and leave the
 * scan for good). A configuration error stops the round with one report.
 * `deadline` (epoch ms) stops it before the next candidate.
 */
export async function backfillEmailSequenceEnrollments(
  options: { now?: Date; scanLimit?: number; vendorId?: string; deadline?: number; onConfigurationError?: ConfigurationReporter } = {},
  db: Database = getDb(),
) {
  const now = options.now ?? new Date();
  const reportConfiguration = options.onConfigurationError ?? reportConfigurationProblem;
  const since = new Date(now.getTime() - SEQUENCE_BACKFILL_WINDOW_MS);
  const scanLimit = Math.min(Math.max(options.scanLimit ?? SEQUENCE_BACKFILL_SCAN_LIMIT, 1), 1_000);
  const round = Math.floor(now.getTime() / SEQUENCE_BACKFILL_ROTATION_PERIOD_MS);
  const pivot = new Date(since.getTime() + Math.floor(((round * SEQUENCE_BACKFILL_ROTATION_STEP) % 1) * SEQUENCE_BACKFILL_WINDOW_MS));
  const results: Array<{ status: EnrollmentResult["status"] }> = [];
  // [pivot, now] first, then [since, pivot).
  for (const range of [{ from: pivot, to: now, toInclusive: true }, { from: since, to: pivot, toInclusive: false }]) {
    let after: BackfillCandidate | null = null;
    while (results.length < scanLimit) {
      if (options.deadline !== undefined && Date.now() >= options.deadline) return results;
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
          AND f."verifiedAt" >= ${utcTimestamp(range.from)}
          AND ${range.toInclusive ? Prisma.sql`f."verifiedAt" <= ${utcTimestamp(range.to)}` : Prisma.sql`f."verifiedAt" < ${utcTimestamp(range.to)}`}
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
        if (options.deadline !== undefined && Date.now() >= options.deadline) return results;
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
          if (error instanceof SequenceConfigurationError) {
            reportConfiguration(error);
            return results;
          }
          // Skipped for this round only; the next round starts elsewhere in the window.
          reportFailure(error, "backfill_enrollment", "failed");
          results.push({ status: "not_eligible" });
        }
      }
      if (page.length < take) break;
    }
  }
  return results;
}

export type Lease = {
  id: string;
  vendorId: string;
  claimedAt: Date;
  attemptCount: number;
  cursorDelayMinutes: number;
};

/** Every write after the claim must still hold this exact lease. */
export function leaseWhere(lease: Lease): Prisma.DelayedStepRunWhereInput {
  return {
    id: lease.id,
    vendorId: lease.vendorId,
    status: "active",
    claimedAt: lease.claimedAt,
    attemptCount: lease.attemptCount,
    cursorDelayMinutes: lease.cursorDelayMinutes,
  };
}

export class LeaseLostError extends Error {
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
    | "skipped_already_sent"
    | "waiting_template"
    | "waiting_previous"
    | "definition_changed"
    | "rescheduled"
    | "completed"
    | "cancelled"
    | "claimed_elsewhere"
    | "failed"
    // F-4 automation steps (automation-delayed-steps.ts).
    | "executed"
    | "condition_not_met"
    | "skipped_invalid"
    | "waiting_capacity";
  cancelReason?: DelayedStepCancelReason;
  /** E-mails an automation step queued (a sequence step's `queued` counts as one). */
  emailsQueued?: number;
};

/** E-mails one result put into the sequence queue, for the round's creation quota. */
function emailsQueuedBy(result: DelayedStepResult) {
  if (result.status === "queued") return 1;
  return result.emailsQueued ?? 0;
}

export async function cancelLeasedRun(db: Database, lease: Lease, reason: DelayedStepCancelReason): Promise<DelayedStepResult> {
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

class DefinitionChangedError extends Error {
  constructor() {
    super("Email sequence changed while the step ran.");
    this.name = "DefinitionChangedError";
  }
}

/**
 * Every write that follows from the steps the worker read: inside one
 * transaction, the sequence row is read FOR SHARE and must still be active at
 * the version the steps were read with (M1). A save in between makes the
 * worker drop its result and release the lease, so the next round recomputes
 * from the new steps instead of overwriting the save's re-timing.
 */
async function commitWithDefinition(
  db: Database,
  lease: Lease,
  sequence: { id: string; version: number },
  work: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<"committed" | "lease_lost" | "definition_changed"> {
  try {
    await db.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<Array<{ version: number }>>`
        SELECT "version" FROM "EmailSequence"
        WHERE "id" = ${sequence.id} AND "vendorId" = ${lease.vendorId} AND "status" = 'active'
        FOR SHARE
      `;
      if (!current || current.version !== sequence.version) throw new DefinitionChangedError();
      await work(tx);
    });
    return "committed";
  } catch (error) {
    if (error instanceof LeaseLostError) return "lease_lost";
    if (error instanceof DefinitionChangedError) {
      // Give the attempt back: nothing was done, the next round starts over.
      await db.delayedStepRun.updateMany({
        where: leaseWhere(lease),
        data: { claimedAt: null, attemptCount: Math.max(0, lease.attemptCount - 1) },
      });
      return "definition_changed";
    }
    throw error;
  }
}

function outcomeOf(lease: Lease, committed: Awaited<ReturnType<typeof commitWithDefinition>>, status: DelayedStepResult["status"]): DelayedStepResult {
  if (committed === "committed") return { runId: lease.id, status };
  return { runId: lease.id, status: committed === "definition_changed" ? "definition_changed" : "claimed_elsewhere" };
}

const SUBJECT_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 25_000;

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
          version: true,
          activatedAt: true,
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
  // Pausing cancels every active run and resuming moves activatedAt forward,
  // so an active run anchored before the current activation was added while
  // the sequence was paused (an enrollment racing the pause): it never
  // continues after the resume.
  if (sequence.activatedAt && run.anchorAt < sequence.activatedAt) return cancelLeasedRun(db, lease, "definition_paused");
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
    return outcomeOf(lease, await commitWithDefinition(db, lease, sequence, async (tx) => {
      const completed = await tx.delayedStepRun.updateMany({
        where: leaseWhere(lease),
        data: { status: "completed", nextRunAt: null, claimedAt: null, attemptCount: 0 },
      });
      if (completed.count !== 1) throw new LeaseLostError();
    }), "completed");
  }

  const dueAt = new Date(run.anchorAt.getTime() + step.delayMinutes * 60_000);
  if (dueAt > now) {
    // The step moved later (or the earlier one was switched off): wait for it.
    return outcomeOf(lease, await commitWithDefinition(db, lease, sequence, async (tx) => {
      const rescheduled = await tx.delayedStepRun.updateMany({
        where: leaseWhere(lease),
        data: { nextRunAt: dueAt, claimedAt: null, attemptCount: 0 },
      });
      if (rescheduled.count !== 1) throw new LeaseLostError();
    }), "rescheduled");
  }

  const stale = now.getTime() - dueAt.getTime() > DELAYED_STEP_STALE_AFTER_MS;
  const template = step.messageTemplate;
  if (!stale && !isSequenceTemplateAvailable(template, lease.vendorId)) {
    // The template was switched off or re-purposed (the template editor
    // refuses this while an active sequence uses it, so this is e.g. a
    // sequence resumed after the change). Keep the cursor and try again next
    // round; once the step is more than 24 hours late it is skipped below.
    return outcomeOf(lease, await commitWithDefinition(db, lease, sequence, async (tx) => {
      const waiting = await tx.delayedStepRun.updateMany({
        where: leaseWhere(lease),
        data: { nextRunAt: new Date(now.getTime() + DELAYED_STEP_TEMPLATE_RETRY_MS), claimedAt: null, attemptCount: 0 },
      });
      if (waiting.count !== 1) throw new LeaseLostError();
    }), "waiting_template");
  }

  if (!stale) {
    // One step in the queue per person (MAJOR 2): while an earlier step e-mail
    // of this run still waits to be sent (or retried), this step waits too.
    const previousPending = await db.emailDelivery.findFirst({
      where: {
        vendorId: lease.vendorId,
        sourceFormSubmissionId: submission.id,
        trigger: SEQUENCE_EMAIL_TRIGGER,
        idempotencyKey: { startsWith: `sequence-email/${run.id}/` },
        status: { in: ["queued", "failed", "sending"] },
      },
      select: { id: true },
    });
    if (previousPending) {
      return outcomeOf(lease, await commitWithDefinition(db, lease, sequence, async (tx) => {
        const waiting = await tx.delayedStepRun.updateMany({
          where: leaseWhere(lease),
          data: { nextRunAt: new Date(now.getTime() + DELAYED_STEP_TEMPLATE_RETRY_MS), claimedAt: null, attemptCount: 0 },
        });
        if (waiting.count !== 1) throw new LeaseLostError();
      }), "waiting_previous");
    }
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
  if (stale) {
    outcome = "skipped_stale";
  } else if (!hasValidSequenceTemplateContent(template)) {
    // Missing subject or body, or an unknown variable: retrying cannot fix it.
    outcome = "skipped_template";
  } else {
    const deliveryId = stableSequenceDeliveryId({
      vendorId: lease.vendorId,
      runId: run.id,
      stepId: step.id,
      template: { id: template.id, subject: template.subject ?? "", body: template.body },
    });
    // Configuration, key and database errors below are thrown on purpose: the
    // lease keeps the run and a later round retries the same step (S3).
    const unsubscribeUrl = configured(() => createEmailUnsubscribeUrl(deliveryId));
    const liveUrl = configured(() => createLiveViewerUrl(live.slug));
    const variables = {
      name: submission.name,
      live_title: live.title,
      live_url: liveUrl,
      live_start_at: await sequenceLiveStartText(db, live, submission, now),
      vendor_name: live.vendor.name,
      unsubscribe_url: unsubscribeUrl,
    };
    const subject = renderMessageTemplate(template.subject ?? "", variables).replace(/\s+/gu, " ").trim();
    // Marketing mail: the unsubscribe link is always there.
    const body = ensureEmailUnsubscribeFooter(renderMessageTemplate(template.body, variables), unsubscribeUrl);
    if (!subject || subject.length > SUBJECT_MAX_LENGTH || !body.trim() || body.length > BODY_MAX_LENGTH) {
      // The rendered mail does not fit the delivery limits (deterministic).
      reportFailure(new Error("Rendered sequence e-mail exceeds the delivery limits."), "render_step", "skipped");
      outcome = "skipped_template";
    } else {
      // Lengths and the address were checked above, so a failure here is a key problem.
      const payload = configured(() => protectEmailDeliveryPayload({
        recipientEmail: recipient.normalized,
        subject,
        body,
        brand: {
          senderName: live.vendor.senderName,
          supportEmail: live.vendor.supportEmail,
          contactUrl: live.vendor.contactUrl,
        },
      }, { vendorId: lease.vendorId, deliveryId }));
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
        // The send-time guard ages a step e-mail from this moment.
        createdAt: now,
      };
    }
  }

  const committed = await commitWithDefinition(db, lease, sequence, async (tx) => {
    // Moving the cursor and creating the step's e-mail commit together.
    const advanced = await tx.delayedStepRun.updateMany({ where: leaseWhere(lease), data: advance });
    if (advanced.count !== 1) throw new LeaseLostError();
    if (!delivery) return;
    // One e-mail per person and step, whatever the step edits did (B1): any
    // earlier e-mail of this run and step, in any state, means this step is
    // done. Read by the registration index, bound to the vendor.
    const earlier = await tx.emailDelivery.findFirst({
      where: {
        vendorId: lease.vendorId,
        sourceFormSubmissionId: submission.id,
        trigger: SEQUENCE_EMAIL_TRIGGER,
        idempotencyKey: { startsWith: sequenceEmailIdempotencyPrefix(run.id, step.id) },
      },
      select: { id: true },
    });
    if (earlier) {
      outcome = "skipped_already_sent";
      return;
    }
    await tx.emailDelivery.createMany({ data: [delivery], skipDuplicates: true });
  });
  return outcomeOf(lease, committed, outcome);
}

export type DelayedStepBudget = {
  /** Runs claimed per round, all vendors together. */
  runs: number;
  /**
   * Step e-mails this round may create before subtracting the sequence
   * e-mails still waiting to be sent (defaults to the dispatch quota).
   */
  emails: number;
};

export const DEFAULT_DELAYED_STEP_BUDGET: DelayedStepBudget = {
  runs: DELAYED_STEP_BATCH_LIMIT,
  emails: SEQUENCE_EMAIL_CREATE_LIMIT,
};

/** Sequence and delayed-automation e-mails of active vendors still waiting to be sent (or being sent). */
export async function countPendingSequenceEmails(db: Pick<Database, "emailDelivery">, vendorId?: string) {
  return db.emailDelivery.count({
    where: {
      ...(vendorId ? { vendorId } : {}),
      trigger: { in: [...DELAYED_STEP_EMAIL_TRIGGERS] },
      status: { in: ["queued", "failed", "sending"] },
      // A suspended vendor's queue is not dispatched and must not block others.
      vendor: { is: { suspendedAt: null } },
    },
  });
}

/**
 * Probes everything a step e-mail needs from the deployment: the e-mail
 * provider settings (API key and a parsable sender, as sendTransactionalEmail
 * requires them), the public URL and the signing and encryption keys. Returns
 * the problem, or null. A problem belongs to the platform, not to any run.
 */
export function sequenceRuntimeProblem(options: { requireProvider?: boolean } = {}): SequenceConfigurationError | null {
  try {
    if (options.requireProvider !== false && !isTransactionalEmailConfigured()) throw new Error("E-mail provider settings are missing.");
    const probeId = `email_${"0".repeat(32)}`;
    createEmailUnsubscribeUrl(probeId);
    createLiveViewerUrl("probe");
    createEmailRecipientHash("probe@example.invalid", "probe");
    automationCustomerKeyHash("probe", "probe@example.invalid");
    protectEmailDeliveryPayload({ recipientEmail: "probe@example.invalid", subject: "probe", body: "probe" }, { vendorId: "probe", deliveryId: probeId });
    return null;
  } catch (error) {
    return error instanceof SequenceConfigurationError ? error : new SequenceConfigurationError(error);
  }
}

/** Reports a configuration problem; callers pass one reporter per job round so a round reports it once. */
export type ConfigurationReporter = (error: SequenceConfigurationError) => void;

const reportConfigurationProblem: ConfigurationReporter = (error) => reportFailure(error, "configuration", "skipped");

/** One reporter for a whole job round: the first problem is reported, later ones in the same round are not. */
export function onceConfigurationReporter(): ConfigurationReporter {
  let reported = false;
  return (error) => {
    if (reported) return;
    reported = true;
    reportConfigurationProblem(error);
  };
}

/**
 * Steps more than 24 hours late are skipped in bulk, before any run is
 * claimed (MAJOR 3): they send nothing, so they must not take a vendor's turn
 * or the round's run budget. Each pass moves every such run past one step;
 * a run with no step left after it is made due now so the worker completes it.
 * Leased runs, paused sequences, suspended vendors and closed grants are left
 * alone, like in the worker.
 */
async function skipStaleSteps(db: Database, now: Date, vendorId: string | undefined, pastDeadline: () => boolean) {
  const staleBefore = new Date(now.getTime() - DELAYED_STEP_STALE_AFTER_MS);
  const leaseCutoff = new Date(now.getTime() - DELAYED_STEP_LEASE_MS);
  let skipped = 0;
  for (let pass = 0; pass < MAX_STALE_SKIP_PASSES; pass += 1) {
    if (pastDeadline()) break;
    // m3: the sequences involved are read FOR SHARE first, in the same
    // transaction. A merchant save holds its sequence row while it changes the
    // steps and re-times the runs, so this pass either waits for that save and
    // then (new statement, new snapshot) computes from the saved steps, or
    // the save waits for this pass and re-times the runs after it.
    const updated = await db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT q."id" FROM "EmailSequence" q
        JOIN "Vendor" v ON v."id" = q."vendorId"
        WHERE q."status" = 'active'
          ${vendorId ? Prisma.sql`AND q."vendorId" = ${vendorId}` : Prisma.empty}
          AND v."suspendedAt" IS NULL
          AND ${EMAIL_SEQUENCES_FEATURE} = ANY(v."betaFeatureGrants")
          AND EXISTS (
            SELECT 1 FROM "DelayedStepRun" r
            WHERE r."vendorId" = q."vendorId" AND r."emailSequenceId" = q."id"
              AND r."status" = 'active' AND r."nextRunAt" <= ${utcTimestamp(now)}
          )
        ORDER BY q."id"
        FOR SHARE OF q
      `;
      return tx.$executeRaw`
      WITH due AS (
        SELECT r."id",
          (
            SELECT MIN(s."delayMinutes") FROM "EmailSequenceStep" s
            WHERE s."vendorId" = r."vendorId" AND s."emailSequenceId" = r."emailSequenceId"
              AND s."isActive" AND s."delayMinutes" > r."cursorDelayMinutes"
          ) AS "nextDelay"
        FROM "DelayedStepRun" r
        JOIN "EmailSequence" q ON q."id" = r."emailSequenceId" AND q."vendorId" = r."vendorId" AND q."status" = 'active'
        JOIN "Vendor" v ON v."id" = r."vendorId"
        WHERE r."status" = 'active'
          ${vendorId ? Prisma.sql`AND r."vendorId" = ${vendorId}` : Prisma.empty}
          AND r."nextRunAt" <= ${utcTimestamp(now)}
          AND (r."claimedAt" IS NULL OR r."claimedAt" <= ${utcTimestamp(leaseCutoff)})
          AND v."suspendedAt" IS NULL
          AND ${EMAIL_SEQUENCES_FEATURE} = ANY(v."betaFeatureGrants")
          AND r."anchorAt" >= q."activatedAt"
      )
      UPDATE "DelayedStepRun" AS r
      SET "cursorDelayMinutes" = due."nextDelay",
          "nextRunAt" = COALESCE(
            r."anchorAt" + make_interval(mins => (
              SELECT MIN(s."delayMinutes") FROM "EmailSequenceStep" s
              WHERE s."vendorId" = r."vendorId" AND s."emailSequenceId" = r."emailSequenceId"
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

/** Fractional part of the golden ratio: multiples of it spread evenly over [0, 1) whatever the step. */
const GOLDEN_FRACTION = 0.6180339887498949;

/**
 * The vendor this round starts with (M1). The start is random (`random`,
 * Math.random by default): with n vendors and a capacity for c of them, every
 * vendor is reached in a round with probability about c/n, so the expected
 * wait is n/c rounds whatever the job cadence. A second term, the minute of
 * the round times the golden ratio, spreads the start evenly over the vendors
 * for any cadence (a 5-minute heartbeat included), so even a random source
 * that keeps returning the same value cannot leave one vendor out forever.
 */
function rotate<T>(items: T[], now: Date, random: () => number) {
  if (items.length === 0) return items;
  const minute = Math.floor(now.getTime() / 60_000);
  const spread = (minute * GOLDEN_FRACTION) % 1;
  const offset = Math.min(Math.max(random(), 0), 0.999999);
  const start = Math.floor(((offset + spread) % 1) * items.length);
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * The job's worker (§3「Worker」). Each round:
 * 1. stops at once (nothing claimed, one monitoring event) when the
 *    deployment cannot build step e-mails;
 * 2. skips steps more than 24 hours late in bulk (no claim, no budget);
 * 3. creates step e-mails only into free dispatch capacity: the dispatch
 *    quota minus the sequence e-mails still waiting (MAJOR 2);
 * 4. shares that capacity between the vendors with due runs, starting from a
 *    random vendor every round: each vendor's share is what is left divided
 *    by the vendors still to come, and a second pass hands leftover capacity
 *    to vendors that used their whole share (MAJOR 3, M1, M2). At most one
 *    step per run, claimed with a compare-and-set.
 * Runs not reached stay active with nextRunAt unchanged. Sequence runs only
 * for non-suspended vendors with the email_sequences grant (a closed grant
 * keeps the runs but never runs them); F-4 automation runs for any
 * non-suspended vendor, on the same claims, lateness rule and e-mail capacity
 * (an automation step starts only when all its e-mails fit, and each one it
 * queues counts like a sequence e-mail). `deadline` (epoch ms) stops the
 * round before the next run.
 */
export async function processDueDelayedStepRuns(
  /** `vendorId` scopes one run to a single tenant (tests, operations); the job runs unscoped. */
  options: {
    now?: Date;
    vendorId?: string;
    budget?: Partial<DelayedStepBudget>;
    deadline?: number;
    /** Source of the random starting vendor (tests pass a reproducible one). */
    random?: () => number;
    onConfigurationError?: ConfigurationReporter;
    /**
     * F-4 automation runs. Injected (runDelayedStepWorker in
     * automation-delayed-steps.ts passes it) because the automation engine
     * reaches email-delivery.ts, which imports this module. Without it only
     * sequence runs are selected.
     */
    automation?: AutomationRunProcessor;
  } = {},
  db: Database = getDb(),
): Promise<DelayedStepResult[]> {
  const now = options.now ?? new Date();
  const budget = { ...DEFAULT_DELAYED_STEP_BUDGET, ...options.budget };
  const reportConfiguration = options.onConfigurationError ?? reportConfigurationProblem;
  const pastDeadline = () => options.deadline !== undefined && Date.now() >= options.deadline;
  if (pastDeadline()) return [];
  // A missing URL or key stops the whole round (nothing is claimed).
  const keyProblem = sequenceRuntimeProblem({ requireProvider: false });
  if (keyProblem) {
    reportConfiguration(keyProblem);
    return [];
  }
  // m1: without an e-mail provider no sequence run is claimed or changed and
  // no e-mail is created; automation steps without an e-mail still run (M3).
  // (One probe of the keys per round; the provider is only its settings.)
  const providerProblem = isTransactionalEmailConfigured() ? null : new SequenceConfigurationError(new Error("E-mail provider settings are missing."));
  if (providerProblem) reportConfiguration(providerProblem);
  if (!providerProblem) {
    await skipStaleSteps(db, now, options.vendorId, pastDeadline);
    if (pastDeadline()) return [];
  }
  // F-4: the same bulk skip for automation runs (rules locked FOR SHARE).
  if (options.automation) {
    await options.automation.skipStale(db, now, options.vendorId, pastDeadline, MAX_STALE_SKIP_PASSES);
    if (pastDeadline()) return [];
  }
  const pending = providerProblem ? 0 : await countPendingSequenceEmails(db, options.vendorId);
  const emailCapacity = providerProblem ? 0 : Math.max(0, budget.emails - pending);
  const dueWhere = dueRunWhere(now, options.vendorId, Boolean(options.automation));
  const round: WorkerRound = { db, now, budget, pastDeadline, reportConfiguration, automation: options.automation, results: [] };
  const stopped = await runFairPasses(round, dueWhere, emailCapacity, options.random ?? Math.random);
  if (stopped || !options.automation) return round.results;
  await runEmailFreeAutomationRuns(round, options.vendorId);
  return round.results;
}

/** Due, unleased runs of active vendors holding the grant of their kind. */
function dueRunWhere(now: Date, vendorId: string | undefined, withAutomation: boolean): Prisma.DelayedStepRunWhereInput {
  const leaseCutoff = new Date(now.getTime() - DELAYED_STEP_LEASE_MS);
  return {
    ...(vendorId ? { vendorId } : {}),
    status: "active",
    nextRunAt: { lte: now },
    AND: [
      { OR: [{ claimedAt: null }, { claimedAt: { lte: leaseCutoff } }] },
      {
        OR: [
          // F-3 sequences: only vendors holding the email_sequences grant.
          { emailSequenceId: { not: null }, vendor: { is: { suspendedAt: null, betaFeatureGrants: { has: EMAIL_SEQUENCES_FEATURE } } } },
          // F-4 automation rules: only vendors holding the
          // automation_delayed_steps grant, and only when the caller brings the
          // automation processor.
          ...(withAutomation ? [{ automationRuleId: { not: null }, vendor: { is: { suspendedAt: null, betaFeatureGrants: { has: AUTOMATION_DELAYED_STEPS_GRANT } } } }] : []),
        ],
      },
    ],
  };
}

type WorkerRound = {
  db: Database;
  now: Date;
  budget: DelayedStepBudget;
  pastDeadline: () => boolean;
  reportConfiguration: ConfigurationReporter;
  automation: AutomationRunProcessor | undefined;
  results: DelayedStepResult[];
};

/**
 * The e-mail-bound part of a round: vendors in turn, each with its share of
 * the e-mail capacity (M1, M2, MAJOR 3). Returns true when a deployment
 * problem stopped the round.
 */
async function runFairPasses(round: WorkerRound, dueWhere: Prisma.DelayedStepRunWhereInput, emailCapacity: number, random: () => number) {
  const { db, now, budget, results, pastDeadline } = round;
  if (emailCapacity <= 0) return false;
  const vendorRows = await db.delayedStepRun.groupBy({
    by: ["vendorId"],
    where: dueWhere,
    orderBy: { vendorId: "asc" },
    take: DELAYED_STEP_VENDORS_PER_ROUND,
  });
  let vendors = rotate(vendorRows.map((row) => row.vendorId), now, random);
  let emails = 0;
  for (let pass = 0; pass < DELAYED_STEP_VENDOR_PASSES && vendors.length > 0; pass += 1) {
    // Vendors that used their whole share may have more due runs for the next pass.
    const stillDue: string[] = [];
    for (const [index, vendorId] of vendors.entries()) {
      if (results.length >= budget.runs || emails >= emailCapacity || pastDeadline()) return false;
      // M2: the share is recomputed before each vendor from what is left, so
      // capacity a vendor does not need flows to the vendors after it.
      const share = Math.max(1, Math.floor((emailCapacity - emails) / (vendors.length - index)));
      const candidates = await db.delayedStepRun.findMany({
        where: { ...dueWhere, vendorId },
        orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
        take: Math.min(budget.runs - results.length, share + DELAYED_STEP_EXTRA_RUNS_PER_VENDOR),
        select: { id: true, vendorId: true, updatedAt: true, cursorDelayMinutes: true, attemptCount: true, automationRuleId: true },
      });
      let vendorEmails = 0;
      for (const candidate of candidates) {
        if (emails >= emailCapacity || vendorEmails >= share || pastDeadline()) break;
        const result = await processCandidate(db, candidate, now, round.reportConfiguration, emailCapacity - emails, round.automation);
        // A deployment problem showed up mid-round: the lease was given back
        // without using an attempt and the problem was reported; stop.
        if (result === CONFIGURATION_FAILED) return true;
        results.push(result);
        const queued = emailsQueuedBy(result);
        emails += queued;
        vendorEmails += queued;
      }
      if (vendorEmails >= share) stillDue.push(vendorId);
    }
    vendors = stillDue;
  }
  return false;
}

/**
 * M3: automation steps without an e-mail never wait for e-mail capacity (or
 * for an e-mail provider). Once the e-mail capacity is used up, or when there
 * is none, they run in due order on the rest of the run budget. A run already
 * handled this round is left alone (one step per run and round).
 */
async function runEmailFreeAutomationRuns(round: WorkerRound, vendorId: string | undefined) {
  const { automation, results } = round;
  const room = round.budget.runs - results.length;
  if (!automation || room <= 0 || round.pastDeadline()) return;
  const emailFree = await automation.dueWithoutEmail(round.db, { now: round.now, vendorId, exclude: results.map((result) => result.runId), limit: room });
  for (const candidate of emailFree) {
    if (round.pastDeadline()) break;
    const result = await processCandidate(round.db, candidate, round.now, round.reportConfiguration, 0, automation);
    if (result === CONFIGURATION_FAILED) return;
    results.push(result);
  }
}

/** Grant checked by the worker for automation runs (automation-workflow.ts AUTOMATION_DELAYED_STEPS_FEATURE). */
const AUTOMATION_DELAYED_STEPS_GRANT = "automation_delayed_steps";

const CONFIGURATION_FAILED = Symbol("configuration_failed");

/** The automation half of the worker (implemented in automation-delayed-steps.ts). */
export type AutomationRunProcessor = {
  /** One leased automation run; `emailRoom` is what the round may still create. */
  processClaimed: (db: Database, lease: Lease, now: Date, emailRoom: number) => Promise<DelayedStepResult>;
  /**
   * Due automation runs whose next step queues no e-mail (or that only need
   * completing), oldest first, without `exclude`; the same claim fields as
   * the fair loop's candidates.
   */
  dueWithoutEmail: (db: Database, input: { now: Date; vendorId: string | undefined; exclude: string[]; limit: number }) => Promise<Array<{
    id: string; vendorId: string; updatedAt: Date; cursorDelayMinutes: number; attemptCount: number; automationRuleId: string | null;
  }>>;
  /** Bulk skip of steps more than 24 hours late, before any claim. */
  skipStale: (db: Database, now: Date, vendorId: string | undefined, pastDeadline: () => boolean, maxPasses: number) => Promise<number>;
};

async function processCandidate(
  db: Database,
  candidate: { id: string; vendorId: string; updatedAt: Date; cursorDelayMinutes: number; attemptCount: number; automationRuleId: string | null },
  now: Date,
  reportConfiguration: ConfigurationReporter,
  emailRoom: number,
  automation: AutomationRunProcessor | undefined,
): Promise<DelayedStepResult | typeof CONFIGURATION_FAILED> {
  let lease: Lease | null = null;
  try {
    if (candidate.attemptCount >= DELAYED_STEP_MAX_ATTEMPTS) {
      const exhausted = await db.delayedStepRun.updateMany({
        where: { id: candidate.id, vendorId: candidate.vendorId, status: "active", updatedAt: candidate.updatedAt },
        data: { status: "cancelled", cancelReason: "failed", nextRunAt: null, claimedAt: null },
      });
      if (exhausted.count === 1) reportFailure(new Error("Delayed step run exhausted its attempts."), "retry_limit", "cancelled");
      return exhausted.count === 1
        ? { runId: candidate.id, status: "cancelled", cancelReason: "failed" }
        : { runId: candidate.id, status: "claimed_elsewhere" };
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
    if (claimed.count !== 1) return { runId: candidate.id, status: "claimed_elsewhere" };
    lease = {
      id: candidate.id,
      vendorId: candidate.vendorId,
      claimedAt,
      attemptCount: candidate.attemptCount + 1,
      cursorDelayMinutes: candidate.cursorDelayMinutes,
    };
    if (candidate.automationRuleId) {
      // Not selected without a processor (dueWhere); kept as a guard.
      if (!automation) return { runId: candidate.id, status: "claimed_elsewhere" };
      return await automation.processClaimed(db, lease, now, emailRoom);
    }
    return await processClaimedRun(db, lease, now);
  } catch (error) {
    // m2: a key or URL error is only the platform's when the deployment probe
    // fails again now; otherwise it is this run's own failure and counts.
    const platformProblem = error instanceof SequenceConfigurationError ? sequenceRuntimeProblem() : null;
    if (platformProblem && lease) {
      // Not this run's fault: give the lease back without using an attempt.
      await db.delayedStepRun.updateMany({
        where: leaseWhere(lease),
        data: { claimedAt: null, attemptCount: candidate.attemptCount },
      }).catch(() => undefined);
      reportConfiguration(platformProblem);
      return CONFIGURATION_FAILED;
    }
    // The lease stays; the run is claimable again after DELAYED_STEP_LEASE_MS,
    // and only these run-specific failures count towards the attempt limit.
    reportFailure(error, "process_step", "failed");
    return { runId: candidate.id, status: "failed" };
  }
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

/**
 * Send-time guard for `automation_step` (F-4): the e-mail is normally created
 * and sent in the same round; one still unsent SEQUENCE_EMAIL_SEND_STALE_MS
 * after it was created is superseded, like a sequence e-mail, and so is any
 * once the vendor's automation_delayed_steps grant is closed. Unsubscribe and
 * blacklist are checked at send like every automation e-mail
 * (dispatchEmailDelivery).
 */
export async function isCurrentAutomationStepEmailDelivery(
  delivery: { trigger: string; vendorId: string; createdAt?: Date; idempotencyKey?: string },
  now: Date,
  database: Pick<Prisma.TransactionClient, "vendor" | "automationExecutionLog" | "automationRule" | "delayedStepRun">,
) {
  if (delivery.trigger !== AUTOMATION_STEP_EMAIL_TRIGGER) return true;
  if (!delivery.createdAt || now.getTime() - delivery.createdAt.getTime() > SEQUENCE_EMAIL_SEND_STALE_MS) return false;
  // M3: a vendor whose automation_delayed_steps grant was closed sends none of its queued step e-mails.
  const vendor = await database.vendor.findUnique({ where: { id: delivery.vendorId }, select: { betaFeatureGrants: true, suspendedAt: true } });
  if (!vendor || vendor.suspendedAt || !isFeatureEnabled(vendor, AUTOMATION_DELAYED_STEPS_GRANT)) return false;
  // Review MINOR-3: the e-mail's key names its step execution; the rule must
  // still be switched on and the run not stopped (a switch-off or another
  // stop that came after the step ran supersedes the e-mail). All reads are
  // bound to the delivery's vendor.
  const key = parseAutomationStepEmailIdempotencyKey(delivery.idempotencyKey);
  if (!key) return false;
  const log = await database.automationExecutionLog.findFirst({
    where: { id: key.executionLogId, vendorId: delivery.vendorId },
    select: { ruleId: true, eventId: true },
  });
  const step = log ? parseAutomationStepEventId(log.eventId) : null;
  if (!log || !step) return false;
  const [rule, run] = await Promise.all([
    database.automationRule.findFirst({ where: { id: log.ruleId, vendorId: delivery.vendorId, isActive: true }, select: { id: true } }),
    database.delayedStepRun.findFirst({ where: { id: step.runId, vendorId: delivery.vendorId, automationRuleId: log.ruleId }, select: { status: true } }),
  ]);
  return Boolean(rule && run && run.status !== "cancelled");
}

type SequenceSnapshotDatabase = Pick<Prisma.TransactionClient, "delayedStepRun" | "blacklist" | "vendor">;

/**
 * Send-time guard for `sequence_email` (§4「寄信」): the run is still active or
 * completed, its sequence is active, the step is still active, the template is
 * still usable and its id and content still produce this delivery's id, the
 * recipient is not on the vendor's blacklist, the vendor still holds the
 * email_sequences grant (M2), and the e-mail was created less than 24 hours
 * ago (the worker's lateness rule, S1). Otherwise the delivery is superseded.
 */
export async function isCurrentSequenceEmailDelivery(
  delivery: {
    id: string;
    vendorId: string;
    sourceLiveId: string | null;
    sourceFormSubmissionId: string | null;
    trigger: string;
    idempotencyKey?: string;
    createdAt?: Date;
  },
  now: Date,
  database: SequenceSnapshotDatabase,
) {
  if (delivery.trigger !== SEQUENCE_EMAIL_TRIGGER) return true;
  if (!delivery.sourceLiveId || !delivery.sourceFormSubmissionId) return false;
  if (!delivery.createdAt || now.getTime() - delivery.createdAt.getTime() > SEQUENCE_EMAIL_SEND_STALE_MS) return false;
  if (!await emailSequencesEnabled(database, delivery.vendorId)) return false;
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
