import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(root, ".ai-team", "reports", "g7-09b-support-disposable-20260808.json");
const image = "postgres:16-alpine";

function run(command, args, env, cwd = root) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: "utf8", windowsHide: true,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    maxBuffer: 8 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function psql(containerId, sql, env, database = "celebratedeal_test") {
  return run("docker", ["exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", database, "-c", sql], env);
}

function waitForPostgres(containerId, env) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], env).exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

function markDatabase(containerId, marker, env) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = psql(containerId, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, env, "postgres");
    if (result.exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return false;
}

function isolatedEnvironment(tempRoot) {
  return {
    PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"), TMP: path.join(tempRoot, "tmp"),
    USERPROFILE: path.join(tempRoot, "profile"), DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "test", CI: "true", NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true", NO_COLOR: "1",
  };
}

function inspection(containerId, env) {
  return run("docker", [
    "inspect", "--format",
    "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
    containerId,
  ], env);
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
    INSERT INTO "User" ("id","email","name","passwordHash","updatedAt") VALUES
      ('u1','u1@example.test','Owner One','synthetic',CURRENT_TIMESTAMP),
      ('u2','u2@example.test','Owner Two','synthetic',CURRENT_TIMESTAMP),
      ('finance','finance@example.test','Finance','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO "VendorMember" ("id","vendorId","userId","role","status") VALUES
      ('m1','v1','u1','owner','active'), ('m2','v2','u2','owner','active');
    INSERT INTO "PaymentTransaction" ("id","vendorId","providerName","orderNumber","grossAmountCents","netAmountCents","status") VALUES
      ('tx1','v1','synthetic','ORDER-1',10000,10000,'paid'),
      ('tx1-other','v1','synthetic','ORDER-OTHER',10000,10000,'paid'),
      ('tx2','v2','synthetic','ORDER-2',10000,10000,'paid');
    INSERT INTO "CommerceOrder" (
      "id","vendorId","orderNumber","checkoutIdempotencyKey","checkoutIdentityHash","primaryPaymentTransactionId",
      "status","subtotalAmountCents","totalAmountCents","paidAmountCents","refundedAmountCents",
      "buyerEncryptedEnvelope","buyerMaskedName","buyerMaskedEmail","paidAt","updatedAt"
    ) VALUES
      ('o1','v1','ORDER-1','11111111-1111-4111-8111-111111111111','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','tx1','paid',10000,10000,10000,2000,'opaque','買＊一','b***@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
      ('o2','v2','ORDER-2','22222222-2222-4222-8222-222222222222','BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','tx2','paid',10000,10000,10000,0,'opaque','買＊二','c***@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "SupportCase" (
      "id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision",
      "createdByMemberId","assignedMemberId","updatedAt"
    ) VALUES ('case1','v1','o1','SC-20260808-A1B2C3D4','11111111-1111-4111-8111-111111111112','refund','p1','in_progress',1,'m1','m1',CURRENT_TIMESTAMP);

    DO $$ BEGIN
      BEGIN
        INSERT INTO "SupportCase" ("id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision","createdByMemberId","updatedAt")
        VALUES ('cross-order','v1','o2','SC-20260808-A1B2C3D5','11111111-1111-4111-8111-111111111113','general','p2','open',1,'m1',CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'cross-tenant order unexpectedly accepted';
      EXCEPTION WHEN foreign_key_violation THEN
        INSERT INTO qa_result VALUES ('cross_tenant_order_rejected', true);
      END;
      BEGIN
        INSERT INTO "SupportCase" ("id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision","createdByMemberId","updatedAt")
        VALUES ('cross-member','v1','o1','SC-20260808-A1B2C3D6','11111111-1111-4111-8111-111111111114','general','p2','open',1,'m2',CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'cross-tenant member unexpectedly accepted';
      EXCEPTION WHEN foreign_key_violation THEN
        INSERT INTO qa_result VALUES ('cross_tenant_member_rejected', true);
      END;
    END $$;

    DO $$ DECLARE first_count INTEGER; second_count INTEGER; BEGIN
      UPDATE "SupportCase" SET "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id"='case1' AND "vendorId"='v1' AND "revision"=1;
      GET DIAGNOSTICS first_count = ROW_COUNT;
      UPDATE "SupportCase" SET "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id"='case1' AND "vendorId"='v1' AND "revision"=1;
      GET DIAGNOSTICS second_count = ROW_COUNT;
      IF first_count <> 1 OR second_count <> 0 THEN RAISE EXCEPTION 'CAS did not select exactly one winner'; END IF;
      INSERT INTO qa_result VALUES ('revision_cas_one_winner', true);
    END $$;

    INSERT INTO "SupportCaseEvent" ("id","vendorId","supportCaseId","dedupKey","eventType","actorMemberId")
    VALUES ('event1','v1','case1','note-1','note_added','m1');
    DO $$ BEGIN
      BEGIN
        INSERT INTO "SupportCaseEvent" ("id","vendorId","supportCaseId","dedupKey","eventType","actorMemberId")
        VALUES ('event2','v1','case1','note-1','note_added','m1');
        RAISE EXCEPTION 'duplicate event unexpectedly accepted';
      EXCEPTION WHEN unique_violation THEN
        INSERT INTO qa_result VALUES ('event_dedup_rejected', true);
      END;
    END $$;

    DO $$ BEGIN
      BEGIN
        INSERT INTO "SupportRefundHandoff" ("id","vendorId","supportCaseId","orderId","paymentTransactionId","requestedByMemberId","requestedAmountCents","reasonEncryptedEnvelope","status","revision","updatedAt")
        VALUES ('bad-payment','v1','case1','o1','tx1-other','m1',5000,'opaque','requested',1,CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'mismatched payment unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN
        INSERT INTO qa_result VALUES ('mismatched_payment_rejected', true);
      END;
      BEGIN
        INSERT INTO "SupportRefundHandoff" ("id","vendorId","supportCaseId","orderId","paymentTransactionId","requestedByMemberId","requestedAmountCents","reasonEncryptedEnvelope","status","revision","updatedAt")
        VALUES ('over-remaining','v1','case1','o1','tx1','m1',8001,'opaque','requested',1,CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'amount above remaining balance unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN
        INSERT INTO qa_result VALUES ('remaining_balance_enforced', true);
      END;
    END $$;

    INSERT INTO "SupportRefundHandoff" ("id","vendorId","supportCaseId","orderId","paymentTransactionId","requestedByMemberId","requestedAmountCents","reasonEncryptedEnvelope","status","revision","updatedAt")
    VALUES ('handoff1','v1','case1','o1','tx1','m1',5000,'opaque','requested',1,CURRENT_TIMESTAMP);
    UPDATE "SupportRefundHandoff" SET "status"='reviewing',"revision"=2,"reviewedByActorId"='finance',"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='handoff1';
    DO $$ BEGIN
      BEGIN
        UPDATE "SupportRefundHandoff" SET "requestedAmountCents"=4999,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='handoff1';
        RAISE EXCEPTION 'commercial identity unexpectedly changed';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('handoff_identity_immutable', true); END;
    END $$;
    INSERT INTO "CommerceOrderRefund" ("id","vendorId","orderId","paymentTransactionId","providerName","eventIdentity","amountCents","cumulativeAmountCents","status","occurredAt") VALUES
      ('refund-wrong','v1','o1','tx1','synthetic','wrong',4000,6000,'processed',CURRENT_TIMESTAMP),
      ('refund-pending','v1','o1','tx1','synthetic','pending',5000,7000,'pending',CURRENT_TIMESTAMP),
      ('refund-good','v1','o1','tx1','synthetic','good',5000,7000,'processed',CURRENT_TIMESTAMP);
    DO $$ BEGIN
      BEGIN
        UPDATE "SupportRefundHandoff" SET "status"='completed',"revision"=3,"completedRefundId"='refund-wrong',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='handoff1';
        RAISE EXCEPTION 'wrong refund amount unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('wrong_refund_amount_rejected', true); END;
      BEGIN
        UPDATE "SupportRefundHandoff" SET "status"='completed',"revision"=3,"completedRefundId"='refund-pending',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='handoff1';
        RAISE EXCEPTION 'pending refund unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('pending_refund_rejected', true); END;
    END $$;
    UPDATE "CommerceOrder" SET "status"='partially_refunded',"refundedAmountCents"=7000,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='o1';
    UPDATE "SupportRefundHandoff" SET "status"='completed',"revision"=3,"completedRefundId"='refund-good',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='handoff1';
    INSERT INTO qa_result VALUES ('matching_processed_refund_accepted', (SELECT "status"='completed' FROM "SupportRefundHandoff" WHERE "id"='handoff1'));
    SELECT name || '=' || passed::text FROM qa_result ORDER BY name;
  `;
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-support-${runId}`;
  const schema = `g7_09b_${runId}`;
  const marker = `g7-support:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const env = isolatedEnvironment(tempRoot);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-support-disposable/v1", workPackage: "G7-09B", runId,
    status: "BLOCKED_OR_FAILED", startedAt: new Date().toISOString(), finishedAt: null,
    migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", constraints: "NOT_STARTED" },
    assertions: [], cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" }, failure: null,
    safety: { sourceEnvContentsRead: false, loopbackOnly: true, noPersistentVolume: true, syntheticFixturesOnly: true, productionSideEffects: false, rawOutputPersisted: false },
  };
  let containerId = null;
  try {
    if (!/^celebratedeal-g7-support-[a-f0-9]{16}$/u.test(name) || !/^g7_09b_[a-f0-9]{16}$/u.test(schema) || migrations.at(-1) !== "20260808220500_g7_09_support_cases") throw new Error("runner-contract-invalid");
    for (const directory of ["tmp", "profile", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
    if (run("docker", ["image", "inspect", image], env).exitCode !== 0) throw new Error("docker-image-unavailable");
    const created = run("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image,
    ], env);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) throw new Error("container-create-failed");
    containerId = created.stdout.trim();
    if (!waitForPostgres(containerId, env)) throw new Error("database-unreachable");
    const port = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(run("docker", ["port", containerId, "5432/tcp"], env).stdout)?.[1];
    if (!port) throw new Error("loopback-port-invalid");
    if (!markDatabase(containerId, marker, env)) throw new Error("database-marker-failed");
    if (psql(containerId, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env).exitCode !== 0) throw new Error("schema-marker-failed");
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
    const applied = psql(containerId, `SELECT count(*) FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`, env);
    if (applied.exitCode !== 0 || Number(applied.stdout.trim()) !== migrations.length) throw new Error("migration-count-mismatch");
    const constraints = psql(containerId, contractSql(schema), env);
    const assertions = constraints.stdout.trim().split(/\r?\n/u).filter(Boolean);
    receipt.assertions = assertions;
    const required = [
      "cross_tenant_member_rejected=true", "cross_tenant_order_rejected=true", "event_dedup_rejected=true", "handoff_identity_immutable=true",
      "matching_processed_refund_accepted=true", "mismatched_payment_rejected=true", "pending_refund_rejected=true",
      "remaining_balance_enforced=true", "revision_cas_one_winner=true", "wrong_refund_amount_rejected=true",
    ];
    receipt.phases.constraints = constraints.exitCode === 0 && required.every((value) => assertions.includes(value)) ? "PASS" : "FAIL";
    if (receipt.phases.constraints !== "PASS") throw new Error("constraint-contract-failed");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "unknown-error";
  } finally {
    if (containerId) {
      const actual = inspection(containerId, env);
      const fields = actual.stdout.replace(/\r?\n$/u, "").split("\t");
      const exact = actual.exitCode === 0 && fields[0] === containerId && fields[1]?.replace(/^\//u, "") === name
        && fields[2] === runId && fields[3] === marker && (fields[4] === "" || fields[4] === "tmpfs=/var/lib/postgresql/data");
      if (exact) {
        const removed = run("docker", ["rm", "-f", containerId], env);
        receipt.cleanup.container = removed.exitCode === 0 && run("docker", ["inspect", containerId], env).exitCode !== 0 ? "PASS" : "FAIL";
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
  if (receipt.status !== "PASS") throw new Error(`G7-09B disposable QA failed: ${receipt.failure ?? "cleanup-failed"}`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((receipt) => process.stdout.write(`${JSON.stringify({ status: receipt.status, migrationCount: receipt.migrationCount, assertions: receipt.assertions.length, cleanup: receipt.cleanup })}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "G7-09B disposable QA failed"}\n`);
    process.exitCode = 1;
  });
}
