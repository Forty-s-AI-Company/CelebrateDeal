import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const receiptPath = path.join(workspaceRoot, ".ai-team", "reports", "func-2026-08-07-29-partner-live-share-disposable.json");
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

const seedSql = `
  INSERT INTO "Vendor" ("id","name","slug","email","passwordHash","createdAt","updatedAt") VALUES
    ('wp29-vendor-a','WP29 Vendor A','wp29-vendor-a','wp29-a@example.invalid','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
    ('wp29-vendor-b','WP29 Vendor B','wp29-vendor-b','wp29-b@example.invalid','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
  INSERT INTO "User" ("id","email","name","passwordHash","createdAt","updatedAt") VALUES
    ('wp29-user-a','wp29-user-a@example.invalid','WP29 User A','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
    ('wp29-user-b','wp29-user-b@example.invalid','WP29 User B','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
  INSERT INTO "VendorMember" ("id","vendorId","userId","role","status","createdAt","updatedAt") VALUES
    ('wp29-vm-a','wp29-vendor-a','wp29-user-a','owner','active','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
    ('wp29-vm-b','wp29-vendor-b','wp29-user-b','owner','active','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
  INSERT INTO "SalesTeam" ("id","vendorId","name","slug","createdAt","updatedAt") VALUES
    ('wp29-team-a','wp29-vendor-a','WP29 Team A','wp29-team-a','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
    ('wp29-team-b','wp29-vendor-b','WP29 Team B','wp29-team-b','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
  INSERT INTO "TeamMembership" ("id","vendorId","teamId","vendorMemberId","status","joinedAt","createdAt","updatedAt") VALUES
    ('wp29-member-a','wp29-vendor-a','wp29-team-a','wp29-vm-a','ACTIVE','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
    ('wp29-member-b','wp29-vendor-b','wp29-team-b','wp29-vm-b','ACTIVE','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
  INSERT INTO "Live" ("id","vendorId","teamId","title","slug","scheduledAt","status","createdAt","updatedAt") VALUES
    ('wp29-live-a','wp29-vendor-a','wp29-team-a','WP29 Live A','wp29-live-a','2036-08-08T00:00:00Z','live','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
    ('wp29-live-b','wp29-vendor-b','wp29-team-b','WP29 Live B','wp29-live-b','2036-08-08T00:00:00Z','live','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
  INSERT INTO "TeamFunnelTemplate" ("id","vendorId","teamId","name","status","createdAt","updatedAt") VALUES
    ('wp29-template-a','wp29-vendor-a','wp29-team-a','WP29 Template','ACTIVE','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
  INSERT INTO "TeamFunnelTemplateVersion" ("id","vendorId","teamId","templateId","version","contentOwnerMembershipId","createdByMemberId","headline","ctaLabel","createdAt") VALUES
    ('wp29-version-a','wp29-vendor-a','wp29-team-a','wp29-template-a',1,'wp29-member-a','wp29-vm-a','WP29 headline','Join','2036-08-08T00:00:00Z');
  INSERT INTO "PartnerFunnelPage" ("id","vendorId","teamId","templateVersionId","promoterMembershipId","contentOwnerMembershipId","liveId","slug","headline","ctaLabel","createdAt","updatedAt") VALUES
    ('wp29-page-a','wp29-vendor-a','wp29-team-a','wp29-version-a','wp29-member-a','wp29-member-a','wp29-live-a','wp29-page-a','WP29 page','Join','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
  INSERT INTO "PartnerLiveShare" ("id","vendorId","teamId","liveId","sourcePageId","promoterMembershipId","tokenHash","expiresAt","isEnabled","createdAt","updatedAt") VALUES
    ('wp29-share-a','wp29-vendor-a','wp29-team-a','wp29-live-a','wp29-page-a','wp29-member-a','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL,true,'2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
`;

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-wp29-${runId}`;
  const marker = `wp29-partner-live-share:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-func-wp29-partner-live-share/v1",
    workPackage: "FUNC-2026-08-07-29",
    runId,
    status: "BLOCKED_OR_FAILED",
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", validBinding: "NOT_STARTED", duplicateTargetRejected: "NOT_STARTED", crossTenantLiveRejected: "NOT_STARTED", crossTenantPromoterRejected: "NOT_STARTED" },
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
    const created = run("docker", ["run", "-d", "--pull=never", "--name", name, "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`, "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test", "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image], environment);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/i.test(created.stdout)) throw new Error("container-create-failed");
    container = created.stdout.trim();
    if (!waitForPostgres(container, environment)) throw new Error("database-unreachable");
    const port = /127\.0\.0\.1:(\d+)\s*/m.exec(run("docker", ["port", container, "5432/tcp"], environment).stdout)?.[1];
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

    const seeded = psql(container, seedSql, environment);
    receipt.phases.validBinding = seeded.exitCode === 0 ? "PASS" : "FAIL";
    if (seeded.exitCode !== 0) throw new Error("valid-binding-failed");

    const duplicate = psql(container, `INSERT INTO "PartnerLiveShare" ("id","vendorId","teamId","liveId","sourcePageId","promoterMembershipId","tokenHash","isEnabled","createdAt","updatedAt") VALUES ('wp29-share-duplicate','wp29-vendor-a','wp29-team-a','wp29-live-a','wp29-page-a','wp29-member-a','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',true,'2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');`, environment);
    receipt.phases.duplicateTargetRejected = duplicate.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.duplicateTargetRejected !== "PASS") throw new Error("duplicate-target-accepted");

    const crossLive = psql(container, `INSERT INTO "PartnerLiveShare" ("id","vendorId","teamId","liveId","sourcePageId","promoterMembershipId","tokenHash","isEnabled","createdAt","updatedAt") VALUES ('wp29-share-cross-live','wp29-vendor-a','wp29-team-a','wp29-live-b','wp29-page-a','wp29-member-a','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',true,'2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');`, environment);
    receipt.phases.crossTenantLiveRejected = crossLive.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.crossTenantLiveRejected !== "PASS") throw new Error("cross-tenant-live-accepted");

    const crossPromoter = psql(container, `INSERT INTO "PartnerLiveShare" ("id","vendorId","teamId","liveId","sourcePageId","promoterMembershipId","tokenHash","isEnabled","createdAt","updatedAt") VALUES ('wp29-share-cross-promoter','wp29-vendor-a','wp29-team-a','wp29-live-a','wp29-page-a','wp29-member-b','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',true,'2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');`, environment);
    receipt.phases.crossTenantPromoterRejected = crossPromoter.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.crossTenantPromoterRejected !== "PASS") throw new Error("cross-tenant-promoter-accepted");

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
