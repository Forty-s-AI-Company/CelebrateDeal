import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  CloudflareStreamError,
  createDirectCreatorUpload,
  createLiveInput,
  createResumableCreatorUpload,
  getStreamVideoStatus,
} from "@/lib/cloudflare-stream";
import { getDb } from "@/lib/db";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

const CLOUDFLARE_STREAM_KEY_PURPOSE = "cloudflare-live-stream-key";
const CLOUDFLARE_UPLOAD_TICKET_PURPOSE = "cloudflare-resumable-upload-ticket";
const RESUMABLE_UPLOAD_TICKET_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const VIDEO_UPLOAD_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  // Cloudflare requests are independently capped at 15 seconds. Leave
  // enough room for the provider response plus the local mapping write, while
  // avoiding Prisma's much shorter default interactive-transaction timeout.
  timeout: 30_000,
} as const;
type CloudflareDatabase = ReturnType<typeof getDb>;
type CloudflareDatabaseClient = CloudflareDatabase | Prisma.TransactionClient;

export const DirectUploadRequest = z.object({
  vendorId: z.string().min(1),
  videoId: z.string().min(1).optional(),
  title: z.string().min(1).max(160).default("Cloudflare Stream 上傳"),
  maxDurationSeconds: z.number().int().positive().max(60 * 60 * 6).default(60 * 60),
});

export const ResumableUploadRequest = DirectUploadRequest.extend({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export const LiveInputRequest = z.object({
  vendorId: z.string().min(1),
  videoId: z.string().min(1).optional(),
  liveId: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
});

type CloudflareResourceErrorCode = "vendor_not_found" | "video_not_found" | "video_archived" | "live_not_found";

export class CloudflareResourceError extends Error {
  constructor(public readonly code: CloudflareResourceErrorCode) {
    super(`Cloudflare mapping resource failed validation (${code}).`);
    this.name = "CloudflareResourceError";
  }
}

export class CloudflareUploadTicketError extends Error {
  constructor() {
    super("Cloudflare resumable upload ticket is invalid.");
    this.name = "CloudflareUploadTicketError";
  }
}

export class CloudflareUploadNotCompleteError extends Error {
  constructor() {
    super("Cloudflare resumable upload has not finished receiving bytes.");
    this.name = "CloudflareUploadNotCompleteError";
  }
}

export class CloudflareUploadFailedError extends Error {
  constructor() {
    super("Cloudflare rejected or failed the uploaded media.");
    this.name = "CloudflareUploadFailedError";
  }
}

const ResumableUploadTicket = z.object({
  version: z.literal(1),
  vendorId: z.string().min(1).max(100),
  videoId: z.string().min(1).max(100),
  mode: z.enum(["create", "replace"]),
  title: z.string().min(1).max(160),
  maxDurationSeconds: z.number().int().positive().max(60 * 60 * 6),
  uid: z.string().min(1).max(128),
  expiresAt: z.number().int().positive(),
}).strict();

export function classifyCloudflareOperationError(error: unknown) {
  if (error instanceof CloudflareResourceError) {
    return {
      code: error.code,
      providerStatus: null,
      status: error.code === "video_archived" ? 409 : 404,
    };
  }
  if (error instanceof CloudflareStreamError) {
    return {
      code: error.code,
      providerStatus: error.providerStatus,
      status: error.code === "configuration" ? 503 : 502,
    };
  }
  // Prisma messages may contain connection and schema details. Only expose a
  // bounded category so operators can distinguish migration/availability
  // failures without leaking database metadata to the caller.
  const prismaCode = error && typeof error === "object" && "code" in error
    && typeof error.code === "string"
    ? error.code
    : null;
  if (prismaCode === "P2021" || prismaCode === "P2022") {
    return { code: "database_schema", providerStatus: null, status: 503 };
  }
  if (prismaCode === "P1001" || prismaCode === "P1002" || prismaCode === "P1017") {
    return { code: "database_unavailable", providerStatus: null, status: 503 };
  }
  if (prismaCode === "P2002" || prismaCode === "P2003") {
    return { code: "database_constraint", providerStatus: null, status: 409 };
  }
  return { code: "internal_failure", providerStatus: null, status: 500 };
}

async function requireCloudflareMappingResources({
  vendorId,
  videoId,
  liveId,
  rejectArchivedVideo = false,
}: {
  vendorId: string;
  videoId?: string;
  liveId?: string;
  rejectArchivedVideo?: boolean;
}) {
  const db = getDb();
  const [vendor, video, live] = await Promise.all([
    db.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }),
    videoId
      ? db.video.findFirst({
          where: {
            id: videoId,
            vendorId,
          },
          select: { id: true, status: true },
        })
      : null,
    liveId
      ? db.live.findFirst({ where: { id: liveId, vendorId }, select: { id: true } })
      : null,
  ]);

  if (!vendor) throw new CloudflareResourceError("vendor_not_found");
  if (videoId && !video) throw new CloudflareResourceError("video_not_found");
  if (videoId && rejectArchivedVideo && video?.status === "archived") {
    throw new CloudflareResourceError("video_archived");
  }
  if (liveId && !live) throw new CloudflareResourceError("live_not_found");
  return { db, video, live };
}

/**
 * Serialize replacement provisioning with the archive action. The external
 * provider call is intentionally inside the short transaction so a concurrent
 * archive either wins before provisioning or waits until the local mapping is
 * committed; it cannot leave a newly-created provider asset orphaned by a
 * local archive race.
 */
async function withVideoUploadLock<T>(
  db: CloudflareDatabase,
  vendorId: string,
  videoId: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
      SELECT "id", "status"
      FROM "Video"
      WHERE "id" = ${videoId} AND "vendorId" = ${vendorId}
      FOR UPDATE
    `);
    const video = rows[0];
    if (!video) throw new CloudflareResourceError("video_not_found");
    if (video.status === "archived") throw new CloudflareResourceError("video_archived");
    return operation(transaction);
  }, VIDEO_UPLOAD_TRANSACTION_OPTIONS);
}

export async function createDirectUploadMapping(input: z.infer<typeof DirectUploadRequest>) {
  const { db } = await requireCloudflareMappingResources({
    ...input,
    rejectArchivedVideo: Boolean(input.videoId),
  });
  const provision = async (database: CloudflareDatabaseClient, existingVideo: { id: string }) => {
    const upload = await createDirectCreatorUpload(input.maxDurationSeconds);
    const video = await persistStreamVideo({ db: database, existingVideo, input, uid: upload.uid });
    return { video, upload, videoUrl: video.videoUrl };
  };
  if (input.videoId) {
    return withVideoUploadLock(db, input.vendorId, input.videoId, (transaction) => (
      provision(transaction, { id: input.videoId! })
    ));
  }
  const upload = await createDirectCreatorUpload(input.maxDurationSeconds);
  const video = await persistStreamVideo({ db, existingVideo: null, input, uid: upload.uid });
  return { video, upload, videoUrl: video.videoUrl };
}

export async function createResumableUploadSession(input: z.infer<typeof ResumableUploadRequest>) {
  const { db } = await requireCloudflareMappingResources({
    ...input,
    rejectArchivedVideo: Boolean(input.videoId),
  });
  const provision = async (existingVideoId: string | null) => {
    const upload = await createResumableCreatorUpload({
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      maxDurationSeconds: input.maxDurationSeconds,
    });
    const videoId = existingVideoId ?? `upload_${randomUUID()}`;
    const uploadTicket = encryptSensitiveValue(JSON.stringify({
      version: 1,
      vendorId: input.vendorId,
      videoId,
      mode: existingVideoId ? "replace" : "create",
      title: input.title,
      maxDurationSeconds: input.maxDurationSeconds,
      uid: upload.uid,
      expiresAt: Date.now() + RESUMABLE_UPLOAD_TICKET_LIFETIME_MS,
    }), CLOUDFLARE_UPLOAD_TICKET_PURPOSE);
    return { videoId, uploadURL: upload.uploadURL, uploadTicket };
  };
  if (input.videoId) {
    return withVideoUploadLock(db, input.vendorId, input.videoId, () => provision(input.videoId!));
  }
  // Provisioning must not mutate Video. The opaque ticket is completed only after tus succeeds.
  return provision(null);
}

export async function completeResumableUploadMapping({
  vendorId,
  uploadTicket,
}: {
  vendorId: string;
  uploadTicket: string;
}) {
  let ticket: z.infer<typeof ResumableUploadTicket>;
  try {
    ticket = ResumableUploadTicket.parse(JSON.parse(
      decryptSensitiveValue(uploadTicket, CLOUDFLARE_UPLOAD_TICKET_PURPOSE),
    ));
  } catch {
    throw new CloudflareUploadTicketError();
  }
  if (ticket.vendorId !== vendorId || ticket.expiresAt <= Date.now()) {
    throw new CloudflareUploadTicketError();
  }

  const db = getDb();
  const [vendor, existingVideo] = await Promise.all([
    db.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }),
    db.video.findFirst({
      where: { id: ticket.videoId, vendorId },
      select: { id: true, status: true, cloudflareStreamUid: true },
    }),
  ]);
  if (!vendor) throw new CloudflareResourceError("vendor_not_found");
  if (ticket.mode === "replace" && !existingVideo) {
    throw new CloudflareResourceError("video_not_found");
  }
  if (ticket.mode === "replace" && existingVideo?.status === "archived") {
    throw new CloudflareResourceError("video_archived");
  }
  if (ticket.mode === "create" && existingVideo && existingVideo.cloudflareStreamUid !== ticket.uid) {
    throw new CloudflareUploadTicketError();
  }

  // HEAD/PATCH success is checked against Cloudflare before local mapping becomes visible.
  const providerVideo = await getStreamVideoStatus(ticket.uid);
  const providerState = providerVideo.status?.state?.trim().toLowerCase();
  if (providerVideo.readyToStream !== true && (!providerState || providerState === "pendingupload")) {
    throw new CloudflareUploadNotCompleteError();
  }
  if (providerState === "error") throw new CloudflareUploadFailedError();
  if (
    providerVideo.readyToStream !== true
    && !["queued", "downloading", "inprogress", "processing", "ready"].includes(providerState ?? "")
  ) {
    throw new CloudflareStreamError("invalid_response");
  }
  if (existingVideo?.cloudflareStreamUid === ticket.uid) return { video: existingVideo };

  const input = {
    vendorId,
    videoId: ticket.videoId,
    title: ticket.title,
    maxDurationSeconds: ticket.maxDurationSeconds,
  };
  const video = ticket.mode === "replace"
    ? await persistStreamVideo({ db, existingVideo, input, uid: ticket.uid })
    : await persistStreamVideo({ db, existingVideo: null, input, uid: ticket.uid, createId: ticket.videoId });
  return { video };
}

async function persistStreamVideo({
  db,
  existingVideo,
  input,
  uid,
  createId,
}: {
  db: CloudflareDatabaseClient;
  existingVideo: { id: string } | null;
  input: z.infer<typeof DirectUploadRequest>;
  uid: string;
  createId?: string;
}) {
  const videoUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;
  if (existingVideo) {
    const updated = await db.video.updateMany({
      where: { id: existingVideo.id, vendorId: input.vendorId, status: { not: "archived" } },
      data: {
        title: input.title,
        sourceType: "cloudflare_stream",
        videoUrl,
        status: "processing",
        cloudflareStreamUid: uid,
        cloudflarePlaybackId: uid,
        cloudflareReadyToStream: false,
        durationSec: 0,
        estimatedMinutes: 0,
      },
    });
    if (updated.count !== 1) throw new CloudflareResourceError("video_archived");
    const video = await db.video.findFirst({ where: { id: existingVideo.id, vendorId: input.vendorId } });
    if (!video) throw new CloudflareResourceError("video_not_found");
    return video;
  }

  const video = await db.video.create({
        data: {
          ...(createId ? { id: createId } : {}),
          vendorId: input.vendorId,
          title: input.title,
          sourceType: "cloudflare_stream",
          videoUrl,
          status: "processing",
          cloudflareStreamUid: uid,
          cloudflarePlaybackId: uid,
          cloudflareReadyToStream: false,
          durationSec: 0,
          estimatedMinutes: 0,
        },
      });

  return video;
}

export async function createLiveInputMapping(input: z.infer<typeof LiveInputRequest>) {
  const { db, video: existingVideo } = await requireCloudflareMappingResources({
    ...input,
    rejectArchivedVideo: Boolean(input.videoId),
  });
  const liveInput = await createLiveInput(input.name);
  const videoUrl = `https://videodelivery.net/${liveInput.uid}/manifest/video.m3u8`;
  const encryptedStreamKey = liveInput.rtmps?.streamKey
    ? encryptSensitiveValue(liveInput.rtmps.streamKey, CLOUDFLARE_STREAM_KEY_PURPOSE)
    : null;
  const video = existingVideo
    ? await db.video.update({
        where: { id: existingVideo.id, vendorId: input.vendorId },
        data: {
          title: input.name,
          sourceType: "cloudflare_live",
          videoUrl,
          status: "processing",
          cloudflareLiveInputUid: liveInput.uid,
          cloudflarePlaybackId: liveInput.uid,
          liveStreamKey: encryptedStreamKey,
          liveInputStatus: "created",
        },
      })
    : await db.video.create({
        data: {
          vendorId: input.vendorId,
          title: input.name,
          sourceType: "cloudflare_live",
          videoUrl,
          status: "processing",
          cloudflareLiveInputUid: liveInput.uid,
          cloudflarePlaybackId: liveInput.uid,
          liveStreamKey: encryptedStreamKey,
          liveInputStatus: "created",
        },
      });

  if (input.liveId) {
    await db.live.updateMany({
      where: { id: input.liveId, vendorId: input.vendorId },
      data: {
        videoId: video.id,
        streamMode: "live",
        cloudflareLiveInputUid: liveInput.uid,
      },
    });
  }

  return { video, liveInput, videoUrl };
}
