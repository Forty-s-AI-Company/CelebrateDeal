import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const receiptPath = path.join(workspaceRoot, ".ai-team", "reports", "func-2026-08-07-26-live-product-tenant-disposable.json");
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

function dockerInspection(container, environment) {
  const inspected = run("docker", [
    "inspect", "--format",
    "{{.Id}}|{{index .Config.Labels \"celebratedeal.run-id\"}}|{{index .Config.Labels \"celebratedeal.marker\"}}",
    container,
  ], environment);
  if (inspected.exitCode !== 0) return null;
  const fields = inspected.stdout.replace(/\r?\n$/, "").split("|");
  return fields.length === 3 ? fields : null;
}

function cleanup(container, tempRoot, marker, environment, receipt) {
  if (container) {
    const inspected = dockerInspection(container.id, environment);
    const markerOkay = inspected
      && inspected[0] === container.id
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

  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
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
  const name = `celebratedeal-wp26-${id}`;
  const marker = `wp26-live-product:${id}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-func-wp26-live-product-tenant/v1",
    workPackage: "FUNC-2026-08-07-26",
    status: "BLOCKED_OR_FAILED",
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", validInsert: "NOT_STARTED", crossVendorLiveRejected: "NOT_STARTED", crossVendorProductRejected: "NOT_STARTED" },
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
    container = { id: created.stdout.trim(), name, runId: id };
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
      const response = run(process.execPath, [prismaCli, ...args, "--config", path.join(mirrorRoot, "prisma.config.mjs")], prismaEnvironment, mirrorRoot);
      receipt.phases[key] = response.exitCode === 0 ? "PASS" : "FAIL";
      if (response.exitCode !== 0) throw new Error(`prisma-${key}-failed`);
    }

    const ids = { vendorA: "wp26-vendor-a", vendorB: "wp26-vendor-b", liveA: "wp26-live-a", liveB: "wp26-live-b", productA: "wp26-product-a", productB: "wp26-product-b", valid: "wp26-live-product-valid" };
    const seedSql = `
      INSERT INTO "Vendor" ("id","name","slug","email","passwordHash","createdAt","updatedAt") VALUES
        ('${ids.vendorA}','WP26 Vendor A','wp26-vendor-a','wp26-a@example.invalid','synthetic-hash','2036-08-07T00:00:00Z','2036-08-07T00:00:00Z'),
        ('${ids.vendorB}','WP26 Vendor B','wp26-vendor-b','wp26-b@example.invalid','synthetic-hash','2036-08-07T00:00:00Z','2036-08-07T00:00:00Z');
      INSERT INTO "Product" ("id","vendorId","name","slug","priceCents","createdAt","updatedAt") VALUES
        ('${ids.productA}','${ids.vendorA}','WP26 Product A','wp26-product-a',100,'2036-08-07T00:00:00Z','2036-08-07T00:00:00Z'),
        ('${ids.productB}','${ids.vendorB}','WP26 Product B','wp26-product-b',100,'2036-08-07T00:00:00Z','2036-08-07T00:00:00Z');
      INSERT INTO "Live" ("id","vendorId","title","slug","scheduledAt","status","createdAt","updatedAt") VALUES
        ('${ids.liveA}','${ids.vendorA}','WP26 Live A','wp26-live-a','2036-08-07T00:00:00Z','live','2036-08-07T00:00:00Z','2036-08-07T00:00:00Z'),
        ('${ids.liveB}','${ids.vendorB}','WP26 Live B','wp26-live-b','2036-08-07T00:00:00Z','live','2036-08-07T00:00:00Z','2036-08-07T00:00:00Z');
      INSERT INTO "LiveProduct" ("id","vendorId","liveId","productId") VALUES
        ('${ids.valid}','${ids.vendorA}','${ids.liveA}','${ids.productA}');
      SELECT COUNT(*) FROM "LiveProduct" WHERE "id" = '${ids.valid}';
    `;
    const validInsert = psql(container.id, seedSql, environment);
    receipt.phases.validInsert = validInsert.exitCode === 0 && validInsert.stdout.trim().endsWith("1") ? "PASS" : "FAIL";
    if (receipt.phases.validInsert !== "PASS") throw new Error("valid-live-product-insert-failed");

    const crossLive = psql(container.id, `INSERT INTO "LiveProduct" ("id","vendorId","liveId","productId") VALUES ('wp26-cross-live','${ids.vendorA}','${ids.liveB}','${ids.productA}');`, environment);
    receipt.phases.crossVendorLiveRejected = crossLive.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.crossVendorLiveRejected !== "PASS") throw new Error("cross-vendor-live-not-rejected");

    const crossProduct = psql(container.id, `INSERT INTO "LiveProduct" ("id","vendorId","liveId","productId") VALUES ('wp26-cross-product','${ids.vendorA}','${ids.liveA}','${ids.productB}');`, environment);
    receipt.phases.crossVendorProductRejected = crossProduct.exitCode !== 0 ? "PASS" : "FAIL";
    if (receipt.phases.crossVendorProductRejected !== "PASS") throw new Error("cross-vendor-product-not-rejected");
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
