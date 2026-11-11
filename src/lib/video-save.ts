import "server-only";

import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { resolveReadyImageAsset } from "@/lib/image-assets";
import { isLiveVideoReady } from "@/lib/live-video-readiness";

/**
 * Why one video write did not happen, as the video editor reports it:
 * `invalid_id` (an over-long id), `invalid_video` (no usable external URL or
 * metadata), `invalid_image_asset` (the thumbnail asset is not this vendor's
 * ready asset), `not_found` (no such video for this vendor) and
 * `video_processing` (a provider video that is not playable yet).
 */
export type VideoSaveFailure = "invalid_id" | "invalid_video" | "invalid_image_asset" | "not_found" | "video_processing";

export type VideoSaveResult =
  | {
      ok: true;
      /** `created` is false for an update. `liveReady` is the shared live readiness of the saved row. */
      video: { id: string; title: string; created: boolean; liveReady: boolean };
    }
  | { ok: false; reason: VideoSaveFailure };

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

const MAX_MANUAL_VIDEO_DURATION_SECONDS = 24 * 60 * 60;
const MAX_MANUAL_VIDEO_ESTIMATED_MINUTES = 24 * 60;

function boundedNonNegativeIntValue(formData: FormData, key: string, maximum: number, fallback = 0) {
  const raw = text(formData, key, String(fallback));
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

function manualVideoMetadata(formData: FormData) {
  const durationSec = boundedNonNegativeIntValue(formData, "durationSec", MAX_MANUAL_VIDEO_DURATION_SECONDS);
  const estimatedMinutes = boundedNonNegativeIntValue(formData, "estimatedMinutes", MAX_MANUAL_VIDEO_ESTIMATED_MINUTES);
  if (durationSec === null || estimatedMinutes === null) return null;
  return { durationSec, estimatedMinutes };
}

/**
 * Creates an external-URL video, or updates one video, for `vendorId`, which
 * the caller must take from the authenticated session. This is the video
 * editor's write without its redirects: the same fields, the same validation
 * order, the same provider-owned fields left untouched and the same thrown
 * errors for an unsafe thumbnail or replacement URL. A new video is always an
 * external URL (`sourceType: "url"`, `status: "ready"`); provider videos are
 * created only by the Cloudflare upload routes. No CSRF or session check
 * happens here.
 */
export async function saveVideo(vendorId: string, formData: FormData): Promise<VideoSaveResult> {
  const id = optionalText(formData, "id");
  if (id && id.length > 128) return { ok: false, reason: "invalid_id" };
  const db = getDb();
  const thumbnailAssetId = optionalText(formData, "thumbnailAssetId");
  let thumbnailAsset: Awaited<ReturnType<typeof resolveReadyImageAsset>>;
  try {
    thumbnailAsset = await resolveReadyImageAsset(db, { vendorId, assetId: thumbnailAssetId });
  } catch {
    return { ok: false, reason: "invalid_image_asset" };
  }
  const thumbnailUrl = thumbnailAsset?.publicUrl
    ?? optionalExternalUrl(formData, "thumbnailUrl", "影片縮圖網址");
  const editableData = {
    title: text(formData, "title"),
    description: optionalText(formData, "description"),
    thumbnailUrl,
    thumbnailAssetId: thumbnailAsset?.id ?? null,
  };

  if (id) {
    const existingVideo = await db.video.findFirst({
      where: { id, vendorId },
      select: {
        id: true,
        sourceType: true,
        status: true,
        cloudflareReadyToStream: true,
        cloudflareLiveInputUid: true,
        liveInputStatus: true,
      },
    });
    if (!existingVideo) return { ok: false, reason: "not_found" };
    if (existingVideo.sourceType !== "url" && !isLiveVideoReady(existingVideo)) {
      return { ok: false, reason: "video_processing" };
    }

    if (existingVideo.sourceType === "url") {
      const metadata = manualVideoMetadata(formData);
      if (!metadata) return { ok: false, reason: "invalid_video" };
      const status = text(formData, "status") === "archived" ? "archived" : "ready";
      const data = {
        ...editableData,
        ...metadata,
        videoUrl: requiredExternalUrl(formData, "videoUrl", "影片網址"),
        status,
      };
      await db.video.update({ where: { id, vendorId }, data });
      return { ok: true, video: { id, title: editableData.title, created: false, liveReady: status === "ready" } };
    }
    await db.video.update({ where: { id, vendorId }, data: editableData });
    return { ok: true, video: { id, title: editableData.title, created: false, liveReady: true } };
  }

  const externalVideoUrl = parseSafeExternalHttpUrl(text(formData, "videoUrl"));
  if (!externalVideoUrl) return { ok: false, reason: "invalid_video" };
  const metadata = manualVideoMetadata(formData);
  if (!metadata) return { ok: false, reason: "invalid_video" };
  const created = await db.video.create({
    data: {
      ...editableData,
      ...metadata,
      vendorId,
      sourceType: "url",
      videoUrl: externalVideoUrl,
      status: "ready",
    },
  });
  return {
    ok: true,
    video: {
      id: created.id,
      title: editableData.title,
      created: true,
      liveReady: isLiveVideoReady({
        sourceType: created.sourceType,
        status: created.status,
        cloudflareReadyToStream: created.cloudflareReadyToStream,
        cloudflareLiveInputUid: created.cloudflareLiveInputUid,
        liveInputStatus: created.liveInputStatus,
      }),
    },
  };
}
