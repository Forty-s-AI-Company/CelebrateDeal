import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const receiptPath = path.join(workspaceRoot, ".ai-team", "reports", "func-2026-08-07-27-live-resource-tenant-disposable.json");
const dockerImage = "postgres:16-alpine";

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
    const ready = run("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], environment);
    if (ready.exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

function psql(container, sql, environment, database = "celebratedeal_test") {
  return run("docker", [
    "exec", container, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q",
    "-d", database, "-c", sql,
  ], environment);
}

function inspectMarker(container, environment) {
  const result = run("docker", [
    "inspect", "--format",
    "{{.Id}}|{{index .Config.Labels \"celebratedeal.run-id\"}}|{{index .Config.Labels \"celebratedeal.marker\"}}",
    container,
  ], environment);
  if (result.exitCode !== 0) return null;
  const fields = result.stdout.replace(/\r?\n$/, "").split("|");
  return fields.length === 3 ? fields : null;
}

function cleanup(container, tempRoot, marker, environment, receipt) {
  if (container) {
    const inspected = inspectMarker(container.id, environment);
    const markerOkay = inspected?.[0] === container.id
      && inspected[1] === container.runId
      && inspected[2] === marker;
    if (!markerOkay) {
      receipt.cleanup.container = "CLEANUP_BLOCKED";
    } else {
      const removed = run("docker", ["rm", "-f", container.id], environment);
      const verified = run("docker", ["inspect", container.id], environment);
      receipt.cleanup.container = removed.exitCode === 0 && verified.exitCode !== 0 ? "PASS" : "FAIL";
    }
  } else {
    receipt.cleanup.container = "NOT_CREATED";
  }

  const resolved = path.resolve(tempRoot);
  const tempBase = path.resolve(os.tmpdir());
  const markerPath = path.join(resolved, ".marker");
  const safeTemp = resolved.startsWith(`${tempBase}${path.sep}`)
    && fs.existsSync(markerPath)
    && fs.readFileSync(markerPath, "utf8") === marker;
  if (!safeTemp) {
    receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";
  } else {
    fs.rmSync(resolved, { recursive: true, force: true });
    receipt.cleanup.tempRoot = fs.existsSync(resolved) ? "FAIL" : "PASS";
  }
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export async function main() {
  const id = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-wp27-${id}`;
  const marker = `wp27-live-resource:${id}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-func-wp27-live-resource-tenant/v1",
    workPackage: "FUNC-2026-08-07-27",
    status: "BLOCKED_OR_FAILED",
    phases: {
      validate: "NOT_STARTED",
      deploy: "NOT_STARTED",
      status: "NOT_STARTED",
      validBinding: "NOT_STARTED",
      crossVendorVideoRejected: "NOT_STARTED",
      crossVendorFormRejected: "NOT_STARTED",
      deletePreservesSetNull: "NOT_STARTED",
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
    if (run("docker", ["image", "inspect", dockerImage], environment).exitCode !== 0) throw new Error("toolchain-missing");

    const created = run("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${id}`, "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", dockerImage,
    ], environment);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/i.test(created.stdout)) throw new Error("container-create-failed");
    container = { id: created.stdout.trim(), runId: id };
    if (!waitForPostgres(container.id, environment)) throw new Error("database-unreachable");

    const portResult = run("docker", ["port", container.id, "5432/tcp"], environment);
    const port = /127\.0\.0\.1:(\d+)\s*/m.exec(portResult.stdout)?.[1];
    if (!port) throw new Error("loopback-port-invalid");
    const mirrorRoot = writeMirror(tempRoot, migrations);
    const databaseUrl = ["postgres", "ql://"].join("")
      + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=public`;
    const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
    const prismaEnvironment = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
    for (const [key, args] of [["validate", ["validate"]], ["deploy", ["migrate", "deploy"]], ["status", ["migrate", "status"]]]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", path.join(mirrorRoot, "prisma.config.mjs")], prismaEnvironment, mirrorRoot);
      receipt.phases[key] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) throw new Error(`prisma-${key}-failed`);
    }

    const ids = {
      vendorA: "wp27-vendor-a", vendorB: "wp27-vendor-b",
      videoA: "wp27-video-a", videoB: "wp27-video-b",
      formA: "wp27-form-a", formB: "wp27-form-b",
      liveA: "wp27-live-a", liveB: "wp27-live-b",
    };
    const seedSql = `
      INSERT INTO "Vendor" ("id","name","slug","email","passwordHash","createdAt","updatedAt") VALUES
        ('${ids.vendorA}','WP27 Vendor A','wp27-vendor-a','wp27-a@example.invalid','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('${ids.vendorB}','WP27 Vendor B','wp27-vendor-b','wp27-b@example.invalid','synthetic-hash','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "Video" ("id","vendorId","title","videoUrl","createdAt","updatedAt") VALUES
        ('${ids.videoA}','${ids.vendorA}','WP27 Video A','https://video.example.invalid/a','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('${ids.videoB}','${ids.vendorB}','WP27 Video B','https://video.example.invalid/b','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "RegistrationForm" ("id","vendorId","name","slug","headline","fields","createdAt","updatedAt") VALUES
        ('${ids.formA}','${ids.vendorA}','WP27 Form A','wp27-form-a','WP27 Form A','{"name":"text","email":"email"}'::jsonb,'2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('${ids.formB}','${ids.vendorB}','WP27 Form B','wp27-form-b','WP27 Form B','{"name":"text","email":"email"}'::jsonb,'2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      INSERT INTO "Live" ("id","vendorId","videoId","formId","title","slug","scheduledAt","status","createdAt","updatedAt") VALUES
        ('${ids.liveA}','${ids.vendorA}','${ids.videoA}','${ids.formA}','WP27 Live A','wp27-live-a','2036-08-08T00:00:00Z','live','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z'),
        ('${ids.liveB}','${ids.vendorB}','${ids.videoB}','${ids.formB}','WP27 Live B','wp27-live-b','2036-08-08T00:00:00Z','live','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');
      SELECT COUNT(*) FROM "Live" WHERE "id" = '${ids.liveA}' AND "videoId" = '${ids.videoA}' AND "formId" = '${ids.formA}';
    `;
    const valid = psql(container.id, seedSql, environment);
    receipt.phases.validBinding = valid.exitCode === 0 && valid.stdout.trim().endsWith("1") ? "PASS" : "FAIL";
    if (receipt.phases.validBinding !== "PASS") throw new Error("valid-resource-binding-failed");

    const crossVideo = psql(container.id, `INSERT INTO "Live" ("id","vendorId","videoId","title","slug","scheduledAt","createdAt","updatedAt") VALUES ('wp27-cross-video','${ids.vendorA}','${ids.videoB}','cross video','wp27-cross-video','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');`, environment);
    receipt.phases.crossVendorVideoRejected = crossVideo.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.crossVendorVideoRejected !== "PASS") throw new Error("cross-vendor-video-not-rejected");

    const crossForm = psql(container.id, `INSERT INTO "Live" ("id","vendorId","formId","title","slug","scheduledAt","createdAt","updatedAt") VALUES ('wp27-cross-form','${ids.vendorA}','${ids.formB}','cross form','wp27-cross-form','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z','2036-08-08T00:00:00Z');`, environment);
    receipt.phases.crossVendorFormRejected = crossForm.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.crossVendorFormRejected !== "PASS") throw new Error("cross-vendor-form-not-rejected");

    const deleted = psql(container.id, `DELETE FROM "Video" WHERE "id" = '${ids.videoA}'; DELETE FROM "RegistrationForm" WHERE "id" = '${ids.formA}'; SELECT COUNT(*) FROM "Live" WHERE "id" = '${ids.liveA}' AND "videoId" IS NULL AND "formId" IS NULL;`, environment);
    receipt.phases.deletePreservesSetNull = deleted.exitCode === 0 && deleted.stdout.trim().endsWith("1") ? "PASS" : "FAIL";
    if (receipt.phases.deletePreservesSetNull !== "PASS") throw new Error("set-null-delete-semantics-failed");

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
