import assert from "node:assert/strict";
import test from "node:test";

import { inspectCompatibility, inspectMigrationHistory, PREVIEW_HOST, SOURCE_SHA } from "./staging-migration-compat-preflight.mjs";

const databaseUrl = ["postgresql:", "", "postgres:synthetic-password@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres"].join("/");
const binding = {
  sourceSha: SOURCE_SHA, host: PREVIEW_HOST, databaseUrl,
  supabaseUrl: "https://ocbugvgojrunvenozsbx.supabase.co",
};
const names = Array.from({ length: 79 }, (_, index) => `202608${String(index).padStart(8, "0")}_synthetic`);
names[71] = "20260911080000_live_interaction_tenant_integrity";
names.sort();
const inventory = new Map(names.map((name) => [name, { exact: "a".repeat(64), alternatives: new Set(["b".repeat(64)]) }]));
const history = names.slice(0, 58).map((migration_name) => ({ migration_name, checksum: "a".repeat(64), finished_at: new Date(), rolled_back_at: null }));
const identity = [{ readOnly: true, databaseMatched: true, migrationTablePresent: true, runTablePresent: true, responseTablePresent: true, submissionTablePresent: true }];

function fakeDatabase(counts = [{ runMismatchCount: 0n, submissionMismatchCount: 0n }], rows = history, databaseIdentity = identity) {
  const calls = [];
  const tx = {
    $executeRawUnsafe: async (sql) => { calls.push(sql); },
    $queryRawUnsafe: async (sql) => {
      calls.push(sql);
      if (calls.length === 2) return databaseIdentity;
      if (calls.length === 3) return rows;
      return counts;
    },
  };
  return { calls, db: { $transaction: async (callback) => callback(tx) } };
}

test("the fixed 58/79 prefix requires trusted checksums and no failed migration", () => {
  assert.equal(inspectMigrationHistory(history, inventory), true);
  assert.equal(inspectMigrationHistory([...history.slice(0, -1), { ...history.at(-1), checksum: "c".repeat(64) }], inventory), false);
  assert.equal(inspectMigrationHistory([...history, { migration_name: "failed", finished_at: null, rolled_back_at: null }], inventory), false);
  assert.equal(inspectMigrationHistory(history.slice(0, -1), inventory), false);
});

test("read-only guard precedes identity, history, and aggregate queries", async () => {
  const { db, calls } = fakeDatabase();
  const result = await inspectCompatibility({ ...binding, db, inventory });
  assert.equal(result.result, "PASS");
  assert.equal(calls.length, 4);
  assert.equal(calls[0], "SET TRANSACTION READ ONLY");
  assert.match(calls[1], /transaction_read_only/u);
  assert.match(calls[3], /count\(\*\)/u);
  assert.equal(JSON.stringify(result).includes("synthetic-password"), false);
  assert.equal(JSON.stringify(result).includes("postgresql:"), false);
});

test("existing run/live or registration/live conflicts fail without exposing counts or rows", async () => {
  for (const counts of [
    [{ runMismatchCount: 2n, submissionMismatchCount: 0n }],
    [{ runMismatchCount: 0n, submissionMismatchCount: 3n }],
  ]) {
    const result = await inspectCompatibility({ ...binding, db: fakeDatabase(counts).db, inventory });
    assert.equal(result.result, "FAILED");
    assert.equal(JSON.stringify(result).includes("MismatchCount"), false);
    assert.equal(result.checks.runLiveMismatch === "FAIL" || result.checks.submissionLiveMismatch === "FAIL", true);
    assert.equal(Object.hasOwn(result, "runMismatchCount"), false);
  }
});

test("wrong fixed binding, changed history, and query errors fail closed", async () => {
  const fake = fakeDatabase();
  assert.equal((await inspectCompatibility({ ...binding, host: "other.vercel.app", db: fake.db, inventory })).reason, "INVALID_BINDING");
  assert.equal(fake.calls.length, 0);
  const partialIdentity = fakeDatabase(undefined, history, [{ readOnly: true }]);
  assert.equal((await inspectCompatibility({ ...binding, db: partialIdentity.db, inventory })).reason, "DATABASE_IDENTITY_OR_SCHEMA_MISMATCH");
  assert.equal(partialIdentity.calls.length, 2);
  assert.equal((await inspectCompatibility({ ...binding, db: fakeDatabase([], history.slice(1)).db, inventory })).reason, "MIGRATION_BASELINE_CHANGED");
  const error = { db: { $transaction: async () => { throw new Error("postgresql://private") } } };
  const result = await inspectCompatibility({ ...binding, ...error, inventory });
  assert.equal(result.reason, "READ_ONLY_QUERY_FAILED");
  assert.equal(JSON.stringify(result).includes("private"), false);
});
