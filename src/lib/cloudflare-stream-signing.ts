import { createPrivateKey, sign, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * F-093：Cloudflare Stream 簽章播放網址（自簽 RS256 JWT）。
 *
 * 只能在伺服器端使用：私鑰來自非 `NEXT_PUBLIC_*` 的環境變數，token 不寫入
 * DB 或 log。未設定金鑰時整個功能停用，播放網址與上傳參數維持原狀，讓各環境
 * 可以逐步切換（見 docs/operations/stream-signed-urls-plan.md）。
 */

/** `nbf` 往前推的秒數，容忍伺服器與 Cloudflare 的時鐘差。 */
export const STREAM_TOKEN_CLOCK_SKEW_SECONDS = 30;
/** Cloudflare 規定 `exp` 最多是簽發後 24 小時。 */
export const STREAM_TOKEN_MAX_LIFETIME_SECONDS = 24 * 60 * 60;
/** 直播（含 evergreen、指定場次播放中）token 效期。 */
export const STREAM_LIVE_TOKEN_TTL_SECONDS = 10 * 60;
/** 回放 token 效期；VOD 換網址要補 seek，效期拉長以減少切換。 */
export const STREAM_REPLAY_TOKEN_TTL_SECONDS = 30 * 60;
/** 商家後台預覽與公開報名頁宣傳影片的 token 效期。 */
export const STREAM_PREVIEW_TOKEN_TTL_SECONDS = 4 * 60 * 60;

const MIN_RSA_MODULUS_BITS = 2048;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const CUSTOMER_CODE_PATTERN = /^[a-z0-9]{1,64}$/;
const VIDEO_UID_PATTERN = /^[a-f0-9]{32}$/i;
const CUSTOMER_HOST_PATTERN = /^customer-[a-z0-9]{1,64}\.cloudflarestream\.com$/;
const PLAYBACK_PATH_SUFFIXES = new Set(["manifest/video.m3u8", "manifest/video.mpd"]);
const ALLOWED_ORIGIN_PATTERN = /^(\*\.)?([^:/*]{1,253})(?::(\d{1,5}))?$/;
const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type StreamSigningMisconfiguration =
  | "partial"
  | "both_key_formats"
  | "invalid_key_id"
  | "invalid_key"
  | "weak_key"
  | "invalid_customer_code";

export type StreamSigningConfig =
  | { status: "disabled" }
  | { status: "misconfigured"; reason: StreamSigningMisconfiguration }
  | { status: "enabled"; keyId: string; privateKey: KeyObject; customerCode: string | null };

type SigningEnv = Partial<Record<string, string | undefined>>;

function trimmed(value: string | undefined) {
  const result = value?.trim();
  return result ? result : null;
}

/** Vercel 與 shell 常把 PEM 的換行存成字面 `\n`。 */
function normalizePemText(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

/**
 * Cloudflare `POST /stream/keys` 回傳的 `pem`／`jwk` 都是 base64 編碼；也接受
 * 直接貼上的 PEM 文字或 JWK JSON。
 */
function decodeMaybeBase64(value: string, looksDecoded: (text: string) => boolean) {
  if (looksDecoded(value)) return value;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64").toString("utf8").trim();
  return looksDecoded(decoded) ? decoded : null;
}

function parsePrivateKey(pem: string | null, jwk: string | null): KeyObject | null {
  try {
    if (pem) {
      const text = decodeMaybeBase64(normalizePemText(pem), (candidate) => candidate.startsWith("-----BEGIN"));
      return text ? createPrivateKey({ key: text, format: "pem" }) : null;
    }
    if (jwk) {
      const text = decodeMaybeBase64(jwk, (candidate) => candidate.startsWith("{"));
      if (!text) return null;
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return createPrivateKey({ key: parsed as JsonWebKey, format: "jwk" });
    }
  } catch {
    return null;
  }
  return null;
}

let cachedConfig: { fingerprint: string; config: StreamSigningConfig } | null = null;

/** 讀取並驗證簽章設定；結果依環境變數值快取，避免每個請求重新解析私鑰。 */
export function getStreamSigningConfig(env: SigningEnv = process.env): StreamSigningConfig {
  const keyId = trimmed(env.CLOUDFLARE_STREAM_SIGNING_KEY_ID);
  const pem = trimmed(env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM);
  const jwk = trimmed(env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK);
  const customerCode = trimmed(env.CLOUDFLARE_STREAM_CUSTOMER_CODE)?.toLowerCase() ?? null;
  const fingerprint = JSON.stringify([keyId, pem, jwk, customerCode]);
  if (cachedConfig?.fingerprint === fingerprint) return cachedConfig.config;

  const config = resolveStreamSigningConfig(keyId, pem, jwk, customerCode);
  cachedConfig = { fingerprint, config };
  return config;
}

function resolveStreamSigningConfig(
  keyId: string | null,
  pem: string | null,
  jwk: string | null,
  customerCode: string | null,
): StreamSigningConfig {
  if (!keyId && !pem && !jwk) return { status: "disabled" };
  if (pem && jwk) return { status: "misconfigured", reason: "both_key_formats" };
  if (!keyId || (!pem && !jwk)) return { status: "misconfigured", reason: "partial" };
  if (!KEY_ID_PATTERN.test(keyId)) return { status: "misconfigured", reason: "invalid_key_id" };
  if (customerCode !== null && !CUSTOMER_CODE_PATTERN.test(customerCode)) {
    return { status: "misconfigured", reason: "invalid_customer_code" };
  }
  const privateKey = parsePrivateKey(pem, jwk);
  if (!privateKey || privateKey.type !== "private" || privateKey.asymmetricKeyType !== "rsa") {
    return { status: "misconfigured", reason: "invalid_key" };
  }
  if ((privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_RSA_MODULUS_BITS) {
    return { status: "misconfigured", reason: "weak_key" };
  }
  return { status: "enabled", keyId, privateKey, customerCode };
}

export function isStreamSigningEnabled(env: SigningEnv = process.env) {
  return getStreamSigningConfig(env).status === "enabled";
}

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
 * 解析我們寫進 `Video.videoUrl` 的 Cloudflare Stream 播放網址
 * （`https://videodelivery.net/<uid>/manifest/video.m3u8` 或
 * `https://customer-<CODE>.cloudflarestream.com/<uid>/manifest/video.m3u8`）。
 * 其他網址（商家自填的外部 HLS／MP4）回傳 null。
 */
export function parseCloudflareStreamPlaybackUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  if (host !== "videodelivery.net" && !CUSTOMER_HOST_PATTERN.test(host)) return null;
  if (url.search || url.hash) return null;
  const [, uid, ...rest] = url.pathname.split("/");
  const suffix = rest.join("/");
  if (!uid || !VIDEO_UID_PATTERN.test(uid) || !PLAYBACK_PATH_SUFFIXES.has(suffix)) return null;
  return { host, uid, suffix };
}

export type SignedStreamPlayback =
  | { signed: false; playbackUrl: string }
  | { signed: true; playbackUrl: string; expiresAt: Date };

/**
 * 呼叫端必須已完成入場與 vendor ownership 檢查。
 *
 * - 簽章停用（或設定錯誤，preflight 會擋下部署）或不是 Cloudflare Stream 網址：原網址不變。
 * - 已啟用：以 token 取代網址中的 uid；`exp` 取 `min(now + ttl, notAfter, now + 24h)`。
 * - `notAfter` 已過（例如回放截止）：回傳 null，呼叫端視為無法播放。
 */
export function signStreamPlaybackUrl(
  playbackUrl: string,
  options: { now: Date; ttlSeconds: number; notAfter?: Date | null },
  env: SigningEnv = process.env,
): SignedStreamPlayback | null {
  const config = getStreamSigningConfig(env);
  if (config.status !== "enabled") return { signed: false, playbackUrl };
  const parsed = parseCloudflareStreamPlaybackUrl(playbackUrl);
  if (!parsed) return { signed: false, playbackUrl };

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
    playbackUrl: `https://${host}/${token}/${parsed.suffix}`,
    expiresAt: new Date(expiresAtSeconds * 1_000),
  };
}

/** 給 server component 用：簽章失敗（已過 notAfter）時回傳 null。 */
export function signedStreamPlaybackUrlOrNull(
  playbackUrl: string | null | undefined,
  options: { now?: Date; ttlSeconds?: number; notAfter?: Date | null } = {},
) {
  if (!playbackUrl) return null;
  return signStreamPlaybackUrl(playbackUrl, {
    now: options.now ?? new Date(),
    ttlSeconds: options.ttlSeconds ?? STREAM_PREVIEW_TOKEN_TTL_SECONDS,
    notAfter: options.notAfter ?? null,
  })?.playbackUrl ?? null;
}

export type StreamAllowedOriginsResult = {
  origins: string[];
  invalid: string[];
};

function appUrlOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Cloudflare：localhost 等非 80／443 連接埠要寫明；`URL.port` 只在非預設連接埠時有值。
    return url.port ? `${url.hostname.toLowerCase()}:${url.port}` : url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeAllowedOrigin(entry: string) {
  let value = entry.trim().toLowerCase();
  if (!value) return null;
  // 容許誤貼 scheme 或結尾斜線；路徑一律不接受（Cloudflare 不支援）。
  value = value.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const match = ALLOWED_ORIGIN_PATTERN.exec(value);
  if (!match) return undefined;
  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (port < 1 || port > 65_535)) return undefined;
  return match[2]!.split(".").every((label) => HOST_LABEL_PATTERN.test(label)) ? value : undefined;
}

/**
 * `allowedOrigins`：`NEXT_PUBLIC_APP_URL` 的主機名，加上 `STREAM_ALLOWED_ORIGINS`
 * （逗號分隔，可用 `*.example.com` 萬用子網域；不含裸網域）。
 */
export function getStreamAllowedOrigins(env: SigningEnv = process.env): StreamAllowedOriginsResult {
  const origins = new Set<string>();
  const invalid: string[] = [];
  const appOrigin = appUrlOrigin(trimmed(env.NEXT_PUBLIC_APP_URL));
  if (appOrigin) origins.add(appOrigin);
  for (const entry of (env.STREAM_ALLOWED_ORIGINS ?? "").split(",")) {
    const normalized = normalizeAllowedOrigin(entry);
    if (normalized === null) continue;
    if (normalized === undefined) invalid.push(entry.trim());
    else origins.add(normalized);
  }
  return { origins: [...origins], invalid };
}

export type StreamPlaybackSecurity = {
  requireSignedURLs: true;
  allowedOrigins: string[];
};

/**
 * 新上傳與 live input 錄影要套用的播放限制。簽章未啟用時回傳 null，讓呼叫端
 * 維持原本的 Cloudflare 請求內容（否則新影片會變成無法播放）。
 */
export function getStreamPlaybackSecurity(env: SigningEnv = process.env): StreamPlaybackSecurity | null {
  if (!isStreamSigningEnabled(env)) return null;
  return { requireSignedURLs: true, allowedOrigins: getStreamAllowedOrigins(env).origins };
}
