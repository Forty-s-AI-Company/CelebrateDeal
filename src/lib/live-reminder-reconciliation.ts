import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { ensureLiveReminderDelivery } from "@/lib/email-delivery";
import { hasOnlySupportedMessageTemplateVariables } from "@/lib/message-template";

const JOB_LEASE_MS = 10 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 250;
const JOB_MAX_ATTEMPTS = 5;
const REMINDER_OFFSETS = new Set([15, 30, 60, 180, 1440]);

export type LiveReminderTemplateSnapshot = {
  id: string;
  vendorId: string;
  channel: string;
  trigger: string;
  subject: string | null;
  body: string;
  isActive: boolean;
  updatedAt?: Date;
  revision?: string | number | null;
};

export type LiveReminderReconciliationSnapshot = {
  vendorId: string;
  liveId: string;
  liveTitle: string;
  liveStatus: string;
  scheduledAt: Date;
  reminderOffsetMinutes: number;
  template: LiveReminderTemplateSnapshot | null;
  templateId: string | null;
  templateRevision: string | null;
  configDigest: string;
  isDeliverable: boolean;
};

type ReconciliationDelegate = {
  updateMany(args: unknown): Promise<{ count: number }>;
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown>;
  findFirst?(args: unknown): Promise<unknown>;
  create?(args: unknown): Promise<unknown>;
  update?(args: unknown): Promise<unknown>;
};

type ReconciliationDb = {
  liveReminderReconciliationJob: ReconciliationDelegate;
  emailDelivery: ReconciliationDelegate;
  live: ReconciliationDelegate;
  formSubmission: ReconciliationDelegate;
};

type ReconciliationJob = {
  id: string;
  vendorId: string;
  liveId: string;
  configDigest: string;
  lifecycle: string;
  attemptCount: number;
  maxAttempts: number;
  updatedAt: Date;
  cursorCreatedAt: Date | null;
  cursorId: string | null;
};

type CurrentLive = {
  id: string;
  vendorId: string;
  title: string;
  status: string;
  scheduledAt: Date;
  liveReminderOffsetMinutes: number;
  liveReminderTemplate: LiveReminderTemplateSnapshot | null;
  vendor: {
    name: string;
    senderName: string | null;
    supportEmail: string | null;
    contactUrl: string | null;
  };
};

type VerifiedSubmission = { id: string; name: string; email: string; createdAt: Date };

function asReconciliationDb(db: unknown) {
  return db as ReconciliationDb;
}

function stableDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function templateRevision(template: LiveReminderTemplateSnapshot) {
  if (template.revision !== null && template.revision !== undefined) return String(template.revision);
  return stableDigest([
    template.id,
    template.channel,
    template.trigger,
    template.isActive,
    template.subject,
    template.body,
    template.updatedAt?.toISOString() ?? null,
  ]);
}

function isValidTemplate(vendorId: string, template: LiveReminderTemplateSnapshot | null) {
  return Boolean(
    template
    && template.vendorId === vendorId
    && template.isActive
    && template.channel === "email"
    && template.trigger === "live_reminder"
    && template.subject
    && hasOnlySupportedMessageTemplateVariables(template.subject)
    && hasOnlySupportedMessageTemplateVariables(template.body)
  );
}

/** Builds the immutable, server-derived configuration identity for one live. */
export function createLiveReminderReconciliationSnapshot(input: {
  vendorId: string;
  liveId: string;
  liveTitle: string;
  liveStatus: string;
  scheduledAt: Date;
  reminderOffsetMinutes: number;
  template: LiveReminderTemplateSnapshot | null;
}, now = new Date()): LiveReminderReconciliationSnapshot {
  const validTemplate = isValidTemplate(input.vendorId, input.template);
  const validOffset = REMINDER_OFFSETS.has(input.reminderOffsetMinutes);
  // `scheduled` and `live` use the same delivery identity. Keep the raw
  // status as evidence, but do not restart a pending cursor for that change.
  const liveDeliverability = ["scheduled", "live"].includes(input.liveStatus) ? "active" : "inactive";
  const isDeliverable = validTemplate
    && validOffset
    && input.scheduledAt > now
    && liveDeliverability === "active";
  const resolvedTemplateId = input.template?.id ?? null;
  const resolvedTemplateRevision = input.template ? templateRevision(input.template) : null;
  const configDigest = stableDigest([
    input.vendorId,
    input.liveId,
    input.liveTitle,
    liveDeliverability,
    input.scheduledAt.toISOString(),
    input.reminderOffsetMinutes,
    resolvedTemplateId,
    resolvedTemplateRevision,
    isDeliverable,
    "live_reminder_reconciliation/v1",
  ]);

  return {
    ...input,
    templateId: resolvedTemplateId,
    templateRevision: resolvedTemplateRevision,
    configDigest,
    isDeliverable,
  };
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function supersedeQueuedReminderDeliveries(db: ReconciliationDb, vendorId: string, liveId: string) {
  return db.emailDelivery.updateMany({
    where: {
      vendorId,
      sourceLiveId: liveId,
      trigger: "live_reminder",
      status: { in: ["queued", "failed"] },
    },
    data: {
      status: "superseded",
      nextAttemptAt: null,
      claimedAt: null,
      lastErrorCode: "reconciliation_cancelled",
    },
  });
}

/**
 * Queue or reuse a deterministic job inside the caller's transaction. The
 * snapshot must come from trusted server state, never from a browser payload.
 */
export async function queueLiveReminderReconciliation(
  tx: Prisma.TransactionClient,
  snapshot: LiveReminderReconciliationSnapshot,
  now = new Date(),
) {
  const db = asReconciliationDb(tx);
  await db.liveReminderReconciliationJob.updateMany({
    where: {
      vendorId: snapshot.vendorId,
      liveId: snapshot.liveId,
      configDigest: { not: snapshot.configDigest },
      lifecycle: { in: ["pending", "processing"] },
    },
    data: { lifecycle: "superseded", supersededAt: now, claimedAt: null, nextAttemptAt: null, lastErrorCode: "config_superseded" },
  });

  const existing = await db.liveReminderReconciliationJob.findUnique({
    where: { vendorId_liveId_configDigest: { vendorId: snapshot.vendorId, liveId: snapshot.liveId, configDigest: snapshot.configDigest } },
    select: { id: true, lifecycle: true },
  }) as { id: string; lifecycle: string } | null;

  if (!snapshot.isDeliverable) {
    const cancelled = await supersedeQueuedReminderDeliveries(db, snapshot.vendorId, snapshot.liveId);
    if (existing) {
      await db.liveReminderReconciliationJob.update?.({
        where: { id: existing.id },
        data: { lifecycle: "completed", completedAt: now, claimedAt: null, nextAttemptAt: null, supersededCount: { increment: cancelled.count }, lastErrorCode: "config_not_deliverable" },
      });
      return { status: "reused_cancelled" as const, jobId: existing.id, cancelledCount: cancelled.count };
    }
    const job = await db.liveReminderReconciliationJob.create?.({
      data: {
        vendorId: snapshot.vendorId,
        liveId: snapshot.liveId,
        liveStatus: snapshot.liveStatus,
        configDigest: snapshot.configDigest,
        templateId: snapshot.templateId,
        templateRevision: snapshot.templateRevision,
        scheduledAt: snapshot.scheduledAt,
        reminderOffsetMinutes: snapshot.reminderOffsetMinutes,
        lifecycle: "completed",
        maxAttempts: JOB_MAX_ATTEMPTS,
        completedAt: now,
        supersededCount: cancelled.count,
        lastErrorCode: "config_not_deliverable",
      },
      select: { id: true },
    });
    return { status: "cancelled" as const, jobId: (job as { id: string }).id, cancelledCount: cancelled.count };
  }

  if (existing) {
    if (["pending", "processing"].includes(existing.lifecycle)) {
      return { status: "reused" as const, jobId: existing.id };
    }
    await db.liveReminderReconciliationJob.update?.({
      where: { id: existing.id },
      data: {
        lifecycle: "pending",
        liveStatus: snapshot.liveStatus,
        cursorCreatedAt: null,
        cursorId: null,
        scannedCount: 0,
        scheduledCount: 0,
        supersededCount: 0,
        claimedAt: null,
        attemptCount: 0,
        nextAttemptAt: now,
        lastErrorCode: null,
        completedAt: null,
        supersededAt: null,
      },
    });
    return { status: "reactivated" as const, jobId: existing.id };
  }
  try {
    const job = await db.liveReminderReconciliationJob.create?.({
      data: {
        vendorId: snapshot.vendorId,
        liveId: snapshot.liveId,
        liveStatus: snapshot.liveStatus,
        configDigest: snapshot.configDigest,
        templateId: snapshot.templateId,
        templateRevision: snapshot.templateRevision,
        scheduledAt: snapshot.scheduledAt,
        reminderOffsetMinutes: snapshot.reminderOffsetMinutes,
        lifecycle: "pending",
        maxAttempts: JOB_MAX_ATTEMPTS,
        nextAttemptAt: now,
      },
      select: { id: true },
    });
    return { status: "queued" as const, jobId: (job as { id: string }).id };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const duplicate = await db.liveReminderReconciliationJob.findUnique({
      where: { vendorId_liveId_configDigest: { vendorId: snapshot.vendorId, liveId: snapshot.liveId, configDigest: snapshot.configDigest } },
      select: { id: true },
    }) as { id: string } | null;
    if (!duplicate) throw error;
    return { status: "reused" as const, jobId: duplicate.id };
  }
}

async function currentSnapshot(db: ReconciliationDb, vendorId: string, liveId: string, now: Date) {
  const live = await db.live.findFirst?.({
    where: { id: liveId, vendorId },
    select: {
      id: true,
      vendorId: true,
      title: true,
      status: true,
      scheduledAt: true,
      liveReminderOffsetMinutes: true,
      liveReminderTemplate: {
        select: { id: true, vendorId: true, channel: true, trigger: true, subject: true, body: true, isActive: true, updatedAt: true },
      },
      vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
    },
  }) as CurrentLive | null | undefined;
  if (!live) return null;
  return {
    live,
    snapshot: createLiveReminderReconciliationSnapshot({
      vendorId: live.vendorId,
      liveId: live.id,
      liveTitle: live.title,
      liveStatus: live.status,
      scheduledAt: live.scheduledAt,
      reminderOffsetMinutes: live.liveReminderOffsetMinutes,
      template: live.liveReminderTemplate,
    }, now),
  };
}

async function finalizeJob(db: ReconciliationDb, job: ReconciliationJob, data: Record<string, unknown>) {
  return db.liveReminderReconciliationJob.updateMany({
    where: { id: job.id, lifecycle: "processing", attemptCount: job.attemptCount },
    data,
  });
}

async function markFailure(db: ReconciliationDb, job: ReconciliationJob, code: string, now: Date) {
  const isFinalAttempt = job.attemptCount >= job.maxAttempts;
  await finalizeJob(db, job, {
    lifecycle: "failed",
    claimedAt: null,
    nextAttemptAt: isFinalAttempt ? null : now,
    lastErrorCode: code,
  });
}

async function processClaimedJob(db: ReconciliationDb, job: ReconciliationJob, batchSize: number, now: Date) {
  const current = await currentSnapshot(db, job.vendorId, job.liveId, now);
  if (!current || current.snapshot.configDigest !== job.configDigest) {
    const cancelled = await supersedeQueuedReminderDeliveries(db, job.vendorId, job.liveId);
    await finalizeJob(db, job, {
      lifecycle: "superseded",
      supersededAt: now,
      claimedAt: null,
      nextAttemptAt: null,
      supersededCount: { increment: cancelled.count },
      lastErrorCode: "config_superseded",
    });
    return { jobId: job.id, status: "superseded" as const };
  }

  if (!current.snapshot.isDeliverable) {
    const cancelled = await supersedeQueuedReminderDeliveries(db, job.vendorId, job.liveId);
    await finalizeJob(db, job, {
      lifecycle: "completed",
      completedAt: now,
      claimedAt: null,
      nextAttemptAt: null,
      supersededCount: { increment: cancelled.count },
      lastErrorCode: "config_not_deliverable",
    });
    return { jobId: job.id, status: "cancelled" as const };
  }

  const cursor = job.cursorCreatedAt && job.cursorId
    ? { OR: [{ createdAt: { gt: job.cursorCreatedAt } }, { createdAt: job.cursorCreatedAt, id: { gt: job.cursorId } }] }
    : {};
  const submissions = await db.formSubmission.findMany({
    where: {
      liveId: job.liveId,
      verificationStatus: "VERIFIED",
      form: { vendorId: job.vendorId },
      ...cursor,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true, name: true, email: true, createdAt: true },
  }) as VerifiedSubmission[];

  if (submissions.length === 0) {
    await finalizeJob(db, job, { lifecycle: "completed", completedAt: now, claimedAt: null, nextAttemptAt: null, lastErrorCode: null });
    return { jobId: job.id, status: "completed" as const };
  }

  const beforeWrite = await currentSnapshot(db, job.vendorId, job.liveId, now);
  if (!beforeWrite || beforeWrite.snapshot.configDigest !== job.configDigest || !beforeWrite.snapshot.isDeliverable) {
    const cancelled = await supersedeQueuedReminderDeliveries(db, job.vendorId, job.liveId);
    await finalizeJob(db, job, {
      lifecycle: "superseded",
      supersededAt: now,
      claimedAt: null,
      nextAttemptAt: null,
      supersededCount: { increment: cancelled.count },
      lastErrorCode: "config_superseded",
    });
    return { jobId: job.id, status: "superseded" as const };
  }

  let scheduledCount = 0;
  try {
    for (const submission of submissions) {
      // The query is tenant-bound and VERIFIED-only; never backfill another live.
      const result = await ensureLiveReminderDelivery({
        vendorId: job.vendorId,
        // Read through the tenant-bound Live relation so {{vendor_name}} is
        // never sourced from a stale client snapshot or left blank.
        vendorName: beforeWrite.live.vendor.name,
        liveId: job.liveId,
        liveTitle: beforeWrite.live.title,
        formSubmissionId: submission.id,
        recipientName: submission.name,
        recipientEmail: submission.email,
        liveScheduledAt: beforeWrite.live.scheduledAt,
        reminderOffsetMinutes: beforeWrite.live.liveReminderOffsetMinutes,
        template: beforeWrite.live.liveReminderTemplate,
        emailBrand: {
          senderName: beforeWrite.live.vendor.senderName,
          supportEmail: beforeWrite.live.vendor.supportEmail,
          contactUrl: beforeWrite.live.vendor.contactUrl,
        },
      }, now, { reconciliationGuard: { jobId: job.id, configDigest: job.configDigest } });
      if (result.status === "config_superseded") {
        return { jobId: job.id, status: "superseded" as const };
      }
      if (result.status !== "not_configured" && result.status !== "not_scheduled") scheduledCount += 1;
    }
  } catch {
    await markFailure(db, job, "reconciliation_write_failed", now);
    return { jobId: job.id, status: "failed" as const };
  }

  const last = submissions.at(-1)!;
  const completed = submissions.length < batchSize;
  const advanced = await finalizeJob(db, job, {
    lifecycle: completed ? "completed" : "pending",
    completedAt: completed ? now : null,
    claimedAt: null,
    nextAttemptAt: completed ? null : now,
    cursorCreatedAt: last.createdAt,
    cursorId: last.id,
    scannedCount: { increment: submissions.length },
    scheduledCount: { increment: scheduledCount },
    lastErrorCode: null,
  });
  return { jobId: job.id, status: advanced.count === 1 ? (completed ? "completed" as const : "pending" as const) : "claimed_elsewhere" as const };
}

/** Processes a bounded number of jobs and verified submissions without exposing PII. */
export async function processLiveReminderReconciliationJobs(options: {
  limit?: number;
  batchSize?: number;
  now?: Date;
} = {}) {
  const db = asReconciliationDb(getDb());
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(25, options.limit ?? 5));
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, options.batchSize ?? DEFAULT_BATCH_SIZE));
  const staleCutoff = new Date(now.getTime() - JOB_LEASE_MS);

  await db.liveReminderReconciliationJob.updateMany({
    where: { lifecycle: "processing", claimedAt: { lte: staleCutoff } },
    data: { lifecycle: "failed", claimedAt: null, nextAttemptAt: now, lastErrorCode: "stale_lease_recovered" },
  });

  const candidates = await db.liveReminderReconciliationJob.findMany({
    where: { lifecycle: { in: ["pending", "failed"] }, nextAttemptAt: { lte: now }, attemptCount: { lt: JOB_MAX_ATTEMPTS } },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  const results: Array<{ jobId: string; status: string }> = [];

  for (const candidate of candidates as ReconciliationJob[]) {
    const claimed = await db.liveReminderReconciliationJob.updateMany({
      where: { id: candidate.id, lifecycle: candidate.lifecycle, attemptCount: candidate.attemptCount, updatedAt: candidate.updatedAt },
      data: { lifecycle: "processing", claimedAt: now, nextAttemptAt: null, attemptCount: { increment: 1 }, lastErrorCode: null },
    });
    if (claimed.count !== 1) {
      results.push({ jobId: candidate.id, status: "claimed_elsewhere" });
      continue;
    }
    const claimedJob = await db.liveReminderReconciliationJob.findUnique({ where: { id: candidate.id } }) as ReconciliationJob | null;
    if (!claimedJob) {
      results.push({ jobId: candidate.id, status: "missing" });
      continue;
    }
    try {
      results.push(await processClaimedJob(db, claimedJob, batchSize, now));
    } catch {
      await markFailure(db, claimedJob, "reconciliation_internal", now);
      results.push({ jobId: candidate.id, status: "failed" });
    }
  }
  return results;
}
