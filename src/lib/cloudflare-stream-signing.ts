import "server-only";
import { sign, type KeyObject } from "node:crypto";
import { getStreamSigningConfig, type StreamSigningEnv } from "@/lib/cloudflare-stream-signing-config";

/**
 * F-093：Cloudflare Stream 簽章網址（自簽 RS256 JWT）。
 *
 * 只能在伺服器端使用。token 不寫入 DB 或 log。未設定金鑰時整個功能停用，
 * 網址維持原狀，讓各環境可以逐步切換（見 docs/operations/stream-signed-urls-plan.md）。
 *
 * 簽章只看 Video 列本身：只有 Cloudflare 類型（`cloudflare_stream`／`cloudflare_live`）
 * 才簽，`sub` 必須是同一列由伺服器寫入的 `cloudflareStreamUid`／`cloudflarePlaybackId`／
 * `cloudflareLiveInputUid`；網址中的 uid 與這些欄位不一致時不簽。商家可自填的
 * `url` 類型即使貼了 Stream 網址也一律原樣回傳，避免替其他租戶的影片簽 token。
 */

/** `nbf` 往前推的秒數，容忍伺服器與 Cloudflare 的時鐘差。 */
export const STREAM_TOKEN_CLOCK_SKEW_SECONDS = 30;
/** Cloudflare 規定 `exp` 最多是簽發後 24 小時。 */
export const STREAM_TOKEN_MAX_LIFETIME_SECONDS = 24 * 60 * 60;
/** 直播（含 evergreen、指定場次播放中）token 效期。 */
export const STREAM_LIVE_TOKEN_TTL_SECONDS = 10 * 60;
/** 回放 token 效期；VOD 換網址要補 seek，效期拉長以減少切換。 */
export const STREAM_REPLAY_TOKEN_TTL_SECONDS = 30 * 60;
/** 商家後台預覽、縮圖與公開報名頁宣傳影片的 token 效期。 */
export const STREAM_PREVIEW_TOKEN_TTL_SECONDS = 4 * 60 * 60;

export const CLOUDFLARE_VIDEO_SOURCE_TYPES: ReadonlySet<string> = new Set(["cloudflare_stream", "cloudflare_live"]);

const VIDEO_UID_PATTERN = /^[a-f0-9]{32}$/i;
const CUSTOMER_HOST_PATTERN = /^customer-[a-z0-9]{1,64}\.cloudflarestream\.com$/;
const PLAYBACK_SUFFIX_PATTERN = /^manifest\/video\.(m3u8|mpd)$/;
const THUMBNAIL_SUFFIX_PATTERN = /^thumbnails\/thumbnail\.(jpg|png|gif|webp)$/;

export type StreamUrlKind = "playback" | "thumbnail";

/** Video 列中簽章需要的欄位；呼叫端必須已用目前 vendor 篩選。 */
export type SignableVideo = {
  vendorId: string;
  sourceType: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  cloudflareStreamUid: string | null;
  cloudflarePlaybackId: string | null;
  cloudflareLiveInputUid: string | null;
};

export const SIGNABLE_VIDEO_SELECT = {
  vendorId: true,
  sourceType: true,
  videoUrl: true,
  cloudflareStreamUid: true,
  cloudflarePlaybackId: true,
  cloudflareLiveInputUid: true,
} as const;

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * 依 Cloudflare 規格簽 RS256 JWT：header `{ alg, kid }`，claims `sub`（video
 * 或 live input uid）、`kid`、`nbf`、`exp`。不綁 IP（行動網路換 IP 會誤擋）。
 */
export function signStreamToken(input: {
  videoUid: string;
  keyId: string;
  privateKey: KeyObject;
  notBeforeSeconds: number;
  expiresAtSeconds: number;
}) {
  const header = base64UrlJson({ alg: "RS256", kid: input.keyId });
  const payload = base64UrlJson({
    sub: input.videoUid,
    kid: input.keyId,
    nbf: input.notBeforeSeconds,
    exp: input.expiresAtSeconds,
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput, "utf8"), input.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * 解析 Cloudflare Stream 網址（`videodelivery.net` 或 `customer-<CODE>.cloudflarestream.com`，
 * 32 位 hex uid）。播放網址只接受 HLS／DASH manifest 且不得帶 query；縮圖保留 query
 * （例如 `time`、`height`）。
 */
export function parseCloudflareStreamUrl(value: string, kind: StreamUrlKind) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
  if (host !== "videodelivery.net" && !CUSTOMER_HOST_PATTERN.test(host)) return null;
  if (kind === "playback" && url.search) return null;
  const [, uid, ...rest] = url.pathname.split("/");
  const suffix = rest.join("/");
  const suffixPattern = kind === "playback" ? PLAYBACK_SUFFIX_PATTERN : THUMBNAIL_SUFFIX_PATTERN;
  if (!uid || !VIDEO_UID_PATTERN.test(uid) || !suffixPattern.test(suffix)) return null;
  return { host, uid: uid.toLowerCase(), suffix, search: url.search };
}

function boundUids(video: SignableVideo) {
  return new Set(
    [video.cloudflareStreamUid, video.cloudflarePlaybackId, video.cloudflareLiveInputUid]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value && VIDEO_UID_PATTERN.test(value))),
  );
}

export type SignedStreamUrl =
  | { signed: false; url: string }
  | { signed: true; url: string; expiresAt: Date };

let warnedMisconfiguration: string | null = null;

/** 執行期發現設定錯誤時記一次警告（只含原因代碼，不含金鑰）；preflight 會擋下部署。 */
function warnMisconfiguredOnce(reason: string) {
  if (warnedMisconfiguration === reason) return;
  warnedMisconfiguration = reason;
  console.warn("stream_signing_misconfigured", { reason });
}

export type SignVideoUrlOptions = {
  /** 目前 vendor；與 `video.vendorId` 不同時不簽、回傳 null。 */
  vendorId: string;
  now: Date;
  ttlSeconds: number;
  notAfter?: Date | null;
  kind?: StreamUrlKind;
};

/**
 * 為已綁定目前 vendor 的 Video 列簽章播放（或縮圖）網址。
 *
 * - `video.vendorId !== vendorId`：null。
 * - 非 Cloudflare 類型、簽章停用或設定錯誤、不是 Stream 網址、網址 uid 與欄位不一致：原網址、`signed: false`。
 * - 已啟用：以 token 取代 uid；`exp` 取 `min(now + ttl, notAfter, now + 24h)`；`notAfter` 已過時回傳 null。
 */
export function signVideoUrl(
  video: SignableVideo,
  options: SignVideoUrlOptions,
  env: StreamSigningEnv = process.env,
): SignedStreamUrl | null {
  if (video.vendorId !== options.vendorId) return null;
  const kind = options.kind ?? "playback";
  const url = kind === "playback" ? video.videoUrl : video.thumbnailUrl ?? "";
  const unchanged: SignedStreamUrl = { signed: false, url };
  if (!CLOUDFLARE_VIDEO_SOURCE_TYPES.has(video.sourceType)) return unchanged;

  const config = getStreamSigningConfig(env);
  if (config.status === "misconfigured") warnMisconfiguredOnce(config.reason);
  if (config.status !== "enabled") return unchanged;

  const parsed = parseCloudflareStreamUrl(url, kind);
  if (!parsed || !boundUids(video).has(parsed.uid)) return unchanged;

  const nowSeconds = Math.floor(options.now.getTime() / 1_000);
  const ttlSeconds = Math.max(1, Math.min(Math.floor(options.ttlSeconds), STREAM_TOKEN_MAX_LIFETIME_SECONDS));
  let expiresAtSeconds = nowSeconds + ttlSeconds;
  if (options.notAfter) {
    expiresAtSeconds = Math.min(expiresAtSeconds, Math.floor(options.notAfter.getTime() / 1_000));
  }
  if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= nowSeconds) return null;

  const token = signStreamToken({
    videoUid: parsed.uid,
    keyId: config.keyId,
    privateKey: config.privateKey,
    notBeforeSeconds: nowSeconds - STREAM_TOKEN_CLOCK_SKEW_SECONDS,
    expiresAtSeconds,
  });
  const host = config.customerCode ? `customer-${config.customerCode}.cloudflarestream.com` : parsed.host;
  return {
    signed: true,
    url: `https://${host}/${token}/${parsed.suffix}${kind === "thumbnail" ? parsed.search : ""}`,
    expiresAt: new Date(expiresAtSeconds * 1_000),
  };
}

/**
 * 給 server component 用（後台預覽、縮圖、報名頁宣傳影片）：預設 4 小時。
 * 不屬於目前 vendor 或已過 `notAfter` 時回傳 null。
 */
export function signedVideoUrlOrNull(
  video: SignableVideo | null | undefined,
  options: { vendorId: string; kind?: StreamUrlKind; now?: Date; ttlSeconds?: number },
) {
  if (!video) return null;
  const signed = signVideoUrl(video, {
    vendorId: options.vendorId,
    kind: options.kind,
    now: options.now ?? new Date(),
    ttlSeconds: options.ttlSeconds ?? STREAM_PREVIEW_TOKEN_TTL_SECONDS,
  });
  return signed?.url || null;
}
