// B04-04: detect drift between prisma/schema.prisma and the database the
// migrations actually build.
//
// `prisma migrate diff --from-migrations prisma/migrations
//   --to-schema-datamodel prisma/schema.prisma --shadow-database-url <db> --script`
// prints the SQL that `prisma migrate dev` would generate next. Some of that
// SQL is known, accepted drift (objects Prisma 6 cannot express, or names that
// PostgreSQL truncated); it is recorded in scripts/prisma-drift-allowlist.json.
//
// The check fails when
//   * the diff contains a statement that is not allowlisted (new drift), or
//   * an allowlisted statement no longer appears (the drift was fixed or, more
//     dangerously, a migration dropped the object; either way the allowlist
//     must be updated deliberately in the same PR).
//
// The shadow database is wiped by Prisma, so it must be a dedicated loopback
// database: celebratedeal_shadow_ci (CI) or celebratedeal_e2e (local loopback).
// Usage:
//   PRISMA_DRIFT_SHADOW_DATABASE_URL=postgresql://...@127.0.0.1:5432/celebratedeal_shadow_ci?schema=public \
//     node scripts/prisma-drift-check.mjs [--print-statements]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SHADOW_DATABASE_NAMES = new Set(["celebratedeal_shadow_ci", "celebratedeal_e2e"]);
export const ALLOWLIST_SCHEMA = "celebratedeal-prisma-drift-allowlist/v1";

/** Returns a safe category only; never echoes the URL. */
export function classifyShadowDatabaseUrl(value) {
  if (!value) return { safe: false, category: "missing" };
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { safe: false, category: "invalid-url" };
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return { safe: false, category: "unsupported-protocol" };
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return { safe: false, category: "non-loopback" };
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/u, ""));
  if (!SHADOW_DATABASE_NAMES.has(database)) return { safe: false, category: "not-a-dedicated-shadow-database" };
  return { safe: true, database };
}

/** Split `migrate diff --script` output into normalized SQL statements. */
export function parseDiffStatements(script) {
  const statements = [];
  let current = [];
  const flush = () => {
    const statement = current.join(" ").replace(/\s+/gu, " ").trim();
    if (statement) statements.push(statement);
    current = [];
  };
  for (const rawLine of script.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("--")) {
      flush();
      continue;
    }
    current.push(line);
    if (line.endsWith(";")) flush();
  }
  flush();
  return statements;
}

export function validateAllowlist(allowlist) {
  if (!allowlist || allowlist.schemaVersion !== ALLOWLIST_SCHEMA || !Array.isArray(allowlist.entries)) {
    throw new Error(`Allowlist must use schemaVersion ${ALLOWLIST_SCHEMA} with an entries array.`);
  }
  const seen = new Set();
  for (const entry of allowlist.entries) {
    if (typeof entry?.statement !== "string" || typeof entry.category !== "string" || typeof entry.reason !== "string") {
      throw new Error("Every allowlist entry needs statement, category and reason strings.");
    }
    if (seen.has(entry.statement)) throw new Error(`Duplicate allowlist statement: ${entry.statement}`);
    seen.add(entry.statement);
  }
  return allowlist.entries;
}

/**
 * @returns {{ ok: boolean, unexpected: string[], stale: string[], matched: number }}
 */
export function compareDrift(statements, allowlist) {
  const allowed = new Set(validateAllowlist(allowlist).map((entry) => entry.statement));
  const actual = new Set(statements);
  const unexpected = [...actual].filter((statement) => !allowed.has(statement)).sort();
  const stale = [...allowed].filter((statement) => !actual.has(statement)).sort();
  return { ok: unexpected.length === 0 && stale.length === 0, unexpected, stale, matched: actual.size - unexpected.length };
}

export function runPrismaDiff({ root, shadowUrl, spawn = spawnSync }) {
  const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
  const result = spawn(process.execPath, [
    prismaCli, "migrate", "diff",
    "--from-migrations", "prisma/migrations",
    "--to-schema-datamodel", "prisma/schema.prisma",
    "--shadow-database-url", shadowUrl,
    "--script",
  ], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
    // Point every Prisma URL at the shadow database so nothing else can be
    // touched, even if a local dotenv file is loaded by prisma.config.ts.
    env: {
      ...process.env,
      DATABASE_URL: shadowUrl,
      DIRECT_URL: shadowUrl,
      CHECKPOINT_DISABLE: "1",
      PRISMA_HIDE_UPDATE_MESSAGE: "true",
      NO_COLOR: "1",
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`prisma migrate diff failed with exit code ${result.status ?? "unknown"}.`);
  }
  return result.stdout;
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = fileURLToPath(import.meta.url);

if (invokedScript === currentScript) {
  const root = path.resolve(path.dirname(currentScript), "..");
  const allowlistPath = path.join(root, "scripts", "prisma-drift-allowlist.json");
  try {
    const shadowUrl = process.env.PRISMA_DRIFT_SHADOW_DATABASE_URL;
    const safety = classifyShadowDatabaseUrl(shadowUrl);
    if (!safety.safe) throw new Error(`PRISMA_DRIFT_SHADOW_DATABASE_URL rejected; category=${safety.category}`);
    const statements = parseDiffStatements(runPrismaDiff({ root, shadowUrl }));
    if (process.argv.includes("--print-statements")) {
      process.stdout.write(`${JSON.stringify(statements, null, 2)}\n`);
    } else {
      const allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
      const result = compareDrift(statements, allowlist);
      for (const statement of result.unexpected) console.error(`prisma-drift: unexpected (not allowlisted): ${statement}`);
      for (const statement of result.stale) console.error(`prisma-drift: allowlisted drift no longer present (update the allowlist deliberately): ${statement}`);
      console.log(JSON.stringify({ ok: result.ok, statements: statements.length, matched: result.matched, unexpected: result.unexpected.length, stale: result.stale.length }));
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    console.error(`prisma-drift: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
