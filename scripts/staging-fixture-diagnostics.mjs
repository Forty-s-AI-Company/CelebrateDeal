import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { getStagingDatabaseIdentityReport } from "../src/lib/database-identity.ts";
import { verifyTrustedMigrationTree } from "./secure-staging-runner.mjs";

// Bind this diagnostic to the deployment already attested by the protected Preview gate.
const SOURCE_SHA = "9193326824b8b6bf774bdfa28e4783a1a1b8f304";
const PREVIEW_HOST = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
const MIGRATION_NAME = /^\d{12,14}_[a-z0-9_]+$/u;
const PREFLIGHT_OUTCOMES = new Set(["EXECUTOR_DISABLED", "FIXTURE_UNAVAILABLE"]);

function blocked(reason) {
  return {
    result: "BLOCKED",
    reason,
    migrations: { status: "NOT_RUN", expected: null, applied: null, failed: null, checksumMismatch: null },
    fixture: "NOT_RUN",
    sideEffects: { databaseWrites: 0, paymentSubmissions: 0, productionOperations: 0 },
  };
}

export function exitCodeForReport(report) {
  return report?.result === "PASS" ? 0 : 2;
}

/** Classify only fixed, non-sensitive response metadata; never persist the body or headers. */
export function classifyFixturePreflight(response, body) {
  if (response.status === 200) {
    return body?.ready === true && body?.buyerOrder === true
      && body?.platformSubscription === true && body?.invoicePayment === true
      ? "READY" : "INVALID_RESPONSE";
  }
  if (response.status === 401) return "UNAUTHORIZED";
  const outcome = response.headers.get("x-celebratedeal-wp4-preflight");
  if (PREFLIGHT_OUTCOMES.has(outcome)) return outcome;
  if (response.status === 404) return "NOT_FOUND";
  if (response.status === 503) return "SERVICE_UNAVAILABLE";
  return "HTTP_FAILURE";
}

/** Read-only check of migration history and the exact Preview's fixed WP4 preflight. */
export async function diagnoseStagingFixture({ sourceSha, host, jobSecret, databaseUrl, supabaseUrl, db, migrationChecksums, fetchImpl = fetch }) {
  if (sourceSha !== SOURCE_SHA || host !== PREVIEW_HOST || typeof jobSecret !== "string" || jobSecret.length < 16) {
    return blocked("INVALID_BINDING");
  }
  const identity = getStagingDatabaseIdentityReport({
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    STAGING_DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  });
  if (!identity.all_passed) return blocked("DATABASE_IDENTITY_MISMATCH");
  const report = blocked("DIAGNOSTIC_INCOMPLETE");
  const expected = [...migrationChecksums.keys()].sort();
  if (expected.length === 0 || expected.some((name) => !MIGRATION_NAME.test(name))) {
    return blocked("INVALID_MIGRATION_SET");
  }

  try {
    const rows = await db.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    const applied = rows.filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .sort((left, right) => left.migration_name.localeCompare(right.migration_name));
    const failed = rows.filter((row) => row.finished_at === null && row.rolled_back_at === null).length;
    const checksumMismatch = applied.filter((row) => !migrationChecksums.get(row.migration_name)?.has(row.checksum)).length;
    const matches = failed === 0 && applied.length === expected.length
      && checksumMismatch === 0 && applied.every((row, index) => row.migration_name === expected[index]);
    report.migrations = { status: matches ? "UP_TO_DATE" : "DRIFT", expected: expected.length, applied: applied.length, failed, checksumMismatch };
  } catch {
    report.migrations = { status: "QUERY_FAILED", expected: expected.length, applied: null, failed: null, checksumMismatch: null };
  }

  try {
    const response = await fetchImpl(`https://${host}/api/admin/ops/payuni/wp4-preflight`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jobSecret}`, "x-celebratedeal-source-sha": sourceSha },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      report.fixture = "REDIRECT_REJECTED";
    } else {
      const body = response.status === 200 ? await response.json() : null;
      report.fixture = classifyFixturePreflight(response, body);
    }
  } catch {
    report.fixture = "REQUEST_FAILED";
  }
  report.result = report.migrations.status === "UP_TO_DATE" && report.fixture === "READY" ? "PASS" : "BLOCKED";
  report.reason = report.result === "PASS" ? "NONE" : "STAGING_FIXTURE_NOT_READY";
  return report;
}

async function main() {
  verifyTrustedMigrationTree(SOURCE_SHA);
  const names = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && MIGRATION_NAME.test(entry.name))
    .map((entry) => entry.name);
  const migrationChecksums = new Map();
  for (const name of names) {
    const bytes = await readFile(`prisma/migrations/${name}/migration.sql`);
    const exact = createHash("sha256").update(bytes).digest("hex");
    const withoutFinalLf = createHash("sha256").update(bytes.at(-1) === 10 ? bytes.subarray(0, -1) : bytes).digest("hex");
    const crlf = createHash("sha256").update(Buffer.from(bytes.toString("utf8").replace(/(?<!\r)\n/gu, "\r\n"), "utf8")).digest("hex");
    migrationChecksums.set(name, new Set([exact, withoutFinalLf, crlf]));
  }
  // Import Prisma only after validating named bindings, so unit tests never need a database.
  const databaseUrl = process.env.STAGING_DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const identity = getStagingDatabaseIdentityReport({
    DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
    STAGING_DATABASE_URL: databaseUrl, NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  });
  let report;
  if (!identity.all_passed) {
    report = blocked("DATABASE_IDENTITY_MISMATCH");
  } else {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      report = await diagnoseStagingFixture({
        sourceSha: process.env.CELEBRATEDEAL_SOURCE_SHA,
        host: process.env.CELEBRATEDEAL_DEPLOYMENT_HOST,
        jobSecret: process.env.JOB_SECRET,
        databaseUrl, supabaseUrl, db, migrationChecksums,
      });
    } finally {
      await db.$disconnect();
    }
  }
  const serialized = `${JSON.stringify(report)}\n`;
  if (process.env.RUNNER_TEMP) {
    await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-fixture-diagnostic.json`, serialized, { mode: 0o600 });
  }
  process.stdout.write(serialized);
  process.exitCode = exitCodeForReport(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify(blocked("DIAGNOSTIC_ERROR"))}\n`);
    process.exitCode = 2;
  });
}
