import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const receiptPath = path.join(workspaceRoot, ".ai-team", "reports", "func-2026-08-07-28-stream-usage-attribution-disposable.json");
const image = "postgres:16-alpine";

function run(command, args, environment, cwd = workspaceRoot) {
  const child = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    maxBuffer: 4 * 1024 * 1024,
  });
  return { exitCode: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}

function environmentFor(tempRoot) {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    HOME: path.join(tempRoot, "home"),
    USERPROFILE: path.join(tempRoot, "home"),
    DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    CI: "true",
    CHECKPOINT_DISABLE: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
  };
}

function waitForPostgres(container, environment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (run("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], environment).exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

function psql(container, sql, environment) {
  return run("docker", ["exec", container, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", "celebratedeal_test", "-c", sql], environment);
}

function cleanup(container, tempRoot, marker, environment, receipt) {
  if (container) {
    const inspected = run("docker", ["inspect", "--format", "{{.Id}}|{{index .Config.Labels \"celebratedeal.run-id\"}}|{{index .Config.Labels \"celebratedeal.marker\"}}", container], environment);
    const [id, runId, containerMarker] = inspected.stdout.trim().split("|");
    if (inspected.exitCode !== 0 || id !== container || runId !== receipt.runId || containerMarker !== marker) {
      receipt.cleanup.container = "CLEANUP_BLOCKED";
    } else {
      const removed = run("docker", ["rm", "-f", container], environment);
      receipt.cleanup.container = removed.exitCode === 0 && run("docker", ["inspect", container], environment).exitCode !== 0 ? "PASS" : "FAIL";
    }
  } else receipt.cleanup.container = "NOT_CREATED";

  const resolved = path.resolve(tempRoot);
  const safeTemp = resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    && fs.existsSync(path.join(resolved, ".marker"))
    && fs.readFileSync(path.join(resolved, ".marker"), "utf8") === marker;
  if (!safeTemp) receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";
  else {
    fs.rmSync(resolved, { recursive: true, force: true });
    receipt.cleanup.tempRoot = fs.existsSync(resolved) ? "FAIL" : "PASS";
  }
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-wp28-${runId}`;
  const marker = `wp28-stream-usage:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-func-wp28-stream-usage-attribution/v1",
    workPackage: "FUNC-2026-08-07-28",
    runId,
    status: "BLOCKED_OR_FAILED",
    phases: {
      validate: "NOT_STARTED",
      deploy: "NOT_STARTED",
      status: "NOT_STARTED",
      validAllocation: "NOT_STARTED",
      allocationTotalsReconcile: "NOT_STARTED",
      duplicateAllocationRejected: "NOT_STARTED",
      crossVendorRecipientRejected: "NOT_STARTED",
    },
    migrationCount: migrations.length,
    failure: null,
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { sourceEnvContentsRead: false, rawOutputPersisted: false, loopbackOnly: true, noPersistentVolume: true },
  };
  const environment = environmentFor(tempRoot);
  let container = null;

  try {
    fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "docker-config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
    if (run("docker", ["image", "inspect", image], environment).exitCode !== 0) throw new Error("toolchain-missing");
    const created = run("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image,
    ], environment);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/i.test(created.stdout)) throw new Error("container-create-failed");
    container = created.stdout.trim();
    if (!waitForPostgres(container, environment)) throw new Error("database-unreachable");
    const portOutput = run("docker", ["port", container, "5432/tcp"], environment).stdout;
    const port = /127\.0\.0\.1:(\d+)\s*/m.exec(portOutput)?.[1];
    if (!port) throw new Error("loopback-port-invalid");

    const mirrorRoot = writeMirror(tempRoot, migrations);
    const databaseUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=public`;
    const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
    const prismaEnvironment = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
    for (const [phase, args] of [["validate", ["validate"]], ["deploy", ["migrate", "deploy"]], ["status", ["migrate", "status"]]]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", path.join(mirrorRoot, "prisma.config.mjs")], prismaEnvironment, mirrorRoot);
      receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) throw new Error(`prisma-${phase}-failed`);
    }

    const seed = `
      INSERT INTO "Vendor" ("id","name","slug","email","passwordHash","createdAt","updatedAt") VALUES
        ('wp28-vendor-a','WP28 Vendor A','wp28-vendor-a','wp28-a@example.invalid','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('wp28-vendor-b','WP28 Vendor B','wp28-vendor-b','wp28-b@example.invalid','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "User" ("id","email","name","passwordHash","createdAt","updatedAt") VALUES
        ('wp28-user-a','wp28-user-a@example.invalid','WP28 User A','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('wp28-user-b','wp28-user-b@example.invalid','WP28 User B','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "VendorMember" ("id","vendorId","userId","role","status","createdAt","updatedAt") VALUES
        ('wp28-vm-a','wp28-vendor-a','wp28-user-a','owner','active','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('wp28-vm-b','wp28-vendor-b','wp28-user-b','owner','active','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "SalesTeam" ("id","vendorId","name","slug","createdAt","updatedAt") VALUES
        ('wp28-team-a','wp28-vendor-a','WP28 Team A','wp28-team-a','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('wp28-team-b','wp28-vendor-b','WP28 Team B','wp28-team-b','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "TeamMembership" ("id","vendorId","teamId","vendorMemberId","status","joinedAt","createdAt","updatedAt") VALUES
        ('wp28-member-a','wp28-vendor-a','wp28-team-a','wp28-vm-a','ACTIVE','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('wp28-member-b','wp28-vendor-b','wp28-team-b','wp28-vm-b','ACTIVE','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "Live" ("id","vendorId","teamId","title","slug","scheduledAt","status","createdAt","updatedAt") VALUES
        ('wp28-live-a','wp28-vendor-a','wp28-team-a','WP28 Live A','wp28-live-a','2036-08-08T00:00:00Z','live','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "StreamUsageLedgerEntry" ("id","vendorId","liveId","teamId","eventId","monthKey","watchSeconds","source","policyVersion","attributionMode","capturedAt","createdAt") VALUES
        ('wp28-ledger-a','wp28-vendor-a','wp28-live-a','wp28-team-a','00000000-0000-4000-8000-000000000028','2036-08',45,'TEAM_FUNNEL_PAGE',2,'SPLIT','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "StreamUsageAllocationEntry" ("id","vendorId","liveId","ledgerEntryId","monthKey","recipientKey","recipientType","recipientTeamId","recipientMembershipId","allocationBps","allocatedWatchSeconds","policyVersion","attributionMode","createdAt") VALUES
        ('wp28-allocation-a','wp28-vendor-a','wp28-live-a','wp28-ledger-a','2036-08','MEMBERSHIP:wp28-team-a:wp28-member-a','MEMBERSHIP','wp28-team-a','wp28-member-a',10000,45,2,'SPLIT','2036-08-08T00:00:00Z');
    `;
    const seeded = psql(container, seed, environment);
    receipt.phases.validAllocation = seeded.exitCode === 0 ? "PASS" : "FAIL";
    if (receipt.phases.validAllocation !== "PASS") throw new Error("valid-allocation-failed");

    const totals = psql(container, `SELECT (SELECT "watchSeconds" FROM "StreamUsageLedgerEntry" WHERE "id"='wp28-ledger-a')::text || ':' || (SELECT COALESCE(SUM("allocatedWatchSeconds"),0) FROM "StreamUsageAllocationEntry" WHERE "ledgerEntryId"='wp28-ledger-a')::text;`, environment);
    receipt.phases.allocationTotalsReconcile = totals.exitCode === 0 && totals.stdout.trim() === "45:45" ? "PASS" : "FAIL";
    if (receipt.phases.allocationTotalsReconcile !== "PASS") throw new Error("allocation-total-drift");

    const duplicate = psql(container, `INSERT INTO "StreamUsageAllocationEntry" ("id","vendorId","liveId","ledgerEntryId","monthKey","recipientKey","recipientType","recipientTeamId","recipientMembershipId","allocationBps","allocatedWatchSeconds","policyVersion","attributionMode","createdAt") VALUES ('wp28-allocation-duplicate','wp28-vendor-a','wp28-live-a','wp28-ledger-a','2036-08','MEMBERSHIP:wp28-team-a:wp28-member-a','MEMBERSHIP','wp28-team-a','wp28-member-a',10000,45,2,'SPLIT','2036-08-08T00:00:00Z');`, environment);
    receipt.phases.duplicateAllocationRejected = duplicate.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.duplicateAllocationRejected !== "PASS") throw new Error("duplicate-allocation-accepted");

    const crossVendor = psql(container, `INSERT INTO "StreamUsageAllocationEntry" ("id","vendorId","liveId","ledgerEntryId","monthKey","recipientKey","recipientType","recipientTeamId","recipientMembershipId","allocationBps","allocatedWatchSeconds","policyVersion","attributionMode","createdAt") VALUES ('wp28-allocation-cross-vendor','wp28-vendor-a','wp28-live-a','wp28-ledger-a','2036-08','MEMBERSHIP:wp28-team-b:wp28-member-b','MEMBERSHIP','wp28-team-b','wp28-member-b',10000,45,2,'SPLIT','2036-08-08T00:00:00Z');`, environment);
    receipt.phases.crossVendorRecipientRejected = crossVendor.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.crossVendorRecipientRejected !== "PASS") throw new Error("cross-vendor-recipient-accepted");

    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "runner-failed";
  } finally {
    cleanup(container, tempRoot, marker, environment, receipt);
    if (receipt.status === "PASS" && (receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS")) receipt.status = "BLOCKED_OR_FAILED";
    writeReceipt(receipt);
  }

  if (receipt.status !== "PASS") process.exitCode = 1;
  else process.stdout.write(`${JSON.stringify({ workPackage: receipt.workPackage, status: receipt.status, migrationCount: receipt.migrationCount, phases: receipt.phases, cleanup: receipt.cleanup })}\n`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
