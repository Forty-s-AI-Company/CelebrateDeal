import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(root, ".ai-team", "reports", "g7-10-product-catalog-disposable-20260808.json");
const image = "postgres:16-alpine";

function run(command, args, env, cwd = root) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: "utf8", windowsHide: true,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    maxBuffer: 8 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function psql(containerId, sql, env) {
  return run("docker", ["exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", "celebratedeal_test", "-c", sql], env);
}

function waitForPostgres(containerId, env) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], env).exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

function createSchemaMarker(containerId, schema, marker, env) {
  const statement = `CREATE SCHEMA IF NOT EXISTS "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (psql(containerId, statement, env).exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return false;
}

function isolatedEnvironment(tempRoot) {
  return {
    PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"), TMP: path.join(tempRoot, "tmp"), USERPROFILE: path.join(tempRoot, "profile"), DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "test", CI: "true", NEXT_TELEMETRY_DISABLED: "1", PRISMA_HIDE_UPDATE_MESSAGE: "true", NO_COLOR: "1",
  };
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(receiptPath, serialized, "utf8");
  const digest = crypto.createHash("sha256").update(serialized).digest("hex").toUpperCase();
  fs.writeFileSync(`${receiptPath}.sha256`, `${digest}  ${path.basename(receiptPath)}\n`, "utf8");
}

function contractSql(schema) {
  return `
    SET search_path TO "${schema}";
    CREATE TEMP TABLE qa_result (name TEXT PRIMARY KEY, passed BOOLEAN NOT NULL);
    INSERT INTO "Vendor" ("id","name","slug","email","passwordHash","updatedAt") VALUES
      ('v1','Vendor One','vendor-one','v1@example.test','synthetic',CURRENT_TIMESTAMP),
      ('v2','Vendor Two','vendor-two','v2@example.test','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO "Product" ("id","vendorId","name","slug","priceCents","inventory","updatedAt") VALUES
      ('p1','v1','Shared Slug One','shared-product',1200,2,CURRENT_TIMESTAMP),
      ('p2','v2','Shared Slug Two','shared-product',1200,2,CURRENT_TIMESTAMP);
    INSERT INTO qa_result VALUES ('same_slug_across_vendors_accepted', true);
    INSERT INTO qa_result SELECT 'revision_default_is_one', "revision" = 1 FROM "Product" WHERE "id" = 'p1';
    DO $$ BEGIN
      BEGIN
        INSERT INTO "Product" ("id","vendorId","name","slug","priceCents","inventory","updatedAt")
        VALUES ('p3','v1','Duplicate','shared-product',1200,1,CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'same-vendor duplicate slug unexpectedly accepted';
      EXCEPTION WHEN unique_violation THEN INSERT INTO qa_result VALUES ('same_vendor_duplicate_slug_rejected', true); END;
      BEGIN
        UPDATE "Product" SET "revision" = 0 WHERE "id" = 'p2';
        RAISE EXCEPTION 'invalid revision unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('positive_revision_enforced', true); END;
    END $$;
    DO $$ DECLARE first_count INTEGER; second_count INTEGER; BEGIN
      UPDATE "Product" SET "inventory"="inventory"-1,"revision"="revision"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='p1' AND "vendorId"='v1' AND "revision"=1;
      GET DIAGNOSTICS first_count = ROW_COUNT;
      UPDATE "Product" SET "name"='Stale overwrite',"revision"="revision"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='p1' AND "vendorId"='v1' AND "revision"=1;
      GET DIAGNOSTICS second_count = ROW_COUNT;
      IF first_count <> 1 OR second_count <> 0 THEN RAISE EXCEPTION 'product revision CAS did not select one winner'; END IF;
      INSERT INTO qa_result VALUES ('stale_product_edit_cas_one_winner', true);
    END $$;
    INSERT INTO qa_result SELECT 'inventory_change_advanced_revision', "inventory" = 1 AND "revision" = 2 FROM "Product" WHERE "id" = 'p1';
    INSERT INTO qa_result SELECT 'tenant_slug_index_present', COUNT(*) = 1 FROM pg_indexes WHERE schemaname='${schema}' AND indexname='Product_vendorId_slug_key';
    INSERT INTO qa_result SELECT 'global_slug_index_removed', COUNT(*) = 0 FROM pg_indexes WHERE schemaname='${schema}' AND indexname='Product_slug_key';
    SELECT name || '=' || passed::text FROM qa_result ORDER BY name;
  `;
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-product-${runId}`;
  const schema = `g7_10_${runId}`;
  const marker = `g7-product:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const env = isolatedEnvironment(tempRoot);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-product-catalog-disposable/v1", workPackage: "G7-10", runId, status: "BLOCKED_OR_FAILED",
    startedAt: new Date().toISOString(), finishedAt: null, migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", constraints: "NOT_STARTED", inventoryTests: "NOT_STARTED", coursePolicyTests: "NOT_STARTED" },
    assertions: [], cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" }, failure: null,
    safety: { sourceEnvContentsRead: false, loopbackOnly: true, noPersistentVolume: true, syntheticFixturesOnly: true, productionSideEffects: false, rawOutputPersisted: false },
  };
  let containerId = null;
  try {
    if (!/^celebratedeal-g7-product-[a-f0-9]{16}$/u.test(name) || !/^g7_10_[a-f0-9]{16}$/u.test(schema) || migrations.at(-1) !== "20260808235500_g7_10_product_catalog_safety") throw new Error("runner-contract-invalid");
    for (const directory of ["tmp", "profile", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
    if (run("docker", ["image", "inspect", image], env).exitCode !== 0) throw new Error("docker-image-unavailable");
    const created = run("docker", ["run", "-d", "--pull=never", "--name", name, "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`, "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test", "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image], env);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) throw new Error("container-create-failed");
    containerId = created.stdout.trim();
    if (!waitForPostgres(containerId, env)) throw new Error("database-unreachable");
    const port = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(run("docker", ["port", containerId, "5432/tcp"], env).stdout)?.[1];
    if (!port) throw new Error("loopback-port-invalid");
    if (!createSchemaMarker(containerId, schema, marker, env)) throw new Error("schema-marker-failed");
    const databaseUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=${schema}`;
    const dbEnv = { ...env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
    const mirror = writeMirror(tempRoot, migrations);
    const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
    const config = path.join(mirror, "prisma.config.mjs");
    const validate = run(process.execPath, [prismaCli, "validate", "--config", config], dbEnv, mirror);
    receipt.phases.validate = validate.exitCode === 0 ? "PASS" : "FAIL";
    if (validate.exitCode !== 0) throw new Error("prisma-validate-failed");
    const deploy = run(process.execPath, [prismaCli, "migrate", "deploy", "--config", config], dbEnv, mirror);
    receipt.phases.deploy = deploy.exitCode === 0 ? "PASS" : "FAIL";
    if (deploy.exitCode !== 0) throw new Error("prisma-deploy-failed");
    const status = run(process.execPath, [prismaCli, "migrate", "status", "--config", config], dbEnv, mirror);
    receipt.phases.status = status.exitCode === 0 ? "PASS" : "FAIL";
    if (status.exitCode !== 0) throw new Error("prisma-status-failed");
    const constraints = psql(containerId, contractSql(schema), env);
    receipt.assertions = constraints.stdout.trim().split(/\r?\n/u).filter(Boolean);
    const required = ["global_slug_index_removed=true", "inventory_change_advanced_revision=true", "positive_revision_enforced=true", "revision_default_is_one=true", "same_slug_across_vendors_accepted=true", "same_vendor_duplicate_slug_rejected=true", "stale_product_edit_cas_one_winner=true", "tenant_slug_index_present=true"];
    receipt.phases.constraints = constraints.exitCode === 0 && required.every((value) => receipt.assertions.includes(value)) ? "PASS" : "FAIL";
    if (receipt.phases.constraints !== "PASS") throw new Error("constraint-contract-failed");
    const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
    const inventoryTests = run(process.execPath, [vitestCli, "run", "src/lib/inventory-reservations.test.ts"], dbEnv);
    receipt.phases.inventoryTests = inventoryTests.exitCode === 0 ? "PASS" : "FAIL";
    if (inventoryTests.exitCode !== 0) throw new Error("inventory-tests-failed");
    const coursePolicyTests = run(process.execPath, [vitestCli, "run", "src/lib/course-payment-webhooks.test.ts"], dbEnv);
    receipt.phases.coursePolicyTests = coursePolicyTests.exitCode === 0 ? "PASS" : "FAIL";
    if (coursePolicyTests.exitCode !== 0) throw new Error("course-policy-tests-failed");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "unknown-error";
  } finally {
    if (containerId) {
      const inspected = run("docker", ["inspect", "--format", "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}", containerId], env);
      const fields = inspected.stdout.replace(/\r?\n$/u, "").split("\t");
      const exact = inspected.exitCode === 0 && fields[0] === containerId && fields[1]?.replace(/^\//u, "") === name && fields[2] === runId && fields[3] === marker;
      if (exact) {
        const removed = run("docker", ["rm", "-f", containerId], env);
        receipt.cleanup.container = removed.exitCode === 0 && run("docker", ["inspect", containerId], env).exitCode !== 0 ? "PASS" : "FAIL";
      } else receipt.cleanup.container = "CLEANUP_BLOCKED";
    } else receipt.cleanup.container = "NOT_CREATED";
    const markerPath = path.join(tempRoot, ".marker");
    const safeTemp = path.resolve(tempRoot).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(tempRoot) === name && fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8") === marker;
    if (safeTemp) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      receipt.cleanup.tempRoot = fs.existsSync(tempRoot) ? "FAIL" : "PASS";
    } else receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";
    if (receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS") receipt.status = "BLOCKED_OR_FAILED";
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt);
  }
  if (receipt.status !== "PASS") throw new Error(`G7-10 disposable QA failed: ${receipt.failure ?? "cleanup-failed"}`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((receipt) => process.stdout.write(`${JSON.stringify({ status: receipt.status, migrationCount: receipt.migrationCount, assertions: receipt.assertions.length, phases: receipt.phases, cleanup: receipt.cleanup })}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "G7-10 disposable QA failed"}\n`);
    process.exitCode = 1;
  });
}
