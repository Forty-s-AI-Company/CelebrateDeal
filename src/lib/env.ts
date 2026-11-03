import { z } from "zod";
import { isValidSentryEnvironment } from "@/lib/sentry-environment";
import { payUniLiveProbeAvailable } from "@/lib/payuni-live-probe";
import { payUniStagingPlanTestScope } from "@/lib/payuni-staging-plan-test";
import { isStagingPayUniPreviewCandidate } from "@/lib/database-identity";
import { payUniCredentialKeys } from "@/lib/payuni-credentials";
import { isVercelProductionDeployment, PRODUCTION_PAYMENT_PROVIDER } from "@/lib/payment-providers/runtime-policy";
import {
  DATA_ENCRYPTION_KEY_BYTES,
  DATA_ENCRYPTION_KEYRING_ENV,
  DataEncryptionKeyringError,
  LEGACY_DATA_KEY_ID,
  MINIMUM_ENCRYPTION_SECRET_BYTES,
  inspectDataEncryptionKeyring,
  type DataEncryptionKeyringIssue,
} from "@/lib/sensitive-data";
import {
  LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH,
  LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH,
} from "@/lib/request-client-ip";
import { REGISTRATION_MODES } from "@/lib/registration-mode";
import { getTurnstileConfig } from "@/lib/turnstile";
import {
  getStreamAllowedOrigins,
  getStreamSigningConfig,
  getStreamUploadLockFlag,
  type StreamSigningMisconfiguration,
} from "@/lib/cloudflare-stream-signing-config";

const RequiredUrl = z.string().url();
const OptionalSecret = z.string().optional();
const OptionalSentryEnvironment = z.string().refine(
  (value) => !value || isValidSentryEnvironment(value),
  "Sentry environment 只能使用 1–64 個英數字、點、底線或連字號",
).optional();
const EmailFrom = z.string().min(3).refine((value) => {
  if (/[\r\n]/.test(value)) return false;
  const trimmed = value.trim();
  const bracketed = /^[^<>]{1,100}<([^<>]+)>$/.exec(trimmed);
  const address = bracketed?.[1]?.trim() ?? trimmed;
  return z.string().email().safeParse(address).success;
}, "EMAIL_FROM 必須是單一有效寄件地址，可使用「名稱 <email>」格式");

export const ProductionEnvSchema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql://"),
  DIRECT_URL: z.string().startsWith("postgresql://"),
  NEXT_PUBLIC_APP_URL: RequiredUrl,
  JOB_SECRET: z.string().min(16),
  CRON_SECRET: z.string().min(16),
  CSRF_SECRET: OptionalSecret,
  LIVE_CHAT_INGRESS_SECRET: z.string()
    .min(LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH)
    .max(LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH,
      `LIVE_CHAT_INGRESS_SECRET 的 UTF-8 bytes 不得超過 ${LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH}`,
    )
    .optional(),
  RATE_LIMIT_PROVIDER: z.enum(["memory", "cloudflare_waf", "upstash_redis"]).default("memory"),
  UPSTASH_REDIS_REST_URL: OptionalSecret,
  UPSTASH_REDIS_REST_TOKEN: OptionalSecret,
  CLOUDFLARE_ACCOUNT_ID: OptionalSecret,
  CLOUDFLARE_STREAM_TOKEN: OptionalSecret,
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: OptionalSecret,
  // F-093: Stream signed playback URLs. Validated in streamSigningChecks.
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: OptionalSecret,
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: OptionalSecret,
  CLOUDFLARE_STREAM_SIGNING_KEY_JWK: OptionalSecret,
  CLOUDFLARE_STREAM_CUSTOMER_CODE: OptionalSecret,
  CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS: OptionalSecret,
  STREAM_ALLOWED_ORIGINS: OptionalSecret,
  PAYMENT_PROVIDER: z.enum(["demo", "payuni", "ecpay-like", "platform-ecpay"]).default("demo"),
  PAYUNI_HASH_KEY: OptionalSecret,
  PAYUNI_HASH_IV: OptionalSecret,
  PAYUNI_MERCHANT_ID: OptionalSecret,
  PAYUNI_SANDBOX_HASH_KEY: OptionalSecret,
  PAYUNI_SANDBOX_HASH_IV: OptionalSecret,
  PAYUNI_SANDBOX_MERCHANT_ID: OptionalSecret,
  PAYUNI_ENV: z.enum(["sandbox", "production"]).optional(),
  ECPAY_WEBHOOK_SECRET: OptionalSecret,
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: EmailFrom,
  SMOKE_TEST_EMAIL: OptionalSecret,
  SENTRY_DSN: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: OptionalSecret,
  SENTRY_ENVIRONMENT: OptionalSentryEnvironment,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: OptionalSentryEnvironment,
  SENTRY_ORG: OptionalSecret,
  SENTRY_PROJECT: OptionalSecret,
  SENTRY_AUTH_TOKEN: OptionalSecret,
  NEXT_PUBLIC_POSTHOG_KEY: OptionalSecret,
  NEXT_PUBLIC_POSTHOG_HOST: RequiredUrl.optional(),
  // Cloudflare Turnstile (registration and verification-mail resend). Both or
  // neither; see turnstileChecks.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: OptionalSecret,
  TURNSTILE_SECRET_KEY: OptionalSecret,
  TURNSTILE_ALLOWED_HOSTNAMES: OptionalSecret,
  // Unset or blank = invite (closed beta). Any other value is a typo and fails
  // preflight; the runtime also treats it as invite.
  REGISTRATION_MODE: z.preprocess(
    (value) => typeof value === "string" ? value.trim().toLowerCase() || undefined : value,
    z.enum(REGISTRATION_MODES, { message: "REGISTRATION_MODE 只能是 invite 或 open；未設定＝invite" }).optional(),
  ),
});

export type EnvCheck = {
  key: keyof z.infer<typeof ProductionEnvSchema> | string;
  status: "pass" | "warning" | "fail";
  message: string;
};

function secretPresent(value: string | undefined) {
  return Boolean(value && value.trim() && !value.includes("...") && !value.includes("example"));
}

function strongEncryptionSecret(value: string | undefined) {
  return secretPresent(value)
    && Buffer.byteLength(value!.trim(), "utf8") >= MINIMUM_ENCRYPTION_SECRET_BYTES;
}

function csrfSecretDeploymentCheck(env: NodeJS.ProcessEnv): EnvCheck {
  const csrfConfigured = secretPresent(env.CSRF_SECRET);
  const csrfSecretStrong = strongEncryptionSecret(env.CSRF_SECRET);
  const csrfSecretIsDistinct = csrfConfigured
    && secretPresent(env.JOB_SECRET)
    && env.CSRF_SECRET !== env.JOB_SECRET;
  let message = "已設定獨立且至少 32 bytes 的 CSRF／MFA 加密密鑰";
  if (!csrfConfigured) {
    message = "production 必須使用獨立 CSRF_SECRET，不得與 JOB_SECRET 共用";
  } else if (!csrfSecretStrong) {
    message = "CSRF_SECRET 作為 MFA／敏感資料加密來源時必須至少 32 bytes";
  } else if (!csrfSecretIsDistinct) {
    message = "CSRF_SECRET 不得與 JOB_SECRET 共用";
  }

  return {
    key: "CSRF_SECRET",
    status: csrfSecretStrong && csrfSecretIsDistinct ? "pass" : "fail",
    message,
  };
}

const KEYRING_ISSUE_MESSAGES: Record<DataEncryptionKeyringIssue, string> = {
  invalid_json: "不是有效的 JSON",
  not_a_list: "必須是 JSON 陣列，例如 [{\"kid\":\"d2611a\",\"key\":\"…\",\"active\":true},{\"kid\":\"legacy\"}]",
  empty: "不可為空陣列；不使用 keyring 時請整個不設定",
  invalid_entry: "每一項只能有 kid、key、active（布林值）三個欄位",
  invalid_key_id: "kid 只能是 1–32 個小寫英數字、底線或連字號，且以英數字開頭",
  duplicate_key_id: "kid 重複",
  duplicate_key_material: "兩個 kid 使用同一把金鑰；每個 kid 必須是不同的隨機值",
  no_active_key: "必須恰好有一把 active 金鑰，目前沒有",
  multiple_active_keys: "必須恰好有一把 active 金鑰，目前超過一把",
  legacy_key_material: "kid legacy 代表 CSRF_SECRET 衍生的金鑰，不可附 key",
  missing_key_material: "非 legacy 的 kid 必須附 key",
  invalid_key_encoding: "key 必須是無 padding 的 base64url",
  key_too_short: `key 長度不足：必須是 ${DATA_ENCRYPTION_KEY_BYTES} bytes 隨機值（base64url 後 43 字元）`,
  key_too_long: `key 長度必須剛好是 ${DATA_ENCRYPTION_KEY_BYTES} bytes（base64url 後 43 字元）`,
};

/**
 * F-031 ②③: DATA_ENCRYPTION_KEYRING makes the data-encryption key rotatable.
 * Unset keeps encrypting with the CSRF_SECRET-derived key (warning); a
 * malformed value fails, because the runtime then refuses every envelope.
 * Messages carry only kids and issue codes, never key material.
 */
function dataEncryptionKeyringCheck(env: NodeJS.ProcessEnv): EnvCheck {
  const key = DATA_ENCRYPTION_KEYRING_ENV;
  try {
    const summary = inspectDataEncryptionKeyring(env[key]);
    if (!summary.configured) {
      return { key, status: "warning", message: "未設定；敏感資料仍以根金鑰 CSRF_SECRET 衍生的金鑰加密（kid legacy），資料金鑰無法輪替。設定方式與輪替步驟見 docs/staging-production-env-vars.md §8" };
    }
    const decryptOnly = summary.decryptOnlyKeyIds.length ? summary.decryptOnlyKeyIds.join("、") : "無";
    const legacyNote = summary.activeKeyId === LEGACY_DATA_KEY_ID
      ? "；新資料仍以 legacy 寫入（輪替第 1 階段）"
      : summary.acceptsLegacy ? "" : "；不再接受 legacy（CSRF_SECRET 衍生）密文，必須已完成 re-encrypt";
    return { key, status: "pass", message: `active kid：${summary.activeKeyId}；decrypt-only：${decryptOnly}${legacyNote}` };
  } catch (error) {
    const issue = error instanceof DataEncryptionKeyringError ? error.issue : "invalid_json";
    return { key, status: "fail", message: `DATA_ENCRYPTION_KEYRING 格式錯誤：${KEYRING_ISSUE_MESSAGES[issue]}；執行時所有敏感資料加解密都會拒絕` };
  }
}

function liveChatIngressSecretDeploymentCheck(env: NodeJS.ProcessEnv): EnvCheck {
  const value = env.LIVE_CHAT_INGRESS_SECRET;
  const strong = secretPresent(value)
    && value!.trim() === value
    && value!.length >= LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH
    && value!.length <= LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH
    && Buffer.byteLength(value!, "utf8") >= LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH
    && Buffer.byteLength(value!, "utf8") <= LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH
    && !/[\r\n]/.test(value!);

  return {
    key: "LIVE_CHAT_INGRESS_SECRET",
    status: strong ? "pass" : "fail",
    message: strong
      ? "已設定至少 32 字元的直播入口 proof secret"
      : "Preview／Production 必須設定至少 32 字元的 LIVE_CHAT_INGRESS_SECRET",
  };
}

/**
 * Public registration (`REGISTRATION_MODE=open`) needs bot protection and
 * working verification mail. On a deployment (Preview or Production) opening
 * registration without Turnstile or without email sending fails preflight;
 * locally it only passes with a note.
 */
function registrationModeChecks(env: NodeJS.ProcessEnv, deploymentSecurityRequired: boolean): EnvCheck[] {
  const value = env.REGISTRATION_MODE?.trim().toLowerCase();
  if (value && !(REGISTRATION_MODES as readonly string[]).includes(value)) return []; // the schema reports it
  if (value !== "open") return [{ key: "REGISTRATION_MODE", status: "pass", message: "商家註冊僅限平台邀請（封測預設）" }];
  if (!deploymentSecurityRequired) return [{ key: "REGISTRATION_MODE", status: "pass", message: "本機開放任何人註冊商家" }];
  const missing = [
    ...(getTurnstileConfig(env).status === "enabled" ? [] : ["Turnstile（NEXT_PUBLIC_TURNSTILE_SITE_KEY、TURNSTILE_SECRET_KEY）"]),
    ...(secretPresent(env.RESEND_API_KEY) && EmailFrom.safeParse(env.EMAIL_FROM ?? "").success ? [] : ["驗證信寄送（RESEND_API_KEY、EMAIL_FROM）"]),
  ];
  if (missing.length > 0) {
    return [{ key: "REGISTRATION_MODE", status: "fail", message: `REGISTRATION_MODE=open 會開放任何人註冊商家，但尚未設定${missing.join("與")}；設定完成前不可開放公開註冊` }];
  }
  return [{ key: "REGISTRATION_MODE", status: "warning", message: "已開放任何人註冊商家（Turnstile 與商家 Email 驗證已啟用）；請確認這是正式公開註冊的決定" }];
}

function turnstileChecks(env: NodeJS.ProcessEnv): EnvCheck[] {
  const config = getTurnstileConfig(env);
  if (config.status === "enabled") return [{ key: "TURNSTILE_SECRET_KEY", status: "pass", message: "已設定 Turnstile 站點金鑰與伺服器金鑰；註冊與重新寄送驗證信會驗證真人" }];
  if (config.status === "misconfigured") {
    return [{ key: "TURNSTILE_SECRET_KEY", status: "fail", message: config.reason === "test_key_on_deployment"
      ? "Preview／Production 不可使用 Cloudflare 公開的 Turnstile 測試金鑰；請改用 Cloudflare 後台建立的 widget 金鑰"
      : "NEXT_PUBLIC_TURNSTILE_SITE_KEY 與 TURNSTILE_SECRET_KEY 必須同時設定；只設定一個時註冊與重新寄送驗證信會一律失敗" }];
  }
  return [{ key: "TURNSTILE_SECRET_KEY", status: "warning", message: "未設定 Turnstile；註冊與重新寄送驗證信沒有機器人防護（邀請制可接受，開放公開註冊前必須設定）" }];
}

function requiresDeploymentSecurity(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV === "production"
    || env.VERCEL_ENV === "preview"
    || env.VERCEL_ENV === "production";
}

function payUniEnvironmentDeploymentCheck(
  env: NodeJS.ProcessEnv,
  deploymentSecurityRequired: boolean,
): EnvCheck {
  const configured = secretPresent(env.PAYUNI_ENV);
  const value = env.PAYUNI_ENV?.trim().toLowerCase();
  const expected = env.VERCEL_ENV === "preview"
    ? payUniLiveProbeAvailable(env.PAYUNI_LIVE_PROBE_VENDOR_ID ?? "", env)
      || payUniStagingPlanTestScope(env)
      || isStagingPayUniPreviewCandidate(env) ? "production" : "sandbox"
    : env.VERCEL_ENV === "production" || env.NODE_ENV === "production"
      ? "production"
      : undefined;

  if (!deploymentSecurityRequired) {
    return {
      key: "PAYUNI_ENV",
      status: configured ? "pass" : "warning",
      message: configured ? "已設定 PayUni environment" : "本機未設定 PayUni environment",
    };
  }

  if (!configured) {
    return {
      key: "PAYUNI_ENV",
      status: "fail",
      message: "Preview／Production 使用 PayUni 時必須設定 PAYUNI_ENV",
    };
  }

  if (!expected) {
    return {
      key: "PAYUNI_ENV",
      status: "fail",
      message: "無法判定 PayUni deployment environment",
    };
  }

  return {
    key: "PAYUNI_ENV",
    status: value === expected ? "pass" : "fail",
    message: value === expected
      ? `PayUni environment 與 ${expected} deployment boundary 一致`
      : `此 deployment 必須使用 PAYUNI_ENV=${expected}`,
  };
}

/** F-003: only PayUni refunds reach a provider; production accepts nothing else. */
function productionPaymentProviderChecks(env: NodeJS.ProcessEnv): EnvCheck[] {
  // The runtime policy also covers non-Vercel production servers (review m-5);
  // the build preflight keeps to the deployment truth so controlled CI builds
  // with the demo provider still run.
  if (!isVercelProductionDeployment(env) || env.PAYMENT_PROVIDER === PRODUCTION_PAYMENT_PROVIDER) return [];
  return [{
    key: "PAYMENT_PROVIDER",
    status: "fail",
    message: "Production 只允許 PAYMENT_PROVIDER=payuni；demo 與其他 provider 只能用於本機、CI 與 Preview",
  }];
}

/**
 * F-052: the platform affiliate payout switch must be an explicit decision on
 * the production deployment. Unset or any value other than `true`／`false`
 * fails production and warns everywhere else. (The runtime parser still fails
 * closed on unknown values; this check only demands an explicit choice.)
 */
function affiliatePayoutSwitchCheck(env: NodeJS.ProcessEnv): EnvCheck {
  const key = "AFFILIATE_PAYOUTS_DISABLED";
  const value = env[key]?.trim().toLowerCase();
  if (value === "true") return { key, status: "pass", message: "平台已停用聯盟出款（不可標記已付款、不可匯出提領 CSV）" };
  if (value === "false") return { key, status: "pass", message: "平台允許聯盟出款；仍需商家出款政策與已匯出的扣繳快照" };
  const message = value
    ? "AFFILIATE_PAYOUTS_DISABLED 只接受 true 或 false；目前的值在執行時會被視為停用出款"
    : "未設定 AFFILIATE_PAYOUTS_DISABLED；執行時視為允許聯盟出款，請明確設定 true 或 false";
  return { key, status: isVercelProductionDeployment(env) ? "fail" : "warning", message };
}

/**
 * F-055 / B04-14: the deployed runtime reaches PostgreSQL through a
 * transaction pooler. Without pgbouncer=true Prisma's prepared statements
 * break, and without connection_limit each serverless instance opens a pool
 * sized for a server, which turns Serializable retries into pool timeouts.
 * Warning only; the message never echoes the URL.
 */
function databasePoolChecks(env: NodeJS.ProcessEnv): EnvCheck[] {
  if (env.VERCEL_ENV !== "preview" && env.VERCEL_ENV !== "production") return [];
  let params: URLSearchParams;
  try {
    params = new URL(env.DATABASE_URL ?? "").searchParams;
  } catch {
    return [];
  }
  const missing = [
    ...(params.get("pgbouncer") === "true" ? [] : ["pgbouncer=true"]),
    ...(/^[1-9][0-9]{0,2}$/.test(params.get("connection_limit") ?? "") ? [] : ["connection_limit"]),
  ];
  return missing.length === 0 ? [] : [{
    key: "DATABASE_URL",
    status: "warning",
    message: `Preview／Production 的 DATABASE_URL 缺少 ${missing.join("、")}；交易連線池與 Serializable 重試需要這些設定`,
  }];
}

const requiredKeys = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_APP_URL",
  "JOB_SECRET",
  "CRON_SECRET",
  "PAYMENT_PROVIDER",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
] as const;

const recommendedKeys = [
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
] as const;

const STREAM_SIGNING_MISCONFIGURATION_MESSAGES: Record<StreamSigningMisconfiguration, string> = {
  partial: "CLOUDFLARE_STREAM_SIGNING_KEY_ID 與 CLOUDFLARE_STREAM_SIGNING_KEY_PEM（或 _JWK）必須同時設定",
  both_key_formats: "CLOUDFLARE_STREAM_SIGNING_KEY_PEM 與 CLOUDFLARE_STREAM_SIGNING_KEY_JWK 只能設定其中一個",
  invalid_key_id: "CLOUDFLARE_STREAM_SIGNING_KEY_ID 格式不正確（應為 Cloudflare signing key 的 id）",
  invalid_key: "Stream signing key 無法解析成 RSA 私鑰；請貼上 Cloudflare 回傳的 pem（base64）或 PEM 文字",
  weak_key: "Stream signing key 的 RSA 長度不足 2048 bits",
  invalid_customer_code: "CLOUDFLARE_STREAM_CUSTOMER_CODE 只能是 customer-<CODE>.cloudflarestream.com 中的 <CODE>（小寫英數）",
};

/**
 * F-093: signed Stream playback. Unset keys keep today's public URLs (warning)
 * so environments can switch one at a time; a set but unusable key fails.
 * Locking new uploads is a separate flag, turned on only after the signed URLs
 * were verified on Staging.
 */
function streamSigningChecks(env: NodeJS.ProcessEnv): EnvCheck[] {
  const config = getStreamSigningConfig(env);
  const allowedOrigins = getStreamAllowedOrigins(env);
  const lockFlag = getStreamUploadLockFlag(env);
  const lockKey = "CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS";
  if (lockFlag === "invalid") {
    return [{ key: lockKey, status: "fail", message: "CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS 只能是 true 或 false（未設定＝false）" }];
  }
  if (config.status === "disabled") {
    return [lockFlag === "on"
      ? { key: lockKey, status: "fail", message: "CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS=true 需要先設定 Stream 簽章金鑰，否則新影片會無法播放" }
      : {
        key: "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
        status: "warning",
        message: "未設定 Stream 簽章金鑰；播放網址維持公開且永久有效，任何人可不經入場觀看（F-093，見 docs/operations/stream-signed-urls-plan.md）",
      }];
  }
  if (config.status === "misconfigured") {
    return [{ key: "CLOUDFLARE_STREAM_SIGNING_KEY_ID", status: "fail", message: STREAM_SIGNING_MISCONFIGURATION_MESSAGES[config.reason] }];
  }
  const originsCheck: EnvCheck = allowedOrigins.invalid.length > 0
    ? { key: "STREAM_ALLOWED_ORIGINS", status: "fail", message: "STREAM_ALLOWED_ORIGINS 含無效項目；只接受以逗號分隔的主機名（可用 *.example.com、可加 :port），不可含路徑" }
    : allowedOrigins.origins.length === 0
      ? { key: "STREAM_ALLOWED_ORIGINS", status: "warning", message: "無法從 NEXT_PUBLIC_APP_URL 推得 allowedOrigins；鎖定的影片不會限制播放網域" }
      : { key: "STREAM_ALLOWED_ORIGINS", status: "pass", message: `鎖定影片的 allowedOrigins：${allowedOrigins.origins.join(", ")}` };
  return [
    {
      key: "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
      status: "pass",
      message: "已設定 Stream 簽章金鑰（RS256）；入場後簽發短效播放 token",
    },
    originsCheck,
    lockFlag === "on"
      ? { key: lockKey, status: "pass", message: "新上傳與新 live input 錄影要求簽章" }
      : { key: lockKey, status: "warning", message: "新上傳仍是公開網址；Staging 驗證簽章播放通過後再設 CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS=true" },
  ];
}

function accountRateLimitCheck(rateLimitProvider: string): EnvCheck {
  return {
    key: "ACCOUNT_RATE_LIMIT",
    status: "pass",
    message: rateLimitProvider === "cloudflare_waf"
      ? "cloudflare_waf 只負責 IP 層限流；帳號層限流（登入、MFA、復原碼、magic link、成員邀請、密碼重設、Email 驗證信）固定使用資料庫計數"
      : "帳號層限流（登入、MFA、復原碼、magic link、成員邀請、密碼重設、Email 驗證信）固定使用資料庫計數，不受 RATE_LIMIT_PROVIDER 影響",
  };
}

export function getEnvCheckReport(env: NodeJS.ProcessEnv = process.env) {
  const parsed = ProductionEnvSchema.safeParse(env);
  const checks: EnvCheck[] = [];
  const deploymentSecurityRequired = requiresDeploymentSecurity(env);

  for (const key of requiredKeys) {
    const value = env[key];
    checks.push({
      key,
      status: secretPresent(value) ? "pass" : "fail",
      message: secretPresent(value) ? "已設定" : "缺少或仍是 placeholder",
    });
  }

  for (const key of recommendedKeys) {
    const value = env[key];
    checks.push({
      key,
      status: secretPresent(value) ? "pass" : "warning",
      message: secretPresent(value) ? "已設定" : "建議設定；未設定不阻擋部署，但會降低正式監控或 webhook 驗證完整度",
    });
  }

  const cloudflareKeys = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_STREAM_TOKEN",
    "CLOUDFLARE_STREAM_WEBHOOK_SECRET",
  ] as const;
  const configuredCloudflareKeys = cloudflareKeys.filter((key) => secretPresent(env[key]));
  const cloudflareDisabled = configuredCloudflareKeys.length === 0;
  const cloudflarePartiallyConfigured = configuredCloudflareKeys.length > 0
    && configuredCloudflareKeys.length < cloudflareKeys.length;
  for (const key of cloudflareKeys) {
    const configured = secretPresent(env[key]);
    let status: EnvCheck["status"] = "pass";
    let message = "已設定";
    if (cloudflareDisabled) {
      status = "warning";
      message = "未設定；Cloudflare Stream 功能將安全停用";
    } else if (cloudflarePartiallyConfigured) {
      status = configured ? "pass" : "fail";
      message = configured
        ? "已設定；Cloudflare Stream 三項設定必須同時存在"
        : "Cloudflare Stream 已部分啟用，三項設定必須同時存在";
    }
    checks.push({
      key,
      status,
      message,
    });
  }

  checks.push(...streamSigningChecks(env));

  for (const key of ["SENTRY_ENVIRONMENT", "NEXT_PUBLIC_SENTRY_ENVIRONMENT"] as const) {
    const value = env[key];
    const configured = secretPresent(value);
    checks.push({
      key,
      status: configured ? (isValidSentryEnvironment(value) ? "pass" : "fail") : "warning",
      message: configured
        ? (isValidSentryEnvironment(value) ? "已設定安全的監控環境標籤" : "監控環境標籤格式不安全")
        : "建議明確區分 staging 與 production 監控事件",
    });
  }

  if (env.PAYMENT_PROVIDER === "payuni") {
    checks.push(payUniEnvironmentDeploymentCheck(env, deploymentSecurityRequired));
    try {
      const selected = payUniCredentialKeys(env);
      for (const [field, key] of Object.entries(selected)) {
        const value = env[key];
        const valid = secretPresent(value) && (field === "hashKey"
          ? Buffer.byteLength(value!.trim()) === 32
          : field === "hashIv" ? Buffer.byteLength(value!.trim()) === 16 : true);
        checks.push({
          key,
          status: valid ? "pass" : "fail",
          message: valid ? "所選 PAYUNi 環境資料已設定" : `PAYMENT_PROVIDER=payuni 時必須設定有效的 ${key}`,
        });
      }
    } catch {
      // The PAYUNI_ENV check above already reports the invalid selector.
    }
  }

  if (env.PAYMENT_PROVIDER === "ecpay-like" || env.PAYMENT_PROVIDER === "platform-ecpay") {
    const value = env.ECPAY_WEBHOOK_SECRET;
    checks.push({
      key: "ECPAY_WEBHOOK_SECRET",
      status: secretPresent(value) ? "pass" : "fail",
      message: `${env.PAYMENT_PROVIDER} provider 必須設定 ECPAY_WEBHOOK_SECRET`,
    });
  }

  checks.push(...registrationModeChecks(env, deploymentSecurityRequired));
  checks.push(...turnstileChecks(env));

  checks.push(...productionPaymentProviderChecks(env));
  checks.push(affiliatePayoutSwitchCheck(env));
  checks.push(...databasePoolChecks(env));

  if (env.DATABASE_URL?.startsWith("file:")) {
    checks.push({
      key: "DATABASE_URL",
      status: "fail",
      message: "正式環境不可使用 SQLite file: URL",
    });
  }

  if (env.NEXT_PUBLIC_APP_URL?.includes("localhost") && deploymentSecurityRequired) {
    checks.push({
      key: "NEXT_PUBLIC_APP_URL",
      status: "fail",
      message: "production 不可使用 localhost app URL",
    });
  }

  if (deploymentSecurityRequired && env.NEXT_PUBLIC_APP_URL) {
    let isHttps = false;
    try {
      isHttps = new URL(env.NEXT_PUBLIC_APP_URL).protocol === "https:";
    } catch {}
    if (!isHttps) {
      checks.push({
        key: "NEXT_PUBLIC_APP_URL",
        status: "fail",
        message: "Preview／Production 的公開網址必須使用 HTTPS",
      });
    }
  }

  checks.push(dataEncryptionKeyringCheck(env));

  if (deploymentSecurityRequired) {
    checks.push(csrfSecretDeploymentCheck(env));
    checks.push(liveChatIngressSecretDeploymentCheck(env));
  }

  const rateLimitProvider = env.RATE_LIMIT_PROVIDER ?? "memory";
  if (rateLimitProvider === "memory" && deploymentSecurityRequired) {
    checks.push({
      key: "RATE_LIMIT_PROVIDER",
      status: "fail",
      message: "production 的 IP 層限流必須使用 Cloudflare WAF 或 Upstash Redis；in-memory 無法跨部署節點持久控流",
    });
  } else if (!env.RATE_LIMIT_PROVIDER) {
    checks.push({
      key: "RATE_LIMIT_PROVIDER",
      status: "warning",
      message: "未設定時預設 memory；正式部署前必須明確設定 cloudflare_waf 或 upstash_redis",
    });
  }

  // F-028 / B02-05: RATE_LIMIT_PROVIDER only selects the IP layer. A WAF counts
  // per source IP and cannot stand in for per-account limits, so those
  // (MFA, recovery codes, magic links, member invitations, password reset)
  // always count in PostgreSQL. Report that explicitly instead of letting a
  // WAF selection read as full rate-limit coverage.
  checks.push(accountRateLimitCheck(rateLimitProvider));

  if (env.RATE_LIMIT_PROVIDER === "upstash_redis") {
    for (const key of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
      const value = env[key];
      checks.push({
        key,
        status: secretPresent(value) ? "pass" : "fail",
        message: `RATE_LIMIT_PROVIDER=upstash_redis 時必須設定 ${key}`,
      });
    }
  }

  const smokeTestEmailConfigured = secretPresent(env.SMOKE_TEST_EMAIL);
  const smokeTestEmailValid = smokeTestEmailConfigured && z.string().email().safeParse(env.SMOKE_TEST_EMAIL?.trim()).success;
  checks.push({
    key: "SMOKE_TEST_EMAIL",
    status: smokeTestEmailValid ? "pass" : "warning",
    message: smokeTestEmailValid
      ? "已設定受限的測試收件人"
      : smokeTestEmailConfigured
        ? "格式不是單一有效 Email；smoke test 將安全地拒絕寄送，請在 Staging 驗證前修正"
        : "未設定；Email smoke test 將安全地拒絕寄送，需在 Staging 驗證前補齊",
  });

  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        key: issue.path.join(".") || "env",
        status: "fail" as const,
        message: issue.message,
      }));

  const allChecks = [...checks, ...schemaIssues];
  return {
    ok: allChecks.every((check) => check.status !== "fail"),
    checks: allChecks,
  };
}

export function assertProductionEnv() {
  const report = getEnvCheckReport();
  if (!report.ok) {
    const failures = report.checks.filter((check) => check.status === "fail");
    throw new Error(`Production env validation failed: ${failures.map((failure) => `${failure.key}: ${failure.message}`).join("; ")}`);
  }
  return report;
}
