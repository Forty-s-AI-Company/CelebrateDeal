"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { requireFeature } from "@/lib/feature-gates";
import {
  ID_PATTERN,
  parseEmailSequenceDraft,
  readEmailSequenceDraft,
  type EmailSequenceActionState,
  type EmailSequenceFormDraft,
} from "@/lib/email-sequence-rules";
import {
  activateEmailSequence,
  deleteEmailSequence,
  pauseEmailSequence,
  saveEmailSequence,
  type EmailSequenceServiceFailure,
} from "@/lib/email-sequences";

const LIST_PATH = "/messages/sequences";

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readVersion(formData: FormData) {
  const value = text(formData, "expectedVersion");
  return /^\d{1,9}$/u.test(value) ? Number(value) : null;
}

/** Owner / admin of the current vendor, with the closed-beta grant (F-3). */
async function requireSequenceManager() {
  const { auth, vendor } = await requireVendorManagerContext();
  requireFeature(vendor, "email_sequences");
  return {
    vendor,
    actor: { actorId: auth.user.id, actorLabel: auth.member?.role ?? "vendor_manager" },
  };
}

function errorState(
  previous: EmailSequenceActionState,
  draft: EmailSequenceFormDraft,
  expectedVersion: number | null,
  message: string,
  fieldErrors: Record<string, string> = {},
): EmailSequenceActionState {
  return { status: "error", message, fieldErrors, draft, expectedVersion, errorVersion: previous.errorVersion + 1 };
}

function failureMessage(failure: EmailSequenceServiceFailure) {
  if (failure.code === "conflict") return "這條序列在其他分頁已有新版，你輸入的內容已保留。請重新整理確認後再儲存。";
  if (failure.code === "not_found") return "找不到這條序列，可能已被刪除。";
  if (failure.code === "active_limit") return "已達寄送中序列的上限。";
  return failure.message;
}

export async function saveEmailSequenceAction(
  previousState: EmailSequenceActionState,
  formData: FormData,
): Promise<EmailSequenceActionState> {
  await assertServerActionSecurity(formData);
  const { vendor, actor } = await requireSequenceManager();
  const sequenceIdText = text(formData, "sequenceId");
  const sequenceId = sequenceIdText && ID_PATTERN.test(sequenceIdText) ? sequenceIdText : null;
  const expectedVersion = readVersion(formData);
  const draft = readEmailSequenceDraft(formData);
  if (sequenceIdText && (!sequenceId || expectedVersion === null)) {
    return errorState(previousState, draft, expectedVersion, "找不到這條序列，可能已被刪除。");
  }
  const parsed = parseEmailSequenceDraft(draft);
  if (!parsed.ok) return errorState(previousState, draft, expectedVersion, parsed.message, parsed.fieldErrors);

  const result = await saveEmailSequence({ vendorId: vendor.id, sequenceId, expectedVersion, data: parsed.data });
  if (!result.ok) {
    return errorState(
      previousState,
      draft,
      expectedVersion,
      failureMessage(result),
      result.code === "invalid" ? result.fieldErrors : {},
    );
  }
  await writeAuditLog({
    vendorId: vendor.id,
    ...actor,
    action: result.created ? "email_sequence_created" : "email_sequence_updated",
    targetType: "EmailSequence",
    targetId: result.id,
    after: {
      version: result.version,
      liveId: parsed.data.liveId,
      steps: parsed.data.steps.map((step) => ({ delayMinutes: step.delayMinutes, messageTemplateId: step.messageTemplateId, isActive: step.isActive })),
    },
  });
  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?notice=${result.created ? "created" : "saved"}`);
}

type StatusChange = "activate" | "pause" | "delete";

async function changeSequence(formData: FormData, change: StatusChange) {
  await assertServerActionSecurity(formData);
  const { vendor, actor } = await requireSequenceManager();
  const sequenceId = text(formData, "sequenceId");
  const expectedVersion = readVersion(formData);
  if (!ID_PATTERN.test(sequenceId) || expectedVersion === null) redirect(`${LIST_PATH}?error=not_found`);
  const input = { vendorId: vendor.id, sequenceId, expectedVersion };
  const result = change === "activate"
    ? await activateEmailSequence(input)
    : change === "pause" ? await pauseEmailSequence(input) : await deleteEmailSequence(input);
  if (!result.ok) {
    redirect(`${LIST_PATH}?error=${result.code === "not_ready" ? "not_ready" : result.code}`);
  }
  await writeAuditLog({
    vendorId: vendor.id,
    ...actor,
    action: change === "activate" ? "email_sequence_activated" : change === "pause" ? "email_sequence_paused" : "email_sequence_deleted",
    targetType: "EmailSequence",
    targetId: sequenceId,
    after: "cancelledRuns" in result && typeof result.cancelledRuns === "number" ? { cancelledRuns: result.cancelledRuns } : null,
  });
  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?notice=${change === "activate" ? "activated" : change === "pause" ? "paused" : "deleted"}`);
}

export async function activateEmailSequenceAction(formData: FormData) {
  return changeSequence(formData, "activate");
}

export async function pauseEmailSequenceAction(formData: FormData) {
  return changeSequence(formData, "pause");
}

export async function deleteEmailSequenceAction(formData: FormData) {
  return changeSequence(formData, "delete");
}
