import { z } from "zod";
import { isValidSentryEnvironment } from "@/lib/sentry-environment";

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
  CSRF_SECRET: OptionalSecret,
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
});

export type EnvCheck = {
  key: keyof z.infer<typeof ProductionEnvSchema> | string;
  status: "pass" | "warning" | "fail";
  message: string;
};

function secretPresent(value: string | undefined) {
  return Boolean(value && value.trim() && !value.includes("...") && !value.includes("example"));
}

function requiresDeploymentSecurity(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV === "production"
    || env.VERCEL_ENV === "preview"
    || env.VERCEL_ENV === "production";
}

const requiredKeys = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_APP_URL",
  "JOB_SECRET",
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

export function getEnvCheckReport(env: NodeJS.ProcessEnv = process.env) {
  const parsed = ProductionEnvSchema.safeParse(env);
  const checks: EnvCheck[] = [];

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
    for (const key of ["PAYUNI_HASH_KEY", "PAYUNI_HASH_IV", "PAYUNI_MERCHANT_ID"]) {
      const value = env[key];
      checks.push({
        key,
        status: secretPresent(value) ? "pass" : "fail",
        message: `PAYMENT_PROVIDER=payuni 時必須設定 ${key}`,
      });
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

  if (env.DATABASE_URL?.startsWith("file:")) {
    checks.push({
      key: "DATABASE_URL",
      status: "fail",
      message: "正式環境不可使用 SQLite file: URL",
    });
  }

  const deploymentSecurityRequired = requiresDeploymentSecurity(env);

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
    const csrfConfigured = secretPresent(env.CSRF_SECRET);
    const csrfSecretIsDistinct = csrfConfigured
      && secretPresent(env.JOB_SECRET)
      && env.CSRF_SECRET !== env.JOB_SECRET;
    let csrfMessage = "已設定獨立 CSRF／MFA 加密密鑰";
    if (!csrfConfigured) {
      csrfMessage = "production 必須使用獨立 CSRF_SECRET，不得與 JOB_SECRET 共用";
    } else if (!csrfSecretIsDistinct) {
      csrfMessage = "CSRF_SECRET 不得與 JOB_SECRET 共用";
    }
    checks.push({
      key: "CSRF_SECRET",
      status: csrfSecretIsDistinct ? "pass" : "fail",
      message: csrfMessage,
    });
  }

  const rateLimitProvider = env.RATE_LIMIT_PROVIDER ?? "memory";
  if (rateLimitProvider === "memory" && deploymentSecurityRequired) {
    checks.push({
      key: "RATE_LIMIT_PROVIDER",
      status: "fail",
      message: "production 必須使用 Cloudflare WAF 或 Upstash Redis；in-memory 無法跨部署節點持久控流",
    });
  } else if (!env.RATE_LIMIT_PROVIDER) {
    checks.push({
      key: "RATE_LIMIT_PROVIDER",
      status: "warning",
      message: "未設定時預設 memory；正式部署前必須明確設定 cloudflare_waf 或 upstash_redis",
    });
  }

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
