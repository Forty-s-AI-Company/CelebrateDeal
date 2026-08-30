import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(root, ".ai-team", "reports", "g7-26-split-refund-handoff-disposable.json");
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
    INSERT INTO "Vendor" ("id","name","slug","email","passwordHash","updatedAt") VALUES
      ('v1','Synthetic Vendor','synthetic-vendor','vendor@example.test','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO "User" ("id","email","name","passwordHash","updatedAt") VALUES
      ('owner','owner@example.test','Synthetic Owner','synthetic',CURRENT_TIMESTAMP),
      ('finance','finance@example.test','Synthetic Finance','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO "VendorMember" ("id","vendorId","userId","role","status") VALUES
      ('member1','v1','owner','owner','active');
    INSERT INTO "PaymentTransaction" ("id","vendorId","providerName","orderNumber","grossAmountCents","netAmountCents","status") VALUES
      ('tx1','v1','synthetic','ORDER-1',10000,10000,'paid'),
      ('tx-other','v1','synthetic','ORDER-OTHER',10000,10000,'paid');
    INSERT INTO "CommerceOrder" (
      "id","vendorId","orderNumber","checkoutIdempotencyKey","checkoutIdentityHash","primaryPaymentTransactionId",
      "status","subtotalAmountCents","totalAmountCents","paidAmountCents","refundedAmountCents",
      "buyerEncryptedEnvelope","buyerMaskedName","buyerMaskedEmail","paidAt","updatedAt"
    ) VALUES ('order1','v1','ORDER-1','11111111-1111-4111-8111-111111111111','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','tx1',
      'paid',10000,10000,10000,0,'opaque','測＊者','s***@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "SupportCase" (
      "id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision",
      "createdByMemberId","responseDueAt","updatedAt"
    ) VALUES
      ('case1','v1','order1','SC-20260809-A1B2C3D4','11111111-1111-4111-8111-111111111112','refund','p1','waiting_finance',1,'member1',CURRENT_TIMESTAMP + INTERVAL '1 hour',CURRENT_TIMESTAMP),
      ('case2','v1','order1','SC-20260809-A1B2C3D5','11111111-1111-4111-8111-111111111113','refund','p1','waiting_finance',1,'member1',CURRENT_TIMESTAMP + INTERVAL '1 hour',CURRENT_TIMESTAMP);
    INSERT INTO "SupportRefundHandoff" (
      "id","vendorId","supportCaseId","orderId","paymentTransactionId","requestedByMemberId",
      "requestedAmountCents","reasonEncryptedEnvelope","status","revision","updatedAt"
    ) VALUES
      ('handoff1','v1','case1','order1','tx1','member1',5000,'opaque','requested',1,CURRENT_TIMESTAMP),
      ('handoff2','v1','case2','order1','tx1','member1',5000,'opaque','requested',1,CURRENT_TIMESTAMP);
    UPDATE "SupportRefundHandoff"
      SET "status"='reviewing',"revision"=2,"reviewedByActorId"='finance',"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP;
    INSERT INTO "CommerceOrderRefund" (
      "id","vendorId","orderId","paymentTransactionId","providerName","eventIdentity",
      "amountCents","cumulativeAmountCents","status","occurredAt"
    ) VALUES
      ('refund-a','v1','order1','tx1','synthetic','split-a',2000,2000,'processed',CURRENT_TIMESTAMP),
      ('refund-b','v1','order1','tx1','synthetic','split-b',3000,5000,'processed',CURRENT_TIMESTAMP),
      ('refund-pending','v1','order1','tx1','synthetic','pending',5000,5000,'pending',CURRENT_TIMESTAMP),
      ('refund-other-payment','v1','order1','tx-other','synthetic','other-payment',5000,5000,'processed',CURRENT_TIMESTAMP);
    UPDATE "CommerceOrder" SET "status"='partially_refunded',"refundedAmountCents"=5000,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='order1';

    INSERT INTO "SupportRefundHandoffRefund" ("vendorId","handoffId","orderId","refundId","amountCentsSnapshot")
    VALUES ('v1','handoff1','order1','refund-a',2000);
    DO $$ BEGIN
      BEGIN
        UPDATE "SupportRefundHandoff"
          SET "status"='completed',"revision"=3,"completedRefundId"='refund-a',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"='handoff1';
        RAISE EXCEPTION 'incomplete refund sum unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('incomplete_sum_rejected', true); END;
    END $$;

    INSERT INTO "SupportRefundHandoffRefund" ("vendorId","handoffId","orderId","refundId","amountCentsSnapshot")
    VALUES ('v1','handoff1','order1','refund-b',3000);
    UPDATE "SupportRefundHandoff"
      SET "status"='completed',"revision"=3,"completedRefundId"='refund-a',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"='handoff1';
    INSERT INTO qa_result VALUES ('split_sum_accepted', (
      SELECT "status"='completed' FROM "SupportRefundHandoff" WHERE "id"='handoff1'
    ));
    INSERT INTO qa_result VALUES ('split_links_preserved', (
      SELECT COUNT(*)=2 AND SUM("amountCentsSnapshot")=5000 FROM "SupportRefundHandoffRefund" WHERE "handoffId"='handoff1'
    ));

    DO $$ BEGIN
      BEGIN
        INSERT INTO "SupportRefundHandoffRefund" ("vendorId","handoffId","orderId","refundId","amountCentsSnapshot")
        VALUES ('v1','handoff2','order1','refund-a',2000);
        RAISE EXCEPTION 'refund reused by another handoff';
      EXCEPTION WHEN unique_violation THEN INSERT INTO qa_result VALUES ('refund_reuse_rejected', true); END;
      BEGIN
        INSERT INTO "SupportRefundHandoffRefund" ("vendorId","handoffId","orderId","refundId","amountCentsSnapshot")
        VALUES ('v1','handoff2','order1','refund-pending',5000);
        RAISE EXCEPTION 'pending refund unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('pending_refund_rejected', true); END;
      BEGIN
        INSERT INTO "SupportRefundHandoffRefund" ("vendorId","handoffId","orderId","refundId","amountCentsSnapshot")
        VALUES ('v1','handoff2','order1','refund-other-payment',5000);
        RAISE EXCEPTION 'other payment refund unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('other_payment_rejected', true); END;
      BEGIN
        INSERT INTO "SupportRefundHandoffRefund" ("vendorId","handoffId","orderId","refundId","amountCentsSnapshot")
        VALUES ('v1','handoff2','order1','refund-other-payment',4999);
        RAISE EXCEPTION 'changed snapshot unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('snapshot_mismatch_rejected', true); END;
      BEGIN
        UPDATE "SupportRefundHandoffRefund" SET "amountCentsSnapshot"=1999
        WHERE "vendorId"='v1' AND "handoffId"='handoff1' AND "refundId"='refund-a';
        RAISE EXCEPTION 'completion link unexpectedly changed';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('completion_link_immutable', true); END;
      BEGIN
        DELETE FROM "SupportRefundHandoffRefund"
        WHERE "vendorId"='v1' AND "handoffId"='handoff1' AND "refundId"='refund-b';
        RAISE EXCEPTION 'completion link unexpectedly deleted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('completion_link_delete_rejected', true); END;
      BEGIN
        UPDATE "CommerceOrderRefund" SET "status"='pending'
        WHERE "vendorId"='v1' AND "id"='refund-a';
        RAISE EXCEPTION 'linked canonical refund unexpectedly changed';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('linked_refund_update_rejected', true); END;
    END $$;
    SELECT name || '=' || passed::text FROM qa_result ORDER BY name;
  `;
}

function legacyPaymentMismatchSql(schema) {
  return `
    SET search_path TO "${schema}";
    INSERT INTO "Vendor" ("id","name","slug","email","passwordHash","updatedAt") VALUES
      ('legacy-v','Legacy Synthetic Vendor','legacy-synthetic-vendor','legacy-vendor@example.test','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO "User" ("id","email","name","passwordHash","updatedAt") VALUES
      ('legacy-owner','legacy-owner@example.test','Legacy Owner','synthetic',CURRENT_TIMESTAMP),
      ('legacy-finance','legacy-finance@example.test','Legacy Finance','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO "VendorMember" ("id","vendorId","userId","role","status") VALUES
      ('legacy-member','legacy-v','legacy-owner','owner','active');
    INSERT INTO "PaymentTransaction" ("id","vendorId","providerName","orderNumber","grossAmountCents","netAmountCents","status") VALUES
      ('legacy-tx','legacy-v','synthetic','LEGACY-ORDER',10000,10000,'paid'),
      ('legacy-other-tx','legacy-v','synthetic','LEGACY-OTHER',10000,10000,'paid');
    INSERT INTO "CommerceOrder" (
      "id","vendorId","orderNumber","checkoutIdempotencyKey","checkoutIdentityHash","primaryPaymentTransactionId",
      "status","subtotalAmountCents","totalAmountCents","paidAmountCents","refundedAmountCents",
      "buyerEncryptedEnvelope","buyerMaskedName","buyerMaskedEmail","paidAt","updatedAt"
    ) VALUES ('legacy-order','legacy-v','LEGACY-ORDER','22222222-2222-4222-8222-222222222222','BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','legacy-tx',
      'paid',10000,10000,10000,0,'opaque','舊＊料','l***@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "SupportCase" (
      "id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision",
      "createdByMemberId","responseDueAt","updatedAt"
    ) VALUES ('legacy-case','legacy-v','legacy-order','SC-20260809-B1C2D3E4','22222222-2222-4222-8222-222222222223','refund','p1','waiting_finance',1,'legacy-member',CURRENT_TIMESTAMP + INTERVAL '1 hour',CURRENT_TIMESTAMP);
    INSERT INTO "SupportRefundHandoff" (
      "id","vendorId","supportCaseId","orderId","paymentTransactionId","requestedByMemberId",
      "requestedAmountCents","reasonEncryptedEnvelope","status","revision","updatedAt"
    ) VALUES ('legacy-handoff','legacy-v','legacy-case','legacy-order','legacy-tx','legacy-member',5000,'opaque','requested',1,CURRENT_TIMESTAMP);
    UPDATE "SupportRefundHandoff"
      SET "status"='reviewing',"revision"=2,"reviewedByActorId"='legacy-finance',"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"='legacy-handoff';
    INSERT INTO "CommerceOrderRefund" (
      "id","vendorId","orderId","paymentTransactionId","providerName","eventIdentity",
      "amountCents","cumulativeAmountCents","status","occurredAt"
    ) VALUES ('legacy-refund','legacy-v','legacy-order','legacy-other-tx','synthetic','legacy-mismatch',5000,5000,'processed',CURRENT_TIMESTAMP);
    UPDATE "CommerceOrder" SET "status"='partially_refunded',"refundedAmountCents"=5000,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='legacy-order';
    UPDATE "SupportRefundHandoff"
      SET "status"='completed',"revision"=3,"completedRefundId"='legacy-refund',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"='legacy-handoff';
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
  const name = `celebratedeal-g7-split-refund-${runId}`;
  const marker = `g7-split-refund:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const environment = isolatedEnvironment(tempRoot);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-split-refund/v1",
    workPackage: "G7-26",
    runId,
    status: "BLOCKED_OR_FAILED",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", contract: "NOT_STARTED", legacyBackfillGuard: "NOT_STARTED" },
    assertions: [],
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { sourceEnvContentsRead: false, loopbackOnly: true, noPersistentVolume: true, syntheticFixturesOnly: true, productionSideEffects: false },
    failure: null,
  };
  let containerId = null;
  try {
    if (!/^celebratedeal-g7-split-refund-[a-f0-9]{16}$/u.test(name)) throw new Error("runner-contract-invalid");
    for (const directory of ["tmp", "profile", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
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
      "completion_link_immutable=true",
      "completion_link_delete_rejected=true",
      "incomplete_sum_rejected=true",
      "linked_refund_update_rejected=true",
      "other_payment_rejected=true",
      "pending_refund_rejected=true",
      "refund_reuse_rejected=true",
      "snapshot_mismatch_rejected=true",
      "split_links_preserved=true",
      "split_sum_accepted=true",
    ];
    receipt.phases.contract = contract.exitCode === 0 && required.every((value) => receipt.assertions.includes(value)) ? "PASS" : "FAIL";
    if (receipt.phases.contract !== "PASS") throw new Error("contract-failed");

    const finalMigration = "20260809050000_g7_26_split_refund_handoff";
    if (migrations.at(-1) !== finalMigration) throw new Error("migration-order-changed");
    const legacySchema = `g7_26_legacy_${runId}`;
    if (psql(containerId, `CREATE SCHEMA "${legacySchema}"; COMMENT ON SCHEMA "${legacySchema}" IS '${marker}:legacy';`, environment).exitCode !== 0) {
      throw new Error("legacy-schema-create-failed");
    }
    const legacyRoot = path.join(tempRoot, "legacy-backfill");
    const legacyMirror = writeMirror(legacyRoot, migrations.slice(0, -1));
    const legacyConfig = path.join(legacyMirror, "prisma.config.mjs");
    const legacyUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=${legacySchema}`;
    const legacyEnvironment = { ...environment, DATABASE_URL: legacyUrl, DIRECT_URL: legacyUrl };
    const legacyBaseDeploy = run(process.execPath, [prismaCli, "migrate", "deploy", "--config", legacyConfig], legacyEnvironment, legacyMirror);
    if (legacyBaseDeploy.exitCode !== 0) throw new Error("legacy-base-deploy-failed");
    if (psql(containerId, legacyPaymentMismatchSql(legacySchema), environment).exitCode !== 0) throw new Error("legacy-fixture-failed");
    writeMirror(legacyRoot, migrations);
    const guardedDeploy = run(process.execPath, [prismaCli, "migrate", "deploy", "--config", legacyConfig], legacyEnvironment, legacyMirror);
    const guardedOutput = `${guardedDeploy.stdout}\n${guardedDeploy.stderr}`;
    receipt.phases.legacyBackfillGuard = guardedDeploy.exitCode !== 0
      && guardedOutput.includes("G7-26 backfill rejected an invalid legacy support refund completion")
      ? "PASS"
      : "FAIL";
    if (receipt.phases.legacyBackfillGuard !== "PASS") throw new Error("legacy-backfill-guard-failed");
    receipt.assertions.push("legacy_payment_mismatch_backfill_rejected=true");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "unknown-error";
  } finally {
    if (containerId) {
      const inspected = run("docker", [
        "inspect", "--format",
        "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
        containerId,
      ], environment);
      const fields = inspected.stdout.replace(/\r?\n$/u, "").split("\t");
      const exactContainer = inspected.exitCode === 0 && fields[0] === containerId
        && fields[1]?.replace(/^\//u, "") === name && fields[2] === runId && fields[3] === marker
        && (fields[4] === "" || fields[4] === "tmpfs=/var/lib/postgresql/data");
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
  if (receipt.status !== "PASS") throw new Error(`G7-26 disposable QA failed: ${receipt.failure ?? "cleanup-failed"}`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((receipt) => process.stdout.write(`${JSON.stringify({ status: receipt.status, migrationCount: receipt.migrationCount, assertions: receipt.assertions.length, cleanup: receipt.cleanup })}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "G7-26 disposable QA failed"}\n`);
    process.exitCode = 1;
  });
}
