import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const runId = randomBytes(6).toString("hex");
const schema = `wp118_${runId}`;
const marker = `celebratedeal:wp118:${runId}`;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`;
const adminUrl = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci";
const syntheticEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  CI: "true",
  NEXT_TELEMETRY_DISABLED: "1",
};

function sanitize(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/(?:password|token|secret|key)\s*[=:]\s*[^\s,}]+/gi, "$1=[REDACTED]");
}

function run(command, args, env = syntheticEnv) {
  try {
    return execFileSync(command, args, {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    const stdout = error?.stdout ? sanitize(error.stdout) : "";
    const stderr = error?.stderr ? sanitize(error.stderr) : "";
    throw new Error(`${command} failed: ${stdout}\n${stderr}`.trim());
  }
}

function psql(sql) {
  return run("psql.exe", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

let schemaCreated = false;
let migrationCount = 0;
let prisma;
let result;
let cleanupStatus = "NOT_RUN";
try {
  psql(`CREATE SCHEMA IF NOT EXISTS "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`);
  schemaCreated = true;
  if (process.platform === "win32") {
    run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npx prisma migrate deploy --schema prisma/schema.prisma"]);
  } else {
    run("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]);
  }
  migrationCount = 13;

  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const { reconcilePayUniRefund } = await import("../src/lib/payuni-refund-reconciliation.ts");
  const snapshot = {
    providerTradeNo: "trade-wp118-001",
    orderNumber: "CD-WP118-001",
    grossAmountCents: 168000,
    refundedAmountCents: 168000,
    remainingRefundableAmountCents: 0,
    status: "refunded",
  };
  const vendor = await prisma.vendor.create({
    data: { name: "WP-118 Synthetic Vendor", slug: `wp118-${runId}`, email: `wp118-${runId}@invalid.test`, passwordHash: "synthetic-only" },
  });
  const transaction = await prisma.paymentTransaction.create({
    data: {
      vendorId: vendor.id,
      providerName: "payuni",
      providerTradeNo: snapshot.providerTradeNo,
      orderNumber: snapshot.orderNumber,
      grossAmountCents: snapshot.grossAmountCents,
      refundedAmountCents: 84000,
      status: "partially_refunded",
    },
  });
  await prisma.refundRecord.createMany({
    data: [
      { vendorId: vendor.id, paymentTransactionId: transaction.id, providerEventId: "provider-close-wp118", monthKey: "2026-08", refundAmountCents: 84000, status: "processed" },
      { vendorId: vendor.id, paymentTransactionId: transaction.id, providerEventId: `request:${"b".repeat(32)}`, monthKey: "2026-08", refundAmountCents: 84000, status: "pending" },
    ],
  });
  const actor = { id: "wp118-synthetic-admin", label: "platform_admin" };
  const reconciled = await reconcilePayUniRefund({ db: prisma, transactionId: transaction.id, providerSnapshot: snapshot, actor });
  const after = await prisma.paymentTransaction.findUnique({ where: { id: transaction.id }, include: { refunds: true } });
  const auditCountAfterFirst = await prisma.auditLog.count({ where: { action: "reconcile_payuni_refund", targetId: transaction.id } });
  if (reconciled.disposition !== "reconciled" || after?.status !== "refunded" || after.refundedAmountCents !== 168000 || after.refunds.some((refund) => refund.status === "pending") || auditCountAfterFirst !== 1) {
    throw new Error("WP-118 success invariant failed");
  }

  const duplicate = await reconcilePayUniRefund({ db: prisma, transactionId: transaction.id, providerSnapshot: snapshot, actor });
  const auditCountAfterDuplicate = await prisma.auditLog.count({ where: { action: "reconcile_payuni_refund", targetId: transaction.id } });
  if (duplicate.disposition !== "already_reconciled" || auditCountAfterDuplicate !== 1) throw new Error("WP-118 duplicate no-op failed");

  const invalid = await prisma.paymentTransaction.create({
    data: { vendorId: vendor.id, providerName: "payuni", providerTradeNo: "trade-wp118-invalid", orderNumber: "CD-WP118-INVALID", grossAmountCents: 168000, status: "failed" },
  });
  await prisma.refundRecord.create({ data: { vendorId: vendor.id, paymentTransactionId: invalid.id, providerEventId: `request:${"c".repeat(32)}`, monthKey: "2026-08", refundAmountCents: 168000, status: "pending" } });
  await expectReject(reconcilePayUniRefund({ db: prisma, transactionId: invalid.id, providerSnapshot: { ...snapshot, providerTradeNo: "trade-wp118-invalid", orderNumber: "CD-WP118-INVALID" }, actor }));
  const invalidAfter = await prisma.paymentTransaction.findUnique({ where: { id: invalid.id }, include: { refunds: true } });
  const invalidAuditCount = await prisma.auditLog.count({ where: { action: "reconcile_payuni_refund", targetId: invalid.id } });
  if (invalidAfter?.status !== "failed" || invalidAfter.refunds.some((refund) => refund.status !== "pending") || invalidAuditCount !== 0) throw new Error("WP-118 invalid-state write occurred");

  const rollback = await prisma.paymentTransaction.create({
    data: { vendorId: vendor.id, providerName: "payuni", providerTradeNo: "trade-wp118-rollback", orderNumber: "CD-WP118-ROLLBACK", grossAmountCents: 168000, refundedAmountCents: 84000, status: "partially_refunded" },
  });
  await prisma.refundRecord.create({ data: { vendorId: vendor.id, paymentTransactionId: rollback.id, providerEventId: `request:${"d".repeat(32)}`, monthKey: "2026-08", refundAmountCents: 84000, status: "pending" } });
  const failingDb = {
    ...prisma,
    $transaction: (callback, options) => prisma.$transaction((tx) => callback({ ...tx, auditLog: { ...tx.auditLog, create: async () => { throw new Error("synthetic audit failure"); } } }), options),
  };
  await expectReject(reconcilePayUniRefund({ db: failingDb, transactionId: rollback.id, providerSnapshot: { ...snapshot, providerTradeNo: "trade-wp118-rollback", orderNumber: "CD-WP118-ROLLBACK" }, actor }));
  const rollbackAfter = await prisma.paymentTransaction.findUnique({ where: { id: rollback.id }, include: { refunds: true } });
  if (rollbackAfter?.status !== "partially_refunded" || rollbackAfter.refundedAmountCents !== 84000 || rollbackAfter.refunds.some((refund) => refund.status !== "pending") || await prisma.auditLog.count({ where: { action: "reconcile_payuni_refund", targetId: rollback.id } }) !== 0) throw new Error("WP-118 transaction rollback failed");

  result = {
    work_package: "WP-118",
    status: "PASS",
    database: { host: "127.0.0.1", port: 54329, database: "celebratedeal_ci", schema_prefix: "wp118_", source_env_contents_read: false, synthetic_fixture_only: true },
    migrations: { canonical_count: migrationCount, applied: true },
    cases: { success_reconciled: true, invalid_state_zero_write: true, serializable_rollback: true, duplicate_noop_single_audit: true },
    cleanup: { marker_required: true, status: "PENDING" },
  };
} finally {
  if (prisma) await prisma.$disconnect();
  if (schemaCreated) {
    try {
      psql(`DO $$ BEGIN IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = '${schema}') IS DISTINCT FROM '${marker}' THEN RAISE EXCEPTION 'WP-118 schema marker mismatch'; END IF; EXECUTE 'DROP SCHEMA "${schema}" CASCADE'; END $$;`);
      cleanupStatus = "PASS";
    } catch (error) {
      console.error(sanitize(error?.message ?? error));
      cleanupStatus = "FAIL";
      process.exitCode = 1;
    }
  }
}

if (result) {
  result.cleanup.status = cleanupStatus;
  console.log(JSON.stringify(result));
}

async function expectReject(promise) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error("Expected reconciliation rejection");
}
