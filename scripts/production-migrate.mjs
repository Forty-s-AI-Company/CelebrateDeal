// F-064 / B04-10: applies (or reports) the protected master migration chain on
// the fixed Production Supabase project. Run only from the "Production
// migrate" workflow, which requires the `production` GitHub environment
// (owner-configured required reviewers) and a successful backup run ID. The
// database URL comes from that environment and is never printed; the
// repository is public, so every printed line is a fixed code or an
// allowlisted Prisma summary line (shared with scripts/staging-migrate.mjs).
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FIXED_STAGING_REF,
  MIGRATION_SESSION_OPTIONS,
  classifyPrismaOutput,
  maskCommands,
  sanitizePrismaOutput,
} from "./staging-migrate.mjs";

export const FIXED_PRODUCTION_REF = "awigitueyqdqaqwbjdgu";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODES = new Set(["status", "deploy"]);
const RUNTIME_HINTS = Object.freeze({ connection_limit: [1, 100], connect_timeout: [0, 120],
  pool_timeout: [0, 120], socket_timeout: [0, 120], statement_cache_size: [0, 1000] });
const SAFE_QUERY_KEYS = new Set(["schema", "sslmode", "pgbouncer", ...Object.keys(RUNTIME_HINTS)]);
const SUPABASE_TRANSACTION_POOLER_PORT = "6543";
const SAFE_SSLMODES = new Set(["require", "verify-full"]);
const SAFE_HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/u;
const POOLER_HOST = /^[a-z0-9-]+\.pooler\.supabase\.com$/u;
const PRISMA_TIMEOUT_MS = 15 * 60 * 1000;
const RUN_ID = /^[1-9]\d{5,14}$/u;
/**
 * The only workflow whose runs count as a Production backup. Fixed in code
 * (reviewed) rather than a repository variable. That workflow must back up the
 * fixed Production project only (no target input) and upload an artifact named
 * `${PRODUCTION_BACKUP_ARTIFACT_PREFIX}<run id>`.
 */
export const PRODUCTION_BACKUP_WORKFLOW = ".github/workflows/production-backup.yml";
export const PRODUCTION_BACKUP_ARTIFACT_PREFIX = "production-database-backup-";
const BACKUP_EVENTS = new Set(["workflow_dispatch", "schedule"]);
/** A deploy must follow a backup taken within this window. */
export const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function decode(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}

/**
 * Validate the Production URL: only the fixed Production project, session
 * mode, TLS required, and the same lock/statement timeouts as staging.
 */
export function parseProductionDatabaseUrl(value) {
  if (typeof value !== "string" || !value) return { failure: "PRODUCTION_DATABASE_URL_INVALID" };
  if (value.includes("#")) return { failure: "PRODUCTION_DATABASE_URL_HASH_UNSUPPORTED" };
  let db;
  try { db = new URL(value); } catch { return { failure: "PRODUCTION_DATABASE_URL_INVALID" }; }
  if (!["postgres:", "postgresql:"].includes(db.protocol) || db.hash) return { failure: "PRODUCTION_DATABASE_URL_INVALID" };

  const queryKeys = [...db.searchParams.keys()];
  if (new Set(queryKeys).size !== queryKeys.length) return { failure: "PRODUCTION_DATABASE_QUERY_DUPLICATE" };
  if (queryKeys.some((key) => !SAFE_QUERY_KEYS.has(key))) return { failure: "PRODUCTION_DATABASE_QUERY_KEY_UNSUPPORTED" };
  if ((db.searchParams.get("schema") ?? "public") !== "public") return { failure: "PRODUCTION_DATABASE_SCHEMA_QUERY_INVALID" };
  const sslmode = db.searchParams.get("sslmode");
  if (sslmode !== null && !SAFE_SSLMODES.has(sslmode)) return { failure: "PRODUCTION_DATABASE_SSLMODE_QUERY_INVALID" };
  const pgbouncer = db.searchParams.get("pgbouncer");
  if (pgbouncer !== null && pgbouncer !== "true") return { failure: "PRODUCTION_DATABASE_PGBOUNCER_QUERY_INVALID" };
  const hintsValid = Object.entries(RUNTIME_HINTS).every(([key, [min, max]]) => {
    const raw = db.searchParams.get(key);
    return raw === null || (/^\d{1,4}$/u.test(raw) && Number(raw) >= min && Number(raw) <= max);
  });
  if (!hintsValid) return { failure: "PRODUCTION_DATABASE_RUNTIME_HINT_INVALID" };

  const user = decode(db.username);
  const password = decode(db.password);
  if (user === null || password === null) return { failure: "PRODUCTION_DATABASE_URL_ENCODING_INVALID" };
  const host = db.hostname.toLowerCase();
  if (host.includes(FIXED_STAGING_REF) || user.includes(FIXED_STAGING_REF)) return { failure: "PRODUCTION_DATABASE_IS_STAGING" };
  const direct = host === `db.${FIXED_PRODUCTION_REF}.supabase.co` && user === "postgres";
  const pooler = POOLER_HOST.test(host) && user === `postgres.${FIXED_PRODUCTION_REF}`;
  if (!SAFE_HOSTNAME.test(host) || (!direct && !pooler)) return { failure: "PRODUCTION_PROJECT_MISMATCH" };
  const port = db.port || "5432";
  const poolerTransactionPort = pooler && port === SUPABASE_TRANSACTION_POOLER_PORT;
  if (port !== "5432" && !poolerTransactionPort) return { failure: "PRODUCTION_DATABASE_PORT_INVALID" };
  if (db.pathname !== "/postgres" || !password) return { failure: "PRODUCTION_DATABASE_URL_INVALID" };

  const migrationUrl = new URL(value);
  migrationUrl.hostname = host;
  migrationUrl.port = "5432";
  migrationUrl.searchParams.delete("pgbouncer");
  for (const key of Object.keys(RUNTIME_HINTS)) migrationUrl.searchParams.delete(key);
  migrationUrl.searchParams.set("sslmode", "require");
  migrationUrl.searchParams.set("options", MIGRATION_SESSION_OPTIONS);
  return { url: migrationUrl.toString(), host, password, rawPassword: db.password };
}

async function githubJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" },
  });
  if (!response.ok) return { notFound: true };
  return { body: await response.json() };
}

/**
 * Checks the backup run through the GitHub API before any database
 * connection. It must be a run of this repository's fixed Production backup
 * workflow (PRODUCTION_BACKUP_WORKFLOW), dispatched or scheduled on master,
 * completed with conclusion=success within BACKUP_MAX_AGE_MS, and it must
 * have produced the unexpired Production backup artifact. Returns a fixed
 * failure code or null.
 */
export async function verifyBackupRun(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const runId = env.BACKUP_RUN_ID ?? "";
  if (!RUN_ID.test(runId)) return "BACKUP_RUN_ID_INVALID";
  const repository = env.GITHUB_REPOSITORY ?? "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !env.GITHUB_TOKEN) return "BACKUP_RUN_LOOKUP_UNAVAILABLE";
  const base = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;

  let run;
  let artifacts;
  try {
    const runResult = await githubJson(fetchImpl, base, env.GITHUB_TOKEN);
    if (runResult.notFound) return "BACKUP_RUN_NOT_FOUND";
    run = runResult.body;
    if (!run || typeof run !== "object") return "BACKUP_RUN_NOT_FOUND";
    if (run.path !== PRODUCTION_BACKUP_WORKFLOW) return "BACKUP_RUN_WRONG_WORKFLOW";
    if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) return "BACKUP_RUN_WRONG_REPOSITORY";
    if (run.head_branch !== "master" || !BACKUP_EVENTS.has(run.event)) return "BACKUP_RUN_NOT_MASTER";
    if (run.status !== "completed" || run.conclusion !== "success") return "BACKUP_RUN_NOT_SUCCESSFUL";
    const finishedAt = Date.parse(run.updated_at ?? "");
    if (!Number.isFinite(finishedAt) || finishedAt > now || now - finishedAt > BACKUP_MAX_AGE_MS) return "BACKUP_RUN_TOO_OLD";
    const artifactResult = await githubJson(fetchImpl, `${base}/artifacts?per_page=100`, env.GITHUB_TOKEN);
    if (artifactResult.notFound) return "BACKUP_ARTIFACT_MISSING";
    artifacts = artifactResult.body?.artifacts;
  } catch {
    return "BACKUP_RUN_LOOKUP_FAILED";
  }
  const expected = `${PRODUCTION_BACKUP_ARTIFACT_PREFIX}${runId}`;
  const artifact = Array.isArray(artifacts) ? artifacts.find((entry) => entry?.name === expected) : undefined;
  if (!artifact || artifact.expired !== false || !(Number(artifact.size_in_bytes) > 0)) return "BACKUP_ARTIFACT_MISSING";
  return null;
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
 * status: read-only report (pending migrations exit 0).
 * deploy: verifies the backup run, runs status first, and refuses when
 * history diverged, a migration failed (P3009) or status errored.
 */
export async function run(mode, env = process.env, { runner = spawnPrisma, emit = console.log, fetchImpl, now } = {}) {
  if (!MODES.has(mode)) return { code: 2, lines: ["PRODUCTION_MIGRATE_MODE_INVALID"] };
  const target = parseProductionDatabaseUrl(env.PRODUCTION_DATABASE_URL);
  if (target.failure) return { code: 1, lines: [target.failure] };
  for (const line of maskCommands(target)) emit(line);

  if (mode === "deploy") {
    const backupFailure = await verifyBackupRun(env, { fetchImpl, now });
    if (backupFailure) return { code: 1, lines: [backupFailure] };
  }
  const childEnv = prismaEnv(env, target.url);

  const status = migrate("status", runner, childEnv);
  if (status.spawnFailed) return { code: status.code, lines: status.lines };
  if (status.diverged) return { code: status.code || 1, lines: [...status.lines, "PRODUCTION_HISTORY_DIVERGED"] };
  const pendingOnly = status.code === 1 && status.pending && !status.errored;
  if (status.code !== 0 && !pendingOnly) {
    return { code: status.code, lines: mode === "deploy" ? [...status.lines, "PRODUCTION_STATUS_FAILED"] : status.lines };
  }
  if (mode === "status") {
    return { code: 0, lines: pendingOnly ? [...status.lines, "PRODUCTION_MIGRATIONS_PENDING"] : status.lines };
  }
  if (!pendingOnly) return { code: 0, lines: [...status.lines, "PRODUCTION_NOTHING_TO_DEPLOY"] };
  const deploy = migrate("deploy", runner, childEnv);
  return { code: deploy.code, lines: [...deploy.lines, ...(deploy.code === 0 ? [] : ["PRODUCTION_DEPLOY_FAILED"])] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run(process.argv[2]);
  for (const line of result.lines) console.log(line);
  process.exitCode = result.code;
}
