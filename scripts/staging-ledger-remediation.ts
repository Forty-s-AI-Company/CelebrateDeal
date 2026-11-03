/**
 * Staging ledger remediation for the failed
 * `20261103090200_ledger_integrity_constraints_validate` migration (F-062).
 * Run only from the protected "Staging ledger remediation" workflow; the
 * database URL comes from that GitHub environment and is never printed.
 *
 * Modes (LEDGER_REMEDIATION_MODE):
 * - inspect (default): one `SET TRANSACTION READ ONLY` repeatable-read
 *   snapshot. Per CHECK constraint of 20261103090100 it reports the violating
 *   row count and, for at most ROW_LIMIT rows, only the row id, vendorId,
 *   status value and which amount rules fail (column names and whether the
 *   value is negative; never the amount itself). It also lists the
 *   `_prisma_migrations` rows of the three ledger migrations and whether each
 *   constraint is validated.
 * - resolve-rolled-back: `prisma migrate resolve --rolled-back` for the fixed
 *   migration name below, then `prisma migrate status`. Needs
 *   LEDGER_REMEDIATION_CONFIRM = "resolve-20261103090200" and refuses unless
 *   that migration is currently recorded as failed.
 * - apply-fix: runs one fix registered in FIXES (reviewed in a PR) inside a
 *   transaction, commits only when the affected row count is within the fix's
 *   maxAffectedRows, and writes one AuditLog row. Needs
 *   LEDGER_REMEDIATION_FIX_ID and LEDGER_REMEDIATION_CONFIRM = "apply-<fix id>".
 *
 * The repository is public, so every printed line is public: output carries
 * only fixed codes, constraint and column names, opaque row ids, status
 * values restricted to a safe character set, counts, booleans, timestamps and
 * allowlisted Prisma summary lines. No connection string, host, e-mail, name
 * or amount is ever printed; errors are reduced to a fixed code plus the
 * Prisma error code and SQLSTATE.
 *
 * Exit code 0 = done, 1 = refused or failed, 2 = configuration error.
 */
import { spawnSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { maskCommands, parseStagingDatabaseUrl, sanitizePrismaOutput } from "./staging-migrate.mjs";

export const REMEDIATION_SCHEMA_VERSION = "celebratedeal-staging-ledger-remediation/v1";
export const VALIDATE_MIGRATION = "20261103090200_ledger_integrity_constraints_validate";
export const RESOLVE_CONFIRMATION = "resolve-20261103090200";
export const LEDGER_MIGRATIONS = [
  "20261103090000_ledger_aggregate_amounts_bigint",
  "20261103090100_ledger_integrity_constraints",
  VALIDATE_MIGRATION,
] as const;
export const MODES = ["inspect", "resolve-rolled-back", "apply-fix"] as const;
export type Mode = (typeof MODES)[number];
export const ROW_LIMIT = 200;
/** Hard ceiling for any registered fix, whatever its own limit says. */
export const MAX_FIX_ROWS = 500;

type Term = { rule: string; sql: string };
export type CheckSpec = {
  name: string;
  table: "PaymentTransaction" | "RefundRecord" | "PayoutBatch" | "Settlement" | "PayoutItem";
  /** The exact CHECK expression of 20261103090100 (runbook section 7). */
  predicate: string;
  hasVendor: boolean;
  /** Amount checks only: one entry per AND-ed term, as the violated condition. */
  terms: Term[];
};

const statusIn = (values: string[]) => `"status" IN (${values.map((value) => `'${value}'`).join(", ")})`;
const negative = (column: string): Term => ({ rule: `${column} < 0`, sql: `"${column}" < 0` });

export const CHECKS: readonly CheckSpec[] = Object.freeze([
  {
    name: "PaymentTransaction_status_check", table: "PaymentTransaction", hasVendor: true, terms: [],
    predicate: statusIn(["pending", "paid", "failed", "expired", "partially_refunded", "refunded"]),
  },
  {
    name: "PaymentTransaction_amounts_check", table: "PaymentTransaction", hasVendor: true,
    predicate: `"grossAmountCents" >= 0 AND "gatewayFeeCents" >= 0 AND "platformFeeCents" >= 0
      AND "netAmountCents" >= 0 AND "refundedAmountCents" >= 0
      AND "refundedAmountCents" <= "grossAmountCents"`,
    terms: [
      ...["grossAmountCents", "gatewayFeeCents", "platformFeeCents", "netAmountCents", "refundedAmountCents"].map(negative),
      { rule: "refundedAmountCents > grossAmountCents", sql: `"refundedAmountCents" > "grossAmountCents"` },
    ],
  },
  {
    name: "RefundRecord_status_check", table: "RefundRecord", hasVendor: true, terms: [],
    predicate: statusIn(["pending", "processed", "failed"]),
  },
  {
    name: "RefundRecord_amounts_check", table: "RefundRecord", hasVendor: true,
    predicate: `"refundAmountCents" > 0 AND "gatewayFeeRefundCents" >= 0 AND "platformFeeRefundCents" >= 0`,
    terms: [
      { rule: "refundAmountCents <= 0", sql: `"refundAmountCents" <= 0` },
      negative("gatewayFeeRefundCents"),
      negative("platformFeeRefundCents"),
    ],
  },
  {
    name: "Settlement_status_check", table: "Settlement", hasVendor: true, terms: [],
    predicate: statusIn(["draft", "locked", "ready_for_payout", "paid"]),
  },
  {
    name: "Settlement_amounts_check", table: "Settlement", hasVendor: true,
    predicate: `"monthlyFeeCents" >= 0 AND "overflowFeeCents" >= 0 AND "paymentServiceFeeCents" >= 0
      AND "transactionServiceFeeCents" >= 0 AND "affiliateManagementFeeCents" >= 0
      AND "paymentGatewayFeeCents" >= 0 AND "finalPayoutAmountCents" >= 0`,
    terms: ["monthlyFeeCents", "overflowFeeCents", "paymentServiceFeeCents", "transactionServiceFeeCents",
      "affiliateManagementFeeCents", "paymentGatewayFeeCents", "finalPayoutAmountCents"].map(negative),
  },
  {
    name: "PayoutBatch_status_check", table: "PayoutBatch", hasVendor: false, terms: [],
    predicate: statusIn(["draft", "exported", "retrying", "failed", "completed"]),
  },
  {
    name: "PayoutBatch_amounts_check", table: "PayoutBatch", hasVendor: false,
    predicate: `"totalAmountCents" >= 0 AND "totalCount" >= 0`,
    terms: [negative("totalAmountCents"), negative("totalCount")],
  },
  {
    name: "PayoutItem_status_check", table: "PayoutItem", hasVendor: true, terms: [],
    predicate: statusIn(["pending", "paid", "failed", "retrying"]),
  },
  {
    name: "PayoutItem_amounts_check", table: "PayoutItem", hasVendor: true,
    predicate: `"payoutAmountCents" >= 0 AND "retryCount" >= 0`,
    terms: [negative("payoutAmountCents"), negative("retryCount")],
  },
]);

/**
 * A data fix registered by PR. The statements run in order inside one
 * transaction; their summed row counts must stay within maxAffectedRows or
 * the whole transaction rolls back. A dryRun fix always rolls back.
 * Each statement should be a single-row-scoped UPDATE keyed by id (and
 * vendorId), written after an inspect run showed the exact rows.
 */
export type LedgerFix = {
  id: string;
  description: string;
  statements: readonly string[];
  maxAffectedRows: number;
  dryRun: boolean;
};

const STATUS_TABLES = ["PaymentTransaction", "RefundRecord", "PayoutBatch", "Settlement", "PayoutItem"];

export const FIXES: readonly LedgerFix[] = Object.freeze([
  {
    id: "legacy-status-null-amounts-report-only",
    description: "機制驗證：對五張帳務表各執行一次 WHERE false 的 UPDATE（不會選到任何列），回報影響筆數後一律回滾。真正的資料修復在 inspect 結果出來後另開 PR 登記。",
    statements: STATUS_TABLES.map((table) => `UPDATE "${table}" SET "status" = "status" WHERE false`),
    maxAffectedRows: 0,
    dryRun: true,
  },
]);

const FIX_ID = /^[a-z0-9][a-z0-9-]{2,79}$/u;
const FORBIDDEN_FIX_SQL = /;|--|\/\*|\$\$|\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|RESET|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|VACUUM|LOCK|_prisma_migrations|pg_catalog|set_config)\b|\bSET\s+(?:LOCAL|SESSION|TRANSACTION|ROLE)\b/iu;
const ALLOWED_FIX_SQL = /^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+"(?:PaymentTransaction|RefundRecord|PayoutBatch|Settlement|PayoutItem)"\s/u;

/** Returns null when the fix may run, or the fixed refusal code. */
export function fixDefinitionProblem(fix: LedgerFix): string | null {
  if (!FIX_ID.test(fix.id)) return "LEDGER_FIX_ID_INVALID";
  if (!Number.isInteger(fix.maxAffectedRows) || fix.maxAffectedRows < 0 || fix.maxAffectedRows > MAX_FIX_ROWS) return "LEDGER_FIX_LIMIT_INVALID";
  if (fix.statements.length === 0) return "LEDGER_FIX_EMPTY";
  if (fix.statements.some((sql) => !ALLOWED_FIX_SQL.test(sql) || FORBIDDEN_FIX_SQL.test(sql))) return "LEDGER_FIX_SQL_FORBIDDEN";
  return null;
}

// ---------------------------------------------------------------------------
// Output safety

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const SAFE_STATUS = /^[A-Za-z0-9_-]{1,40}$/u;

/** Opaque ids only; anything else is replaced so it cannot carry data. */
export function safeId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return SAFE_ID.test(text) ? text : `<unsafe-id len=${text.length}>`;
}

export function safeStatus(value: unknown): string {
  const text = String(value ?? "");
  return SAFE_STATUS.test(text) ? text : `<unsafe-status len=${text.length}>`;
}

/** Reduce any thrown error to a fixed code, the Prisma error code and SQLSTATE. */
export function sanitizeError(code: string, error: unknown): string {
  const parts = [code];
  const record = (error && typeof error === "object" ? error : {}) as { code?: unknown; meta?: { code?: unknown } };
  if (typeof record.code === "string" && /^P\d{4}$/u.test(record.code)) parts.push(`PRISMA_ERROR ${record.code}`);
  const sqlstate = record.meta?.code;
  if (typeof sqlstate === "string" && /^[0-9A-Z]{5}$/u.test(sqlstate)) parts.push(`SQLSTATE ${sqlstate}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Inspect

export type ViolationRow = { id: string | null; vendorId: string | null; status: string; violatedRules: string[] };
export type CheckReport = {
  constraint: string;
  table: string;
  violations: number;
  rows: ViolationRow[];
  rowsTruncated: boolean;
  validated: boolean | null;
};
export type MigrationState = "applied" | "rolled_back" | "failed";
export type MigrationRow = {
  migration: string;
  state: MigrationState;
  startedAt: string | null;
  finishedAt: string | null;
  rolledBackAt: string | null;
  appliedStepsCount: number;
};
export type InspectReport = {
  schemaVersion: typeof REMEDIATION_SCHEMA_VERSION;
  mode: "inspect";
  databaseWrites: false;
  totalViolations: number;
  checks: CheckReport[];
  migrations: MigrationRow[];
};

type RawClient = Pick<Prisma.TransactionClient, "$queryRawUnsafe" | "$executeRawUnsafe">;
type Db = Pick<PrismaClient, "$transaction">;

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);

export function migrationState(row: { finished_at: unknown; rolled_back_at: unknown }): MigrationState {
  if (row.rolled_back_at) return "rolled_back";
  return row.finished_at ? "applied" : "failed";
}

async function readMigrations(tx: RawClient): Promise<MigrationRow[]> {
  const rows = await tx.$queryRawUnsafe<Array<{
    migration_name: string; started_at: unknown; finished_at: unknown; rolled_back_at: unknown; applied_steps_count: number;
  }>>(
    `SELECT "migration_name", "started_at", "finished_at", "rolled_back_at", "applied_steps_count"
       FROM "_prisma_migrations" WHERE "migration_name" = ANY($1::text[])
      ORDER BY "started_at", "id"`,
    [...LEDGER_MIGRATIONS],
  );
  return rows.map((row) => ({
    migration: row.migration_name,
    state: migrationState(row),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    rolledBackAt: iso(row.rolled_back_at),
    appliedStepsCount: Number(row.applied_steps_count),
  }));
}

async function readCheck(tx: RawClient, check: CheckSpec, validated: Map<string, boolean>): Promise<CheckReport> {
  const where = `(${check.predicate}) IS FALSE`;
  const [{ count }] = await tx.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT count(*) AS "count" FROM "${check.table}" WHERE ${where}`,
  );
  const termColumns = check.terms.map((term, index) => `(${term.sql}) AS "t${index}"`);
  const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT "id", ${check.hasVendor ? `"vendorId"` : "NULL::text"} AS "vendorId", "status"${termColumns.map((sql) => `, ${sql}`).join("")}
       FROM "${check.table}" WHERE ${where} ORDER BY "id" LIMIT ${ROW_LIMIT}`,
  );
  const violations = Number(count);
  return {
    constraint: check.name,
    table: check.table,
    violations,
    rows: rows.map((row) => ({
      id: safeId(row.id),
      vendorId: safeId(row.vendorId),
      status: safeStatus(row.status),
      violatedRules: check.terms.flatMap((term, index) => (row[`t${index}`] === true ? [term.rule] : [])),
    })),
    rowsTruncated: violations > rows.length,
    validated: validated.has(check.name) ? validated.get(check.name)! : null,
  };
}

/** Reads every check inside a database-enforced read-only snapshot. */
export async function inspectLedger(db: Db): Promise<InspectReport> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
    const constraintRows = await tx.$queryRawUnsafe<Array<{ conname: string; convalidated: boolean }>>(
      `SELECT c."conname", c."convalidated" FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
        WHERE t.relnamespace = to_regnamespace(current_schema()) AND c."conname" = ANY($1::text[])`,
      CHECKS.map((check) => check.name),
    );
    const validated = new Map(constraintRows.map((row) => [row.conname, row.convalidated]));
    const checks: CheckReport[] = [];
    for (const check of CHECKS) checks.push(await readCheck(tx, check, validated));
    const migrations = await readMigrations(tx);
    return {
      schemaVersion: REMEDIATION_SCHEMA_VERSION,
      mode: "inspect" as const,
      databaseWrites: false as const,
      totalViolations: checks.reduce((sum, check) => sum + check.violations, 0),
      checks,
      migrations,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000, maxWait: 10_000 });
}

// ---------------------------------------------------------------------------
// Apply fix

export type FixReport = {
  schemaVersion: typeof REMEDIATION_SCHEMA_VERSION;
  mode: "apply-fix";
  fixId: string;
  dryRun: boolean;
  maxAffectedRows: number;
  statementRows: number[];
  affectedRows: number;
  outcome: "committed" | "rolled_back_dry_run" | "rolled_back_over_limit";
};

class Rollback extends Error {
  constructor(readonly outcome: FixReport["outcome"], readonly statementRows: number[]) { super(outcome); }
}

export async function applyFix(db: Db, fix: LedgerFix, runId: string | null = null): Promise<FixReport> {
  const problem = fixDefinitionProblem(fix);
  if (problem) throw new Error(problem);
  const report = (outcome: FixReport["outcome"], statementRows: number[]): FixReport => ({
    schemaVersion: REMEDIATION_SCHEMA_VERSION,
    mode: "apply-fix",
    fixId: fix.id,
    dryRun: fix.dryRun,
    maxAffectedRows: fix.maxAffectedRows,
    statementRows,
    affectedRows: statementRows.reduce((sum, rows) => sum + rows, 0),
    outcome,
  });
  try {
    const statementRows = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
      const counts: number[] = [];
      for (const sql of fix.statements) counts.push(await tx.$executeRawUnsafe(sql));
      const total = counts.reduce((sum, rows) => sum + rows, 0);
      if (total > fix.maxAffectedRows) throw new Rollback("rolled_back_over_limit", counts);
      if (fix.dryRun) throw new Rollback("rolled_back_dry_run", counts);
      await tx.auditLog.create({
        data: {
          action: "staging_ledger_remediation.apply_fix",
          actorLabel: "staging-ledger-remediation workflow",
          targetType: "LedgerRemediationFix",
          targetId: fix.id,
          after: { affectedRows: total, statementRows: counts, maxAffectedRows: fix.maxAffectedRows, runId },
        },
      });
      return counts;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 120_000, maxWait: 10_000 });
    return report("committed", statementRows);
  } catch (error) {
    if (error instanceof Rollback) return report(error.outcome, error.statementRows);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Resolve

export type PrismaRunner = (args: string[], env: Record<string, string>) => { status: number | null; error?: Error; output: string };

// ---------------------------------------------------------------------------
// Rendering

const cell = (value: unknown) => String(value ?? "—").replace(/\|/gu, "\\|");

export function renderInspectMarkdown(report: InspectReport): string {
  const lines = [
    "## Staging 帳務 CHECK 診斷（唯讀，未寫入）",
    "",
    `- 違規總筆數：${report.totalViolations}`,
    "",
    "| Constraint | 違規筆數 | 已 validate |",
    "|---|---|---|",
    ...report.checks.map((check) => `| ${check.constraint} | ${check.violations} | ${check.validated === null ? "不存在" : check.validated} |`),
    "",
  ];
  for (const check of report.checks.filter((entry) => entry.violations > 0)) {
    lines.push(`### ${check.constraint}（${check.violations} 筆${check.rowsTruncated ? `，只列前 ${ROW_LIMIT} 筆` : ""}）`, "",
      "| id | vendorId | status | 違反的金額規則 |", "|---|---|---|---|",
      ...check.rows.map((row) => `| ${cell(row.id)} | ${cell(row.vendorId)} | ${cell(row.status)} | ${cell(row.violatedRules.join(", ") || "—")} |`), "");
  }
  lines.push("### `_prisma_migrations`", "", "| Migration | 狀態 | started_at | finished_at | rolled_back_at |", "|---|---|---|---|---|",
    ...report.migrations.map((row) => `| ${row.migration} | ${row.state} | ${cell(row.startedAt)} | ${cell(row.finishedAt)} | ${cell(row.rolledBackAt)} |`),
    "", "金額只輸出欄名與規則，不輸出數值；修復必須另開 PR 登記到 `FIXES`。");
  return `${lines.join("\n")}\n`;
}

function renderLines(title: string, lines: string[]): string {
  return [`## ${title}`, "", "```text", ...lines, "```", ""].join("\n");
}

// ---------------------------------------------------------------------------
// Entry point

export type RunInputs = { mode?: string; fixId?: string; confirm?: string };
export type RunDeps = {
  db?: Db;
  createDb?: (url: string) => Db & { $disconnect(): Promise<void> };
  runner?: PrismaRunner;
  fixes?: readonly LedgerFix[];
  env?: Record<string, string | undefined>;
  emit?: (line: string) => void;
};
export type RunResult = { code: number; lines: string[]; summary: string };

/** Validates mode and confirmation before anything connects to a database. */
export function preflight(inputs: RunInputs, fixes: readonly LedgerFix[] = FIXES): { mode: Mode; fix?: LedgerFix } | { code: number; line: string } {
  const mode = (inputs.mode || "inspect") as Mode;
  if (!MODES.includes(mode)) return { code: 2, line: "LEDGER_REMEDIATION_MODE_INVALID" };
  if (mode === "resolve-rolled-back" && inputs.confirm !== RESOLVE_CONFIRMATION) return { code: 1, line: "LEDGER_REMEDIATION_CONFIRM_MISMATCH" };
  if (mode === "apply-fix") {
    const fix = fixes.find((entry) => entry.id === inputs.fixId);
    if (!fix) return { code: 1, line: "LEDGER_FIX_UNKNOWN" };
    if (inputs.confirm !== `apply-${fix.id}`) return { code: 1, line: "LEDGER_REMEDIATION_CONFIRM_MISMATCH" };
    const problem = fixDefinitionProblem(fix);
    if (problem) return { code: 1, line: problem };
    return { mode, fix };
  }
  return { mode };
}

function spawnPrisma(args: string[], env: Record<string, string>) {
  const child = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), env: env as NodeJS.ProcessEnv, encoding: "utf8", shell: false, windowsHide: true,
    timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
  });
  return { status: child.status, error: child.error, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

async function resolveRolledBack(db: Db, runner: PrismaRunner, childEnv: Record<string, string>): Promise<RunResult> {
  const before = await inspectLedger(db);
  const failed = before.migrations.filter((row) => row.migration === VALIDATE_MIGRATION);
  const isFailed = failed.length > 0 && failed.some((row) => row.state === "failed") && !failed.some((row) => row.state === "applied");
  const lines = [`violations_before_resolve ${before.totalViolations}`];
  if (!isFailed) {
    lines.push("LEDGER_REMEDIATION_RESOLVE_NOT_FAILED");
    return { code: 1, lines, summary: renderLines("Staging resolve --rolled-back（已拒絕）", lines) };
  }
  if (before.totalViolations > 0) lines.push("WARNING violations remain; the next deploy fails again until they are fixed");
  const resolve = runner(["migrate", "resolve", "--rolled-back", VALIDATE_MIGRATION], childEnv);
  if (resolve.error) lines.push("PRISMA_SPAWN_FAILED");
  else lines.push(`resolve_exit ${resolve.status ?? "null"}`, ...sanitizePrismaOutput(resolve.output));
  const status = runner(["migrate", "status"], childEnv);
  if (status.error) lines.push("PRISMA_SPAWN_FAILED");
  else lines.push(`status_exit ${status.status ?? "null"}`, ...sanitizePrismaOutput(status.output));
  const code = resolve.error || resolve.status !== 0 ? 1 : 0;
  return { code, lines, summary: renderLines(`Staging resolve --rolled-back ${VALIDATE_MIGRATION}`, lines) };
}

export async function run(inputs: RunInputs, deps: RunDeps = {}): Promise<RunResult> {
  const env = deps.env ?? process.env;
  const fixes = deps.fixes ?? FIXES;
  const checked = preflight(inputs, fixes);
  if ("line" in checked) return { code: checked.code, lines: [checked.line], summary: renderLines("Staging 帳務修復（已拒絕）", [checked.line]) };

  const target = parseStagingDatabaseUrl(env.STAGING_DATABASE_URL);
  if (target.failure) return { code: 2, lines: [target.failure], summary: renderLines("Staging 帳務修復（設定錯誤）", [target.failure]) };
  for (const line of maskCommands(target)) (deps.emit ?? console.log)(line);
  const migrationUrl = target.url as string;
  // The query engine gets the same session URL without the migration-only `options`.
  const clientUrl = new URL(migrationUrl);
  clientUrl.searchParams.delete("options");

  const owned = deps.db ? null : (deps.createDb ?? ((url: string) => new PrismaClient({ datasources: { db: { url } } })))(clientUrl.toString());
  const db = deps.db ?? owned!;
  try {
    if (checked.mode === "inspect") {
      const report = await inspectLedger(db);
      return { code: 0, lines: [JSON.stringify(report)], summary: renderInspectMarkdown(report) };
    }
    if (checked.mode === "resolve-rolled-back") {
      const childEnv = {
        PATH: env.PATH ?? "", HOME: env.HOME ?? "", DATABASE_URL: migrationUrl, DIRECT_URL: migrationUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1",
      };
      return await resolveRolledBack(db, deps.runner ?? spawnPrisma, childEnv);
    }
    const report = await applyFix(db, checked.fix!, safeId(env.GITHUB_RUN_ID));
    const after = await inspectLedger(db);
    const lines = [JSON.stringify(report), `violations_after ${after.totalViolations}`];
    const code = report.outcome === "rolled_back_over_limit" ? 1 : 0;
    return { code, lines, summary: renderLines(`Staging 帳務修復 ${report.fixId}：${report.outcome}`, lines) + renderInspectMarkdown(after) };
  } catch (error) {
    const line = sanitizeError("LEDGER_REMEDIATION_DATABASE_FAILED", error);
    return { code: 1, lines: [line], summary: renderLines("Staging 帳務修復（失敗）", [line]) };
  } finally {
    if (owned) await owned.$disconnect().catch(() => undefined);
  }
}

export async function main(env: Record<string, string | undefined> = process.env) {
  const result = await run({
    mode: env.LEDGER_REMEDIATION_MODE,
    fixId: env.LEDGER_REMEDIATION_FIX_ID,
    confirm: env.LEDGER_REMEDIATION_CONFIRM,
  }, { env });
  for (const line of result.lines) console.log(line);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, result.summary);
  return result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, () => {
    console.log("LEDGER_REMEDIATION_UNEXPECTED_FAILURE");
    process.exitCode = 1;
  });
}
