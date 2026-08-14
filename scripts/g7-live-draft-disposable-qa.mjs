import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const receiptPath = path.join(root, ".ai-team", "reports", "g7-44-live-draft-disposable-20260809.json");
const image = "postgres:16-alpine";

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

function psql(containerId, sql, environment) {
  return run("docker", [
    "exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1",
    "-A", "-t", "-q", "-d", "celebratedeal_test", "-c", sql,
  ], environment);
}

function waitForPostgres(containerId, environment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], environment).exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
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
    NODE_ENV: "test",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
  };
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
  const name = `celebratedeal-g7-live-draft-${runId}`;
  const schema = `g7_44_${runId}`;
  const marker = `g7-live-draft:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const environment = isolatedEnvironment(tempRoot);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-live-draft-disposable/v1",
    workPackage: "G7-44",
    runId,
    status: "BLOCKED_OR_FAILED",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", draftDbTests: "NOT_STARTED" },
    tests: { files: 1, cases: 3 },
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    failure: null,
    safety: {
      sourceEnvContentsRead: false,
      loopbackOnly: true,
      noPersistentVolume: true,
      syntheticFixturesOnly: true,
      productionSideEffects: false,
      rawOutputPersisted: false,
    },
  };
  let containerId = null;

  try {
    if (!/^celebratedeal-g7-live-draft-[a-f0-9]{16}$/u.test(name) || !/^g7_44_[a-f0-9]{16}$/u.test(schema) || migrations.length === 0) {
      throw new Error("runner-contract-invalid");
    }
    for (const directory of ["tmp", "profile", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
    if (run("docker", ["image", "inspect", image], environment).exitCode !== 0) throw new Error("docker-image-unavailable");

    const created = run("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${runId}`,
      "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres",
      "-e", "POSTGRES_PASSWORD=postgres",
      "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data",
      "-p", "127.0.0.1::5432",
      image,
    ], environment);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) throw new Error("container-create-failed");
    containerId = created.stdout.trim();
    if (!waitForPostgres(containerId, environment)) throw new Error("database-unreachable");

    const port = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(run("docker", ["port", containerId, "5432/tcp"], environment).stdout)?.[1];
    if (!port) throw new Error("loopback-port-invalid");
    const markerWrite = psql(containerId, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, environment);
    if (markerWrite.exitCode !== 0) throw new Error("schema-marker-failed");

    const databaseUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=${schema}`;
    const dbEnvironment = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
    const mirror = writeMirror(tempRoot, migrations);
    const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
    const config = path.join(mirror, "prisma.config.mjs");
    for (const [phase, args] of [
      ["validate", ["validate"]],
      ["deploy", ["migrate", "deploy"]],
      ["status", ["migrate", "status"]],
    ]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", config], dbEnvironment, mirror);
      receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) throw new Error(`prisma-${phase}-failed`);
    }

    const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
    const tests = run(process.execPath, [vitestCli, "run", "src/lib/live-studio-draft.db.test.ts"], dbEnvironment);
    receipt.phases.draftDbTests = tests.exitCode === 0 ? "PASS" : "FAIL";
    if (tests.exitCode !== 0) throw new Error("draft-db-tests-failed");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "unknown-error";
  } finally {
    if (containerId) {
      const inspected = run("docker", [
        "inspect", "--format",
        "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}",
        containerId,
      ], environment);
      const fields = inspected.stdout.replace(/\r?\n$/u, "").split("\t");
      const exact = inspected.exitCode === 0
        && fields[0] === containerId
        && fields[1]?.replace(/^\//u, "") === name
        && fields[2] === runId
        && fields[3] === marker;
      if (exact) {
        const removed = run("docker", ["rm", "-f", containerId], environment);
        receipt.cleanup.container = removed.exitCode === 0 && run("docker", ["inspect", containerId], environment).exitCode !== 0 ? "PASS" : "FAIL";
      } else receipt.cleanup.container = "CLEANUP_BLOCKED";
    } else receipt.cleanup.container = "NOT_CREATED";

    const markerPath = path.join(tempRoot, ".marker");
    const safeTemp = path.resolve(tempRoot).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
      && path.basename(tempRoot) === name
      && fs.existsSync(markerPath)
      && fs.readFileSync(markerPath, "utf8") === marker;
    if (safeTemp) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      receipt.cleanup.tempRoot = fs.existsSync(tempRoot) ? "FAIL" : "PASS";
    } else receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";

    if (receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS") receipt.status = "BLOCKED_OR_FAILED";
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt);
  }

  if (receipt.status !== "PASS") throw new Error(`G7-44 disposable QA failed: ${receipt.failure ?? "cleanup-failed"}`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().then((receipt) => {
    process.stdout.write(`${JSON.stringify({ status: receipt.status, migrationCount: receipt.migrationCount, phases: receipt.phases, tests: receipt.tests, cleanup: receipt.cleanup })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "G7-44 disposable QA failed"}\n`);
    process.exitCode = 1;
  });
}
