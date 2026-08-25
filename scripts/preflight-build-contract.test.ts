import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production build preflight contract", () => {
  it("forces production environment validation before Prisma generation or Next build", () => {
    const root = process.cwd();
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const preflightSource = fs.readFileSync(path.join(root, "scripts", "preflight.ts"), "utf8");
    const ciWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    const controlledConfig = JSON.parse(fs.readFileSync(path.join(root, "config", "build-env.controlled.json"), "utf8")) as {
      environment?: Record<string, string>;
    };

    expect(packageJson.scripts?.build).toBe(
      "node --import tsx scripts/preflight.ts --production && prisma generate && next build",
    );
    expect(preflightSource).toContain('process.argv.includes("--production")');
    expect(preflightSource).toContain('NODE_ENV: "production"');
    expect(controlledConfig.environment).toHaveProperty("CRON_SECRET");
    expect(controlledConfig.environment).toHaveProperty("LIVE_CHAT_INGRESS_SECRET");
    expect(ciWorkflow).toContain("name: Controlled production preflight and build");
    expect(ciWorkflow).toContain("node scripts/build/controlled-production-build.mjs");

    const concurrencySchemaCreates = ciWorkflow
      .split(/\r?\n/)
      .filter((line) => line.includes("CREATE SCHEMA wp17_ci") || line.includes("CREATE SCHEMA wp18_ci"));
    expect(ciWorkflow).toContain('base_url="${DATABASE_URL%\\?schema=public}"');
    expect(concurrencySchemaCreates).toHaveLength(2);
    expect(concurrencySchemaCreates.every((line) => line.includes('psql "$base_url"'))).toBe(true);
  });

  it("keeps the production-mode Playwright server self-contained with synthetic runtime keys", () => {
    const root = process.cwd();
    const playwrightConfig = fs.readFileSync(path.join(root, "playwright.config.ts"), "utf8");

    expect(playwrightConfig).toContain("const localE2eCronSecret");
    expect(playwrightConfig).toContain("const localE2eLiveChatIngressSecret");
    expect(playwrightConfig).toContain("CRON_SECRET: localE2eCronSecret");
    expect(playwrightConfig).toContain("LIVE_CHAT_INGRESS_SECRET: localE2eLiveChatIngressSecret");
  });
});
