import { createPrivateKey, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * F-093：Cloudflare Stream 簽章設定（金鑰解析、allowedOrigins、鎖定新上傳旗標）。
 *
 * 這個模組不簽 token，因此不標 `server-only`：preflight（`scripts/preflight.ts`
 * 以 tsx 執行）與 `cloudflare-stream.ts` 也要讀設定。實際簽章在
 * `cloudflare-stream-signing.ts`（`server-only`）。私鑰只來自非 `NEXT_PUBLIC_*`
 * 的環境變數，任何回傳值與訊息都不含金鑰內容。
 */

const MIN_RSA_MODULUS_BITS = 2048;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const CUSTOMER_CODE_PATTERN = /^[a-z0-9]{1,64}$/;
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

export type StreamSigningEnv = Partial<Record<string, string | undefined>>;

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
export function getStreamSigningConfig(env: StreamSigningEnv = process.env): StreamSigningConfig {
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

export function isStreamSigningEnabled(env: StreamSigningEnv = process.env) {
  return getStreamSigningConfig(env).status === "enabled";
}

export type StreamUploadLockFlag = "on" | "off" | "invalid";

/**
 * `CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS`：簽章網址在 Staging 驗證通過後才設
 * `true`，新上傳與新 live input 錄影才會要求簽章。未設定或 `false` 為關閉。
 */
export function getStreamUploadLockFlag(env: StreamSigningEnv = process.env): StreamUploadLockFlag {
  const value = trimmed(env.CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS)?.toLowerCase() ?? null;
  if (value === null || value === "false") return "off";
  if (value === "true") return "on";
  return "invalid";
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
export function getStreamAllowedOrigins(env: StreamSigningEnv = process.env): StreamAllowedOriginsResult {
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

/** 鎖定（批次 lock）時要送給 Cloudflare 的播放限制；簽章未啟用時回傳 null。 */
export function getStreamLockSecurity(env: StreamSigningEnv = process.env): StreamPlaybackSecurity | null {
  if (!isStreamSigningEnabled(env)) return null;
  return { requireSignedURLs: true, allowedOrigins: getStreamAllowedOrigins(env).origins };
}

/**
 * 新上傳與 live input 錄影要套用的播放限制：簽章已啟用，且
 * `CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS=true`。否則回傳 null，呼叫端維持原本的
 * Cloudflare 請求內容。
 */
export function getStreamPlaybackSecurity(env: StreamSigningEnv = process.env): StreamPlaybackSecurity | null {
  if (getStreamUploadLockFlag(env) !== "on") return null;
  return getStreamLockSecurity(env);
}
