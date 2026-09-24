import assert from "node:assert/strict";
import test from "node:test";

import { classifyFixturePreflight, diagnoseStagingFixture, exitCodeForReport } from "./staging-fixture-diagnostics.mjs";

const INPUT = {
  sourceSha: "9193326824b8b6bf774bdfa28e4783a1a1b8f304",
  host: "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app",
  jobSecret: "synthetic-job-secret-for-test",
  databaseUrl: ["postgresql:", "", "postgres:synthetic-password@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres"].join("/"),
  supabaseUrl: "https://ocbugvgojrunvenozsbx.supabase.co",
  migrationChecksums: new Map([
    ["20260101000000_first", new Set(["a".repeat(64)])],
    ["20260102000000_second", new Set(["b".repeat(64), "c".repeat(64)])],
  ]),
};

function fixtureResponse(status, outcome, body) {
  return {
    status,
    redirected: false,
    headers: new Headers(outcome ? { "x-celebratedeal-wp4-preflight": outcome } : {}),
    json: async () => body,
  };
}

test("exact staging identity and migration history produce only bounded readiness evidence", async () => {
  const db = { $queryRaw: async () => [
    { migration_name: "20260101000000_first", checksum: "a".repeat(64), finished_at: new Date(), rolled_back_at: null },
    { migration_name: "20260102000000_second", checksum: "c".repeat(64), finished_at: new Date(), rolled_back_at: null },
  ] };
  const result = await diagnoseStagingFixture({
    ...INPUT, db,
    fetchImpl: async () => fixtureResponse(200, null, {
      ready: true, buyerOrder: true, platformSubscription: true, invoicePayment: true,
    }),
  });
  assert.equal(result.result, "PASS");
  assert.deepEqual(result.migrations, { status: "UP_TO_DATE", expected: 2, applied: 2, failed: 0, checksumMismatch: 0 });
  assert.equal(result.fixture, "READY");
  assert.equal(JSON.stringify(result).includes("synthetic-password"), false);
  assert.equal(JSON.stringify(result).includes(INPUT.jobSecret), false);
});

test("wrong Preview or database identity stops before network and database access", async () => {
  let accessed = false;
  const dependencies = {
    db: { $queryRaw: async () => { accessed = true; return []; } },
    fetchImpl: async () => { accessed = true; throw new Error("should not run"); },
  };
  const host = await diagnoseStagingFixture({ ...INPUT, host: "example.com", ...dependencies });
  const db = await diagnoseStagingFixture({ ...INPUT, databaseUrl: ["postgresql:", "", "postgres:pass@db.other.supabase.co/postgres"].join("/"), ...dependencies });
  assert.equal(host.reason, "INVALID_BINDING");
  assert.equal(db.reason, "DATABASE_IDENTITY_MISMATCH");
  assert.equal(accessed, false);
});

test("pending migration and fixture failure remain blocked without leaking response details", async () => {
  const db = { $queryRaw: async () => [
    { migration_name: "20260101000000_first", checksum: "a".repeat(64), finished_at: new Date(), rolled_back_at: null },
  ] };
  const result = await diagnoseStagingFixture({
    ...INPUT, db, fetchImpl: async () => fixtureResponse(404, "FIXTURE_UNAVAILABLE"),
  });
  assert.equal(result.result, "BLOCKED");
  assert.equal(result.migrations.status, "DRIFT");
  assert.equal(result.fixture, "FIXTURE_UNAVAILABLE");
  assert.equal(exitCodeForReport(result), 2);
  assert.equal(JSON.stringify(result).includes("postgresql://"), false);
});

test("same migration name with changed SQL checksum cannot pass", async () => {
  const db = { $queryRaw: async () => [
    { migration_name: "20260101000000_first", checksum: "d".repeat(64), finished_at: new Date(), rolled_back_at: null },
    { migration_name: "20260102000000_second", checksum: "b".repeat(64), finished_at: new Date(), rolled_back_at: null },
  ] };
  const result = await diagnoseStagingFixture({
    ...INPUT, db, fetchImpl: async () => fixtureResponse(200, null, {
      ready: true, buyerOrder: true, platformSubscription: true, invoicePayment: true,
    }),
  });
  assert.equal(result.migrations.status, "DRIFT");
  assert.equal(result.migrations.checksumMismatch, 1);
  assert.equal(exitCodeForReport(result), 2);
});

test("rolled-back history does not count as active but unresolved failure blocks", async () => {
  const rows = [
    { migration_name: "20260101000000_first", checksum: "a".repeat(64), finished_at: new Date(), rolled_back_at: null },
    { migration_name: "20260102000000_second", checksum: "b".repeat(64), finished_at: new Date(), rolled_back_at: null },
    { migration_name: "20260102000000_second", checksum: "d".repeat(64), finished_at: null, rolled_back_at: new Date() },
  ];
  const db = { $queryRaw: async () => rows };
  const fetchImpl = async () => fixtureResponse(200, null, {
    ready: true, buyerOrder: true, platformSubscription: true, invoicePayment: true,
  });
  const recovered = await diagnoseStagingFixture({ ...INPUT, db, fetchImpl });
  assert.equal(recovered.result, "PASS");
  rows.push({ migration_name: "20260103000000_failed", checksum: "e".repeat(64), finished_at: null, rolled_back_at: null });
  const unresolved = await diagnoseStagingFixture({ ...INPUT, db, fetchImpl });
  assert.equal(unresolved.migrations.status, "DRIFT");
  assert.equal(exitCodeForReport(unresolved), 2);
});

test("preflight response classifier accepts only fixed outcomes", () => {
  assert.equal(classifyFixturePreflight(fixtureResponse(404, "EXECUTOR_DISABLED"), null), "EXECUTOR_DISABLED");
  assert.equal(classifyFixturePreflight(fixtureResponse(503, "unexpected-value"), null), "SERVICE_UNAVAILABLE");
  assert.equal(classifyFixturePreflight(fixtureResponse(401), null), "UNAUTHORIZED");
  assert.equal(classifyFixturePreflight(fixtureResponse(200), { ready: true }), "INVALID_RESPONSE");
});
