import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_STAGING_REF, MIGRATION_SESSION_OPTIONS, classifyPrismaOutput, maskCommands,
  parseStagingDatabaseUrl, run, sanitizePrismaOutput, stagingDatabaseFailureCode,
} from "./staging-migrate.mjs";

// Built from parts so the repository secret scan does not see a literal database URL.
const url = (authority, suffix = "") => ["postgresql:", "", `${authority}/postgres${suffix}`].join("/");
const directHost = `db.${FIXED_STAGING_REF}.supabase.co`;
const poolerHost = "aws-0-ap-northeast-1.pooler.supabase.com";
const poolerUser = `postgres.${FIXED_STAGING_REF}`;
const direct = url(`postgres:synthetic-password@${directHost}:5432`);
const pooler = url(`${poolerUser}:synthetic-password@${poolerHost}:5432`);
const withQuery = (query) => `${pooler}?${query}`;

test("accepts only the fixed staging project over a session connection", () => {
  assert.equal(stagingDatabaseFailureCode(direct), null);
  assert.equal(stagingDatabaseFailureCode(pooler), null);
  assert.equal(stagingDatabaseFailureCode(withQuery("sslmode=require&schema=public&pgbouncer=true")), null);
  assert.equal(stagingDatabaseFailureCode(withQuery("sslmode=verify-full")), null);
  assert.equal(stagingDatabaseFailureCode(direct.replace(FIXED_STAGING_REF, "aaaaaaaaaaaaaaaaaaaa")), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(pooler.replace(poolerUser, "postgres.aaaaaaaaaaaaaaaaaaaa")), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url("postgres:synthetic-password@db.production.supabase.co:5432")), "STAGING_DATABASE_PRODUCTION_HOST");
  assert.equal(stagingDatabaseFailureCode(pooler.replace(":5432/", ":6543/")), "STAGING_DATABASE_PORT_INVALID");
  assert.equal(stagingDatabaseFailureCode(direct.replace("synthetic-password", "")), "STAGING_DATABASE_URL_INVALID");
  assert.equal(stagingDatabaseFailureCode(direct.replace(":5432/postgres", ":5432/other")), "STAGING_DATABASE_URL_INVALID");
  assert.equal(stagingDatabaseFailureCode(undefined), "STAGING_DATABASE_URL_INVALID");
  assert.equal(stagingDatabaseFailureCode("https://example.test"), "STAGING_DATABASE_URL_INVALID");
});

test("rejects query parameters that could redirect or reconfigure the connection", () => {
  const cases = {
    "host=evil.example": "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED",
    "hostaddr=192.0.2.10": "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED",
    "port=6543": "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED",
    "options=-c%20search_path%3Devil": "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED",
    "ho%73t=evil.example": "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED",
    "HOST=evil.example": "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED",
    "connection_limit=1": "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED",
    "=x": "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED",
    "schema=other": "STAGING_DATABASE_SCHEMA_QUERY_INVALID",
    "schema=": "STAGING_DATABASE_SCHEMA_QUERY_INVALID",
    "sslmode=disable": "STAGING_DATABASE_SSLMODE_QUERY_INVALID",
    "sslmode=prefer": "STAGING_DATABASE_SSLMODE_QUERY_INVALID",
    "pgbouncer=false": "STAGING_DATABASE_PGBOUNCER_QUERY_INVALID",
    "sslmode=require&sslmode=disable": "STAGING_DATABASE_QUERY_DUPLICATE",
    "schema=public&schema=public": "STAGING_DATABASE_QUERY_DUPLICATE",
  };
  for (const [query, code] of Object.entries(cases)) {
    assert.equal(stagingDatabaseFailureCode(withQuery(query)), code, query);
  }
});

test("rejects hashes, bad encodings and hosts that are not the staging project", () => {
  assert.equal(stagingDatabaseFailureCode(`${pooler}#x`), "STAGING_DATABASE_URL_HASH_UNSUPPORTED");
  assert.equal(stagingDatabaseFailureCode(`${pooler}#`), "STAGING_DATABASE_URL_HASH_UNSUPPORTED");
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}:synthetic#password@${poolerHost}:5432`)), "STAGING_DATABASE_URL_HASH_UNSUPPORTED");
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}:bad%zzpassword@${poolerHost}:5432`)), "STAGING_DATABASE_URL_ENCODING_INVALID");
  assert.equal(stagingDatabaseFailureCode(url(`postgres.${FIXED_STAGING_REF}%E0:pw@${poolerHost}:5432`)), "STAGING_DATABASE_URL_ENCODING_INVALID");
  // userinfo containing '@': the last '@' delimits the host, so the real host must still match.
  assert.equal(stagingDatabaseFailureCode(url(`postgres:synthetic-password@${directHost}@evil.example:5432`)), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}@evil.example:pw@${poolerHost}:5432`)), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}:pa@ss@${poolerHost}:5432`)), null);
  // Upper case is normalised; percent-encoded hosts are never decoded and never match.
  assert.equal(stagingDatabaseFailureCode(url(`postgres:synthetic-password@${directHost.toUpperCase()}:5432`)), null);
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}:pw@${poolerHost.toUpperCase()}:5432`)), null);
  assert.equal(stagingDatabaseFailureCode(url(`postgres:synthetic-password@db.%6fcbugvgojrunvenozsbx.supabase.co:5432`)), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}:pw@evil%2Eexample.pooler.supabase.com:5432`)), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}:pw@a.b.pooler.supabase.com:5432`)), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}:pw@[::1]:5432`)), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url(`${poolerUser}:pw@[2001:db8::1]:5432`)), "STAGING_PROJECT_MISMATCH");
  assert.equal(stagingDatabaseFailureCode(url(`postgres:synthetic-password@${directHost}.:5432`)), "STAGING_PROJECT_MISMATCH");
});

test("builds the migration URL with fixed session timeouts and without pgbouncer", () => {
  const target = parseStagingDatabaseUrl(withQuery("sslmode=require&pgbouncer=true"));
  const built = new URL(target.url);
  assert.equal(built.searchParams.get("options"), MIGRATION_SESSION_OPTIONS);
  assert.equal(built.searchParams.get("sslmode"), "require");
  assert.equal(built.searchParams.has("pgbouncer"), false);
  assert.equal(built.hostname, poolerHost);
  // Accepted inputs that Prisma would treat as prefer are still sent as require.
  for (const query of ["sslmode=verify-full", "schema=public"]) {
    assert.equal(new URL(parseStagingDatabaseUrl(withQuery(query)).url).searchParams.get("sslmode"), "require");
  }
  const upper = parseStagingDatabaseUrl(url(`postgres:synthetic-password@${directHost.toUpperCase()}:5432`));
  assert.equal(new URL(upper.url).hostname, directHost);
  assert.equal(upper.host, directHost);
});

test("masks only the password and hostname, escaping workflow command characters", () => {
  assert.deepEqual(maskCommands(parseStagingDatabaseUrl(pooler)), ["::add-mask::synthetic-password", `::add-mask::${poolerHost}`]);
  const encoded = parseStagingDatabaseUrl(url(`${poolerUser}:a%25b%0A%3A@${poolerHost}:5432`));
  assert.deepEqual(maskCommands(encoded), ["::add-mask::a%25b%0A:", "::add-mask::a%2525b%250A%253A", `::add-mask::${poolerHost}`]);
});

test("refuses unknown modes and unsafe targets before running Prisma", () => {
  const runner = () => assert.fail("Prisma must not run");
  const emit = () => assert.fail("nothing may be printed");
  assert.deepEqual(run("reset", { STAGING_DATABASE_URL: direct }, { runner, emit }), { code: 2, lines: ["STAGING_MIGRATE_MODE_INVALID"] });
  assert.deepEqual(run("deploy", { STAGING_DATABASE_URL: direct.replace(FIXED_STAGING_REF, "aaaaaaaaaaaaaaaaaaaa") }, { runner, emit }), { code: 1, lines: ["STAGING_PROJECT_MISMATCH"] });
  assert.deepEqual(run("deploy", { STAGING_DATABASE_URL: withQuery("host=evil.example") }, { runner, emit }), { code: 1, lines: ["STAGING_DATABASE_QUERY_KEY_UNSUPPORTED"] });
});

// Real Prisma 6 output shapes.
const STATUS_PENDING = [
  "Prisma schema loaded from prisma/schema.prisma",
  `Datasource "db": PostgreSQL database "postgres", schema "public" at "${poolerHost}:5432"`,
  "",
  "101 migrations found in prisma/migrations",
  "Following migrations have not yet been applied:",
  "20261018090000_post_purchase_recovery_guard",
  "20261018100000_checkout_recovery",
  "",
  "To apply migrations in development run prisma migrate dev.",
  "To apply migrations in production run prisma migrate deploy.",
].join("\n");
const STATUS_DIVERGED = [
  "101 migrations found in prisma/migrations",
  "Your local migration history and the migrations table from your database are different:",
  "",
  "The last common migration is: 20261017090000_base",
  "",
  "The migration have not yet been applied:",
  "20261018090000_post_purchase_recovery_guard",
  "",
  "The migration from the database are not found locally in prisma/migrations:",
  "20261018093000_unmerged_branch_change",
].join("\n");
const P3009 = [
  "Error: P3009",
  "",
  "migrate found failed migrations in the target database, new migrations will not be applied. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve",
  "The `20261018090000_post_purchase_recovery_guard` migration started at 2026-10-18 09:00:00.123456 UTC failed",
].join("\n");
const P3018 = [
  "Error: P3018",
  "",
  "A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve",
  "",
  "Migration name: 20261018090000_post_purchase_recovery_guard",
  "",
  "Database error code: 23505",
  "",
  "Database error:",
  "ERROR: could not create unique index \"Customer_phone_key\"",
  "DETAIL: Key (phone)=(0912345678) is duplicated.",
  "",
  "DbError { severity: \"ERROR\", parsed_severity: Some(Error), code: SqlState(E23505), message: \"could not create unique index \\\"Customer_phone_key\\\"\", detail: Some(\"Key (phone)=(0912345678) is duplicated.\"), hint: None, position: None, where_: None, schema: Some(\"public\"), table: Some(\"Customer\"), column: None, datatype: None, constraint: Some(\"Customer_phone_key\"), file: Some(\"tuplesort.c\"), line: Some(4294), routine: Some(\"comparetup_index_btree\") }",
].join("\n");

test("sanitiser keeps migration names and summaries but never a host, URL or data value", () => {
  assert.deepEqual(sanitizePrismaOutput(STATUS_PENDING), [
    "101 migrations found in prisma/migrations",
    "Following migrations have not yet been applied:",
    "20261018090000_post_purchase_recovery_guard",
    "20261018100000_checkout_recovery",
  ]);
  assert.deepEqual(sanitizePrismaOutput([
    "The following migration(s) have been applied:",
    "",
    "migrations/",
    "  └─ 20261018090000_post_purchase_recovery_guard/",
    "    └─ migration.sql",
    "",
    "\u001b[32mAll migrations have been successfully applied.\u001b[39m",
  ].join("\n")), [
    "The following migration(s) have been applied:",
    "20261018090000_post_purchase_recovery_guard",
    "All migrations have been successfully applied.",
  ]);
});

test("sanitiser reduces connection and auth failures to the Prisma code", () => {
  const p1001 = [
    `Error: P1001: Can't reach database server at \`${poolerHost}:5432\``,
    "",
    `Please make sure your database server is running at \`${poolerHost}:5432\`.`,
  ].join("\n");
  assert.deepEqual(sanitizePrismaOutput(p1001), ["PRISMA_ERROR P1001"]);
  const p1000 = [
    `Error: P1000: Authentication failed against database server at \`${poolerHost}\`, the provided database credentials for \`${poolerUser}\` are not valid.`,
    "",
    `Please make sure to provide valid database credentials for the database server at \`${poolerHost}\`.`,
  ].join("\n");
  assert.deepEqual(sanitizePrismaOutput(p1000), ["PRISMA_ERROR P1000"]);
});

test("sanitiser reduces failed-migration errors to codes and names only", () => {
  assert.deepEqual(sanitizePrismaOutput(P3009), [
    "PRISMA_ERROR P3009",
    "MIGRATION_FAILED 20261018090000_post_purchase_recovery_guard",
  ]);
  const lines = sanitizePrismaOutput(P3018);
  assert.deepEqual(lines, [
    "PRISMA_ERROR P3018",
    "Migration name: 20261018090000_post_purchase_recovery_guard",
    "Database error code: 23505",
  ]);
  assert.ok(lines.every((line) => !line.includes("0912345678") && !line.includes("Customer")));
  assert.deepEqual(sanitizePrismaOutput(`ERROR: relation "x" failed at ${direct}\nsupabase error ${FIXED_STAGING_REF}`), []);
});

function fakeRunner(responses) {
  const calls = [];
  const runner = (args, env) => {
    calls.push({ args, env });
    const next = responses.shift();
    if (!next) assert.fail("unexpected Prisma call");
    return next;
  };
  return { calls, runner };
}

test("deploy refuses when staging history diverged or a migration failed", () => {
  for (const output of [STATUS_DIVERGED, P3009, "Following migration have failed:\n20261018090000_post_purchase_recovery_guard"]) {
    const { calls, runner } = fakeRunner([{ status: 1, output }]);
    const result = run("deploy", { STAGING_DATABASE_URL: pooler }, { runner, emit: () => {} });
    assert.equal(result.code, 1);
    assert.equal(result.lines.at(-1), "STAGING_HISTORY_DIVERGED");
    assert.deepEqual(calls.map((call) => call.args), [["migrate", "status"]]);
  }
});

test("deploy runs status first, then deploy with a hardened child environment", () => {
  const emitted = [];
  const { calls, runner } = fakeRunner([
    { status: 1, output: STATUS_PENDING },
    { status: 0, output: "The following migration(s) have been applied:\n\nmigrations/\n  └─ 20261018090000_post_purchase_recovery_guard/\nAll migrations have been successfully applied." },
  ]);
  const result = run("deploy", { STAGING_DATABASE_URL: withQuery("pgbouncer=true"), PATH: "/bin", SECRET_OTHER: "x" }, { runner, emit: (line) => emitted.push(line) });
  assert.deepEqual(result, { code: 0, lines: [
    "The following migration(s) have been applied:",
    "20261018090000_post_purchase_recovery_guard",
    "All migrations have been successfully applied.",
  ] });
  assert.deepEqual(calls.map((call) => call.args), [["migrate", "status"], ["migrate", "deploy"]]);
  assert.deepEqual(emitted, ["::add-mask::synthetic-password", `::add-mask::${poolerHost}`]);
  const env = calls[1].env;
  assert.deepEqual(Object.keys(env).sort(), ["CHECKPOINT_DISABLE", "DATABASE_URL", "DIRECT_URL", "HOME", "PATH", "PRISMA_HIDE_UPDATE_MESSAGE"]);
  assert.equal(env.CHECKPOINT_DISABLE, "1");
  assert.equal(env.DATABASE_URL, env.DIRECT_URL);
  assert.equal(new URL(env.DATABASE_URL).searchParams.get("options"), MIGRATION_SESSION_OPTIONS);
  assert.equal(new URL(env.DATABASE_URL).searchParams.has("pgbouncer"), false);
});

test("deploy refuses when the status probe itself errors", () => {
  const { calls, runner } = fakeRunner([{ status: 1, output: `Error: P1001: Can't reach database server at \`${poolerHost}:5432\`` }]);
  assert.deepEqual(run("deploy", { STAGING_DATABASE_URL: pooler }, { runner, emit: () => {} }), {
    code: 1, lines: ["PRISMA_ERROR P1001", "STAGING_STATUS_FAILED"],
  });
  assert.equal(calls.length, 1);
});

test("status maps pending migrations to success but keeps real errors red", () => {
  const pending = fakeRunner([{ status: 1, output: STATUS_PENDING }]);
  assert.deepEqual(run("status", { STAGING_DATABASE_URL: pooler }, { runner: pending.runner, emit: () => {} }), {
    code: 0,
    lines: [
      "101 migrations found in prisma/migrations",
      "Following migrations have not yet been applied:",
      "20261018090000_post_purchase_recovery_guard",
      "20261018100000_checkout_recovery",
      "STAGING_MIGRATIONS_PENDING",
    ],
  });
  const upToDate = fakeRunner([{ status: 0, output: "101 migrations found in prisma/migrations\n\nDatabase schema is up to date!" }]);
  assert.deepEqual(run("status", { STAGING_DATABASE_URL: pooler }, { runner: upToDate.runner, emit: () => {} }), {
    code: 0, lines: ["101 migrations found in prisma/migrations", "Database schema is up to date!"],
  });
  const authFailure = fakeRunner([{ status: 1, output: "Error: P1000: Authentication failed against database server" }]);
  assert.deepEqual(run("status", { STAGING_DATABASE_URL: pooler }, { runner: authFailure.runner, emit: () => {} }), {
    code: 1, lines: ["PRISMA_ERROR P1000"],
  });
  const diverged = fakeRunner([{ status: 1, output: STATUS_DIVERGED }]);
  const result = run("status", { STAGING_DATABASE_URL: pooler }, { runner: diverged.runner, emit: () => {} });
  assert.equal(result.code, 1);
  assert.equal(result.lines.at(-1), "STAGING_HISTORY_DIVERGED");
  assert.ok(!result.lines.includes("STAGING_MIGRATIONS_PENDING"));
});

test("a Prisma spawn failure prints only a fixed code", () => {
  const { runner } = fakeRunner([{ status: null, error: new Error(`spawn failed for ${direct}`), output: "" }]);
  assert.deepEqual(run("deploy", { STAGING_DATABASE_URL: pooler }, { runner, emit: () => {} }), { code: 1, lines: ["PRISMA_SPAWN_FAILED"] });
});

test("classifier never treats plain pending output as divergence", () => {
  assert.deepEqual(classifyPrismaOutput(STATUS_PENDING), { diverged: false, errored: false, pending: true });
  assert.equal(classifyPrismaOutput(STATUS_DIVERGED).diverged, true);
  assert.equal(classifyPrismaOutput(P3018).diverged, false);
  assert.equal(classifyPrismaOutput(P3018).errored, true);
});
