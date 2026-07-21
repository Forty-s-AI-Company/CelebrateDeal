import { describe, expect, it } from "vitest";
import { getEnvCheckReport, type EnvCheck } from "@/lib/env";

const envKey = (...parts: string[]) => parts.join("_");

function configuredEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    [envKey("DATABASE", "URL")]: "postgresql://test:test@database.test:5432/app",
    [envKey("DIRECT", "URL")]: "postgresql://test:test@database.test:5432/app",
    [envKey("NEXT", "PUBLIC", "APP", "URL")]: "https://app.test",
    [envKey("JOB", "SECRET")]: "test-job-value-12345",
    [envKey("CSRF", "SECRET")]: "test-csrf-value-12345",
    [envKey("CLOUDFLARE", "ACCOUNT", "ID")]: "test-account-id",
    [envKey("CLOUDFLARE", "STREAM", "TOKEN")]: "test-stream-value",
    [envKey("CLOUDFLARE", "STREAM", "WEBHOOK", "SECRET")]: "test-webhook-value",
    [envKey("PAYMENT", "PROVIDER")]: "demo",
    [envKey("RESEND", "API", "KEY")]: "test-resend-value",
    [envKey("EMAIL", "FROM")]: "noreply@app.test",
    [envKey("SMOKE", "TEST", "EMAIL")]: "smoke@qa.test",
    [envKey("SENTRY", "DSN")]: "https://public@sentry.test/1",
    [envKey("NEXT", "PUBLIC", "POSTHOG", "KEY")]: "test-posthog-value",
    [envKey("NEXT", "PUBLIC", "POSTHOG", "HOST")]: "https://posthog.test",
    [envKey("NEXT", "PUBLIC", "SENTRY", "DSN")]: "https://public@sentry.test/2",
    [envKey("SENTRY", "ENVIRONMENT")]: "production",
    [envKey("NEXT", "PUBLIC", "SENTRY", "ENVIRONMENT")]: "production",
    [envKey("SENTRY", "ORG")]: "test-org",
    [envKey("SENTRY", "PROJECT")]: "test-project",
    [envKey("SENTRY", "AUTH", "TOKEN")]: "test-sentry-value",
    [envKey("RATE", "LIMIT", "PROVIDER")]: "cloudflare_waf",
  };
}

function check(report: ReturnType<typeof getEnvCheckReport>, key: string, status: EnvCheck["status"]) {
  return report.checks.find((item) => item.key === key && item.status === status);
}

describe("getEnvCheckReport", () => {
  it("passes a complete production configuration", () => {
    const report = getEnvCheckReport(configuredEnv());

    expect(report.ok).toBe(true);
    expect(report.checks.every((item) => item.status === "pass")).toBe(true);
  });

  it("fails when a required value is missing", () => {
    const env = configuredEnv();
    delete env[envKey("DATABASE", "URL")];

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("DATABASE", "URL"), "fail")?.message).toBe("缺少或仍是 placeholder");
  });

  it("fails for a SQLite file URL in production", () => {
    const env = configuredEnv();
    env[envKey("DATABASE", "URL")] = "file:./test.db";

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("DATABASE", "URL"), "fail")?.message).toBe("正式環境不可使用 SQLite file: URL");
  });

  it("fails for a localhost public app URL in production", () => {
    const env = configuredEnv();
    env[envKey("NEXT", "PUBLIC", "APP", "URL")] = "http://localhost:3000";

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("NEXT", "PUBLIC", "APP", "URL"), "fail")?.message).toBe(
      "production 不可使用 localhost app URL",
    );
  });

  it("fails for a non-HTTPS deployment URL even when it is not localhost", () => {
    const env = configuredEnv();
    env[envKey("NEXT", "PUBLIC", "APP", "URL")] = "http://staging.app.test";

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("NEXT", "PUBLIC", "APP", "URL"), "fail")?.message).toBe(
      "Preview／Production 的公開網址必須使用 HTTPS",
    );
  });

  it.each([
    ["an invalid sender", "not-an-email"],
    ["a header-injection attempt", "Sender <sender@app.test>\r\nBcc: attacker@app.test"],
  ])("fails when EMAIL_FROM contains %s", (_label, sender) => {
    const env = configuredEnv();
    env[envKey("EMAIL", "FROM")] = sender;

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("EMAIL", "FROM"), "fail")?.message).toContain(
      "EMAIL_FROM 必須是單一有效寄件地址",
    );
  });

  it("accepts a display name with one valid sender address", () => {
    const env = configuredEnv();
    env[envKey("EMAIL", "FROM")] = "CelebrateDeal <noreply@app.test>";

    expect(getEnvCheckReport(env).ok).toBe(true);
  });

  it("fails closed for an unsafe Sentry environment tag", () => {
    const env = configuredEnv();
    env[envKey("SENTRY", "ENVIRONMENT")] = "staging\nsecret=value";

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("SENTRY", "ENVIRONMENT"), "fail")).toBeTruthy();
  });

  it.each([
    [envKey("PAYUNI", "HASH", "KEY")],
    [envKey("PAYUNI", "HASH", "IV")],
    [envKey("PAYUNI", "MERCHANT", "ID")],
  ])("requires %s when PayUni is selected", (missingKey) => {
    const env = configuredEnv();
    env[envKey("PAYMENT", "PROVIDER")] = "payuni";
    env[envKey("PAYUNI", "HASH", "KEY")] = "test-payuni-key-value";
    env[envKey("PAYUNI", "HASH", "IV")] = "test-payuni-iv-value";
    env[envKey("PAYUNI", "MERCHANT", "ID")] = "test-merchant-id";
    delete env[missingKey];

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, missingKey, "fail")?.message).toBe(`PAYMENT_PROVIDER=payuni 時必須設定 ${missingKey}`);
  });

  it("does not require a non-standard PayUni webhook secret", () => {
    const env = configuredEnv();
    env[envKey("PAYMENT", "PROVIDER")] = "payuni";
    env[envKey("PAYUNI", "HASH", "KEY")] = "test-payuni-key-value";
    env[envKey("PAYUNI", "HASH", "IV")] = "test-payuni-iv-value";
    env[envKey("PAYUNI", "MERCHANT", "ID")] = "test-merchant-id";

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(true);
    expect(report.checks.some((item) => item.key === envKey("PAYUNI", "WEBHOOK", "SECRET"))).toBe(false);
  });

  it.each(["ecpay-like", "platform-ecpay"])("requires the ECPay webhook verification value for %s", (provider) => {
    const env = configuredEnv();
    env[envKey("PAYMENT", "PROVIDER")] = provider;

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("ECPAY", "WEBHOOK", "SECRET"), "fail")?.message).toBe(
      `${provider} provider 必須設定 ECPAY_WEBHOOK_SECRET`,
    );
  });

  it.each([
    [envKey("UPSTASH", "REDIS", "REST", "URL")],
    [envKey("UPSTASH", "REDIS", "REST", "TOKEN")],
  ])("requires %s when Upstash Redis is selected", (missingKey) => {
    const env = configuredEnv();
    env[envKey("RATE", "LIMIT", "PROVIDER")] = "upstash_redis";
    env[envKey("UPSTASH", "REDIS", "REST", "URL")] = "https://upstash.test";
    env[envKey("UPSTASH", "REDIS", "REST", "TOKEN")] = "test-upstash-value";
    delete env[missingKey];

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, missingKey, "fail")?.message).toBe(`RATE_LIMIT_PROVIDER=upstash_redis 時必須設定 ${missingKey}`);
  });

  it("only warns when recommended monitoring values are missing", () => {
    const env = configuredEnv();
    const monitoringKeys = [
      envKey("NEXT", "PUBLIC", "SENTRY", "DSN"),
      envKey("SENTRY", "ORG"),
      envKey("SENTRY", "PROJECT"),
      envKey("SENTRY", "AUTH", "TOKEN"),
    ];
    for (const key of monitoringKeys) delete env[key];

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(true);
    for (const key of monitoringKeys) {
      expect(check(report, key, "warning")?.message).toBe("建議設定；未設定不阻擋部署，但會降低正式監控或 webhook 驗證完整度");
    }
  });

  it("fails when production uses non-durable memory rate limiting", () => {
    const env = configuredEnv();
    env[envKey("RATE", "LIMIT", "PROVIDER")] = "memory";

    const report = getEnvCheckReport(env);
    const failure = check(report, envKey("RATE", "LIMIT", "PROVIDER"), "fail");

    expect(report.ok).toBe(false);
    expect(failure?.message).toContain("in-memory 無法跨部署節點持久控流");
  });

  it("fails when production relies on JOB_SECRET instead of a dedicated CSRF secret", () => {
    const env = configuredEnv();
    delete env[envKey("CSRF", "SECRET")];

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("CSRF", "SECRET"), "fail")?.message).toContain(
      "不得與 JOB_SECRET 共用",
    );
  });

  it("applies production security gates to Vercel Preview builds", () => {
    const env = configuredEnv();
    env[envKey("NODE", "ENV")] = "development";
    env[envKey("VERCEL", "ENV")] = "preview";
    env[envKey("RATE", "LIMIT", "PROVIDER")] = "memory";
    delete env[envKey("CSRF", "SECRET")];

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(false);
    expect(check(report, envKey("CSRF", "SECRET"), "fail")).toBeDefined();
    expect(check(report, envKey("RATE", "LIMIT", "PROVIDER"), "fail")).toBeDefined();
  });

  it("keeps local development usable while warning about an implicit memory limiter", () => {
    const env: NodeJS.ProcessEnv = { ...configuredEnv(), NODE_ENV: "development" };
    delete env[envKey("RATE", "LIMIT", "PROVIDER")];

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(true);
    expect(check(report, envKey("RATE", "LIMIT", "PROVIDER"), "warning")?.message).toContain(
      "正式部署前必須明確設定",
    );
  });

  it("warns that email smoke validation is unavailable without the restricted recipient", () => {
    const env = configuredEnv();
    delete env[envKey("SMOKE", "TEST", "EMAIL")];

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(true);
    expect(check(report, envKey("SMOKE", "TEST", "EMAIL"), "warning")?.message).toContain(
      "Email smoke test 將安全地拒絕寄送",
    );
  });

  it("warns instead of blocking deployment when the optional smoke recipient has an invalid format", () => {
    const env = configuredEnv();
    env[envKey("SMOKE", "TEST", "EMAIL")] = "not-a-single-email";

    const report = getEnvCheckReport(env);

    expect(report.ok).toBe(true);
    expect(check(report, envKey("SMOKE", "TEST", "EMAIL"), "warning")?.message).toContain(
      "格式不是單一有效 Email",
    );
  });
});
