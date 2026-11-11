import "server-only";

import { Prisma } from "@prisma/client";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { EVERGREEN_ACTIVATION_SELECT, isActiveEvergreenLive } from "@/lib/evergreen-activation";
import {
  createLiveReminderReconciliationSnapshot,
  queueLiveReminderReconciliation,
} from "@/lib/live-reminder-reconciliation";
import { supersedeLiveNotificationDeliveriesForTemplate } from "@/lib/live-notification-delivery";
import {
  normalizeMessageTemplateDraft,
  type MessageTemplateActionError,
  type MessageTemplateActionState,
  type MessageTemplateFormDraft,
} from "@/lib/message-template";

export type MessageTemplateSaveResult =
  | {
      ok: true;
      template: { id: string; name: string; channel: string; trigger: string; subject: string | null; body: string; isActive: boolean };
      reconciliationStatuses: string[];
    }
  | { ok: false; state: MessageTemplateActionState };

function optionalText(formData: FormData, key: string) {
  const value = formData.get(key);
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function isRecordNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

export function messageTemplateFormDraft(formData: FormData): MessageTemplateFormDraft {
  const boundedValue = (key: string, maximum: number) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.slice(0, maximum + 1) : "";
  };
  return {
    name: boundedValue("name", 160),
    channel: boundedValue("channel", 32),
    trigger: boundedValue("trigger", 64),
    subject: boundedValue("subject", 200),
    body: boundedValue("body", 20_000),
    isActive: formData.get("isActive") === "on",
  };
}

function messageTemplateActionError(
  previousState: MessageTemplateActionState,
  error: MessageTemplateActionError,
  draft: MessageTemplateFormDraft,
  expectedUpdatedAt: string | null = null,
): MessageTemplateActionState {
  return {
    status: "error",
    error,
    draft,
    expectedUpdatedAt,
    version: previousState.version + 1,
  };
}

/**
 * Creates or updates one message template for `vendorId`, which the caller
 * must take from the authenticated session. Validation, the version check,
 * the READ COMMITTED transaction with reminder reconciliation and the audit
 * log are those of the template editor; the caller decides where to go next.
 * No CSRF or session check happens here.
 */
export async function saveMessageTemplate({
  vendorId,
  auditActor,
  previousState,
  formData,
}: {
  vendorId: string;
  auditActor: { actorId: string; actorLabel: string };
  previousState: MessageTemplateActionState;
  formData: FormData;
}): Promise<MessageTemplateSaveResult> {
  const id = optionalText(formData, "id");
  const expectedUpdatedAtValue = optionalText(formData, "expectedUpdatedAt");
  const expectedUpdatedAt = expectedUpdatedAtValue ? new Date(expectedUpdatedAtValue) : null;
  const expectedUpdatedAtIsValid = Boolean(
    expectedUpdatedAt
    && !Number.isNaN(expectedUpdatedAt.getTime())
    && expectedUpdatedAt.toISOString() === expectedUpdatedAtValue,
  );
  const submittedDraft = messageTemplateFormDraft(formData);
  if (
    id
    && (
      id.length > 128
      || !expectedUpdatedAtIsValid
    )
  ) {
    return { ok: false, state: messageTemplateActionError(previousState, "invalid_template", submittedDraft) };
  }
  const normalized = normalizeMessageTemplateDraft(submittedDraft);
  if (!normalized.success) {
    return {
      ok: false,
      state: messageTemplateActionError(
        previousState,
        "invalid_template",
        submittedDraft,
        expectedUpdatedAtIsValid ? expectedUpdatedAtValue : null,
      ),
    };
  }
  const data = normalized.data;

  const db = getDb();
  let outcome: {
    template: Awaited<ReturnType<typeof db.messageTemplate.create>>;
    reconciliationStatuses: string[];
  };
  try {
    // READ COMMITTED (B-3): the update takes the template's row lock, so it
    // waits for any live notification materialization holding the template
    // FOR SHARE, and the supersede below is a new statement that sees the row
    // that materialization committed. Under SERIALIZABLE the supersede read
    // the snapshot from before the wait and missed it. The update is guarded
    // by the expected `updatedAt` (re-checked on the latest row version after
    // a wait); reminder reconciliation already runs at READ COMMITTED from
    // the live studio save.
    outcome = await db.$transaction(async (tx) => {
      const template = id
        ? await tx.messageTemplate.update({ where: { id, vendorId, updatedAt: expectedUpdatedAt ?? undefined }, data })
        : await tx.messageTemplate.create({ data: { ...data, vendorId } });
      if (!id) return { template, reconciliationStatuses: [] };

      await supersedeLiveNotificationDeliveriesForTemplate(tx, {
        vendorId,
        templateId: template.id,
      });

      const linkedLives = await tx.live.findMany({
        where: { vendorId, liveReminderTemplateId: template.id },
        select: {
          id: true, slug: true, title: true, scheduledAt: true, liveReminderOffsetMinutes: true,
          ...EVERGREEN_ACTIVATION_SELECT,
          video: { select: { durationSec: true } },
        },
      });
      const reconciliationStatuses: string[] = [];
      for (const live of linkedLives) {
        const queued = await queueLiveReminderReconciliation(tx, createLiveReminderReconciliationSnapshot({
          vendorId,
          liveId: live.id,
          liveSlug: live.slug,
          liveTitle: live.title,
          liveStatus: live.status,
          scheduledAt: live.scheduledAt,
          reminderOffsetMinutes: live.liveReminderOffsetMinutes,
          template,
          evergreenActive: isActiveEvergreenLive(live),
        }));
        reconciliationStatuses.push(queued.status);
      }
      return { template, reconciliationStatuses };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      const current = id
        ? await db.messageTemplate.findFirst({
            where: { id, vendorId },
            select: { updatedAt: true },
          })
        : null;
      return {
        ok: false,
        state: messageTemplateActionError(
          previousState,
          current ? "conflict" : "missing_template",
          submittedDraft,
          current?.updatedAt.toISOString() ?? null,
        ),
      };
    }
    throw error;
  }
  const { template, reconciliationStatuses } = outcome;

  await writeAuditLog({
    vendorId,
    ...auditActor,
    action: id ? "message_template_updated" : "message_template_created",
    targetType: "MessageTemplate",
    targetId: template.id,
    after: auditSnapshot({
      name: data.name,
      channel: data.channel,
      trigger: data.trigger,
      isActive: data.isActive,
      hasSubject: true,
      bodyLength: data.body.length,
    }),
  });

  return {
    ok: true,
    template: {
      id: template.id,
      name: data.name,
      channel: data.channel,
      trigger: data.trigger,
      subject: data.subject,
      body: data.body,
      isActive: data.isActive,
    },
    reconciliationStatuses,
  };
}
