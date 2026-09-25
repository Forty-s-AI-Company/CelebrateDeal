import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Exact, previously attested Preview source and the observed 58/79 baseline.
export const SOURCE_SHA = "9193326824b8b6bf774bdfa28e4783a1a1b8f304";
export const PREVIEW_HOST = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
const EXPECTED_COUNT = 79;
const APPLIED_COUNT = 58;
const PENDING_COUNT = 21;
const TENANT_MIGRATION = "20260911080000_live_interaction_tenant_integrity";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stripComments = (sql) => sql.replace(/--[^\r\n]*/gu, "");

/** Audit every exact pending SQL blob, including later ALTERs of newly made tables. */
export function auditPendingSql(inventory, sqlByName) {
  if (!(inventory instanceof Map) || !(sqlByName instanceof Map) || inventory.size !== EXPECTED_COUNT) return false;
  const names = [...inventory.keys()].sort();
  const pending = names.slice(-PENDING_COUNT);
  if (pending.length !== PENDING_COUNT || !pending.includes(TENANT_MIGRATION)
    || sqlByName.size !== PENDING_COUNT || pending.some((name) => !sqlByName.has(name))) return false;

  const sql = new Map();
  for (const name of pending) {
    const bytes = sqlByName.get(name);
    const trusted = inventory.get(name);
    if (!Buffer.isBuffer(bytes) || !trusted || ![trusted.exact, ...trusted.alternatives].includes(digest(bytes))) return false;
    sql.set(name, stripComments(bytes.toString("utf8")));
  }
  const allSql = [...sql.values()].join("\n");
  const newTables = new Set([...allSql.matchAll(/\bCREATE TABLE "([^"]+)"/gu)].map((match) => match[1]));
  if (!newTables.has("LiveInteractionRun") || !newTables.has("LiveInteractionResponse")) return false;
  for (const [name, content] of sql) {
    // Unexpected data mutation or destructive DDL requires a fresh review.
    if (/(?:^|;)\s*(?:UPDATE|DELETE|INSERT|MERGE|TRUNCATE|DROP)\b/imu.test(content)) return false;
    if (name !== TENANT_MIGRATION && /\bDO\s+\$\$/iu.test(content)) return false;
    for (const match of content.matchAll(/\bCREATE UNIQUE INDEX "[^"]+"\s+ON "([^"]+)"/gu)) {
      if (!newTables.has(match[1])) return false;
    }
    for (const match of content.matchAll(/\bADD COLUMN "[^"]+"[^;\r\n]*\bNOT NULL\b[^;\r\n]*/gu)) {
      if (!/\bDEFAULT\b/iu.test(match[0])) return false;
    }
    for (const match of content.matchAll(/\bALTER TABLE "([^"]+)"\s+ADD CONSTRAINT "[^"]+"\s+FOREIGN KEY \(([^)]+)\)/gu)) {
      const [, table, columns] = match;
      if (newTables.has(table)) continue;
      // All FKs on baseline tables use a newly added nullable TEXT field.
      const fields = [...columns.matchAll(/"([^"]+)"/gu)].map((field) => field[1]);
      const newField = fields.find((field) => field !== "vendorId");
      const nullable = newField && new RegExp(`\\bALTER TABLE "${table}"\\s+ADD COLUMN "${newField}"\\s+TEXT\\s*;`, "u").test(allSql);
      if (!nullable || fields.length !== 2) return false;
    }
  }
  return true;
}

export async function readPendingSql(inventory) {
  const names = [...inventory.keys()].sort().slice(-PENDING_COUNT);
  return new Map(await Promise.all(names.map(async (name) => [name, await readFile(`prisma/migrations/${name}/migration.sql`)])));
}

/** Exact object names to verify after the isolated SQL replay. */
export function expectedReplaySchema(sqlByName) {
  const sql = [...sqlByName.values()].map((bytes) => stripComments(bytes.toString("utf8"))).join("\n");
  const collect = (pattern) => [...new Set([...sql.matchAll(pattern)].map((match) => match[1]))].sort();
  const tables = collect(/\bCREATE TABLE "([^"]+)"/gu);
  const indexes = collect(/\bCREATE (?:UNIQUE )?INDEX "([^"]+)"/gu);
  const constraints = collect(/\bCONSTRAINT "([^"]+)"/gu);
  const types = collect(/\bCREATE TYPE "([^"]+)"/gu);
  const columns = [...new Set([...sql.matchAll(/\bALTER TABLE "([^"]+)"\s+ADD COLUMN "([^"]+)"/gu)]
    .map((match) => `${match[1]}|${match[2]}`))].sort();
  const safe = (value) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
  if (tables.length === 0 || indexes.length === 0 || constraints.length === 0 || types.length === 0
    || columns.length === 0 || [...tables, ...indexes, ...constraints, ...types].some((value) => !safe(value))
    || columns.some((value) => value.split("|").some((part) => !safe(part)))) throw new Error("EXPECTED_SCHEMA_INVALID");
  return { tables, indexes, constraints, types, columns };
}

export function inspectMigrationHistory(rows, inventory) {
  if (!Array.isArray(rows) || !(inventory instanceof Map) || inventory.size !== EXPECTED_COUNT) return false;
  const expected = [...inventory.keys()].sort();
  const active = rows.filter((row) => row?.finished_at != null && row?.rolled_back_at == null)
    .sort((a, b) => String(a.migration_name).localeCompare(String(b.migration_name)));
  const rolledBack = rows.filter((row) => row?.rolled_back_at != null);
  // The fixed staging baseline has one historic rollback with an exact
  // completed counterpart. It must not be mistaken for an unresolved failure.
  if (active.length !== APPLIED_COUNT || rolledBack.length !== 1
    || rows.length !== active.length + rolledBack.length) return false;
  if (!rolledBack.every((row) => active.some((completed) => completed.migration_name === row.migration_name
    && completed.checksum === row.checksum))) return false;
  return active.every((row, index) => {
    const trusted = inventory.get(row.migration_name);
    return row.migration_name === expected[index]
      && typeof row.checksum === "string"
      && (row.checksum === trusted?.exact || trusted?.alternatives?.has(row.checksum));
  });
}
