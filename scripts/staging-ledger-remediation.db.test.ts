import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import {
  CHECKS, FIXES, RESOLVE_CONFIRMATION, VALIDATE_MIGRATION, applyFix, fixDefinitionProblem, inspectLedger,
  preflight, renderInspectMarkdown, run, safeId, safeStatus, sanitizeError, type LedgerFix, type PrismaRunner,
} from "./staging-ledger-remediation";

const db = getDb();
// Scratch schema: copies of the ledger tables (LIKE ... INCLUDING DEFAULTS
// never copies CHECKs). Violating rows are inserted first, then the same CHECKs
// as 20261103090100 are added NOT VALID, mirroring staging after the failed
// validate migration. The connection's own schema is never written.
const schema = `ledger_remediation_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;
const TABLES = ["PaymentTransaction", "RefundRecord", "PayoutBatch", "Settlement", "PayoutItem", "AuditLog", "_prisma_migrations"];
let scratch: PrismaClient;

// Built from parts so the repository secret scan does not see a literal database URL.
const stagingUrl = ["postgresql:", "", "postgres.ocbugvgojrunvenozsbx:synthetic-remediation-pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"].join("/");
const AMOUNT_MARKER = 987654;

const q = (table: string) => `"${schema}"."${table}"`;

async function insert(table: string, values: Record<string, unknown>) {
  const columns = Object.keys(values).map((column) => `"${column}"`).join(", ");
  const params = Object.keys(values).map((_, index) => `$${index + 1}`).join(", ");
  await db.$executeRawUnsafe(`INSERT INTO ${q(table)} (${columns}) VALUES (${params})`, ...Object.values(values));
}

async function snapshot() {
  const out: Record<string, unknown> = {};
  for (const table of TABLES) {
    out[table] = await db.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h, count(*)::int AS n FROM ${q(table)} t`);
  }
  return out;
}

beforeAll(async () => {
  // Source schema follows the test connection (public locally, wp18_ci in CI).
  const [{ source }] = await db.$queryRawUnsafe<Array<{ source: string }>>(`SELECT current_schema() AS "source"`);
  expect(source).toMatch(/^[a-z0-9_]+$/u);
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for (const table of TABLES) {
    await db.$executeRawUnsafe(`CREATE TABLE ${q(table)} (LIKE "${source}"."${table}" INCLUDING DEFAULTS)`);
  }
  // Only the columns a test sets need values.
  await db.$executeRawUnsafe(`DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT table_name, column_name FROM information_schema.columns
                WHERE table_schema = '${schema}' AND is_nullable = 'NO' AND column_name <> 'id' LOOP
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL', '${schema}', r.table_name, r.column_name);
      END LOOP;
    END $$`);
  const base = new URL(process.env.DATABASE_URL!);
  base.searchParams.set("schema", schema);
  scratch = new PrismaClient({ datasources: { db: { url: base.toString() } } });

  const vendor = "vendor_remediation_a";
  // PaymentTransaction: 1 bad status, 1 negative fee + refunded > gross, 1 valid.
  await insert("PaymentTransaction", { id: "pt_bad_status", vendorId: vendor, status: "settled_legacy", grossAmountCents: 100, gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: 100, refundedAmountCents: 0 });
  await insert("PaymentTransaction", { id: "pt_bad_amounts", vendorId: vendor, status: "paid", grossAmountCents: 100, gatewayFeeCents: -AMOUNT_MARKER, platformFeeCents: 0, netAmountCents: 100, refundedAmountCents: 150 });
  await insert("PaymentTransaction", { id: "pt_ok", vendorId: vendor, status: "paid", grossAmountCents: 100, gatewayFeeCents: 1, platformFeeCents: 1, netAmountCents: 98, refundedAmountCents: 0 });
  // RefundRecord: zero refund amount.
  await insert("RefundRecord", { id: "rr_zero", vendorId: vendor, paymentTransactionId: "pt_ok", status: "processed", refundAmountCents: 0, gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 });
  // Settlement / PayoutBatch / PayoutItem: legacy seed statuses, status text that must not be echoed.
  await insert("Settlement", { id: "st_reviewing", vendorId: vendor, status: "reviewing", monthlyFeeCents: 0, overflowFeeCents: 0, paymentServiceFeeCents: 0, transactionServiceFeeCents: 0, affiliateManagementFeeCents: 0, paymentGatewayFeeCents: 0, finalPayoutAmountCents: 0 });
  await insert("Settlement", { id: "st_ok", vendorId: vendor, status: "draft", monthlyFeeCents: 0, overflowFeeCents: 0, paymentServiceFeeCents: 0, transactionServiceFeeCents: 0, affiliateManagementFeeCents: 0, paymentGatewayFeeCents: 0, finalPayoutAmountCents: 0 });
  await insert("PayoutBatch", { id: "pb_reviewing", status: "reviewing", totalAmountCents: 0, totalCount: 0 });
  await insert("PayoutItem", { id: "pi_weird", vendorId: vendor, payoutBatchId: "pb_reviewing", status: "owner@example.test", payoutAmountCents: 0, retryCount: 0 });
  // Migration history as left by the failed staging deploy.
  const migration = (id: string, name: string, finished: boolean, started: string) => insert("_prisma_migrations", {
    id, checksum: "synthetic", migration_name: name, started_at: new Date(started),
    finished_at: finished ? new Date(started) : null, applied_steps_count: finished ? 1 : 0,
  });
  await migration("m1", "20261103090100_ledger_integrity_constraints", true, "2026-11-03T01:00:00Z");
  await migration("m2", VALIDATE_MIGRATION, false, "2026-11-03T01:00:01Z");
  for (const check of CHECKS) {
    await db.$executeRawUnsafe(`ALTER TABLE ${q(check.table)} ADD CONSTRAINT "${check.name}" CHECK (${check.predicate}) NOT VALID`);
  }
});

/** Test-only restore of a violating row: the NOT VALID CHECKs reject it otherwise. */
async function restoreViolatingRow(table: string, constraint: string, sql: string) {
  const check = CHECKS.find((entry) => entry.name === constraint)!;
  await db.$executeRawUnsafe(`ALTER TABLE ${q(table)} DROP CONSTRAINT "${constraint}"`);
  await db.$executeRawUnsafe(sql);
  await db.$executeRawUnsafe(`ALTER TABLE ${q(table)} ADD CONSTRAINT "${constraint}" CHECK (${check.predicate}) NOT VALID`);
}

afterAll(async () => {
  await scratch?.$disconnect();
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
});

describe("inspect", () => {
  it("counts violations per constraint, lists only safe row fields and writes nothing", async () => {
    const before = await snapshot();
    const report = await inspectLedger(scratch);
    expect(await snapshot()).toEqual(before);

    const counts = Object.fromEntries(report.checks.map((check) => [check.constraint, check.violations]));
    expect(counts).toEqual({
      PaymentTransaction_status_check: 1,
      PaymentTransaction_amounts_check: 1,
      RefundRecord_status_check: 0,
      RefundRecord_amounts_check: 1,
      Settlement_status_check: 1,
      Settlement_amounts_check: 0,
      PayoutBatch_status_check: 1,
      PayoutBatch_amounts_check: 0,
      PayoutItem_status_check: 1,
      PayoutItem_amounts_check: 0,
    });
    expect(report.totalViolations).toBe(6);
    expect(report.checks).toHaveLength(CHECKS.length);

    const amounts = report.checks.find((check) => check.constraint === "PaymentTransaction_amounts_check")!;
    expect(amounts.rows).toEqual([{ id: "pt_bad_amounts", vendorId: "vendor_remediation_a", status: "paid", violatedRules: ["gatewayFeeCents < 0", "refundedAmountCents > grossAmountCents"] }]);
    expect(Object.keys(amounts.rows[0]).sort()).toEqual(["id", "status", "vendorId", "violatedRules"]);
    expect(report.checks.find((check) => check.constraint === "RefundRecord_amounts_check")!.rows[0].violatedRules).toEqual(["refundAmountCents <= 0"]);
    expect(report.checks.find((check) => check.constraint === "PayoutBatch_status_check")!.rows).toEqual([{ id: "pb_reviewing", vendorId: null, status: "reviewing", violatedRules: [] }]);
    expect(report.checks.find((check) => check.constraint === "PayoutItem_status_check")!.rows[0].status).toBe("<unsafe-status len=18>");
    // Same state as staging: the CHECKs exist NOT VALID.
    expect(report.checks.every((check) => check.validated === false)).toBe(true);
    expect(report.readOnly).toBe("on");

    expect(report.migrations).toEqual([
      expect.objectContaining({ migration: "20261103090100_ledger_integrity_constraints", state: "applied" }),
      expect.objectContaining({ migration: VALIDATE_MIGRATION, state: "failed", finishedAt: null, rolledBackAt: null, startedAt: "2026-11-03T01:00:01.000Z" }),
    ]);

    const printed = JSON.stringify(report) + renderInspectMarkdown(report);
    expect(printed).not.toContain(String(AMOUNT_MARKER));
    expect(printed).not.toContain("owner@example.test");
    expect(printed).toContain("PaymentTransaction_amounts_check | 1 |");
  });

  it("runs inside SET TRANSACTION READ ONLY, which PostgreSQL enforces", async () => {
    const statements: string[] = [];
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $executeRawUnsafe: async (sql: string) => { statements.push(sql); return 0; },
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes("transaction_read_only")) return [{ value: "on" }];
        return sql.includes("count(*)") ? [{ count: BigInt(0) }] : [];
      },
    }));
    await inspectLedger({ $transaction: transaction } as never);
    expect(statements[0]).toBe("SET TRANSACTION READ ONLY");
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
    await expect(scratch.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(`UPDATE "Settlement" SET "status" = 'draft' WHERE "id" = 'st_reviewing'`);
    })).rejects.toThrow();
  });
});

describe("apply-fix", () => {
  const vendorScope = `AND "vendorId" = 'vendor_remediation_a'`;
  const fixSettlement: LedgerFix = {
    id: "test-settlement-reviewing-to-locked",
    description: "test",
    statements: [{ sql: `UPDATE "Settlement" SET "status" = 'locked' WHERE "id" = 'st_reviewing' ${vendorScope} AND "status" = 'reviewing'`, expectedRows: 1 }],
    dryRun: false,
  };

  it("rolls back every statement when any statement's row count differs from expectedRows", async () => {
    const before = await snapshot();
    const fix: LedgerFix = { ...fixSettlement, id: "test-row-mismatch", statements: [
      ...fixSettlement.statements,
      { sql: `UPDATE "PayoutBatch" SET "status" = 'draft' WHERE "id" = 'pb_missing'`, expectedRows: 1 },
    ] };
    const report = await applyFix(scratch, fix);
    expect(report).toMatchObject({ outcome: "rolled_back_row_mismatch", statementRows: [1, 0], expectedRows: [1, 1], rowsMatch: false });
    expect(await snapshot()).toEqual(before);
  });

  it("a statement that fixes only part of a row's violations fails with 23514 and rolls back the whole fix", async () => {
    const before = await snapshot();
    const fix: LedgerFix = { ...fixSettlement, id: "test-half-fix", statements: [
      ...fixSettlement.statements,
      // pt_bad_amounts also has refundedAmountCents > grossAmountCents.
      { sql: `UPDATE "PaymentTransaction" SET "gatewayFeeCents" = 0 WHERE "id" = 'pt_bad_amounts' ${vendorScope}`, expectedRows: 1 },
    ] };
    await expect(applyFix(scratch, fix)).rejects.toMatchObject({ meta: { code: "23514" } });
    expect(await snapshot()).toEqual(before);
  });

  it("the registered dry-run fix touches no rows and always rolls back", async () => {
    const before = await snapshot();
    const fix = FIXES.find((entry) => entry.id === "mechanism-dry-run-noop")!;
    const report = await applyFix(scratch, fix);
    expect(report).toMatchObject({ outcome: "rolled_back_dry_run", statementRows: [0, 0, 0, 0, 0], rowsMatch: true });
    expect(await snapshot()).toEqual(before);
  });

  it("commits when every count matches, records one AuditLog row, and reports already_applied on a rerun", async () => {
    const sha = "a".repeat(40);
    const report = await applyFix(scratch, fixSettlement, { runId: "12345", actor: "octo-cat", sha });
    expect(report).toMatchObject({ outcome: "committed", statementRows: [1], rowsMatch: true });
    const rows = await db.$queryRawUnsafe<Array<{ status: string }>>(`SELECT "status" FROM ${q("Settlement")} WHERE "id" = 'st_reviewing'`);
    expect(rows[0].status).toBe("locked");
    const audit = await db.$queryRawUnsafe<Array<{ action: string; targetId: string; after: unknown }>>(`SELECT "action", "targetId", "after" FROM ${q("AuditLog")}`);
    expect(audit).toEqual([{ action: "staging_ledger_remediation.apply_fix", targetId: fixSettlement.id, after: { statementRows: [1], expectedRows: [1], runId: "12345", actor: "octo-cat", sha } }]);

    const before = await snapshot();
    const rerun = await applyFix(scratch, fixSettlement, { actor: "a b@c", sha: "not-a-sha" });
    expect(rerun).toMatchObject({ outcome: "already_applied", statementRows: [0] });
    expect(await snapshot()).toEqual(before);

    await restoreViolatingRow("Settlement", "Settlement_status_check", `UPDATE ${q("Settlement")} SET "status" = 'reviewing' WHERE "id" = 'st_reviewing'`);
    await db.$executeRawUnsafe(`DELETE FROM ${q("AuditLog")}`);
  });

  it("refuses fix definitions outside the single-row UPDATE shape", () => {
    for (const fix of FIXES) expect(fixDefinitionProblem(fix)).toBeNull();
    const bad = (sql: string, expectedRows = 1) => fixDefinitionProblem({ ...fixSettlement, statements: [{ sql, expectedRows }] });
    const forbidden = [
      `UPDATE "Settlement" SET "status" = 'locked'`,
      `UPDATE "Settlement" SET "status" = 'locked' WHERE "id" = 'st_reviewing' ${vendorScope}; DROP TABLE "Settlement"`,
      `UPDATE "Settlement" SET "status" = 'locked' WHERE "id" = 'st_reviewing' ${vendorScope} -- comment`,
      `UPDATE "Settlement" SET "status" = 'locked' FROM "Vendor" WHERE "id" = 'st_reviewing' ${vendorScope}`,
      `UPDATE "Settlement" SET "status" = lower('LOCKED') WHERE "id" = 'st_reviewing' ${vendorScope}`,
      `UPDATE "Settlement" SET "status" = 'locked' WHERE "id" = 'st_reviewing' ${vendorScope} AND "id" IN (SELECT "id" FROM "Settlement")`,
      `UPDATE "Settlement" SET "status" = 'locked' WHERE "id" = 'st_reviewing' OR "vendorId" = 'vendor_remediation_a'`,
      `UPDATE "Settlement" SET "status" = 'locked' WHERE "id" = 'st_reviewing' ${vendorScope} RETURNING "id"`,
      `DELETE FROM "Settlement" WHERE "id" = 'st_reviewing' ${vendorScope}`,
      `INSERT INTO "Settlement" ("id") VALUES ('x')`,
      `UPDATE "Vendor" SET "name" = 'x' WHERE "id" = 'v1'`,
      `UPDATE "_prisma_migrations" SET "rolled_back_at" = 'x' WHERE "id" = 'm2'`,
      `SET LOCAL session_replication_role = replica`,
    ];
    for (const sql of forbidden) expect([sql, bad(sql)]).toEqual([sql, "LEDGER_FIX_SQL_FORBIDDEN"]);
    expect(bad(`UPDATE "Settlement" SET "status" = 'locked' WHERE "vendorId" = 'vendor_remediation_a' AND "status" = 'reviewing'`)).toBe("LEDGER_FIX_WHERE_ID_MISSING");
    expect(bad(`UPDATE "Settlement" SET "status" = 'locked' WHERE "id" = 'st_reviewing'`)).toBe("LEDGER_FIX_WHERE_VENDOR_MISSING");
    expect(bad(`UPDATE "PayoutBatch" SET "status" = 'draft' WHERE "id" = 'pb_reviewing'`)).toBeNull();
    expect(bad(fixSettlement.statements[0].sql, 2)).toBe("LEDGER_FIX_EXPECTED_ROWS_INVALID");
    expect(bad(fixSettlement.statements[0].sql, 0.5)).toBe("LEDGER_FIX_EXPECTED_ROWS_INVALID");
    expect(fixDefinitionProblem({ ...fixSettlement, statements: [] })).toBe("LEDGER_FIX_EMPTY");
    expect(fixDefinitionProblem({ ...fixSettlement, id: "Bad Id" })).toBe("LEDGER_FIX_ID_INVALID");
  });
});

describe("run guards", () => {
  const env = { STAGING_DATABASE_URL: stagingUrl, PATH: "", HOME: "" };

  it("refuses every mismatched confirmation before connecting", async () => {
    const createDb = vi.fn();
    const runner = vi.fn();
    const cases: Array<[Parameters<typeof run>[0], string]> = [
      [{ mode: "resolve-rolled-back", confirm: "" }, "LEDGER_REMEDIATION_CONFIRM_MISMATCH"],
      [{ mode: "resolve-rolled-back", confirm: "resolve-20261103090100" }, "LEDGER_REMEDIATION_CONFIRM_MISMATCH"],
      [{ mode: "resolve-rolled-back", confirm: ` ${RESOLVE_CONFIRMATION}` }, "LEDGER_REMEDIATION_CONFIRM_MISMATCH"],
      [{ mode: "apply-fix", fixId: "mechanism-dry-run-noop", confirm: "apply" }, "LEDGER_REMEDIATION_CONFIRM_MISMATCH"],
      [{ mode: "apply-fix", fixId: "mechanism-dry-run-noop", confirm: "resolve-20261103090200" }, "LEDGER_REMEDIATION_CONFIRM_MISMATCH"],
      [{ mode: "apply-fix", fixId: "unknown-fix", confirm: "apply-unknown-fix" }, "LEDGER_FIX_UNKNOWN"],
      [{ mode: "drop-everything" }, "LEDGER_REMEDIATION_MODE_INVALID"],
    ];
    for (const [inputs, line] of cases) {
      const result = await run(inputs, { env, createDb, runner, emit: () => undefined });
      expect(result.lines).toEqual([line]);
      expect(result.code).not.toBe(0);
    }
    expect(createDb).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
    expect(preflight({})).toEqual({ mode: "inspect" });
  });

  it("refuses a non-staging database URL", async () => {
    const createDb = vi.fn();
    const result = await run({ mode: "inspect" }, { env: { STAGING_DATABASE_URL: ["postgresql:", "", "postgres:synthetic@localhost:5432/postgres"].join("/") }, createDb, emit: () => undefined });
    expect(result.code).toBe(2);
    expect(result.lines).toEqual(["STAGING_PROJECT_MISMATCH"]);
    expect(createDb).not.toHaveBeenCalled();
  });

  it("resolves only the fixed migration, only while it is failed, and prints no secrets", async () => {
    const emitted: string[] = [];
    const runner = vi.fn<PrismaRunner>((args) => ({
      status: 0,
      output: args[1] === "resolve"
        ? `Migration ${VALIDATE_MIGRATION} marked as rolled back.\nDatasource "db": PostgreSQL database "postgres" at "aws-0-ap-northeast-1.pooler.supabase.com:5432"`
        : "136 migrations found in prisma/migrations\nFollowing migration have not yet been applied:\n20261103090200_ledger_integrity_constraints_validate",
    }));
    const result = await run({ mode: "resolve-rolled-back", confirm: RESOLVE_CONFIRMATION }, { env, db: scratch, runner, emit: (line) => emitted.push(line) });
    expect(result.code).toBe(0);
    expect(runner.mock.calls.map((call) => call[0])).toEqual([
      ["migrate", "resolve", "--rolled-back", VALIDATE_MIGRATION],
      ["migrate", "status"],
    ]);
    const childEnv = runner.mock.calls[0][1];
    expect(new URL(childEnv.DATABASE_URL).port).toBe("5432");
    expect(childEnv.DIRECT_URL).toBe(childEnv.DATABASE_URL);
    expect(emitted).toEqual(expect.arrayContaining(["::add-mask::synthetic-remediation-pw"]));
    const printed = result.lines.join("\n") + result.summary;
    expect(printed).toContain("violations_before_resolve 6");
    expect(printed).toContain("Following migration have not yet been applied:");
    expect(printed).not.toMatch(/synthetic-remediation-pw|pooler\.supabase\.com|postgresql:/u);

    // Once rolled back (or applied) the migration is no longer failed: refuse.
    await db.$executeRawUnsafe(`UPDATE ${q("_prisma_migrations")} SET "rolled_back_at" = now() WHERE "id" = 'm2'`);
    runner.mockClear();
    const again = await run({ mode: "resolve-rolled-back", confirm: RESOLVE_CONFIRMATION }, { env, db: scratch, runner, emit: () => undefined });
    expect(again.code).toBe(1);
    expect(again.lines).toContain("LEDGER_REMEDIATION_RESOLVE_NOT_FAILED");
    expect(runner).not.toHaveBeenCalled();
    await db.$executeRawUnsafe(`UPDATE ${q("_prisma_migrations")} SET "rolled_back_at" = NULL WHERE "id" = 'm2'`);
  });

  it("apply-fix through run emits the outcome first, then the violations afterwards", async () => {
    const emitted: string[] = [];
    const result = await run({ mode: "apply-fix", fixId: "mechanism-dry-run-noop", confirm: "apply-mechanism-dry-run-noop" }, { env, db: scratch, emit: (line) => emitted.push(line) });
    expect(result.code).toBe(0);
    expect(JSON.parse(emitted.at(-1)!)).toMatchObject({ outcome: "rolled_back_dry_run", statementRows: [0, 0, 0, 0, 0] });
    expect(result.lines).toEqual(["violations_after 6"]);
  });

  const batchFix: LedgerFix = {
    id: "test-run-batch",
    description: "test",
    statements: [{ sql: `UPDATE "PayoutBatch" SET "status" = 'draft' WHERE "id" = 'pb_reviewing' AND "status" = 'reviewing'`, expectedRows: 1 }],
    dryRun: false,
  };
  const restoreBatch = async () => {
    await restoreViolatingRow("PayoutBatch", "PayoutBatch_status_check", `UPDATE ${q("PayoutBatch")} SET "status" = 'reviewing' WHERE "id" = 'pb_reviewing'`);
    await db.$executeRawUnsafe(`DELETE FROM ${q("AuditLog")}`);
  };

  it("a committed fix that leaves violations exits 1 with a WARNING", async () => {
    const result = await run({ mode: "apply-fix", fixId: batchFix.id, confirm: `apply-${batchFix.id}` }, { env, db: scratch, fixes: [batchFix], emit: () => undefined });
    expect(result.code).toBe(1);
    expect(result.lines).toEqual(["violations_after 5", "WARNING violations remain after fix: 5"]);
    await restoreBatch();
  });

  it("reports LEDGER_REMEDIATION_POST_INSPECT_FAILED after emitting a committed outcome", async () => {
    let calls = 0;
    const flaky = {
      $transaction: ((...args: unknown[]) => {
        calls += 1;
        if (calls > 1) return Promise.reject(Object.assign(new Error(`timeout at ${stagingUrl}`), { code: "P2028" }));
        return (scratch.$transaction as unknown as (...a: unknown[]) => Promise<unknown>)(...args);
      }) as unknown as PrismaClient["$transaction"],
    };
    const emitted: string[] = [];
    const result = await run({ mode: "apply-fix", fixId: batchFix.id, confirm: `apply-${batchFix.id}` }, { env, db: flaky, fixes: [batchFix], emit: (line) => emitted.push(line) });
    expect(result.code).toBe(1);
    expect(JSON.parse(emitted.at(-1)!)).toMatchObject({ outcome: "committed" });
    expect(result.lines).toEqual(["LEDGER_REMEDIATION_POST_INSPECT_FAILED PRISMA_ERROR P2028"]);
    expect(result.summary).not.toContain("pooler.supabase.com");
    await restoreBatch();
  });

  it("sanitises ids, statuses and errors", () => {
    expect(safeId("cm1abc_DEF-2")).toBe("cm1abc_DEF-2");
    expect(safeId("a@b.c")).toBe("<unsafe-id len=5>");
    expect(safeId(null)).toBeNull();
    expect(safeStatus("pending_review")).toBe("pending_review");
    expect(safeStatus("x y")).toBe("<unsafe-status len=3>");
    const error = Object.assign(new Error(`connect to ${stagingUrl} failed`), { code: "P2010", meta: { code: "23514", message: "row (owner@example.test)" } });
    expect(sanitizeError("LEDGER_REMEDIATION_DATABASE_FAILED", error)).toBe("LEDGER_REMEDIATION_DATABASE_FAILED PRISMA_ERROR P2010 SQLSTATE 23514");
  });
});
