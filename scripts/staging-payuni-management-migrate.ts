import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLinkedStagingProject, assertPrepareEnvironment, currentUserSid, restrictToCurrentUser, sanitizedCliEnvironment } from "./staging-payuni-management-prepare";

const MAIN_WORKSPACE = "C:\\Users\\eden\\Downloads\\AI\\CelebrateDeal";
const PROFILE = "celebratedeal-staging-20261002";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PENDING = {
  "20260929170000_payment_method_setup_intent": "8384b09e5388fb6637bb40d903e17b43858a895b438a1781bee9c5953586b309",
  "20260930094500_payuni_live_probe": "b1c412b6a43d747ad1fb1a3245fad834190721198732b1359e56707f04a21046",
} as const;
type Migration = { name: string; sql: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (value: string) => value.replaceAll("\r\n", "\n");

/** Exact two-file DDL, with Prisma history recorded in the same transaction.
 * This is not prisma migrate deploy. Existing history must match the local
 * inventory, including Prisma's accepted LF/CRLF checksum forms, before DDL.
 */
export function buildMigrationSql(migrations: Migration[]) {
  if (migrations.length !== 81 || new Set(migrations.map((item) => item.name)).size !== 81
    || migrations.some((item) => !/^\d{12,14}_[a-z0-9_]+$/u.test(item.name))) {
    throw new Error("MIGRATION_INVENTORY_INVALID");
  }
  const pending = Object.entries(PENDING).map(([name, checksum]) => {
    const item = migrations.find((entry) => entry.name === name);
    if (!item || digest(normalize(item.sql)) !== checksum) throw new Error("MIGRATION_SOURCE_CHANGED");
    return { name, checksum, sql: normalize(item.sql) };
  });
  const baseline = migrations.filter((item) => !(item.name in PENDING));
  const expected = baseline.map(({ name, sql }) => {
    const lf = normalize(sql);
    return `('${name}', '${digest(lf)}', '${digest(lf.replaceAll("\n", "\r\n"))}')`;
  }).join(",\n");
  return `BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
SELECT pg_catalog.pg_advisory_xact_lock(351, 20261003);
DO $precheck$
BEGIN
  IF current_user <> 'postgres'
    OR current_setting('transaction_isolation') <> 'serializable'
    OR (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 79
    OR (SELECT count(DISTINCT migration_name) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 79
    OR EXISTS (SELECT 1 FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    OR EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name IN (${pending.map((item) => `'${item.name}'`).join(",")}))
    OR to_regclass('public."PaymentMethodSetupIntent"') IS NOT NULL
    OR to_regclass('public."PayUniLiveProbe"') IS NOT NULL THEN
    RAISE EXCEPTION 'MIGRATION_PRECHECK_FAILED';
  END IF;
  IF (SELECT count(*) FROM public._prisma_migrations AS history
    JOIN (VALUES ${expected}) AS source(name, lf, crlf)
      ON history.migration_name=source.name AND history.checksum IN (source.lf,source.crlf)
    WHERE history.finished_at IS NOT NULL AND history.rolled_back_at IS NULL) <> 79 THEN
    RAISE EXCEPTION 'MIGRATION_HISTORY_MISMATCH';
  END IF;
END $precheck$;
${pending.map((item) => `${item.sql}
INSERT INTO public._prisma_migrations
  (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
VALUES ('${randomUUID()}', '${item.checksum}', CURRENT_TIMESTAMP, '${item.name}', CURRENT_TIMESTAMP, 1);`).join("\n")}
DO $postcheck$
BEGIN
  IF (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 81
    OR (SELECT count(*) FROM pg_class WHERE oid IN ('public."PaymentMethodSetupIntent"'::regclass,'public."PayUniLiveProbe"'::regclass) AND relrowsecurity) <> 2
    OR EXISTS (SELECT 1 FROM public."PaymentMethodSetupIntent")
    OR EXISTS (SELECT 1 FROM public."PayUniLiveProbe") THEN
    RAISE EXCEPTION 'MIGRATION_POSTCHECK_FAILED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles AS role
    CROSS JOIN (VALUES ('public."PaymentMethodSetupIntent"'), ('public."PayUniLiveProbe"')) AS target(name)
    WHERE role.rolname IN ('anon', 'authenticated', 'service_role')
      AND (has_table_privilege(role.oid, target.name, 'SELECT')
        OR has_table_privilege(role.oid, target.name, 'INSERT')
        OR has_table_privilege(role.oid, target.name, 'UPDATE')
        OR has_table_privilege(role.oid, target.name, 'DELETE'))) THEN
    RAISE EXCEPTION 'MIGRATION_DATA_API_GRANTS_PRESENT';
  END IF;
END $postcheck$;
COMMIT;`;
}

function fixedCli(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync("supabase.exe", args, {
    cwd: MAIN_WORKSPACE, env: sanitizedCliEnvironment(env), shell: false,
    windowsHide: true, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("MIGRATION_CLI_FAILED_VERIFY_STATE_BEFORE_RETRY");
  return result.stdout.trim();
}

export async function runMigrations(args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (args.length !== 1 || args[0] !== "--apply"
    || env.STAGING_PAYUNI_MIGRATION_CHANGE_APPROVED !== "true") throw new Error("MIGRATION_APPROVAL_REQUIRED");
  assertPrepareEnvironment(env);
  assertLinkedStagingProject();
  if (process.platform !== "win32" || fixedCli(["--version"], env) !== "2.108.0") throw new Error("MIGRATION_CLI_VERSION_INVALID");
  const directory = path.join(ROOT, "prisma", "migrations");
  const inventory = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({ name: entry.name, sql: readFileSync(path.join(directory, entry.name, "migration.sql"), "utf8") }));
  const sql = buildMigrationSql(inventory);
  const sid = currentUserSid();
  const temporary = mkdtempSync(path.join(os.tmpdir(), "celebratedeal-fixed-migrations-"));
  const sqlFile = path.join(temporary, "apply.sql");
  let created = false;
  try {
    // Only public schema DDL and source checksums; no row data or credentials.
    restrictToCurrentUser(temporary, sid, true);
    closeSync(openSync(sqlFile, "wx", 0o600));
    created = true;
    restrictToCurrentUser(sqlFile, sid, false);
    writeFileSync(sqlFile, sql, { encoding: "utf8", flag: "w" });
    fixedCli(["--workdir", MAIN_WORKSPACE, "db", "query", "--linked", "--profile", PROFILE, "--file", sqlFile], env);
  } finally {
    if (created) unlinkSync(sqlFile);
    rmdirSync(temporary);
  }
}

if (process.argv[1]?.endsWith("staging-payuni-management-migrate.ts")) {
  runMigrations(process.argv.slice(2)).then(() => process.stdout.write("STAGING_PAYUNI_MIGRATIONS_APPLIED\n"))
    .catch(() => { process.stderr.write("STAGING_PAYUNI_MIGRATIONS_FAILED_VERIFY_STATE_BEFORE_RETRY\n"); process.exitCode = 1; });
}
