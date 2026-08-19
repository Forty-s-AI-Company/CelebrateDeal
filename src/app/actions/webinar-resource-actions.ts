"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { requireVendorManager, requireVendorManagerContext } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { toSlug } from "@/lib/format";
import { resolveReadyImageAsset } from "@/lib/image-assets";
import { isLiveVideoReady } from "@/lib/live-video-readiness";
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
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function safeExternalUrl(value: string | null, label: string) {
  if (!value) return null;
  const safeUrl = parseSafeExternalHttpUrl(value);
  if (!safeUrl) throw new Error(`${label}必須是有效的 HTTP 或 HTTPS 完整網址。`);
  return safeUrl;
}

function optionalExternalUrl(formData: FormData, key: string, label: string) {
  return safeExternalUrl(optionalText(formData, key), label);
}

function requiredExternalUrl(formData: FormData, key: string, label: string) {
  const safeUrl = parseSafeExternalHttpUrl(text(formData, key));
  if (!safeUrl) throw new Error(`${label}必須是有效的 HTTP 或 HTTPS 完整網址。`);
  return safeUrl;
}

function intValue(formData: FormData, key: string, fallback = 0) {
  const parsed = Number.parseInt(text(formData, key, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function managerAuditIdentity(auth: Awaited<ReturnType<typeof requireVendorManagerContext>>["auth"]) {
  return {
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? "vendor_manager",
  };
}

function isRecordNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

export async function upsertVideoAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const invalidVideoPath = id
    ? `/videos/${encodeURIComponent(id)}/edit?error=invalid_video`
    : "/videos/new?error=invalid_video";
  if (id && id.length > 128) redirect("/videos/new?error=invalid_video");
  const db = getDb();
  const thumbnailAssetId = optionalText(formData, "thumbnailAssetId");
  const invalidImageAssetPath = id
    ? `/videos/${encodeURIComponent(id)}/edit?error=invalid_image_asset`
    : "/videos/new?error=invalid_image_asset";
  const thumbnailAsset = await resolveReadyImageAsset(db, { vendorId: vendor.id, assetId: thumbnailAssetId })
    .catch(() => redirect(invalidImageAssetPath));
  const thumbnailUrl = thumbnailAsset?.publicUrl
    ?? optionalExternalUrl(formData, "thumbnailUrl", "影片縮圖網址");
  const editableData = {
    title: text(formData, "title"),
    description: optionalText(formData, "description"),
    thumbnailUrl,
    thumbnailAssetId: thumbnailAsset?.id ?? null,
    durationSec: intValue(formData, "durationSec"),
    estimatedMinutes: intValue(formData, "estimatedMinutes"),
  };

  if (id) {
    const existingVideo = await db.video.findFirst({
      where: { id, vendorId: vendor.id },
      select: {
        id: true,
        sourceType: true,
        status: true,
        cloudflareReadyToStream: true,
        cloudflareLiveInputUid: true,
        liveInputStatus: true,
      },
    });
    if (!existingVideo) redirect("/videos?error=not_found");
    if (existingVideo.sourceType !== "url" && !isLiveVideoReady(existingVideo)) {
      redirect(`/videos/${encodeURIComponent(id)}/edit?error=video_processing`);
    }

    const data = existingVideo.sourceType === "url"
      ? {
          ...editableData,
          videoUrl: requiredExternalUrl(formData, "videoUrl", "影片網址"),
          status: text(formData, "status") === "archived" ? "archived" : "ready",
        }
      : editableData;
    await db.video.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    const externalVideoUrl = parseSafeExternalHttpUrl(text(formData, "videoUrl"));
    if (!externalVideoUrl) redirect(invalidVideoPath);
    await db.video.create({
      data: {
        ...editableData,
        vendorId: vendor.id,
        sourceType: "url",
        videoUrl: externalVideoUrl,
        status: "ready",
      },
    });
  }

  redirect("/videos");
}

export async function upsertFormAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  let rawFields: unknown;
  try {
    rawFields = JSON.parse(text(formData, "fields", "[]"));
  } catch {
    redirect(id ? `/forms/${encodeURIComponent(id)}/edit?error=invalid_fields` : "/forms/new?error=invalid_fields");
  }
  const fields = parseRegistrationFormFields(rawFields);
  if (!fields.success) {
    redirect(id ? `/forms/${encodeURIComponent(id)}/edit?error=invalid_fields` : "/forms/new?error=invalid_fields");
  }

  const data = {
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    headline: text(formData, "headline"),
    description: optionalText(formData, "description"),
    submitLabel: text(formData, "submitLabel", "送出報名"),
    fields: fields.data as Prisma.InputJsonValue,
    successMessage: text(formData, "successMessage", "已收到你的資料，開播前會再提醒你。"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().registrationForm.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().registrationForm.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/forms");
}

function messageTemplateFormDraft(formData: FormData): MessageTemplateFormDraft {
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

export async function upsertTemplateAction(
  previousState: MessageTemplateActionState,
  formData: FormData,
): Promise<MessageTemplateActionState> {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
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
    return messageTemplateActionError(previousState, "invalid_template", submittedDraft);
  }
  const normalized = normalizeMessageTemplateDraft(submittedDraft);
  if (!normalized.success) {
    return messageTemplateActionError(
      previousState,
      "invalid_template",
      submittedDraft,
      expectedUpdatedAtIsValid ? expectedUpdatedAtValue : null,
    );
  }
  const data = normalized.data;

  const db = getDb();
  let outcome: {
    template: Awaited<ReturnType<typeof db.messageTemplate.create>>;
    reconciliationStatuses: string[];
  };
  try {
    outcome = await db.$transaction(async (tx) => {
      const template = id
        ? await tx.messageTemplate.update({ where: { id, vendorId: vendor.id, updatedAt: expectedUpdatedAt ?? undefined }, data })
        : await tx.messageTemplate.create({ data: { ...data, vendorId: vendor.id } });
      if (!id) return { template, reconciliationStatuses: [] };

      await supersedeLiveNotificationDeliveriesForTemplate(tx, {
        vendorId: vendor.id,
        templateId: template.id,
      });

      const linkedLives = await tx.live.findMany({
        where: { vendorId: vendor.id, liveReminderTemplateId: template.id },
        select: { id: true, slug: true, title: true, status: true, scheduledAt: true, liveReminderOffsetMinutes: true },
      });
      const reconciliationStatuses: string[] = [];
      for (const live of linkedLives) {
        const queued = await queueLiveReminderReconciliation(tx, createLiveReminderReconciliationSnapshot({
          vendorId: vendor.id,
          liveId: live.id,
          liveSlug: live.slug,
          liveTitle: live.title,
          liveStatus: live.status,
          scheduledAt: live.scheduledAt,
          reminderOffsetMinutes: live.liveReminderOffsetMinutes,
          template,
        }));
        reconciliationStatuses.push(queued.status);
      }
      return { template, reconciliationStatuses };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      const current = id
        ? await db.messageTemplate.findFirst({
            where: { id, vendorId: vendor.id },
            select: { updatedAt: true },
          })
        : null;
      return messageTemplateActionError(
        previousState,
        current ? "conflict" : "missing_template",
        submittedDraft,
        current?.updatedAt.toISOString() ?? null,
      );
    }
    throw error;
  }
  const { template, reconciliationStatuses } = outcome;

  await writeAuditLog({
    vendorId: vendor.id,
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

  redirect(reconciliationStatuses.length > 0
    ? "/messages/templates?notice=reminders_reconciling"
    : "/messages/templates");
}
