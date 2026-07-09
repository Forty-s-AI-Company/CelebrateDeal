import { z } from "zod";

const RequiredUrl = z.string().url();
const OptionalSecret = z.string().optional();

export const ProductionEnvSchema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql://"),
  DIRECT_URL: z.string().startsWith("postgresql://"),
  NEXT_PUBLIC_APP_URL: RequiredUrl,
  JOB_SECRET: z.string().min(16),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_STREAM_TOKEN: z.string().min(1),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: OptionalSecret,
  PAYMENT_PROVIDER: z.enum(["demo", "payuni", "ecpay-like", "platform-ecpay"]).default("demo"),
  PAYUNI_HASH_KEY: OptionalSecret,
  PAYUNI_HASH_IV: OptionalSecret,
  PAYUNI_MERCHANT_ID: OptionalSecret,
  PAYUNI_WEBHOOK_SECRET: OptionalSecret,
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(3),
  SENTRY_DSN: OptionalSecret,
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

export function getEnvCheckReport(env: NodeJS.ProcessEnv = process.env) {
  const parsed = ProductionEnvSchema.safeParse(env);
  const checks: EnvCheck[] = [];
  const requiredKeys = Object.keys(ProductionEnvSchema.shape);

  for (const key of requiredKeys) {
    const value = env[key];
    checks.push({
      key,
      status: secretPresent(value) ? "pass" : "fail",
      message: secretPresent(value) ? "已設定" : "缺少或仍是 placeholder",
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
