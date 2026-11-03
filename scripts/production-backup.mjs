// O-20(b) / F-058: encrypted logical backup of the fixed Production Supabase
// project. Run only from the "Production backup" workflow
// (.github/workflows/production-backup.yml), which is manual, protected-master
// only and gated by the `production` GitHub environment (owner-configured
// required reviewers). A successful run of that workflow is what
// scripts/production-migrate.mjs accepts as `backup_run_id`.
//
// The repository is public and workflow artifacts of a public repository can
// be downloaded by any signed-in GitHub user, so:
// - the database URL comes from the environment secret, is validated against
//   the fixed Production project (shared with production-migrate.mjs) and is
//   never printed or passed on a command line (PG* variables only);
// - plaintext (dump, aggregates) only ever exists in a 0700 tmpfs directory
//   that is removed before this script returns;
// - the artifact holds age ciphertext encrypted to the reviewed recipient in
//   ops/backup/keys/production-backup.agepub, whose SHA-256 must equal the
//   owner-set environment variable PRODUCTION_BACKUP_RECIPIENT_SHA256, plus a
//   receipt without data;
// - only Node built-ins are imported: this runs in the job that holds the
//   Production secret, where no npm dependency is installed;
// - every printed line is a fixed code, a count or a SHA-256 digest.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseProductionDatabaseUrl } from "./production-migrate.mjs";
import { maskCommands } from "./staging-migrate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** PostgreSQL 17.10 (alpine) client image, pinned by its multi-arch index digest. */
export const POSTGRES_IMAGE_DIGEST = "sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
/** Local tag the workflow gives the pulled image; the script checks it still resolves to the digest. */
export const POSTGRES_IMAGE = "celebratedeal-production-backup-postgres:17.10-alpine";
const PG_DUMP_VERSION = /^pg_dump \(PostgreSQL\) 17\.10(?:\s|$)/u;
/** The workflow installs this age release after checking its published SHA-256. */
export const AGE_VERSION = "v1.3.1";
export const RECIPIENT_FILE = "ops/backup/keys/production-backup.agepub";
/**
 * Owner-set `production` environment variable holding the SHA-256 of
 * RECIPIENT_FILE (LF line endings). A pull request that swaps the public key
 * cannot also change this value, so a swapped key fails closed.
 */
export const RECIPIENT_PIN_VARIABLE = "PRODUCTION_BACKUP_RECIPIENT_SHA256";
const AGE_RECIPIENT = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/u;
export const ARTIFACT_DIRECTORY = "production-backup-artifact";
export const RECEIPT_NAME = "production-backup-receipt.json";
export const RECEIPT_SCHEMA = "celebratedeal-production-backup/v1";
const DUMP_NAME = "production-public.dump";
const AGGREGATES_NAME = "aggregates.txt";
const MIGRATIONS_NAME = "migrations.txt";
const TMPFS_MAGIC = 0x01021994;
const MIN_TMPFS_BYTES = 1024 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 25 * 60 * 1000;
const MAX_BUFFER = 64 * 1024 * 1024;
const RUN_ID = /^[1-9]\d{0,19}$/u;
const AGE_HEADER = Buffer.from("age-encryption.org/v1\n", "utf8");

/**
 * Accounting aggregates of docs/production-backup-restore-runbook.md §C
 * (counts and sums only, no personal data). Taken inside the same exported
 * snapshot as pg_dump so the isolated restore drill can compare row by row.
 * The contract test keeps this byte-identical to the runbook.
 */
export const AGGREGATES_SQL = `SELECT 'migrations' AS item, count(*)::text AS row_count, NULL::text AS sum_1, NULL::text AS sum_2, NULL::text AS sum_3
  FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL
SELECT 'PaymentTransaction:' || status, count(*)::text,
       sum("grossAmountCents")::text, sum("netAmountCents")::text, sum("refundedAmountCents")::text
  FROM public."PaymentTransaction" GROUP BY status
UNION ALL
SELECT 'RefundRecord:' || status, count(*)::text,
       sum("refundAmountCents")::text, sum("gatewayFeeRefundCents")::text, sum("platformFeeRefundCents")::text
  FROM public."RefundRecord" GROUP BY status
UNION ALL
SELECT 'Settlement:' || status || ':' || CASE WHEN "lockedAt" IS NULL THEN 'unlocked' ELSE 'locked' END, count(*)::text,
       sum("grossRevenueCents")::text, sum("payoutableAmountCents")::text, sum("finalPayoutAmountCents")::text
  FROM public."Settlement" GROUP BY status, ("lockedAt" IS NULL)
UNION ALL
SELECT 'Invoice:' || status, count(*)::text,
       sum("subtotalCents")::text, sum("taxCents")::text, sum("totalCents")::text
  FROM public."Invoice" GROUP BY status
UNION ALL
SELECT 'AffiliateCommission:' || status::text, count(*)::text,
       sum("orderAmountCents")::text, sum("commissionBaseAmountCents")::text, sum("commissionAmountCents")::text
  FROM public."AffiliateCommission" GROUP BY status
UNION ALL
SELECT 'AffiliatePayout:' || status, count(*)::text,
       sum("commissionAmountCents")::text, sum("adjustmentAmountCents")::text, sum("finalAmountCents")::text
  FROM public."AffiliatePayout" GROUP BY status
UNION ALL
SELECT 'CoursePayout:' || status, count(*)::text,
       sum("commissionAmountCents")::text, sum("adjustmentAmountCents")::text, sum("finalAmountCents")::text
  FROM public."CoursePayout" GROUP BY status
UNION ALL
SELECT 'PayoutItem:' || status, count(*)::text,
       sum("payoutAmountCents")::text, NULL::text, NULL::text
  FROM public."PayoutItem" GROUP BY status
UNION ALL
SELECT 'WebhookEvent:' || status, count(*)::text, NULL::text, NULL::text, NULL::text
  FROM public."WebhookEvent" GROUP BY status
ORDER BY 1;`;

/**
 * One psql session inside the pinned image: export a snapshot, run pg_dump
 * on that snapshot (same format as the staging backup: custom, public schema,
 * no owner/privileges), then read the migration summary and the aggregates in
 * the same snapshot. Marker files tell the caller which parts finished; the
 * aggregates are optional so a schema change on master that the Production
 * database does not have yet can never block the backup (and thus the
 * migration that would add it).
 */
export const SNAPSHOT_SCRIPT = [
  "\\set ON_ERROR_STOP on",
  "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;",
  "SET LOCAL idle_in_transaction_session_timeout = '30min';",
  "SET LOCAL statement_timeout = '10min';",
  // Like pg_dump: a role that RLS would filter must fail loudly, never count zero rows.
  "SET LOCAL row_security = off;",
  "SELECT pg_export_snapshot() AS cd_backup_snapshot \\gset",
  "\\setenv CD_BACKUP_SNAPSHOT :cd_backup_snapshot",
  `\\! pg_dump --format=custom --no-owner --no-privileges --schema=public --lock-wait-timeout=60s --snapshot="$CD_BACKUP_SNAPSHOT" --file=/out/${DUMP_NAME} && touch /out/pg_dump.ok`,
  `\\o /out/${MIGRATIONS_NAME}`,
  "SELECT count(*), coalesce(max(migration_name), '') FROM public.\"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;",
  "\\o",
  "\\! touch /out/migrations.ok",
  `\\o /out/${AGGREGATES_NAME}`,
  AGGREGATES_SQL,
  "\\o",
  "\\! touch /out/aggregates.ok",
  "COMMIT;",
  "",
].join("\n");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function defaultExec(command, args, { env, input } = {}) {
  const child = spawnSync(command, args, {
    env, input, shell: false, windowsHide: true, timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_BUFFER,
  });
  return { status: child.status, error: child.error, stdout: child.stdout ?? Buffer.alloc(0), stderr: child.stderr ?? Buffer.alloc(0) };
}

const defaultDeps = Object.freeze({
  exec: defaultExec,
  statfs: (target) => fs.statfsSync(target),
  shmRoot: "/dev/shm",
  readRecipientSource: () => fs.readFileSync(path.join(ROOT, RECIPIENT_FILE), "utf8"),
  now: () => new Date(),
});

/** SHA-256 of the recipient file as committed (CRLF normalised to LF). */
export function recipientFileSha256(source) {
  return sha256(String(source ?? "").replace(/\r\n/gu, "\n"));
}

/** The reviewed age recipient: exactly one non-comment `age1…` line. */
export function parseRecipient(source) {
  const lines = String(source ?? "").split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (lines.length !== 1 || !AGE_RECIPIENT.test(lines[0])) return null;
  return lines[0];
}

/** Schema(s) that the archive's index DDL expects pg_trgm in (F-074). */
export function trigramOperatorSchema(ddl) {
  const schemas = new Set([...String(ddl).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.(?:gin|gist)_trgm_ops\b/gu)].map((match) => match[1]));
  if (schemas.size === 0) return "none";
  if (schemas.size > 1) return "ambiguous";
  const [schema] = schemas;
  return schema === "public" || schema === "extensions" ? schema : "other";
}

/** Fixed category for a client failure; never echoes the message. */
export function classifyDumpFailure(stderr) {
  const message = String(stderr ?? "");
  if (/password authentication failed|tenant or user not found|authentication failed/iu.test(message)) return "AUTHENTICATION";
  if (/could not translate host name|name or service not known|temporary failure in name resolution/iu.test(message)) return "DNS";
  if (/connection refused|timeout expired|connection timed out|network is unreachable|no route to host|could not connect to server/iu.test(message)) return "NETWORK";
  if (/certificate|ssl error|ssl connection|tls/iu.test(message)) return "TLS";
  if (/server version mismatch|aborting because of server version/iu.test(message)) return "VERSION_MISMATCH";
  if (/could not obtain lock|lock timeout|canceling statement due to lock timeout/iu.test(message)) return "LOCK_TIMEOUT";
  if (/snapshot/iu.test(message)) return "SNAPSHOT";
  if (/permission denied|must be (?:owner|superuser)|row-level security/iu.test(message)) return "PERMISSION";
  if (/no space left on device|could not write/iu.test(message)) return "STORAGE";
  return "OTHER";
}

/** PG* variables for the clients; the URL itself never reaches a command line. */
export function clientEnvironment(env, value) {
  const db = new URL(value);
  return {
    PATH: env.PATH ?? "",
    HOME: env.HOME ?? "",
    PGHOST: db.hostname.toLowerCase(),
    PGPORT: "5432",
    PGDATABASE: "postgres",
    PGUSER: decodeURIComponent(db.username),
    PGPASSWORD: decodeURIComponent(db.password),
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "celebratedeal-production-backup",
  };
}

const PG_ENV_KEYS = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGCONNECT_TIMEOUT", "PGAPPNAME"];

/** Container arguments for the source session (host network, PG* by name only). */
export function sourceSessionArgs(plainDirectory) {
  const args = ["run", "--rm", "-i", "--network", "host", "--volume", `${plainDirectory}:/out`];
  for (const key of PG_ENV_KEYS) args.push("--env", key);
  args.push(POSTGRES_IMAGE, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-");
  return args;
}

/** Offline inspection of the plaintext archive (no network, read-only mount). */
function offlineArgs(plainDirectory, tool, toolArgs) {
  return ["run", "--rm", "--network", "none", "--volume", `${plainDirectory}:/in:ro`, POSTGRES_IMAGE, tool, ...toolArgs];
}

function fail(code, lines = []) {
  return { code: 1, lines: [...lines, code] };
}

function readIfMarked(directory, name, marker) {
  if (!fs.existsSync(path.join(directory, marker))) return null;
  const file = path.join(directory, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function parseMigrations(text) {
  const match = /^(\d{1,6})\|([0-9]{14}_[a-z0-9_]{1,120})?\s*$/u.exec(String(text ?? "").trim());
  return match ? { applied: Number(match[1]), latest: match[2] ?? null } : null;
}

function encrypt(exec, baseEnv, recipient, source, destination) {
  const result = exec("age", ["--encrypt", "--recipient", recipient, "--output", destination, source], { env: baseEnv });
  if (result.error || result.status !== 0 || !fs.existsSync(destination)) return false;
  const head = Buffer.alloc(AGE_HEADER.length);
  const handle = fs.openSync(destination, "r");
  try { fs.readSync(handle, head, 0, head.length, 0); } finally { fs.closeSync(handle); }
  return head.equals(AGE_HEADER);
}

function describeFile(directory, name) {
  const bytes = fs.readFileSync(path.join(directory, name));
  return { name, bytes: bytes.length, sha256: sha256(bytes) };
}

/**
 * Takes one encrypted backup. Returns { code, lines } where every line is a
 * fixed code, a count or a digest. On success the artifact directory holds
 * only ciphertext, SHA256SUMS and the receipt.
 */
export function run(env = process.env, overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const emit = overrides.emit ?? console.log;
  const target = parseProductionDatabaseUrl(env.PRODUCTION_DATABASE_URL);
  if (target.failure) return fail(target.failure);
  for (const line of maskCommands(target)) emit(line);

  const runId = env.GITHUB_RUN_ID ?? "";
  const runnerTemp = env.RUNNER_TEMP ?? "";
  if (!RUN_ID.test(runId) || !path.isAbsolute(runnerTemp) || !fs.existsSync(runnerTemp)) return fail("PRODUCTION_BACKUP_RUN_CONTEXT_INVALID");

  const pin = String(env[RECIPIENT_PIN_VARIABLE] ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(pin)) return fail("PRODUCTION_BACKUP_RECIPIENT_UNPINNED");
  let recipientSource;
  try { recipientSource = deps.readRecipientSource(); } catch { recipientSource = null; }
  if (typeof recipientSource !== "string" || recipientFileSha256(recipientSource) !== pin) return fail("PRODUCTION_BACKUP_RECIPIENT_PIN_MISMATCH");
  const recipient = parseRecipient(recipientSource);
  if (!recipient) return fail("PRODUCTION_BACKUP_RECIPIENT_INVALID");

  const baseEnv = { PATH: env.PATH ?? "", HOME: env.HOME ?? "" };
  const age = deps.exec("age", ["--version"], { env: baseEnv });
  if (age.error || age.status !== 0 || String(age.stdout ?? "").trim() !== AGE_VERSION) return fail("PRODUCTION_BACKUP_AGE_UNAVAILABLE");

  const inspected = deps.exec("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", POSTGRES_IMAGE], { env: baseEnv });
  if (inspected.error || inspected.status !== 0 || !String(inspected.stdout).includes(`@${POSTGRES_IMAGE_DIGEST}`)) return fail("PRODUCTION_BACKUP_IMAGE_UNVERIFIED");
  const version = deps.exec("docker", ["run", "--rm", "--network", "none", POSTGRES_IMAGE, "pg_dump", "--version"], { env: baseEnv });
  const toolVersion = String(version.stdout ?? "").trim();
  if (version.error || version.status !== 0 || !PG_DUMP_VERSION.test(toolVersion)) return fail("PRODUCTION_BACKUP_IMAGE_UNVERIFIED");

  let shm;
  try { shm = deps.statfs(deps.shmRoot); } catch { shm = null; }
  if (!shm || Number(shm.type) !== TMPFS_MAGIC || Number(shm.bavail) * Number(shm.bsize) < MIN_TMPFS_BYTES) return fail("PRODUCTION_BACKUP_TMPFS_UNAVAILABLE");

  const outDirectory = path.join(runnerTemp, ARTIFACT_DIRECTORY);
  if (fs.existsSync(outDirectory)) return fail("PRODUCTION_BACKUP_OUTPUT_NOT_EMPTY");
  const plainDirectory = fs.mkdtempSync(path.join(deps.shmRoot, "celebratedeal-production-backup-"));
  let succeeded = false;
  try {
    fs.chmodSync(plainDirectory, 0o700);
    fs.mkdirSync(outDirectory, { mode: 0o700 });

    const startedAt = deps.now();
    const session = deps.exec("docker", sourceSessionArgs(plainDirectory), { env: clientEnvironment(env, target.url), input: SNAPSHOT_SCRIPT });
    if (session.error || !fs.existsSync(path.join(plainDirectory, "pg_dump.ok")) || !fs.existsSync(path.join(plainDirectory, DUMP_NAME))) {
      return fail(`PRODUCTION_BACKUP_DUMP_FAILED ${classifyDumpFailure(session.stderr)}`);
    }

    const listed = deps.exec("docker", offlineArgs(plainDirectory, "pg_restore", ["--list", `/in/${DUMP_NAME}`]), { env: baseEnv });
    const toc = String(listed.stdout ?? "");
    const tocEntries = toc.split("\n").filter((line) => /^\d+;/u.test(line)).length;
    if (listed.error || listed.status !== 0 || tocEntries === 0 || !/\bTABLE DATA public _prisma_migrations\b/u.test(toc)) return fail("PRODUCTION_BACKUP_ARCHIVE_INVALID");
    const ddl = deps.exec("docker", offlineArgs(plainDirectory, "pg_restore", ["--schema-only", "--file=-", `/in/${DUMP_NAME}`]), { env: baseEnv });
    if (ddl.error || ddl.status !== 0) return fail("PRODUCTION_BACKUP_ARCHIVE_INVALID");
    const trigramSchema = trigramOperatorSchema(ddl.stdout);

    const migrations = parseMigrations(readIfMarked(plainDirectory, MIGRATIONS_NAME, "migrations.ok"));
    const aggregatesText = readIfMarked(plainDirectory, AGGREGATES_NAME, "aggregates.ok");
    const aggregatesOk = typeof aggregatesText === "string" && /^migrations\|/mu.test(aggregatesText);

    const dumpCipher = `production-public-${runId}.dump.age`;
    if (!encrypt(deps.exec, baseEnv, recipient, path.join(plainDirectory, DUMP_NAME), path.join(outDirectory, dumpCipher))) return fail("PRODUCTION_BACKUP_ENCRYPTION_FAILED");
    const files = [dumpCipher];
    if (aggregatesOk) {
      const aggregatesCipher = `production-aggregates-${runId}.txt.age`;
      if (!encrypt(deps.exec, baseEnv, recipient, path.join(plainDirectory, AGGREGATES_NAME), path.join(outDirectory, aggregatesCipher))) return fail("PRODUCTION_BACKUP_ENCRYPTION_FAILED");
      files.push(aggregatesCipher);
    }
    const described = files.map((name) => describeFile(outDirectory, name));
    fs.writeFileSync(path.join(outDirectory, "SHA256SUMS"), described.map((file) => `${file.sha256}  ${file.name}\n`).join(""), { mode: 0o600 });

    const receipt = {
      schemaVersion: RECEIPT_SCHEMA,
      result: "PASS",
      runId,
      runAttempt: /^\d{1,4}$/u.test(env.GITHUB_RUN_ATTEMPT ?? "") ? Number(env.GITHUB_RUN_ATTEMPT) : null,
      sourceCommit: /^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "") ? env.GITHUB_SHA : null,
      startedAtUtc: startedAt.toISOString(),
      finishedAtUtc: deps.now().toISOString(),
      database: { project: "fixed-production", connection: "session-tls" },
      dump: {
        tool: toolVersion,
        imageDigest: POSTGRES_IMAGE_DIGEST,
        format: "custom",
        scope: "schema:public",
        options: ["--no-owner", "--no-privileges", "--lock-wait-timeout=60s"],
        snapshot: "exported-repeatable-read",
        tocEntries,
        trigramOperatorSchema: trigramSchema,
      },
      migrations: migrations ?? { applied: null, latest: null },
      aggregates: aggregatesOk ? "ENCRYPTED_SAME_SNAPSHOT" : "UNAVAILABLE",
      encryption: { tool: `age ${AGE_VERSION}`, recipientFile: RECIPIENT_FILE, recipientFileSha256: pin, recipientSha256: sha256(recipient) },
      files: described,
    };
    fs.writeFileSync(path.join(outDirectory, RECEIPT_NAME), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    succeeded = true;
    return {
      code: 0,
      lines: [
        `PRODUCTION_BACKUP_ARCHIVE_SHA256 ${described[0].sha256}`,
        `PRODUCTION_BACKUP_TOC_ENTRIES ${tocEntries}`,
        `PRODUCTION_BACKUP_MIGRATIONS_APPLIED ${migrations?.applied ?? "UNKNOWN"}`,
        `PRODUCTION_BACKUP_TRIGRAM_SCHEMA ${trigramSchema}`,
        `PRODUCTION_BACKUP_AGGREGATES ${receipt.aggregates}`,
        "PRODUCTION_BACKUP_PASS",
      ],
    };
  } catch {
    return fail("PRODUCTION_BACKUP_UNEXPECTED_FAILURE");
  } finally {
    fs.rmSync(plainDirectory, { recursive: true, force: true });
    if (!succeeded) fs.rmSync(outDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (os.platform() !== "linux") {
    console.log("PRODUCTION_BACKUP_LINUX_RUNNER_REQUIRED");
    process.exitCode = 1;
  } else {
    const result = run();
    for (const line of result.lines) console.log(line);
    process.exitCode = result.code;
  }
}
