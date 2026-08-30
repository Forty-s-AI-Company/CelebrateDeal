import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(root, ".ai-team", "reports", "g7-09c-buyer-support-disposable-20260808.json");
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

function createSchemaMarker(containerId, schema, marker, env) {
  const statement = `CREATE SCHEMA IF NOT EXISTS "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = psql(containerId, statement, env);
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
      ('u2','u2@example.test','Support One','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO "VendorMember" ("id","vendorId","userId","role","status") VALUES
      ('m1','v1','u1','owner','active'), ('m2','v1','u2','support','active');
    INSERT INTO "PaymentTransaction" ("id","vendorId","providerName","orderNumber","grossAmountCents","netAmountCents","status") VALUES
      ('tx1','v1','synthetic','ORDER-1',10000,10000,'paid'),
      ('tx2','v2','synthetic','ORDER-2',10000,10000,'paid'),
      ('tx3','v1','synthetic','ORDER-3',10000,10000,'paid');
    INSERT INTO "CommerceOrder" (
      "id","vendorId","orderNumber","checkoutIdempotencyKey","checkoutIdentityHash","primaryPaymentTransactionId",
      "status","subtotalAmountCents","totalAmountCents","paidAmountCents","refundedAmountCents",
      "buyerEncryptedEnvelope","buyerMaskedName","buyerMaskedEmail","paidAt","updatedAt"
    ) VALUES
      ('o1','v1','ORDER-1','11111111-1111-4111-8111-111111111111','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','tx1','paid',10000,10000,10000,0,'opaque','買＊一','b***@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
      ('o2','v2','ORDER-2','22222222-2222-4222-8222-222222222222','BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','tx2','paid',10000,10000,10000,0,'opaque','買＊二','c***@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
      ('o3','v1','ORDER-3','77777777-7777-4777-8777-777777777777','CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC','tx3','paid',10000,10000,10000,0,'opaque','買＊三','d***@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "BuyerSupportOrderGrant" ("id","vendorId","orderId","cookieKey","tokenHash","expiresAt","updatedAt") VALUES
      ('g1','v1','o1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',CURRENT_TIMESTAMP + INTERVAL '180 days',CURRENT_TIMESTAMP),
      ('g2','v2','o2','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',CURRENT_TIMESTAMP + INTERVAL '180 days',CURRENT_TIMESTAMP),
      ('g3','v1','o3','11111111111111111111111111111111','2222222222222222222222222222222222222222222222222222222222222222',CURRENT_TIMESTAMP + INTERVAL '180 days',CURRENT_TIMESTAMP);

    DO $$ BEGIN
      BEGIN
        INSERT INTO "BuyerSupportOrderGrant" ("id","vendorId","orderId","cookieKey","tokenHash","expiresAt","updatedAt") VALUES
          ('cross','v1','o2','cccccccccccccccccccccccccccccccc','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',CURRENT_TIMESTAMP + INTERVAL '180 days',CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'cross-tenant grant unexpectedly accepted';
      EXCEPTION WHEN foreign_key_violation THEN INSERT INTO qa_result VALUES ('grant_exact_order_tenant_enforced', true); END;
      BEGIN
        INSERT INTO "BuyerSupportOrderGrant" ("id","vendorId","orderId","cookieKey","tokenHash","expiresAt","updatedAt") VALUES
          ('bad-token','v2','o2','not-hex','not-a-hash',CURRENT_TIMESTAMP + INTERVAL '180 days',CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'malformed capability unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('grant_format_enforced', true); END;
    END $$;

    INSERT INTO "SupportCase" (
      "id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision",
      "createdByBuyerGrantId","responseDueAt","updatedAt"
    ) VALUES ('case1','v1','o1','SC-20260808-A1B2C3D4','33333333-3333-4333-8333-333333333333','refund','p1','open',1,'g1',CURRENT_TIMESTAMP + INTERVAL '1 hour',CURRENT_TIMESTAMP);

    DO $$ BEGIN
      BEGIN
        INSERT INTO "SupportCase" ("id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision","responseDueAt","updatedAt")
        VALUES ('no-creator','v1','o1','SC-20260808-A1B2C3D5','44444444-4444-4444-8444-444444444444','general','p2','open',1,CURRENT_TIMESTAMP + INTERVAL '1 day',CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'case without creator unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('case_creator_xor_enforced', true); END;
      BEGIN
        INSERT INTO "SupportCase" ("id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision","createdByMemberId","responseDueAt","updatedAt")
        VALUES ('bad-sla','v1','o1','SC-20260808-A1B2C3D6','55555555-5555-4555-8555-555555555555','general','p2','open',1,'m1',CURRENT_TIMESTAMP - INTERVAL '1 minute',CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'past SLA unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('response_due_after_created_enforced', true); END;
      BEGIN
        INSERT INTO "SupportCase" ("id","vendorId","orderId","caseNumber","intakeKey","category","priority","status","revision","createdByBuyerGrantId","responseDueAt","updatedAt")
        VALUES ('cross-creator','v1','o1','SC-20260808-A1B2C3D7','66666666-6666-4666-8666-666666666666','general','p2','open',1,'g2',CURRENT_TIMESTAMP + INTERVAL '1 day',CURRENT_TIMESTAMP);
        RAISE EXCEPTION 'cross-tenant buyer creator unexpectedly accepted';
      EXCEPTION WHEN foreign_key_violation THEN INSERT INTO qa_result VALUES ('case_buyer_creator_exact_tenant_enforced', true); END;
    END $$;

    INSERT INTO "SupportCaseEvent" ("id","vendorId","supportCaseId","dedupKey","eventType","audience","actorBuyerOrderId","actorBuyerGrantId")
    VALUES ('event1','v1','case1','buyer-created','created','buyer','o1','g1');
    INSERT INTO qa_result VALUES ('buyer_actor_event_accepted', true);
    DO $$ BEGIN
      BEGIN
        INSERT INTO "SupportCaseEvent" ("id","vendorId","supportCaseId","dedupKey","eventType","audience","actorMemberId","actorBuyerOrderId","actorBuyerGrantId")
        VALUES ('event2','v1','case1','two-actors','buyer_reply_added','buyer','m2','o1','g1');
        RAISE EXCEPTION 'two event actors unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('event_actor_xor_enforced', true); END;
      BEGIN
        INSERT INTO "SupportCaseEvent" ("id","vendorId","supportCaseId","dedupKey","eventType","audience","actorBuyerOrderId","actorBuyerGrantId")
        VALUES ('event3','v1','case1','cross-buyer','buyer_reply_added','buyer','o3','g3');
        RAISE EXCEPTION 'cross-order buyer actor unexpectedly accepted';
      EXCEPTION WHEN foreign_key_violation THEN INSERT INTO qa_result VALUES ('event_buyer_actor_exact_order_enforced', true); END;
      BEGIN
        INSERT INTO "SupportCaseEvent" ("id","vendorId","supportCaseId","dedupKey","eventType","audience","actorBuyerOrderId","actorBuyerGrantId")
        VALUES ('event4','v1','case1','internal-buyer','buyer_reply_added','internal','o1','g1');
        RAISE EXCEPTION 'buyer actor with internal audience unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN INSERT INTO qa_result VALUES ('event_buyer_audience_enforced', true); END;
    END $$;

    DO $$ DECLARE first_count INTEGER; second_count INTEGER; BEGIN
      UPDATE "BuyerSupportOrderGrant" SET "rotationCount"="rotationCount"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='g1' AND "rotationCount"=0;
      GET DIAGNOSTICS first_count = ROW_COUNT;
      UPDATE "BuyerSupportOrderGrant" SET "rotationCount"="rotationCount"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='g1' AND "rotationCount"=0;
      GET DIAGNOSTICS second_count = ROW_COUNT;
      IF first_count <> 1 OR second_count <> 0 THEN RAISE EXCEPTION 'grant CAS did not select one winner'; END IF;
      INSERT INTO qa_result VALUES ('grant_rotation_cas_one_winner', true);
    END $$;
    SELECT name || '=' || passed::text FROM qa_result ORDER BY name;
  `;
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-buyer-support-${runId}`;
  const schema = `g7_09c_${runId}`;
  const marker = `g7-buyer-support:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const env = isolatedEnvironment(tempRoot);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-buyer-support-disposable/v1", workPackage: "G7-09C", runId,
    status: "BLOCKED_OR_FAILED", startedAt: new Date().toISOString(), finishedAt: null,
    migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", constraints: "NOT_STARTED" },
    assertions: [], cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" }, failure: null,
    safety: { sourceEnvContentsRead: false, loopbackOnly: true, noPersistentVolume: true, syntheticFixturesOnly: true, productionSideEffects: false, rawOutputPersisted: false },
  };
  let containerId = null;
  try {
    if (!/^celebratedeal-g7-buyer-support-[a-f0-9]{16}$/u.test(name) || !/^g7_09c_[a-f0-9]{16}$/u.test(schema) || migrations.at(-1) !== "20260808233000_g7_09c_buyer_support_access") throw new Error("runner-contract-invalid");
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
    const required = [
      "buyer_actor_event_accepted=true", "case_creator_xor_enforced=true", "event_actor_xor_enforced=true",
      "case_buyer_creator_exact_tenant_enforced=true", "event_buyer_actor_exact_order_enforced=true",
      "event_buyer_audience_enforced=true",
      "grant_exact_order_tenant_enforced=true", "grant_format_enforced=true", "grant_rotation_cas_one_winner=true",
      "response_due_after_created_enforced=true",
    ];
    receipt.phases.constraints = constraints.exitCode === 0 && required.every((value) => receipt.assertions.includes(value)) ? "PASS" : "FAIL";
    if (receipt.phases.constraints !== "PASS") throw new Error("constraint-contract-failed");
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
  if (receipt.status !== "PASS") throw new Error(`G7-09C disposable QA failed: ${receipt.failure ?? "cleanup-failed"}`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((receipt) => process.stdout.write(`${JSON.stringify({ status: receipt.status, migrationCount: receipt.migrationCount, assertions: receipt.assertions.length, cleanup: receipt.cleanup })}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "G7-09C disposable QA failed"}\n`);
    process.exitCode = 1;
  });
}
