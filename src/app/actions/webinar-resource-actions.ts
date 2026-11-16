"use server";

import { redirect } from "next/navigation";
import { type Prisma } from "@prisma/client";
import { requireVendorManager, requireVendorManagerContext } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { toSlug } from "@/lib/format";
import { type MessageTemplateActionState } from "@/lib/message-template";
import { saveMessageTemplate } from "@/lib/message-template-save";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";
import { saveVideo, type VideoSaveFailure } from "@/lib/video-save";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function managerAuditIdentity(auth: Awaited<ReturnType<typeof requireVendorManagerContext>>["auth"]) {
  return {
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? "vendor_manager",
  };
}

export async function upsertVideoAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const result = await saveVideo(vendor.id, formData);
  if (!result.ok) redirect(videoSaveFailurePath(result.reason, id));

  redirect("/videos");
}

/** Where the video editor returns after a failed save; the paths predate the shared core. */
function videoSaveFailurePath(reason: VideoSaveFailure, id: string | null) {
  if (reason === "not_found") return "/videos?error=not_found";
  if (reason === "invalid_id" || !id) {
    return `/videos/new?error=${reason === "invalid_image_asset" ? "invalid_image_asset" : "invalid_video"}`;
  }
  return `/videos/${encodeURIComponent(id)}/edit?error=${reason}`;
}

type ManagedVideoForArchive = {
  id: string;
  status: string;
  sourceType: string;
  cloudflareReadyToStream: boolean;
  cloudflareLiveInputUid: string | null;
  liveInputStatus: string | null;
};

const RESTORABLE_VIDEO_STATUSES = new Set(["ready", "processing", "error"]);

function fallbackRestoredVideoStatus(video: ManagedVideoForArchive) {
  if (video.sourceType === "url") return "ready";
  if (video.sourceType === "cloudflare_stream") {
    return video.cloudflareReadyToStream ? "ready" : "processing";
  }
  if (video.sourceType === "cloudflare_live") {
    return video.cloudflareLiveInputUid && video.liveInputStatus === "created" ? "processing" : "processing";
  }
  return "ready";
}

function restoredVideoStatus(
  video: ManagedVideoForArchive,
  previousStatus: string | null | undefined,
) {
  return previousStatus && RESTORABLE_VIDEO_STATUSES.has(previousStatus)
    ? previousStatus
    : fallbackRestoredVideoStatus(video);
}

async function mutateVideoArchiveState(formData: FormData, action: "archive" | "restore") {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const id = optionalText(formData, "id");
  if (!id || id.length > 128) redirect("/videos?error=not_found");

  const db = getDb();
  const result = await db.$transaction(async (tx) => {
    const video = await tx.video.findFirst({
      where: { id, vendorId: vendor.id },
      select: {
        id: true,
        status: true,
        sourceType: true,
        cloudflareReadyToStream: true,
        cloudflareLiveInputUid: true,
        liveInputStatus: true,
      },
    });
    if (!video) return { kind: "missing" as const };

    if (action === "archive") {
      if (video.status === "archived") return { kind: "noop" as const };

      await tx.videoArchiveState.upsert({
        where: { vendorId_videoId: { vendorId: vendor.id, videoId: video.id } },
        create: {
          vendorId: vendor.id,
          videoId: video.id,
          previousStatus: video.status,
        },
        update: { previousStatus: video.status },
      });
      await tx.video.update({
        where: { id: video.id, vendorId: vendor.id },
        data: { status: "archived" },
      });
      return { kind: "updated" as const, previousStatus: video.status, nextStatus: "archived" };
    }

    if (video.status !== "archived") return { kind: "noop" as const };
    const archiveState = await tx.videoArchiveState.findUnique({
      where: { vendorId_videoId: { vendorId: vendor.id, videoId: video.id } },
      select: { previousStatus: true },
    });
    const nextStatus = restoredVideoStatus(video, archiveState?.previousStatus);
    await tx.video.update({
      where: { id: video.id, vendorId: vendor.id },
      data: { status: nextStatus },
    });
    return { kind: "updated" as const, previousStatus: "archived", nextStatus };
  });

  if (result.kind === "missing") redirect("/videos?error=not_found");
  if (result.kind === "updated") {
    await writeAuditLog({
      vendorId: vendor.id,
      ...managerAuditIdentity(auth),
      action: action === "archive" ? "video_archived" : "video_restored",
      targetType: "Video",
      targetId: id,
      before: auditSnapshot({ status: result.previousStatus }),
      after: auditSnapshot({ status: result.nextStatus }),
    });
  }
  redirect("/videos");
}

export async function archiveVideoAction(formData: FormData) {
  return mutateVideoArchiveState(formData, "archive");
}

export async function restoreVideoAction(formData: FormData) {
  return mutateVideoArchiveState(formData, "restore");
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

export async function upsertTemplateAction(
  previousState: MessageTemplateActionState,
  formData: FormData,
): Promise<MessageTemplateActionState> {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const result = await saveMessageTemplate({
    vendorId: vendor.id,
    auditActor: managerAuditIdentity(auth),
    previousState,
    formData,
  });
  if (!result.ok) return result.state;

  redirect(result.reconciliationStatuses.length > 0
    ? "/messages/templates?notice=reminders_reconciling"
    : "/messages/templates");
}
