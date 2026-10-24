import { z } from "zod";
import { isValidSentryEnvironment } from "@/lib/sentry-environment";
import { payUniLiveProbeAvailable } from "@/lib/payuni-live-probe";
import { payUniStagingPlanTestScope } from "@/lib/payuni-staging-plan-test";
import { isStagingPayUniPreviewCandidate } from "@/lib/database-identity";
import { payUniCredentialKeys } from "@/lib/payuni-credentials";
import { isVercelProductionDeployment, PRODUCTION_PAYMENT_PROVIDER } from "@/lib/payment-providers/runtime-policy";
import { MINIMUM_ENCRYPTION_SECRET_BYTES } from "@/lib/sensitive-data";
import {
  LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH,
  LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH,
} from "@/lib/request-client-ip";
import { REGISTRATION_MODES } from "@/lib/registration-mode";

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

function registrationModeChecks(env: NodeJS.ProcessEnv, deploymentSecurityRequired: boolean): EnvCheck[] {
  const value = env.REGISTRATION_MODE?.trim().toLowerCase();
  if (value && !(REGISTRATION_MODES as readonly string[]).includes(value)) return []; // the schema reports it
  if (value === "open") {
    return [{
      key: "REGISTRATION_MODE",
      status: deploymentSecurityRequired ? "warning" : "pass",
      message: deploymentSecurityRequired
        ? "已開放任何人註冊商家；開放前必須完成商家 Email 驗證與 Turnstile 機器人防護"
        : "本機開放任何人註冊商家",
    }];
  }
  return [{ key: "REGISTRATION_MODE", status: "pass", message: "商家註冊僅限平台邀請（封測預設）" }];
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

function accountRateLimitCheck(rateLimitProvider: string): EnvCheck {
  return {
    key: "ACCOUNT_RATE_LIMIT",
    status: "pass",
    message: rateLimitProvider === "cloudflare_waf"
      ? "cloudflare_waf 只負責 IP 層限流；帳號層限流（登入、MFA、復原碼、magic link、成員邀請、密碼重設）固定使用資料庫計數"
      : "帳號層限流（登入、MFA、復原碼、magic link、成員邀請、密碼重設）固定使用資料庫計數，不受 RATE_LIMIT_PROVIDER 影響",
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

  checks.push(...productionPaymentProviderChecks(env));
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
