// F-063 / B04-09: migration directory names must stay monotonic with merge
// order. A branch may only add migrations whose names sort after the newest
// migration already on the base branch (origin/master by default), and it
// may never delete or rename a migration that the base branch already had.
//
// Otherwise an environment migrated in between (staging) and a fresh one
// apply the same DDL in different orders. If a branch falls behind, rebase it
// and rename the new migration directory to a newer timestamp.
//
// Usage: node scripts/migration-order-check.mjs
//   MIGRATION_ORDER_BASE_REF overrides the base ref (default origin/master).
// CI checks out with fetch-depth: 0, so origin/master and the merge base are
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

/** Directory names from `git ls-tree --name-only <ref>:prisma/migrations`. */
export function parseMigrationTree(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => EXISTING_MIGRATION_PATTERN.test(line));
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
 * @param {{ baseMigrations: string[], mergeBaseMigrations: string[], headMigrations: string[] }} input
 * @returns {{ ok: boolean, latestBase: string | null, added: string[], errors: string[] }}
 */
export function evaluateMigrationOrder({ baseMigrations, mergeBaseMigrations, headMigrations }) {
  const base = new Set(baseMigrations);
  const head = new Set(headMigrations);
  const latestBase = latestMigration(baseMigrations);
  const latestBaseKey = latestBase === null ? null : migrationSortKey(latestBase);
  const added = headMigrations.filter((name) => !base.has(name)).sort();
  const errors = [];

  for (const name of added) {
    if (!NEW_MIGRATION_PATTERN.test(name)) {
      errors.push(`${name}: new migrations must be named <YYYYMMDDHHMMSS>_<snake_case>.`);
      continue;
    }
    if (latestBaseKey !== null && migrationSortKey(name) <= latestBaseKey) {
      errors.push(`${name}: must sort after the newest base migration ${latestBase}; rebase and rename it with a newer timestamp.`);
    }
  }

  // Anything the branch started from must still exist: migrations are
  // forward-only, so deleting or renaming one breaks every migrated database.
  for (const name of [...new Set(mergeBaseMigrations)].sort()) {
    if (!head.has(name)) errors.push(`${name}: existing migration was deleted or renamed; migrations are forward-only.`);
  }

  return { ok: errors.length === 0, latestBase, added, errors };
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]} failed; fetch the base branch with full history (fetch-depth: 0).`);
  }
  return result.stdout;
}

export function readHeadMigrations(root) {
  return fs.readdirSync(path.join(root, MIGRATIONS_DIRECTORY), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && EXISTING_MIGRATION_PATTERN.test(entry.name))
    .map((entry) => entry.name);
}

export function runMigrationOrderCheck({ root, baseRef }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(baseRef)) throw new Error("Base ref is not a plain git ref name.");
  const mergeBase = git(["merge-base", "HEAD", baseRef], root).trim();
  const baseMigrations = parseMigrationTree(git(["ls-tree", "--name-only", `${baseRef}:${MIGRATIONS_DIRECTORY}`], root));
  const mergeBaseMigrations = parseMigrationTree(git(["ls-tree", "--name-only", `${mergeBase}:${MIGRATIONS_DIRECTORY}`], root));
  if (baseMigrations.length === 0) throw new Error(`No migrations found on ${baseRef}; refusing to pass vacuously.`);
  return evaluateMigrationOrder({ baseMigrations, mergeBaseMigrations, headMigrations: readHeadMigrations(root) });
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
