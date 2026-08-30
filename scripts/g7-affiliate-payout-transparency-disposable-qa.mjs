import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(root, ".ai-team", "reports", "g7-28-affiliate-payout-transparency-disposable.json");
const dockerImage = "postgres:16-alpine";

function run(command, args, environment, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    maxBuffer: 8 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function isolatedEnvironment(tempRoot) {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    USERPROFILE: path.join(tempRoot, "profile"),
    DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    CI: "true",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
  };
}

function psql(containerId, sql, environment, database = "celebratedeal_test") {
  return run("docker", [
    "exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1",
    "-A", "-t", "-q", "-d", database, "-c", sql,
  ], environment);
}

function waitForPostgres(containerId, environment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], environment).exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

function contractSql() {
  return `
    CREATE TEMP TABLE qa_result (name TEXT PRIMARY KEY, passed BOOLEAN NOT NULL);
    INSERT INTO "Vendor" ("id","name","slug","email","passwordHash","updatedAt")
    VALUES ('vendor-g7-28','Synthetic Vendor','synthetic-g7-28','vendor@example.test','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO "Affiliate" ("id","vendorId","name","code","commissionRateBps","updatedAt")
    VALUES ('affiliate-g7-28','vendor-g7-28','Synthetic Affiliate','G728',500,CURRENT_TIMESTAMP);
    INSERT INTO "AffiliatePayout" (
      "id","vendorId","affiliateId","monthKey","commissionAmountCents","adjustmentAmountCents",
      "finalAmountCents","status","outcomeReason","updatedAt"
    ) VALUES (
      'payout-historical','vendor-g7-28','affiliate-g7-28','2026-07',500,0,500,'paid',NULL,CURRENT_TIMESTAMP
    );
    INSERT INTO qa_result VALUES ('historical_null_accepted', (
      SELECT "outcomeReason" IS NULL FROM "AffiliatePayout" WHERE "id"='payout-historical'
    ));

    UPDATE "AffiliatePayout" SET "outcomeReason"='Synthetic merchant transfer note',"updatedAt"=CURRENT_TIMESTAMP
    WHERE "id"='payout-historical';
    INSERT INTO qa_result VALUES ('outcome_reason_persisted', (
      SELECT "outcomeReason"='Synthetic merchant transfer note' FROM "AffiliatePayout" WHERE "id"='payout-historical'
    ));

    DO $$ BEGIN
      BEGIN
        UPDATE "AffiliatePayout" SET "outcomeReason"='   ',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='payout-historical';
        RAISE EXCEPTION 'blank outcome reason unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('blank_reason_rejected', true); END;
      BEGIN
        UPDATE "AffiliatePayout" SET "outcomeReason"=repeat('x',501),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='payout-historical';
        RAISE EXCEPTION 'oversized outcome reason unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('oversized_reason_rejected', true); END;
    END $$;
    SELECT name || '=' || passed::text FROM qa_result ORDER BY name;
  `;
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(receiptPath, serialized, "utf8");
  const digest = crypto.createHash("sha256").update(serialized).digest("hex").toUpperCase();
  fs.writeFileSync(`${receiptPath}.sha256`, `${digest}  ${path.basename(receiptPath)}\n`, "utf8");
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-affiliate-${runId}`;
  const marker = `g7-affiliate:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const environment = isolatedEnvironment(tempRoot);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-affiliate-payout-transparency/v1",
    workPackage: "G7-28",
    runId,
    status: "BLOCKED_OR_FAILED",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", contract: "NOT_STARTED" },
    assertions: [],
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { sourceEnvContentsRead: false, loopbackOnly: true, noPersistentVolume: true, syntheticFixturesOnly: true, productionSideEffects: false },
    failure: null,
  };
  let containerId = null;
  try {
    if (!/^celebratedeal-g7-affiliate-[a-f0-9]{16}$/u.test(name)) throw new Error("runner-contract-invalid");
    for (const directory of ["tmp", "profile", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
    if (migrations.at(-1) !== "20260809060000_g7_28_affiliate_payout_outcome_reason") throw new Error("migration-order-changed");
    if (run("docker", ["image", "inspect", dockerImage], environment).exitCode !== 0) throw new Error("docker-image-unavailable");
    const created = run("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", dockerImage,
    ], environment);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) throw new Error("container-create-failed");
    containerId = created.stdout.trim();
    if (!waitForPostgres(containerId, environment)) throw new Error("database-unreachable");
    const port = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(run("docker", ["port", containerId, "5432/tcp"], environment).stdout)?.[1];
    if (!port) throw new Error("loopback-port-invalid");
    if (psql(containerId, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, environment, "postgres").exitCode !== 0) throw new Error("database-marker-failed");
    if (psql(containerId, `COMMENT ON SCHEMA public IS '${marker}';`, environment).exitCode !== 0) throw new Error("schema-marker-failed");

    const mirror = writeMirror(tempRoot, migrations);
    const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
    const config = path.join(mirror, "prisma.config.mjs");
    const databaseUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=public`;
    const databaseEnvironment = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
    for (const [phase, args] of [["validate", ["validate"]], ["deploy", ["migrate", "deploy"]], ["status", ["migrate", "status"]]]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", config], databaseEnvironment, mirror);
      receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) throw new Error(`prisma-${phase}-failed`);
    }
    const contract = psql(containerId, contractSql(), environment);
    receipt.assertions = contract.stdout.trim().split(/\r?\n/u).filter(Boolean);
    const required = [
      "blank_reason_rejected=true",
      "historical_null_accepted=true",
      "outcome_reason_persisted=true",
      "oversized_reason_rejected=true",
    ];
    receipt.phases.contract = contract.exitCode === 0 && required.every((value) => receipt.assertions.includes(value)) ? "PASS" : "FAIL";
    if (receipt.phases.contract !== "PASS") throw new Error("contract-failed");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "unknown-error";
  } finally {
    if (containerId) {
      const inspected = run("docker", ["inspect", "--format", "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}", containerId], environment);
      const fields = inspected.stdout.replace(/\r?\n$/u, "").split("\t");
      const exactContainer = inspected.exitCode === 0 && fields[0] === containerId && fields[1]?.replace(/^\//u, "") === name && fields[2] === runId && fields[3] === marker;
      const databaseMarker = exactContainer ? psql(containerId, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname='celebratedeal_test'", environment) : null;
      const schemaMarker = exactContainer ? psql(containerId, "SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname='public'", environment) : null;
      if (databaseMarker?.stdout.trim() === marker && schemaMarker?.stdout.trim() === marker) {
        const removed = run("docker", ["rm", "-f", containerId], environment);
        receipt.cleanup.container = removed.exitCode === 0 && run("docker", ["inspect", containerId], environment).exitCode !== 0 ? "PASS" : "FAIL";
      } else receipt.cleanup.container = "CLEANUP_BLOCKED";
    } else receipt.cleanup.container = "NOT_CREATED";

    const markerPath = path.join(tempRoot, ".marker");
    const safeTemp = path.resolve(tempRoot).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
      && path.basename(tempRoot) === name && fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8") === marker;
    if (safeTemp) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      receipt.cleanup.tempRoot = fs.existsSync(tempRoot) ? "FAIL" : "PASS";
    } else receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";
    if (receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS") receipt.status = "BLOCKED_OR_FAILED";
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt);
  }
  if (receipt.status !== "PASS") throw new Error(`G7-28 disposable QA failed: ${receipt.failure ?? "cleanup-failed"}`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((receipt) => process.stdout.write(`${JSON.stringify({ status: receipt.status, migrationCount: receipt.migrationCount, assertions: receipt.assertions.length, cleanup: receipt.cleanup })}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "G7-28 disposable QA failed"}\n`);
    process.exitCode = 1;
  });
}
