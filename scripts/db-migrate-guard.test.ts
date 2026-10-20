import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MigrateTargetError, resolveDeployMigrateTarget, resolveDevMigrateTarget, validateMigrateArguments } from "./db-migrate-guard";

// Compose URLs from parts so repository secret scanning never sees a credential-shaped literal.
const scheme = "postgresql:" + "//";
const local = (database: string, host = "127.0.0.1:5433") => `${scheme}postgres:synthetic@${host}/${database}?schema=public`;
const remote = `${scheme}postgres:synthetic@db.synthetic-project.example.test:5432/postgres`;

function category(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(MigrateTargetError);
    // Only a category leaves the guard: never the URL, host or database name.
    expect((error as Error).message).not.toContain("synthetic");
    return (error as MigrateTargetError).category;
  }
  throw new Error("expected the migrate target to be rejected");
}

describe("db:migrate (prisma migrate dev) target guard (F-065)", () => {
  it("pins both URLs to an injected loopback disposable database", () => {
    expect(resolveDevMigrateTarget({ DATABASE_URL: local("celebratedeal_dev") })).toEqual({
      childEnvironment: { DATABASE_URL: local("celebratedeal_dev"), DIRECT_URL: local("celebratedeal_dev") },
      remote: false,
    });
  });

  it.each([
    ["no injected target (an env file alone is never read)", {}, "missing"],
    ["a remote DATABASE_URL", { DATABASE_URL: remote }, "non-loopback"],
    ["a remote DIRECT_URL behind a loopback DATABASE_URL", { DATABASE_URL: local("celebratedeal_dev"), DIRECT_URL: remote }, "non-loopback"],
    ["a loopback database outside the disposable allowlist", { DATABASE_URL: local("postgres") }, "unsafe-database"],
    ["an explicit remote allowance, which dev never honours", { DATABASE_URL: remote, ALLOW_REMOTE_MIGRATE_DEPLOY: "1", GITHUB_ACTIONS: "true" }, "non-loopback"],
  ])("rejects %s", (_label, environment, expected) => {
    expect(category(() => resolveDevMigrateTarget(environment))).toBe(expected);
  });
});

describe("db:migrate:deploy target guard (F-065)", () => {
  it("allows a loopback disposable target and pins DIRECT_URL against dotenv injection", () => {
    expect(resolveDeployMigrateTarget({ DATABASE_URL: local("celebratedeal_ci") })).toEqual({
      childEnvironment: { DATABASE_URL: local("celebratedeal_ci"), DIRECT_URL: local("celebratedeal_ci") },
      remote: false,
    });
  });

  it("allows a remote target only for the approved staging build workflow on Vercel", () => {
    expect(resolveDeployMigrateTarget({ DATABASE_URL: remote, DIRECT_URL: remote, ALLOW_REMOTE_MIGRATE_DEPLOY: "1",
      MIGRATE_DEPLOY_WORKFLOW: "vercel-staging-build", VERCEL: "1" }))
      .toMatchObject({ remote: true, childEnvironment: { DIRECT_URL: remote } });
  });

  it.each([
    ["no target", {}, "missing"],
    ["only a SQLite DATABASE_URL", { DATABASE_URL: "file:./dev.db" }, "missing"],
    ["an empty DIRECT_URL falling back to a remote DATABASE_URL", { DIRECT_URL: "", DATABASE_URL: remote }, "remote-not-allowed"],
    ["a remote target without the explicit allowance", { DIRECT_URL: remote, MIGRATE_DEPLOY_WORKFLOW: "vercel-staging-build", VERCEL: "1" }, "remote-not-allowed"],
    ["a remote target allowed from a developer shell", { DIRECT_URL: remote, ALLOW_REMOTE_MIGRATE_DEPLOY: "1" }, "remote-outside-workflow"],
    ["generic CI markers without an approved workflow name", { DIRECT_URL: remote, ALLOW_REMOTE_MIGRATE_DEPLOY: "1", GITHUB_ACTIONS: "true", VERCEL: "1" }, "remote-outside-workflow"],
    ["an unknown workflow name", { DIRECT_URL: remote, ALLOW_REMOTE_MIGRATE_DEPLOY: "1", MIGRATE_DEPLOY_WORKFLOW: "production", VERCEL: "1" }, "remote-outside-workflow"],
    ["a prototype key as workflow name", { DIRECT_URL: remote, ALLOW_REMOTE_MIGRATE_DEPLOY: "1", MIGRATE_DEPLOY_WORKFLOW: "constructor", VERCEL: "1" }, "remote-outside-workflow"],
    ["the staging workflow name outside Vercel", { DIRECT_URL: remote, ALLOW_REMOTE_MIGRATE_DEPLOY: "1", MIGRATE_DEPLOY_WORKFLOW: "vercel-staging-build" }, "remote-outside-workflow"],
    ["an allowance value other than 1", { DIRECT_URL: remote, ALLOW_REMOTE_MIGRATE_DEPLOY: "true", MIGRATE_DEPLOY_WORKFLOW: "vercel-staging-build", VERCEL: "1" }, "remote-not-allowed"],
  ])("rejects %s", (_label, environment, expected) => {
    expect(category(() => resolveDeployMigrateTarget(environment))).toBe(expected);
  });

  it("routes package scripts and the staging build through the guards", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    expect(scripts["db:migrate"]).toBe("node --import tsx scripts/db-migrate-dev.ts");
    expect(scripts["db:migrate:deploy"]).toBe("node --import tsx scripts/db-migrate-deploy.ts");
    const staging = JSON.parse(readFileSync("vercel.staging.json", "utf8")) as { buildCommand: string };
    // An empty STAGING_DATABASE_URL must fail the build, never fall back to DATABASE_URL.
    expect(staging.buildCommand).toContain('DIRECT_URL="${STAGING_DATABASE_URL:?');
    expect(staging.buildCommand).toContain("ALLOW_REMOTE_MIGRATE_DEPLOY=1 MIGRATE_DEPLOY_WORKFLOW=vercel-staging-build npm run db:migrate:deploy");
  });
});

describe("migrate CLI argument allowlist (PR #454 A-8)", () => {
  it.each([
    ["dev", []],
    ["dev", ["--name", "add_index"]],
    ["dev", ["--name=add_index", "--create-only"]],
    ["dev", ["-n", "x", "--skip-seed", "--skip-generate"]],
    ["deploy", []],
  ] as const)("forwards allowed %s arguments %j", (command, args) => {
    expect(validateMigrateArguments(command, args)).toEqual(args);
  });

  it.each([
    ["deploy", ["--schema", "other.prisma"]],
    ["deploy", ["--config=other.ts"]],
    ["dev", ["--schema", "other.prisma"]],
    ["dev", ["--config=other.ts"]],
    ["dev", ["--url", "x"]],
    ["dev", ["--name"]],
    ["dev", ["--name", "bad name"]],
    ["dev", ["--force"]],
  ] as const)("rejects %s arguments %j that could retarget or reset", (command, args) => {
    expect(category(() => validateMigrateArguments(command, args))).toBe("argument-not-allowed");
  });
});
