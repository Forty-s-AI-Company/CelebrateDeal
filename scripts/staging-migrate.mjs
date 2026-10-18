// Applies (or reports) the current master migration chain on the fixed,
// non-Production staging Supabase project. Run only from the protected
// "Staging migrate" workflow; the database URL comes from that GitHub
// environment and is never printed. The repository is public, so every line
// this script prints is public: only fixed codes and allowlisted Prisma
// summary lines ever reach stdout.
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FIXED_STAGING_REF = "ocbugvgojrunvenozsbx";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODES = new Set(["status", "deploy"]);
// Mirrors scripts/staging-migration-apply.mjs. Runtime pool hints are accepted
// within the same bounds (the shared runtime secret carries them) and then
// dropped, since a migration connection never needs them. Every other key
// (host, hostaddr, port, options, ...) is rejected because Prisma honours it
// over the URL authority.
const RUNTIME_HINTS = Object.freeze({ connection_limit: [1, 100], connect_timeout: [0, 120],
  pool_timeout: [0, 120], socket_timeout: [0, 120], statement_cache_size: [0, 1000] });
const SAFE_QUERY_KEYS = new Set(["schema", "sslmode", "pgbouncer", ...Object.keys(RUNTIME_HINTS)]);
const SUPABASE_TRANSACTION_POOLER_PORT = "6543";
const SAFE_SSLMODES = new Set(["require", "verify-full"]);
const SAFE_HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/u;
const POOLER_HOST = /^[a-z0-9-]+\.pooler\.supabase\.com$/u;
const MIGRATION = "\\d{12,14}_[a-z0-9_]+";
const MIGRATION_NAME = new RegExp(`^${MIGRATION}$`, "u");
// Prisma's migration engine ignores PGOPTIONS; bound lock and statement time in its URL.
export const MIGRATION_SESSION_OPTIONS = "-c lock_timeout=5000 -c statement_timeout=60000";
const PRISMA_TIMEOUT_MS = 15 * 60 * 1000;

function decode(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}

/**
 * Validate the staging URL. Returns { failure } with a fixed code, or the URL
 * Prisma should receive plus the values the workflow log must mask.
 */
export function parseStagingDatabaseUrl(value) {
  if (typeof value !== "string" || !value) return { failure: "STAGING_DATABASE_URL_INVALID" };
  if (value.includes("#")) return { failure: "STAGING_DATABASE_URL_HASH_UNSUPPORTED" };
  let db;
  try { db = new URL(value); } catch { return { failure: "STAGING_DATABASE_URL_INVALID" }; }
  if (!["postgres:", "postgresql:"].includes(db.protocol) || db.hash) return { failure: "STAGING_DATABASE_URL_INVALID" };

  const queryKeys = [...db.searchParams.keys()];
  if (new Set(queryKeys).size !== queryKeys.length) return { failure: "STAGING_DATABASE_QUERY_DUPLICATE" };
  if (queryKeys.some((key) => !SAFE_QUERY_KEYS.has(key))) return { failure: "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED" };
  if ((db.searchParams.get("schema") ?? "public") !== "public") return { failure: "STAGING_DATABASE_SCHEMA_QUERY_INVALID" };
  const sslmode = db.searchParams.get("sslmode");
  if (sslmode !== null && !SAFE_SSLMODES.has(sslmode)) return { failure: "STAGING_DATABASE_SSLMODE_QUERY_INVALID" };
  const pgbouncer = db.searchParams.get("pgbouncer");
  if (pgbouncer !== null && pgbouncer !== "true") return { failure: "STAGING_DATABASE_PGBOUNCER_QUERY_INVALID" };
  const hintsValid = Object.entries(RUNTIME_HINTS).every(([key, [min, max]]) => {
    const raw = db.searchParams.get(key);
    return raw === null || (/^\d{1,4}$/u.test(raw) && Number(raw) >= min && Number(raw) <= max);
  });
  if (!hintsValid) return { failure: "STAGING_DATABASE_RUNTIME_HINT_INVALID" };

  const user = decode(db.username);
  const password = decode(db.password);
  if (user === null || password === null) return { failure: "STAGING_DATABASE_URL_ENCODING_INVALID" };
  // Non-special schemes keep the host verbatim (no case folding, no percent decoding).
  const host = db.hostname.toLowerCase();
  if (/(?:^|[.-])prod(?:uction)?(?:$|[.-])/u.test(host)) return { failure: "STAGING_DATABASE_PRODUCTION_HOST" };
  const direct = host === `db.${FIXED_STAGING_REF}.supabase.co` && user === "postgres";
  const pooler = POOLER_HOST.test(host) && user === `postgres.${FIXED_STAGING_REF}`;
  if (!SAFE_HOSTNAME.test(host) || (!direct && !pooler)) return { failure: "STAGING_PROJECT_MISMATCH" };
  // Session mode only: Prisma migrations cannot run through the 6543 transaction
  // pooler. The runtime secret uses it, so a pooler URL on 6543 is moved to the
  // same host's session port; a direct host on any other port is refused.
  const port = db.port || "5432";
  const poolerTransactionPort = pooler && port === SUPABASE_TRANSACTION_POOLER_PORT;
  if (port !== "5432" && !poolerTransactionPort) return { failure: "STAGING_DATABASE_PORT_INVALID" };
  if (db.pathname !== "/postgres" || !password) return { failure: "STAGING_DATABASE_URL_INVALID" };

  const migrationUrl = new URL(value);
  migrationUrl.hostname = host;
  migrationUrl.port = "5432";
  // Runtime pool hints and PgBouncer mode are unnecessary for a session migration connection.
  migrationUrl.searchParams.delete("pgbouncer");
  for (const key of Object.keys(RUNTIME_HINTS)) migrationUrl.searchParams.delete(key);
  // Prisma 6 does not understand verify-full (it falls back to prefer, which
  // can downgrade to plaintext) and an omitted sslmode is prefer: always require TLS.
  migrationUrl.searchParams.set("sslmode", "require");
  migrationUrl.searchParams.set("options", MIGRATION_SESSION_OPTIONS);
  return { url: migrationUrl.toString(), host, password, rawPassword: db.password };
}

/** Return a fixed failure code for an unsafe target, or null when it is the staging project. */
export function stagingDatabaseFailureCode(value) {
  return parseStagingDatabaseUrl(value).failure ?? null;
}

/** Escape a value for a GitHub workflow command so it cannot inject another command. */
function workflowCommandValue(value) {
  return value.replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
}

/** Mask only the password (decoded, plus its encoded form when different) and the hostname. */
export function maskCommands(target) {
  const values = [target.password];
  if (target.rawPassword && target.rawPassword !== target.password) values.push(target.rawPassword);
  return [...values, target.host].map((value) => `::add-mask::${workflowCommandValue(value)}`);
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/gu;
const SUMMARY_LINES = [
  /^\d+ migrations? found in prisma\/migrations$/u,
  /^No migration found in prisma\/migrations$/u,
  /^Following migrations? have not yet been applied:$/u,
  /^The migrations? have not yet been applied:$/u,
  /^The migrations? from the database are not found locally in prisma\/migrations:$/u,
  /^Your local migration history and the migrations table from your database are different:$/u,
  /^Following migrations? have failed:$/u,
  /^Database schema is up to date!$/u,
  /^No pending migrations to apply\.$/u,
  /^The following migration\(s\) have been applied:$/u,
  /^All migrations have been successfully applied\.$/u,
];
const NAMED_LINES = [
  new RegExp(`^The last common migration is: ${MIGRATION}$`, "u"),
  new RegExp(`^Migration name: ${MIGRATION}$`, "u"),
];
const FAILED_HEADER = new RegExp(`^The \`(${MIGRATION})\` migration started at .* failed`, "u");
const SQLSTATE = /^Database error code: ([0-9A-Z]{5})$/u;
const PRISMA_CODE = /\bP[1-6]\d{3}\b/gu;

function sanitizeLine(raw) {
  const line = raw.replace(ANSI, "").trim();
  if (!line) return [];
  // Prisma error codes are kept wherever they appear, as the bare code only.
  const out = [...new Set(line.match(PRISMA_CODE) ?? [])].map((code) => `PRISMA_ERROR ${code}`);
  // Deploy prints applied migrations as a tree: "└─ 20261018090000_name/".
  const name = line.replace(/^[└├│─\s]+/u, "").replace(/\/$/u, "");
  if (MIGRATION_NAME.test(name)) return [...out, name];
  if (SUMMARY_LINES.some((pattern) => pattern.test(line))) return [...out, line];
  if (NAMED_LINES.some((pattern) => pattern.test(line))) return [...out, line];
  const failed = FAILED_HEADER.exec(line);
  if (failed) return [...out, `MIGRATION_FAILED ${failed[1]}`];
  const sqlstate = SQLSTATE.exec(line);
  if (sqlstate) return [...out, `Database error code: ${sqlstate[1]}`];
  return out;
}

/**
 * Strict allowlist: migration names, Prisma's fixed summary lines, Prisma error
 * codes, SQLSTATE codes and failed-migration names. Everything else (hosts,
 * Postgres DETAIL/DbError values, URLs) is dropped because Actions logs are public.
 */
export function sanitizePrismaOutput(text) {
  return String(text ?? "").split(/\r?\n/u).flatMap(sanitizeLine).slice(0, 200);
}

/** Classify raw Prisma output internally; nothing here is printed. */
export function classifyPrismaOutput(text) {
  const raw = String(text ?? "").replace(ANSI, "");
  return {
    diverged: /not found locally|have failed:|\bP3009\b|migration started at .* failed/u.test(raw),
    errored: /\bP[1-6]\d{3}\b/u.test(raw),
    pending: /have not yet been applied/u.test(raw),
  };
}

function spawnPrisma(args, env) {
  const child = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], {
    cwd: ROOT, env, encoding: "utf8", shell: false, windowsHide: true,
    timeout: PRISMA_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
  });
  return { status: child.status, error: child.error, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

function prismaEnv(env, url) {
  return {
    PATH: env.PATH ?? "", HOME: env.HOME ?? "", DATABASE_URL: url, DIRECT_URL: url,
    PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1",
  };
}

function migrate(mode, runner, childEnv) {
  const result = runner(["migrate", mode], childEnv);
  if (result.error) return { code: 1, spawnFailed: true, lines: ["PRISMA_SPAWN_FAILED"] };
  return { code: result.status ?? 1, lines: sanitizePrismaOutput(result.output), ...classifyPrismaOutput(result.output) };
}

/**
 * status: read-only report; pending migrations are a normal state (exit 0).
 * deploy: runs status first and refuses when history diverged, a migration
 * failed, or status itself errored.
 */
export function run(mode, env = process.env, { runner = spawnPrisma, emit = console.log } = {}) {
  if (!MODES.has(mode)) return { code: 2, lines: ["STAGING_MIGRATE_MODE_INVALID"] };
  const target = parseStagingDatabaseUrl(env.STAGING_DATABASE_URL);
  if (target.failure) return { code: 1, lines: [target.failure] };
  for (const line of maskCommands(target)) emit(line);
  const childEnv = prismaEnv(env, target.url);

  const status = migrate("status", runner, childEnv);
  if (status.spawnFailed) return { code: status.code, lines: status.lines };
  if (status.diverged) return { code: status.code || 1, lines: [...status.lines, "STAGING_HISTORY_DIVERGED"] };
  const pendingOnly = status.code === 1 && status.pending && !status.errored;
  if (status.code !== 0 && !pendingOnly) {
    return { code: status.code, lines: mode === "deploy" ? [...status.lines, "STAGING_STATUS_FAILED"] : status.lines };
  }
  if (mode === "status") {
    return { code: 0, lines: pendingOnly ? [...status.lines, "STAGING_MIGRATIONS_PENDING"] : status.lines };
  }
  const deploy = migrate("deploy", runner, childEnv);
  return { code: deploy.code, lines: deploy.lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = run(process.argv[2]);
  for (const line of result.lines) console.log(line);
  process.exitCode = result.code;
}
