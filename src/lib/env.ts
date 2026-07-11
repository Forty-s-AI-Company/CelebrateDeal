import { z } from "zod";

const RequiredUrl = z.string().url();
const OptionalUrl = z.string().url().optional().or(z.literal(""));
const OptionalSecret = z.string().optional();

export const ProductionEnvSchema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql://"),
  DIRECT_URL: z.string().startsWith("postgresql://"),
  NEXT_PUBLIC_APP_URL: RequiredUrl,
  JOB_SECRET: z.string().min(16),
  CSRF_SECRET: OptionalSecret,
  ATTRIBUTION_SECRET: OptionalSecret,
  RATE_LIMIT_PROVIDER: z.enum(["memory", "cloudflare_waf", "upstash_redis"]).default("memory"),
  UPSTASH_REDIS_REST_URL: OptionalSecret,
  UPSTASH_REDIS_REST_TOKEN: OptionalSecret,
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_STREAM_TOKEN: z.string().min(1),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().min(1),
  PAYMENT_PROVIDER: z.enum(["demo", "payuni", "ecpay-like", "platform-ecpay"]),
  PAYUNI_HASH_KEY: OptionalSecret,
  PAYUNI_HASH_IV: OptionalSecret,
  PAYUNI_MERCHANT_ID: OptionalSecret,
  PAYUNI_WEBHOOK_SECRET: OptionalSecret,
  PAYUNI_ENV: z.enum(["sandbox", "production"]).optional(),
  PAYUNI_API_BASE_URL: OptionalUrl,
  ECPAY_WEBHOOK_SECRET: OptionalSecret,
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(3),
  NOTIFICATION_DELIVERY_MODE: z.enum(["fixture", "resend"]).default("resend"),
  SENTRY_DSN: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: OptionalSecret,
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

const requiredKeys = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_APP_URL",
  "JOB_SECRET",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_STREAM_TOKEN",
  "CLOUDFLARE_STREAM_WEBHOOK_SECRET",
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

  checks.push({
    key: "ATTRIBUTION_SECRET",
    status: secretPresent(env.ATTRIBUTION_SECRET) ? "pass" : env.NODE_ENV === "production" ? "fail" : "warning",
    message: secretPresent(env.ATTRIBUTION_SECRET)
      ? "已設定"
      : env.NODE_ENV === "production"
        ? "production 必須設定獨立 ATTRIBUTION_SECRET"
        : "本機可暫用 CSRF_SECRET/JOB_SECRET fallback；staging 與 production 必須獨立設定",
  });

  if (env.PAYMENT_PROVIDER === "payuni") {
    for (const key of ["PAYUNI_HASH_KEY", "PAYUNI_HASH_IV", "PAYUNI_MERCHANT_ID", "PAYUNI_WEBHOOK_SECRET"]) {
      const value = env[key];
      checks.push({
        key,
        status: secretPresent(value) ? "pass" : "fail",
        message: `PAYMENT_PROVIDER=payuni 時必須設定 ${key}`,
      });
    }
  }

  if (env.NODE_ENV === "production" && env.PAYMENT_PROVIDER === "demo") {
    checks.push({
      key: "PAYMENT_PROVIDER",
      status: "fail",
      message: "production 禁止使用 demo payment provider",
    });
  }

  if (env.PAYMENT_PROVIDER === "ecpay-like" || env.PAYMENT_PROVIDER === "platform-ecpay") {
    const value = env.ECPAY_WEBHOOK_SECRET;
    checks.push({
      key: "ECPAY_WEBHOOK_SECRET",
      status: secretPresent(value) ? "pass" : "fail",
      message: `${env.PAYMENT_PROVIDER} provider 必須設定 ECPAY_WEBHOOK_SECRET`,
    });
  }

  if (env.NODE_ENV === "production" && env.NOTIFICATION_DELIVERY_MODE !== "resend") {
    checks.push({
      key: "NOTIFICATION_DELIVERY_MODE",
      status: "fail",
      message: "production 必須使用 resend notification delivery mode",
    });
  }

  if (env.DATABASE_URL?.startsWith("file:")) {
    checks.push({
      key: "DATABASE_URL",
      status: "fail",
      message: "正式環境不可使用 SQLite file: URL",
    });
  }

  if (env.NEXT_PUBLIC_APP_URL?.includes("localhost") && env.NODE_ENV === "production") {
    checks.push({
      key: "NEXT_PUBLIC_APP_URL",
      status: "fail",
      message: "production 不可使用 localhost app URL",
    });
  }

  if (!env.RATE_LIMIT_PROVIDER) {
    checks.push({
      key: "RATE_LIMIT_PROVIDER",
      status: "warning",
      message: "未設定時預設 memory；production 建議明確設定 cloudflare_waf 或 upstash_redis",
    });
  }

  if ((env.RATE_LIMIT_PROVIDER ?? "memory") === "memory" && env.NODE_ENV === "production") {
    checks.push({
      key: "RATE_LIMIT_PROVIDER",
      status: "fail",
      message: "production 必須使用 Upstash Redis；in-memory 無法跨部署節點持久控流",
    });
  }

  if (env.RATE_LIMIT_PROVIDER === "cloudflare_waf" && env.NODE_ENV === "production") {
    checks.push({
      key: "RATE_LIMIT_PROVIDER",
      status: "fail",
      message: "MFA 與邀請 token 需要應用層全域 key，僅使用 Cloudflare WAF 會 fail closed；請改用 upstash_redis，WAF 可另外保留於邊緣層",
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
