import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { getStagingDatabaseIdentityReport } from "../src/lib/database-identity.ts";
import { sourceInventory } from "./secure-staging-runner.mjs";

// This is the already attested Preview and its 58-migration database baseline.
export const SOURCE_SHA = "9193326824b8b6bf774bdfa28e4783a1a1b8f304";
export const PREVIEW_HOST = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
const TENANT_MIGRATION = "20260911080000_live_interaction_tenant_integrity";
const EXPECTED_COUNT = 79;
const APPLIED_COUNT = 58;
const PENDING_COUNT = 21;
const IDENTITY_KEYS = ["readOnly", "databaseMatched", "migrationTablePresent", "runTablePresent", "responseTablePresent", "submissionTablePresent"];

const IDENTITY_SQL = `SELECT
  (current_setting('transaction_read_only') = 'on') AS "readOnly",
  (current_database() = 'postgres') AS "databaseMatched",
  (to_regclass('public._prisma_migrations') IS NOT NULL) AS "migrationTablePresent",
  (to_regclass('public."LiveInteractionRun"') IS NOT NULL) AS "runTablePresent",
  (to_regclass('public."LiveInteractionResponse"') IS NOT NULL) AS "responseTablePresent",
  (to_regclass('public."FormSubmission"') IS NOT NULL) AS "submissionTablePresent"`;
const HISTORY_SQL = `SELECT migration_name, checksum, finished_at, rolled_back_at
  FROM public._prisma_migrations ORDER BY migration_name, started_at`;
// Only aggregates leave PostgreSQL. LEFT JOIN also catches orphaned references,
// even though the existing single-column foreign keys should prevent them.
const COMPATIBILITY_SQL = `SELECT
  (SELECT count(*) FROM public."LiveInteractionResponse" response
    LEFT JOIN public."LiveInteractionRun" run
      ON run."vendorId" = response."vendorId" AND run."id" = response."runId"
    WHERE run."id" IS NULL OR run."liveId" IS DISTINCT FROM response."liveId") AS "runMismatchCount",
  (SELECT count(*) FROM public."LiveInteractionResponse" response
    LEFT JOIN public."FormSubmission" submission
      ON submission."id" = response."formSubmissionId"
    WHERE response."formSubmissionId" IS NOT NULL
      AND (submission."id" IS NULL OR submission."liveId" IS DISTINCT FROM response."liveId")) AS "submissionMismatchCount"`;

function report(result, reason, extras = {}, databaseReads = 0) {
  return {
    schemaVersion: "celebratedeal-staging-migration-compat/v1",
    result, reason,
    baseline: "fixed-preview-58-of-79",
    pendingMigrationCount: PENDING_COUNT,
    checks: { runLiveMismatch: "NOT_RUN", submissionLiveMismatch: "NOT_RUN", ...extras },
    sideEffects: { databaseReads, databaseWrites: 0, migrationWrites: 0, productionOperations: 0 },
  };
}

function safeCount(value) {
  const number = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function inspectMigrationHistory(rows, inventory) {
  if (!Array.isArray(rows) || !(inventory instanceof Map) || inventory.size !== EXPECTED_COUNT) return false;
  const expected = [...inventory.keys()].sort();
  if (!expected.slice(-PENDING_COUNT).includes(TENANT_MIGRATION)) return false;
  const active = rows.filter((row) => row?.finished_at != null && row?.rolled_back_at == null).sort((a, b) => String(a.migration_name).localeCompare(String(b.migration_name)));
  if (active.length !== APPLIED_COUNT || rows.some((row) => row?.finished_at == null && row?.rolled_back_at == null)) return false;
  return active.every((row, index) => {
    const trusted = inventory.get(row.migration_name);
    return row.migration_name === expected[index]
      && typeof row.checksum === "string"
      && (row.checksum === trusted?.exact || trusted?.alternatives?.has(row.checksum));
  });
}

/** Fail closed before connecting unless both fixed Preview and staging DB match. */
export async function inspectCompatibility({ sourceSha, host, databaseUrl, supabaseUrl, db, inventory }) {
  if (sourceSha !== SOURCE_SHA || host !== PREVIEW_HOST || !getStagingDatabaseIdentityReport({
    DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, STAGING_DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  }).all_passed) return report("BLOCKED", "INVALID_BINDING");
  if (!(inventory instanceof Map) || inventory.size !== EXPECTED_COUNT) return report("BLOCKED", "INVALID_SOURCE_INVENTORY");
  try {
    return await db.$transaction(async (tx) => {
      // PostgreSQL enforces the guard for every subsequent query in this transaction.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const identity = await tx.$queryRawUnsafe(IDENTITY_SQL);
      if (identity.length !== 1 || !IDENTITY_KEYS.every((key) => identity[0]?.[key] === true)) return report("BLOCKED", "DATABASE_IDENTITY_OR_SCHEMA_MISMATCH", {}, 1);
      const history = await tx.$queryRawUnsafe(HISTORY_SQL);
      if (!inspectMigrationHistory(history, inventory)) return report("BLOCKED", "MIGRATION_BASELINE_CHANGED", {}, 2);
      const counts = await tx.$queryRawUnsafe(COMPATIBILITY_SQL);
      if (counts.length !== 1) return report("BLOCKED", "INVALID_COUNT_RESPONSE", {}, 3);
      const run = safeCount(counts[0].runMismatchCount);
      const submission = safeCount(counts[0].submissionMismatchCount);
      if (run === null || submission === null) return report("BLOCKED", "INVALID_COUNT_RESPONSE", {}, 3);
      const checks = { runLiveMismatch: run === 0 ? "PASS" : "FAIL", submissionLiveMismatch: submission === 0 ? "PASS" : "FAIL" };
      return report(run === 0 && submission === 0 ? "PASS" : "FAILED", run === 0 && submission === 0 ? "NONE" : "EXISTING_DATA_CONFLICT", checks, 3);
    }, { isolationLevel: "RepeatableRead", timeout: 20_000 });
  } catch {
    // Database error text can contain server details. Never serialize it.
    return report("BLOCKED", "READ_ONLY_QUERY_FAILED");
  }
}

async function main() {
  let result;
  try {
    const inventory = sourceInventory(SOURCE_SHA);
    const databaseUrl = process.env.STAGING_DATABASE_URL;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sourceSha = process.env.CELEBRATEDEAL_SOURCE_SHA;
    const host = process.env.CELEBRATEDEAL_DEPLOYMENT_HOST;
    const valid = sourceSha === SOURCE_SHA && host === PREVIEW_HOST && getStagingDatabaseIdentityReport({
      DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, STAGING_DATABASE_URL: databaseUrl,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    }).all_passed;
    if (!valid) result = report("BLOCKED", "INVALID_BINDING");
    else {
      const { PrismaClient } = await import("@prisma/client");
      const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      try { result = await inspectCompatibility({ sourceSha, host, databaseUrl, supabaseUrl, db, inventory }); }
      finally { await db.$disconnect(); }
    }
  } catch { result = report("BLOCKED", "PREFLIGHT_SETUP_FAILED"); }
  const serialized = `${JSON.stringify(result)}\n`;
  if (process.env.RUNNER_TEMP) await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-migration-compat-preflight.json`, serialized, { mode: 0o600 });
  process.stdout.write(serialized);
  if (result.result !== "PASS") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
