import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { PREVIEW_HOST, SOURCE_SHA } from "./staging-migration-compat-preflight.mjs";
import { canonicalTableCounts, IMAGE, replayArgs, runIsolatedReplay, validateBindings } from "./staging-migration-isolated-replay.mjs";

const names = (await readdir("prisma/migrations", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{12,14}_[a-z0-9_]+$/u.test(entry.name))
  .map((entry) => entry.name).sort();
const sqlByName = new Map(await Promise.all(names.slice(-21).map(async (name) => [name, await readFile(`prisma/migrations/${name}/migration.sql`)])));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventory = new Map(names.map((name) => [name, { exact: sqlByName.has(name) ? digest(sqlByName.get(name)) : "a".repeat(64), alternatives: new Set() }]));
const history = [
  ...names.slice(0, 58).map((name) => `${name}|${"a".repeat(64)}|true|false`),
  `${names[0]}|${"a".repeat(64)}|false|true`,
].join("\n");
const binding = {
  CELEBRATEDEAL_SOURCE_SHA: SOURCE_SHA,
  CELEBRATEDEAL_DEPLOYMENT_HOST: PREVIEW_HOST,
  GITHUB_TOKEN: "synthetic-token",
  RUNNER_TEMP: "/tmp/synthetic",
  STAGING_DATABASE_URL: ["postgresql:", "", "postgres:synthetic-password@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres"].join("/"),
  NEXT_PUBLIC_SUPABASE_URL: "https://ocbugvgojrunvenozsbx.supabase.co",
};

test("table count snapshot ignores PostgreSQL collation order without dropping any table", () => {
  const names = ["Vendor", "auditLog"];
  assert.equal(canonicalTableCounts("Vendor|2\nauditLog|0\n", names), canonicalTableCounts("auditLog|0\nVendor|2\n", names));
  assert.throws(() => canonicalTableCounts("Vendor|2\n", names), /SNAPSHOT_COUNTS_INVALID/u);
  assert.throws(() => canonicalTableCounts("Vendor|2\nVendor|2\n", names), /SNAPSHOT_COUNTS_INVALID/u);
  assert.throws(() => canonicalTableCounts("Vendor|2\nunknown|0\n", names), /SNAPSHOT_COUNTS_INVALID/u);
  assert.notEqual(canonicalTableCounts("Vendor|2\nauditLog|0\n", names), canonicalTableCounts("Vendor|3\nauditLog|0\n", names));
});

test("invalid binding and container ID fail before any database action", async () => {
  assert.equal(IMAGE, "postgres:17-alpine@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3");
  const workflow = await readFile(".github/workflows/staging-migration-compat-preflight.yml", "utf8");
  assert.equal(workflow.includes(`docker pull ${IMAGE}`), true);
  assert.equal(validateBindings({ ...binding, STAGING_DATABASE_URL: "postgresql://other.invalid/postgres" }), false);
  assert.throws(() => replayArgs("wrong"), /ISOLATED_CONTAINER_INVALID/u);
  assert.equal((await runIsolatedReplay({ ...binding, CELEBRATEDEAL_DEPLOYMENT_HOST: "wrong.vercel.app" })).stage, "INVALID_BINDING");
});

test("synthetic source is restored in network-none tmpfs and all 21 migrations replay", async () => {
  const calls = [];
  const id = "f".repeat(64);
  const fakeCommand = (name, args, options = {}) => {
    calls.push({ name, args, options });
    const text = args.join(" ");
    const sql = String(args.at(-1));
    if (text.includes(" pg_dump ")) return { code: 0, stdout: Buffer.from("synthetic-custom-format-dump"), stderr: "" };
    if (args.includes("-d") && args.includes("--network")) return { code: 0, stdout: `${id}\n`, stderr: "" };
    if (text.includes("pg_restore --list")) return { code: 0, stdout: "1; 2615 2200 SCHEMA - public postgres\n2; 1259 1 TABLE public Vendor postgres\n", stderr: "" };
    if (text.includes("docker inspect")) throw new Error("unexpected command shape");
    if (args[0] === "inspect") return { code: 0, stdout: "synthetic-run-id", stderr: "" };
    if (text.includes("current_setting('transaction_read_only')")) return { code: 0, stdout: "true|true|true\n", stderr: "" };
    if (text.includes("SELECT migration_name,checksum")) return { code: 0, stdout: `${history}\n`, stderr: "" };
    if (text.includes("SELECT extension.extname")) return { code: 0, stdout: "pg_trgm|public\npgcrypto|public\n", stderr: "" };
    if (sql.includes("to_regtype(format")) return { code: 0, stdout: "true\n", stderr: "" };
    if (sql.includes("information_schema.tables") && sql.includes("information_schema.columns")) return { code: 0, stdout: "58|2|2\n", stderr: "" };
    if (sql.includes("SELECT table_name FROM information_schema.tables")) return { code: 0, stdout: args[0] === "run" ? "Vendor\nauditLog\n" : "auditLog\nVendor\n", stderr: "" };
    if (sql.includes("SELECT 'Vendor'::text AS table_name") || sql.includes("SELECT 'auditLog'::text AS table_name")) {
      return { code: 0, stdout: args[0] === "run" ? "Vendor|2\nauditLog|0\n" : "auditLog|0\nVendor|2\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const dependencies = {
    verifyDeploymentImpl: async () => ({ host: PREVIEW_HOST, deploymentMatched: true, sourceMatched: true, ready: true }),
    sourceInventoryImpl: () => inventory,
    readPendingSqlImpl: async () => sqlByName,
    command: (name, args, options) => {
      if (args[0] === "run" && args.includes("-d")) {
        const marker = args[args.indexOf("--label") + 1];
        fakeCommand.runId = marker.split("=").at(-1);
      }
      if (args[0] === "inspect") return { code: 0, stdout: fakeCommand.runId, stderr: "" };
      return fakeCommand(name, args, options);
    },
  };
  const receipt = await runIsolatedReplay(binding, dependencies);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.replayedMigrationCount, 21);
  assert.equal(receipt.sourceAggregateMatched, true);
  assert.equal(receipt.postReplaySchemaVerified, true);
  assert.equal(receipt.postReplayHistoryUnchanged, true);
  assert.equal(receipt.prismaMigrateDeployRun, false);
  assert.equal(receipt.rawDumpPersisted, false);
  assert.equal(JSON.stringify(receipt).includes("synthetic-password"), false);
  const isolated = calls.find(({ args }) => args[0] === "run" && args.includes("-d"));
  assert.equal(isolated.args[isolated.args.indexOf("--network") + 1], "none");
  assert.equal(isolated.args.includes("--tmpfs"), true);
  assert.equal(calls.some(({ args }) => args.includes("pg_isready")), false);
  assert.equal(calls.some(({ args }) => args.includes("psql") && args.includes("SELECT 1;")), true);
  assert.equal(calls.filter(({ args }) => args.includes("psql") && args.includes("--single-transaction")).length, 21);
  assert.equal(calls.at(-1).args[0], "rm");
  const failed = await runIsolatedReplay(binding, {
    ...dependencies,
    command: (name, args, options) => args.includes("psql") && args.includes("--single-transaction")
      ? { code: 1, stdout: "", stderr: "private database details" }
      : dependencies.command(name, args, options),
  });
  assert.equal(failed.result, "BLOCKED");
  assert.equal(failed.stage, "ISOLATED_MIGRATION_REPLAY_FAILED");
  assert.equal(failed.replayedMigrationCount, 0);
  assert.equal(JSON.stringify(failed).includes("private database details"), false);
  assert.equal(calls.at(-1).args[0], "rm");
});
