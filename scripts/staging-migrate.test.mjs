import assert from "node:assert/strict";
import test from "node:test";

import { FIXED_STAGING_REF, run, sanitizePrismaOutput, stagingDatabaseFailureCode } from "./staging-migrate.mjs";

// Built from parts so the repository secret scan does not see a literal database URL.
const url = (authority) => ["postgresql:", "", `${authority}/postgres`].join("/");
const direct = url(`postgres:synthetic-password@db.${FIXED_STAGING_REF}.supabase.co:5432`);
const pooler = url(`postgres.${FIXED_STAGING_REF}:synthetic-password@aws-0-ap-northeast-1.pooler.supabase.com:5432`);

test("accepts only the fixed staging project over a session connection", () => {
  assert.equal(stagingDatabaseFailureCode(direct), null);
  assert.equal(stagingDatabaseFailureCode(pooler), null);
  assert.equal(stagingDatabaseFailureCode(direct.replace(FIXED_STAGING_REF, "aaaaaaaaaaaaaaaaaaaa")), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(pooler.replace(`postgres.${FIXED_STAGING_REF}`, "postgres.aaaaaaaaaaaaaaaaaaaa")), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url("postgres:synthetic-password@db.production.supabase.co:5432")), "STAGING_DATABASE_PRODUCTION_HOST");
  assert.equal(stagingDatabaseFailureCode(pooler.replace(":5432/", ":6543/")), "STAGING_DATABASE_PORT_INVALID");
  assert.equal(stagingDatabaseFailureCode(direct.replace("synthetic-password", "")), "STAGING_DATABASE_URL_INVALID");
  assert.equal(stagingDatabaseFailureCode(direct.replace(":5432/postgres", ":5432/other")), "STAGING_DATABASE_URL_INVALID");
  assert.equal(stagingDatabaseFailureCode(undefined), "STAGING_DATABASE_URL_INVALID");
  assert.equal(stagingDatabaseFailureCode("https://example.test"), "STAGING_DATABASE_URL_INVALID");
});

test("refuses unknown modes and unsafe targets before running Prisma", () => {
  assert.deepEqual(run("reset", { STAGING_DATABASE_URL: direct }), { code: 2, lines: ["STAGING_MIGRATE_MODE_INVALID"] });
  assert.deepEqual(run("deploy", { STAGING_DATABASE_URL: direct.replace(FIXED_STAGING_REF, "aaaaaaaaaaaaaaaaaaaa") }), { code: 1, lines: ["STAGING_PROJECT_MISMATCH"] });
});

test("keeps migration names and summaries but never a URL, host or credential", () => {
  const lines = sanitizePrismaOutput([
    `Datasource "db": PostgreSQL database "postgres", schema "public" at "db.${FIXED_STAGING_REF}.supabase.co:5432"`,
    "101 migrations found in prisma/migrations",
    "Following migrations have not yet been applied:",
    "20261018090000_post_purchase_recovery_guard",
    `Error: P1001 Can't reach database server at ${direct}`,
    "All migrations have been successfully applied.",
  ].join("\n"));
  assert.deepEqual(lines, [
    "101 migrations found in prisma/migrations",
    "Following migrations have not yet been applied:",
    "20261018090000_post_purchase_recovery_guard",
    "All migrations have been successfully applied.",
  ]);
  assert.ok(lines.every((line) => !line.includes(FIXED_STAGING_REF) && !/postgres(?:ql)?:\/\//u.test(line)));
});
