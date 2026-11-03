import { z } from "zod";
import {
  CloudflareStreamError,
  updateLiveInputRecordingSecurity,
  updateStreamVideoPlaybackSecurity,
  type StreamPlaybackSecurityUpdate,
} from "@/lib/cloudflare-stream";
import { getStreamLockSecurity } from "@/lib/cloudflare-stream-signing-config";
import { getDb } from "@/lib/db";

/**
 * F-093 §4／§8：對單一 vendor 的既有 Cloudflare Stream 影片與 live input 錄影
 * 批次開啟（lock）或關閉（unlock）`requireSignedURLs`。
 *
 * - 只處理 `sourceType` 為 `cloudflare_stream`／`cloudflare_live` 的列，且以
 *   `vendorId` 篩選；uid 只取伺服器寫入的 `cloudflareStreamUid`／
 *   `cloudflarePlaybackId`／`cloudflareLiveInputUid`，不從商家可改的 `videoUrl` 解析，
 *   也不接受呼叫端傳入 uid。
 * - 預設 dry-run；`apply: true` 才呼叫 Cloudflare。lock 必須已設定簽章金鑰，
 *   否則影片鎖上後應用程式簽不出 token；unlock（回滾）不需要金鑰，並清空
 *   `allowedOrigins`，回到鎖定前的公開狀態。
 * - 以 `id` 游標分頁，每批最多 5 支，逐支依序呼叫（每次請求 15 秒逾時）。
 * - apply 後寫一筆稽核（vendor、模式、每個資源的 uid 與結果；不含 token 或金鑰）。
 *   稽核失敗時回傳 `audited: false` 並記錯誤；Cloudflare 設定錯誤中斷時，先把
 *   已完成的結果寫入稽核再拋出。
 */
export const SIGNED_URL_BACKFILL_MAX_BATCH = 5;

export const SignedUrlBackfillRequest = z.object({
  vendorId: z.string().trim().min(1).max(128),
  mode: z.enum(["lock", "unlock"]).default("lock"),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(SIGNED_URL_BACKFILL_MAX_BATCH).default(SIGNED_URL_BACKFILL_MAX_BATCH),
  apply: z.boolean().default(false),
}).strict();

export type SignedUrlBackfillInput = z.infer<typeof SignedUrlBackfillRequest>;

const CLOUDFLARE_SOURCE_TYPES = ["cloudflare_stream", "cloudflare_live"];
const STREAM_UID_PATTERN = /^[a-f0-9]{32}$/i;

type BackfillTarget = { videoId: string; kind: "video" | "live_input"; uid: string };

export type SignedUrlBackfillResult = BackfillTarget & {
  status: "pending" | "updated" | "not_found" | "failed";
  diagnostic?: string;
  providerStatus?: number | null;
};

export class SignedUrlBackfillNotConfiguredError extends Error {
  constructor() {
    super("Cloudflare Stream signing is not configured.");
    this.name = "SignedUrlBackfillNotConfiguredError";
  }
}

type BackfillVideo = {
  id: string;
  cloudflareStreamUid: string | null;
  cloudflarePlaybackId: string | null;
  cloudflareLiveInputUid: string | null;
};

export type SignedUrlBackfillAudit = (entry: {
  vendorId: string;
  mode: "lock" | "unlock";
  allowedOrigins: string[] | null;
  results: SignedUrlBackfillResult[];
}) => Promise<void>;

function validUid(value: string | null | undefined) {
  const uid = value?.trim();
  return uid && STREAM_UID_PATTERN.test(uid) ? uid.toLowerCase() : null;
}

/** 一列 Video 對應的 Cloudflare 資源：live input 本身，以及欄位中記錄的影片 uid。 */
export function backfillTargetsForVideo(video: BackfillVideo): BackfillTarget[] {
  const liveInputUid = validUid(video.cloudflareLiveInputUid);
  const videoUids = new Set<string>();
  for (const candidate of [validUid(video.cloudflareStreamUid), validUid(video.cloudflarePlaybackId)]) {
    // live input uid 不是影片；由 live input 錄影設定涵蓋。
    if (candidate && candidate !== liveInputUid) videoUids.add(candidate);
  }
  return [
    ...(liveInputUid ? [{ videoId: video.id, kind: "live_input" as const, uid: liveInputUid }] : []),
    ...[...videoUids].map((uid) => ({ videoId: video.id, kind: "video" as const, uid })),
  ];
}

async function applyTarget(target: BackfillTarget, security: StreamPlaybackSecurityUpdate): Promise<SignedUrlBackfillResult> {
  try {
    if (target.kind === "live_input") await updateLiveInputRecordingSecurity(target.uid, security);
    else await updateStreamVideoPlaybackSecurity(target.uid, security);
    return { ...target, status: "updated" };
  } catch (error) {
    if (error instanceof CloudflareStreamError) {
      if (error.code === "provider_rejected" && error.providerStatus === 404) {
        return { ...target, status: "not_found", providerStatus: 404 };
      }
      if (error.code === "configuration") throw error;
      return { ...target, status: "failed", diagnostic: error.code, providerStatus: error.providerStatus };
    }
    return { ...target, status: "failed", diagnostic: "unexpected" };
  }
}

export async function backfillStreamSignedUrls(
  input: SignedUrlBackfillInput,
  dependencies: {
    db?: Pick<ReturnType<typeof getDb>, "video">;
    audit?: SignedUrlBackfillAudit;
  } = {},
) {
  const lockSecurity = getStreamLockSecurity();
  if (input.mode === "lock" && input.apply && !lockSecurity) throw new SignedUrlBackfillNotConfiguredError();
  const security: StreamPlaybackSecurityUpdate | null = input.mode === "unlock"
    ? { requireSignedURLs: false, allowedOrigins: [] }
    : lockSecurity;

  const db = dependencies.db ?? getDb();
  const videos = await db.video.findMany({
    where: {
      vendorId: input.vendorId,
      sourceType: { in: CLOUDFLARE_SOURCE_TYPES },
      ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      OR: [
        { cloudflareStreamUid: { not: null } },
        { cloudflarePlaybackId: { not: null } },
        { cloudflareLiveInputUid: { not: null } },
      ],
    },
    orderBy: { id: "asc" },
    take: input.limit,
    select: {
      id: true,
      cloudflareStreamUid: true,
      cloudflarePlaybackId: true,
      cloudflareLiveInputUid: true,
    },
  });

  const allowedOrigins = input.mode === "lock" ? lockSecurity?.allowedOrigins ?? null : null;
  const audit = async (results: SignedUrlBackfillResult[]) => {
    if (!input.apply || results.length === 0 || !dependencies.audit) return false;
    try {
      await dependencies.audit({ vendorId: input.vendorId, mode: input.mode, allowedOrigins, results });
      return true;
    } catch {
      console.error("stream_signed_url_backfill_audit_failed", { vendorId: input.vendorId, mode: input.mode, count: results.length });
      return false;
    }
  };

  const results: SignedUrlBackfillResult[] = [];
  try {
    for (const target of videos.flatMap(backfillTargetsForVideo)) {
      results.push(input.apply && security ? await applyTarget(target, security) : { ...target, status: "pending" });
    }
  } catch (error) {
    // Cloudflare configuration vanished mid-batch: record what already changed first.
    await audit(results);
    throw error;
  }

  const audited = await audit(results);

  return {
    mode: input.mode,
    apply: input.apply,
    allowedOrigins,
    scannedVideos: videos.length,
    results,
    audited,
    nextCursor: videos.length === input.limit ? videos[videos.length - 1]!.id : null,
  };
}
