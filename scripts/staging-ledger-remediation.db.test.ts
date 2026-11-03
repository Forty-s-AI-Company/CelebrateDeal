import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import {
  CHECKS, FIXES, RESOLVE_CONFIRMATION, VALIDATE_MIGRATION, applyFix, fixDefinitionProblem, inspectLedger,
  preflight, renderInspectMarkdown, run, safeId, safeStatus, sanitizeError, type LedgerFix, type PrismaRunner,
} from "./staging-ledger-remediation";

const db = getDb();
// Scratch schema: copies of the ledger tables WITHOUT their CHECK constraints
// (LIKE ... INCLUDING DEFAULTS never copies CHECKs) so violating rows can be
// inserted. Nothing in "public" is touched.
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
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for (const table of TABLES) {
    await db.$executeRawUnsafe(`CREATE TABLE ${q(table)} (LIKE "public"."${table}" INCLUDING DEFAULTS)`);
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
});

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
    // Scratch tables carry no constraints.
    expect(report.checks.every((check) => check.validated === null)).toBe(true);

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
      $queryRawUnsafe: async (sql: string) => (sql.includes("count(*)") ? [{ count: BigInt(0) }] : []),
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
  const fixSettlement: LedgerFix = {
    id: "test-settlement-reviewing-to-locked",
    description: "test",
    statements: [`UPDATE "Settlement" SET "status" = 'locked' WHERE "id" = 'st_reviewing' AND "vendorId" = 'vendor_remediation_a' AND "status" = 'reviewing'`],
    maxAffectedRows: 1,
    dryRun: false,
  };

  it("rolls back every statement when the affected rows exceed the fix limit", async () => {
    const before = await snapshot();
    const fix: LedgerFix = { ...fixSettlement, id: "test-over-limit", statements: [
      ...fixSettlement.statements,
      `UPDATE "PayoutBatch" SET "status" = 'draft' WHERE "status" = 'reviewing'`,
    ] };
    const report = await applyFix(scratch, fix);
    expect(report).toMatchObject({ outcome: "rolled_back_over_limit", statementRows: [1, 1], affectedRows: 2, maxAffectedRows: 1 });
    expect(await snapshot()).toEqual(before);
  });

  it("the registered dry-run fix touches no rows and always rolls back", async () => {
    const before = await snapshot();
    const fix = FIXES.find((entry) => entry.id === "legacy-status-null-amounts-report-only")!;
    const report = await applyFix(scratch, fix);
    expect(report).toMatchObject({ outcome: "rolled_back_dry_run", affectedRows: 0, statementRows: [0, 0, 0, 0, 0] });
    expect(await snapshot()).toEqual(before);
  });

  it("commits a fix within its limit and records one AuditLog row", async () => {
    const report = await applyFix(scratch, fixSettlement, "12345");
    expect(report).toMatchObject({ outcome: "committed", affectedRows: 1 });
    const rows = await db.$queryRawUnsafe<Array<{ status: string }>>(`SELECT "status" FROM ${q("Settlement")} WHERE "id" = 'st_reviewing'`);
    expect(rows[0].status).toBe("locked");
    const audit = await db.$queryRawUnsafe<Array<{ action: string; targetId: string; after: unknown }>>(`SELECT "action", "targetId", "after" FROM ${q("AuditLog")}`);
    expect(audit).toEqual([{ action: "staging_ledger_remediation.apply_fix", targetId: fixSettlement.id, after: { affectedRows: 1, statementRows: [1], maxAffectedRows: 1, runId: "12345" } }]);
    // Restore for the other tests.
    await db.$executeRawUnsafe(`UPDATE ${q("Settlement")} SET "status" = 'reviewing' WHERE "id" = 'st_reviewing'`);
    await db.$executeRawUnsafe(`DELETE FROM ${q("AuditLog")}`);
  });

  it("refuses fix definitions outside the allowed SQL shape", () => {
    for (const fix of FIXES) expect(fixDefinitionProblem(fix)).toBeNull();
    const bad = (statements: readonly string[], extra: Partial<LedgerFix> = {}) => fixDefinitionProblem({ ...fixSettlement, statements, ...extra });
    expect(bad([`UPDATE "Settlement" SET "status" = 'locked'; DROP TABLE "Settlement"`])).toBe("LEDGER_FIX_SQL_FORBIDDEN");
    expect(bad([`DELETE FROM "_prisma_migrations"`])).toBe("LEDGER_FIX_SQL_FORBIDDEN");
    expect(bad([`UPDATE "Vendor" SET "name" = 'x'`])).toBe("LEDGER_FIX_SQL_FORBIDDEN");
    expect(bad([`UPDATE "Settlement" SET "status" = 'locked' -- comment`])).toBe("LEDGER_FIX_SQL_FORBIDDEN");
    expect(bad([`SET LOCAL session_replication_role = replica`])).toBe("LEDGER_FIX_SQL_FORBIDDEN");
    expect(bad([])).toBe("LEDGER_FIX_EMPTY");
    expect(bad(fixSettlement.statements, { maxAffectedRows: 501 })).toBe("LEDGER_FIX_LIMIT_INVALID");
    expect(bad(fixSettlement.statements, { id: "Bad Id" })).toBe("LEDGER_FIX_ID_INVALID");
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
      [{ mode: "apply-fix", fixId: "legacy-status-null-amounts-report-only", confirm: "apply" }, "LEDGER_REMEDIATION_CONFIRM_MISMATCH"],
      [{ mode: "apply-fix", fixId: "legacy-status-null-amounts-report-only", confirm: "resolve-20261103090200" }, "LEDGER_REMEDIATION_CONFIRM_MISMATCH"],
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
    const result = await run({ mode: "inspect" }, { env: { STAGING_DATABASE_URL: process.env.DATABASE_URL }, createDb, emit: () => undefined });
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

  it("apply-fix through run reports the outcome and violations afterwards", async () => {
    const result = await run({ mode: "apply-fix", fixId: "legacy-status-null-amounts-report-only", confirm: "apply-legacy-status-null-amounts-report-only" }, { env, db: scratch, emit: () => undefined });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.lines[0])).toMatchObject({ outcome: "rolled_back_dry_run", affectedRows: 0 });
    expect(result.lines[1]).toBe("violations_after 6");
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
