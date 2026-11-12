import { Prisma, type PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { rescheduleActiveRunsForSequence, SEQUENCE_EMAIL_TRIGGER } from "@/lib/delayed-step-runs";
import {
  MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR,
  MAX_EMAIL_SEQUENCE_STEPS,
  stepFieldName,
  type EmailSequenceFieldErrors,
  type EmailSequenceInput,
} from "@/lib/email-sequence-rules";
import { hasUsableMessageTemplateContent } from "@/lib/message-template";

/**
 * F-3 Email 追銷序列: merchant-side writes. Every function takes the vendor
 * resolved from the session; every id from the form (sequence, steps,
 * templates, Live) is looked up and written together with that vendorId, so
 * another tenant's record is simply "not found". The Server Actions in
 * src/app/actions/email-sequence-actions.ts add auth, CSRF and the beta gate.
 */

export type EmailSequenceServiceFailure =
  | { ok: false; code: "invalid"; message: string; fieldErrors: EmailSequenceFieldErrors }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "conflict" }
  | { ok: false; code: "active_limit" }
  | { ok: false; code: "not_ready"; message: string };

class ServiceFailure extends Error {
  constructor(readonly failure: EmailSequenceServiceFailure) {
    super("Email sequence change rejected.");
    this.name = "EmailSequenceServiceFailure";
  }
}

function invalid(fieldErrors: EmailSequenceFieldErrors, message = "有幾個欄位需要修正，內容已保留。"): never {
  throw new ServiceFailure({ ok: false, code: "invalid", message, fieldErrors });
}

async function run<T>(work: () => Promise<T>): Promise<T | EmailSequenceServiceFailure> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ServiceFailure) return error.failure;
    throw error;
  }
}

const TEMPLATE_SELECT = { id: true, channel: true, trigger: true, subject: true, body: true, isActive: true } as const;

function isUsableSequenceTemplate(template: { channel: string; trigger: string; subject: string | null; body: string; isActive: boolean }) {
  return template.isActive
    && template.channel === "email"
    && template.trigger === SEQUENCE_EMAIL_TRIGGER
    && hasUsableMessageTemplateContent(template);
}

export async function saveEmailSequence(
  input: {
    vendorId: string;
    sequenceId: string | null;
    expectedVersion: number | null;
    data: EmailSequenceInput;
    now?: Date;
  },
  db: PrismaClient = getDb(),
): Promise<{ ok: true; id: string; version: number; created: boolean } | EmailSequenceServiceFailure> {
  const now = input.now ?? new Date();
  const data = input.data;
  if (data.steps.length > MAX_EMAIL_SEQUENCE_STEPS) {
    return { ok: false, code: "invalid", message: `一條序列最多 ${MAX_EMAIL_SEQUENCE_STEPS} 封信。`, fieldErrors: {} };
  }
  return run(() => db.$transaction(async (tx) => {
    const existing = input.sequenceId
      ? await tx.emailSequence.findFirst({
          where: { id: input.sequenceId, vendorId: input.vendorId },
          select: { id: true, status: true, version: true, liveId: true, activatedAt: true, steps: { select: { id: true, delayMinutes: true } } },
        })
      : null;
    if (input.sequenceId && !existing) throw new ServiceFailure({ ok: false, code: "not_found" });
    if (existing && existing.version !== input.expectedVersion) throw new ServiceFailure({ ok: false, code: "conflict" });

    const fieldErrors: EmailSequenceFieldErrors = {};
    const live = await tx.live.findFirst({ where: { id: data.liveId, vendorId: input.vendorId }, select: { id: true } });
    if (!live) fieldErrors.liveId = "找不到這場直播，請重新選擇。";
    else if (existing && existing.liveId !== data.liveId && existing.activatedAt) {
      fieldErrors.liveId = "啟用過的序列不能更換直播；請另外建立一條序列。";
    }

    const templateIds = [...new Set(data.steps.map((step) => step.messageTemplateId))];
    const templates = new Map((await tx.messageTemplate.findMany({
      where: { id: { in: templateIds }, vendorId: input.vendorId },
      select: TEMPLATE_SELECT,
    })).map((template) => [template.id, template]));
    const existingSteps = new Map((existing?.steps ?? []).map((step) => [step.id, step]));
    const willBeActive = existing?.status === "active";
    // Field errors use the submitted order, which is also the refilled form's.
    data.steps.forEach((step, index) => {
      if (step.id && !existingSteps.has(step.id)) {
        fieldErrors[stepFieldName(index, "delayValue")] = "這一封的資料已失效，請重新整理頁面。";
      }
      const template = templates.get(step.messageTemplateId);
      const templateField = stepFieldName(index, "messageTemplateId");
      if (!template || template.channel !== "email" || template.trigger !== SEQUENCE_EMAIL_TRIGGER) {
        fieldErrors[templateField] = "找不到這個模板，或它不是「追銷序列信」模板。";
      } else if (step.isActive && !isUsableSequenceTemplate(template)) {
        fieldErrors[templateField] = "這個模板已停用或內容不完整，請先到訊息模板修正，或把這一封設為不寄送。";
      }
    });
    if (willBeActive && !data.steps.some((step) => step.isActive)) {
      fieldErrors.steps = "寄送中的序列至少要有一封要寄的信；想全部停下來請改用「暫停」。";
    }
    if (Object.keys(fieldErrors).length > 0) invalid(fieldErrors);

    let sequenceId: string;
    let version: number;
    if (existing) {
      const updated = await tx.emailSequence.updateMany({
        where: { id: existing.id, vendorId: input.vendorId, version: existing.version },
        data: { name: data.name, liveId: data.liveId, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ServiceFailure({ ok: false, code: "conflict" });
      sequenceId = existing.id;
      version = existing.version + 1;
    } else {
      const created = await tx.emailSequence.create({
        data: { vendorId: input.vendorId, liveId: data.liveId, name: data.name, status: "draft" },
        select: { id: true, version: true },
      });
      sequenceId = created.id;
      version = created.version;
    }

    // A step keeps its id while its delay is unchanged. A step whose delay
    // changed is replaced: it now sits at another point of the timeline, and
    // replacing it never collides with the per-sequence unique delay.
    const keep = data.steps.filter((step) => step.id && existingSteps.get(step.id)?.delayMinutes === step.delayMinutes);
    const keepIds = new Set(keep.map((step) => step.id));
    await tx.emailSequenceStep.deleteMany({
      where: { vendorId: input.vendorId, emailSequenceId: sequenceId, id: { notIn: [...keepIds].filter((id): id is string => Boolean(id)) } },
    });
    for (const step of keep) {
      await tx.emailSequenceStep.updateMany({
        where: { id: step.id!, vendorId: input.vendorId, emailSequenceId: sequenceId },
        data: { messageTemplateId: step.messageTemplateId, isActive: step.isActive },
      });
    }
    const fresh = data.steps.filter((step) => !keepIds.has(step.id));
    if (fresh.length > 0) {
      await tx.emailSequenceStep.createMany({
        data: fresh.map((step) => ({
          vendorId: input.vendorId,
          emailSequenceId: sequenceId,
          delayMinutes: step.delayMinutes,
          messageTemplateId: step.messageTemplateId,
          isActive: step.isActive,
        })),
      });
    }
    if (willBeActive) await rescheduleActiveRunsForSequence(tx, { vendorId: input.vendorId, emailSequenceId: sequenceId, now });
    return { ok: true as const, id: sequenceId, version, created: !existing };
  }));
}

export async function activateEmailSequence(
  input: { vendorId: string; sequenceId: string; expectedVersion: number; now?: Date },
  db: PrismaClient = getDb(),
): Promise<{ ok: true; status: "activated" | "already_active" } | EmailSequenceServiceFailure> {
  const now = input.now ?? new Date();
  return run(() => db.$transaction(async (tx) => {
    // Serializes activations of one vendor so two tabs cannot pass the
    // active-sequence limit together.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`email-sequence-activation:${input.vendorId}`}, 0))`);
    const sequence = await tx.emailSequence.findFirst({
      where: { id: input.sequenceId, vendorId: input.vendorId },
      select: {
        id: true,
        status: true,
        version: true,
        steps: { where: { isActive: true }, select: { messageTemplate: { select: TEMPLATE_SELECT } } },
      },
    });
    if (!sequence) throw new ServiceFailure({ ok: false, code: "not_found" });
    if (sequence.version !== input.expectedVersion) throw new ServiceFailure({ ok: false, code: "conflict" });
    if (sequence.status === "active") return { ok: true as const, status: "already_active" as const };
    if (sequence.steps.length === 0) {
      throw new ServiceFailure({ ok: false, code: "not_ready", message: "這條序列還沒有要寄的信，請先新增至少一封再啟用。" });
    }
    if (sequence.steps.some((step) => !isUsableSequenceTemplate(step.messageTemplate))) {
      throw new ServiceFailure({ ok: false, code: "not_ready", message: "有一封信的模板已停用或內容不完整，請先修正再啟用。" });
    }
    const activeCount = await tx.emailSequence.count({ where: { vendorId: input.vendorId, status: "active" } });
    if (activeCount >= MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR) throw new ServiceFailure({ ok: false, code: "active_limit" });
    const updated = await tx.emailSequence.updateMany({
      where: { id: sequence.id, vendorId: input.vendorId, version: sequence.version, status: sequence.status },
      // Only registrations verified from now on join (§4「加入序列」), also
      // after a pause: people who verified while it was paused are not added.
      data: { status: "active", activatedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ServiceFailure({ ok: false, code: "conflict" });
    return { ok: true as const, status: "activated" as const };
  }));
}

export async function pauseEmailSequence(
  input: { vendorId: string; sequenceId: string; expectedVersion: number },
  db: PrismaClient = getDb(),
): Promise<{ ok: true; status: "paused" | "not_active"; cancelledRuns: number } | EmailSequenceServiceFailure> {
  return run(() => db.$transaction(async (tx) => {
    const sequence = await tx.emailSequence.findFirst({
      where: { id: input.sequenceId, vendorId: input.vendorId },
      select: { id: true, status: true, version: true },
    });
    if (!sequence) throw new ServiceFailure({ ok: false, code: "not_found" });
    if (sequence.version !== input.expectedVersion) throw new ServiceFailure({ ok: false, code: "conflict" });
    if (sequence.status !== "active") return { ok: true as const, status: "not_active" as const, cancelledRuns: 0 };
    const updated = await tx.emailSequence.updateMany({
      where: { id: sequence.id, vendorId: input.vendorId, version: sequence.version, status: "active" },
      data: { status: "paused", version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ServiceFailure({ ok: false, code: "conflict" });
    // People part-way through stop here; resuming does not bring them back,
    // so nobody is sent a batch of late e-mails without the merchant knowing.
    const cancelled = await tx.delayedStepRun.updateMany({
      where: { vendorId: input.vendorId, emailSequenceId: sequence.id, status: "active" },
      data: { status: "cancelled", cancelReason: "definition_paused", nextRunAt: null, claimedAt: null },
    });
    return { ok: true as const, status: "paused" as const, cancelledRuns: cancelled.count };
  }));
}

/** Deletes the sequence with its steps and runs; queued e-mails of it are superseded at send time. */
export async function deleteEmailSequence(
  input: { vendorId: string; sequenceId: string; expectedVersion: number },
  db: PrismaClient = getDb(),
): Promise<{ ok: true } | EmailSequenceServiceFailure> {
  const exists = await db.emailSequence.findFirst({
    where: { id: input.sequenceId, vendorId: input.vendorId },
    select: { version: true },
  });
  if (!exists) return { ok: false, code: "not_found" };
  const deleted = await db.emailSequence.deleteMany({
    where: { id: input.sequenceId, vendorId: input.vendorId, version: input.expectedVersion },
  });
  return deleted.count === 1 ? { ok: true } : { ok: false, code: "conflict" };
}

export type EmailSequenceRunCounts = { active: number; completed: number; cancelled: number };

/** 進行中／完成／停止 per sequence, for this vendor only. */
export async function emailSequenceRunCounts(vendorId: string, db: PrismaClient = getDb()) {
  const rows = await db.delayedStepRun.groupBy({
    by: ["emailSequenceId", "status"],
    where: { vendorId, emailSequenceId: { not: null } },
    _count: { _all: true },
  });
  const counts = new Map<string, EmailSequenceRunCounts>();
  for (const row of rows) {
    if (!row.emailSequenceId) continue;
    const entry = counts.get(row.emailSequenceId) ?? { active: 0, completed: 0, cancelled: 0 };
    if (row.status === "active" || row.status === "completed" || row.status === "cancelled") entry[row.status] += row._count._all;
    counts.set(row.emailSequenceId, entry);
  }
  return counts;
}
