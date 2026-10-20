// F-063 / B04-09: migration directory names must stay monotonic with merge
// order. A branch may only add migrations whose names sort after the newest
// migration already on the base branch (origin/master by default), and it
// may never delete, rename or edit a migration the branch started from.
//
// Every directory under prisma/migrations counts: Prisma applies any
// directory that holds a migration.sql, so a malformed name (camelCase,
// hyphens, short prefix) fails the check instead of being skipped.
//
// Otherwise an environment migrated in between (staging) and a fresh one
// apply the same DDL in different orders. If a branch falls behind, rebase it
// and rename the new migration directory to a newer timestamp, but only if
// that migration has not been applied to any shared environment yet.
//
// Usage: node scripts/migration-order-check.mjs
//   MIGRATION_ORDER_BASE_REF overrides the base ref (default origin/master;
//   CI passes HEAD^1 for pushes to master, i.e. the squash merge's parent).
// CI checks out with fetch-depth: 0, so the base ref and the merge base are
// always available; a missing ref fails closed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIRECTORY = "prisma/migrations";
// Legacy directories use 12-digit prefixes; every new one must use the
// 14-digit YYYYMMDDHHMMSS form so names sort by time.
const EXISTING_MIGRATION_PATTERN = /^(\d{12,14})_[a-z0-9_]+$/;
const NEW_MIGRATION_PATTERN = /^\d{14}_[a-z0-9_]+$/;

/** Sort key that keeps legacy 12-digit prefixes comparable with 14-digit ones. */
export function migrationSortKey(name) {
  const match = EXISTING_MIGRATION_PATTERN.exec(name);
  if (!match) return null;
  return `${match[1].padEnd(14, "0")}${name.slice(match[1].length)}`;
}

/**
 * Every directory from `git ls-tree <ref>:prisma/migrations`
 * ("<mode> <type> <object>\t<name>" lines). Files such as migration_lock.toml
 * are not migrations. Names are deliberately not filtered so that malformed
 * directory names reach the format check.
 */
export function parseMigrationTree(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => /^\d+ tree [0-9a-f]+\t(.+)$/u.exec(line.trim())?.[1])
    .filter((name) => typeof name === "string");
}

/** Migration directories touched in `git diff --name-only <merge-base> -- prisma/migrations`. */
export function parseChangedMigrationDirectories(output) {
  const directories = new Set();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^prisma\/migrations\/([^/]+)\/.+$/u.exec(line.trim());
    if (match) directories.add(match[1]);
  }
  return directories;
}

export function latestMigration(names) {
  let latest = null;
  for (const name of names) {
    const key = migrationSortKey(name);
    if (key !== null && (latest === null || key > latest.key)) latest = { name, key };
  }
  return latest?.name ?? null;
}

/**
 * @param {{
 *   baseMigrations: string[],
 *   mergeBaseMigrations: string[],
 *   headMigrations: string[],
 *   changedDirectories?: Set<string>,
 * }} input
 * @returns {{ ok: boolean, latestBase: string | null, added: string[], errors: string[] }}
 */
export function evaluateMigrationOrder({ baseMigrations, mergeBaseMigrations, headMigrations, changedDirectories = new Set() }) {
  const base = new Set(baseMigrations);
  const head = new Set(headMigrations);
  const latestBase = latestMigration(baseMigrations);
  const latestBaseKey = latestBase === null ? null : migrationSortKey(latestBase);
  const added = headMigrations.filter((name) => !base.has(name)).sort();
  const errors = [];

  for (const name of added) {
    if (!NEW_MIGRATION_PATTERN.test(name)) {
      errors.push(`${name}: new migrations must be named <YYYYMMDDHHMMSS>_<lowercase_snake_case>.`);
      continue;
    }
    if (latestBaseKey !== null && migrationSortKey(name) <= latestBaseKey) {
      errors.push(`${name}: must sort after the newest base migration ${latestBase}; rebase and rename it with a newer timestamp.`);
    }
  }

  // Anything the branch started from must still exist unchanged: migrations
  // are forward-only, so deleting, renaming or editing one makes databases
  // that already applied it diverge from fresh ones.
  for (const name of [...new Set(mergeBaseMigrations)].sort()) {
    if (!head.has(name)) {
      errors.push(`${name}: existing migration was deleted or renamed; migrations are forward-only.`);
      continue;
    }
    if (changedDirectories.has(name)) {
      errors.push(`${name}: existing migration was edited; add a new forward migration instead.`);
    }
  }

  return { ok: errors.length === 0, latestBase, added, errors };
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]} failed; fetch the base branch with full history (fetch-depth: 0).`);
  }
  return result.stdout;
}

/** Every directory under prisma/migrations in the working tree, unfiltered. */
export function readHeadMigrations(root) {
  return fs.readdirSync(path.join(root, MIGRATIONS_DIRECTORY), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function runMigrationOrderCheck({ root, baseRef }) {
  // Plain ref names, optionally with ^/~ ancestry suffixes.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/^~-]*$/u.test(baseRef)) throw new Error("Base ref is not a plain git ref name.");
  const mergeBase = git(["merge-base", "HEAD", baseRef], root).trim();
  const baseMigrations = parseMigrationTree(git(["ls-tree", `${baseRef}:${MIGRATIONS_DIRECTORY}`], root));
  const mergeBaseMigrations = parseMigrationTree(git(["ls-tree", `${mergeBase}:${MIGRATIONS_DIRECTORY}`], root));
  if (baseMigrations.length === 0) throw new Error(`No migrations found on ${baseRef}; refusing to pass vacuously.`);
  // Working tree vs merge base, using git's own line-ending normalization;
  // tracked edits and deletions are listed, untracked new files are not.
  const changedDirectories = parseChangedMigrationDirectories(
    git(["diff", "--name-only", "--no-renames", mergeBase, "--", MIGRATIONS_DIRECTORY], root),
  );
  return evaluateMigrationOrder({ baseMigrations, mergeBaseMigrations, headMigrations: readHeadMigrations(root), changedDirectories });
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = fileURLToPath(import.meta.url);

if (invokedScript === currentScript) {
  const root = path.resolve(path.dirname(currentScript), "..");
  const baseRef = process.env.MIGRATION_ORDER_BASE_REF || "origin/master";
  try {
    const result = runMigrationOrderCheck({ root, baseRef });
    for (const error of result.errors) console.error(`migration-order: ${error}`);
    console.log(JSON.stringify({ ok: result.ok, baseRef, latestBase: result.latestBase, added: result.added }));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`migration-order: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
