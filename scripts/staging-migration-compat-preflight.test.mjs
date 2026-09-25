import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { auditPendingSql, inspectMigrationHistory } from "./staging-migration-compat-preflight.mjs";

const names = (await readdir("prisma/migrations", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{12,14}_[a-z0-9_]+$/u.test(entry.name))
  .map((entry) => entry.name).sort();
const pending = names.slice(-21);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sqlByName = new Map(await Promise.all(pending.map(async (name) => [name, await readFile(`prisma/migrations/${name}/migration.sql`)])));
const inventory = new Map(names.map((name) => [name, { exact: sqlByName.has(name) ? digest(sqlByName.get(name)) : "a".repeat(64), alternatives: new Set() }]));
const history = names.slice(0, 58).map((migration_name) => ({ migration_name, checksum: "a".repeat(64), finished_at: new Date(), rolled_back_at: null }));

function changedSql(name, transform) {
  const modified = new Map(sqlByName);
  modified.set(name, Buffer.from(transform(modified.get(name).toString("utf8"))));
  const matching = new Map(inventory);
  matching.set(name, { exact: digest(modified.get(name)), alternatives: new Set() });
  return { inventory: matching, sqlByName: modified };
}

test("all 21 exact pending SQL files have no data-dependent baseline constraint", () => {
  assert.equal(names.length, 79);
  assert.equal(pending.length, 21);
  assert.equal(auditPendingSql(inventory, sqlByName), true);
});

test("source mismatch and a new baseline unique index or unsafe non-null column fail closed", () => {
  const target = pending[0];
  const mismatched = new Map(sqlByName);
  mismatched.set(target, Buffer.from(`${mismatched.get(target).toString("utf8")}\n-- changed`));
  assert.equal(auditPendingSql(inventory, mismatched), false);
  const unique = changedSql(target, (sql) => `${sql}\nCREATE UNIQUE INDEX "unsafe" ON "Vendor"("id");`);
  assert.equal(auditPendingSql(unique.inventory, unique.sqlByName), false);
  const nonNull = changedSql(target, (sql) => `${sql}\nALTER TABLE "Vendor" ADD COLUMN "unsafe" TEXT NOT NULL;`);
  assert.equal(auditPendingSql(nonNull.inventory, nonNull.sqlByName), false);
});

test("the fixed 58/79 prefix requires trusted checksums and no unresolved failure", () => {
  assert.equal(inspectMigrationHistory(history, inventory), false);
  const completedCounterpart = { ...history[0], finished_at: null, rolled_back_at: new Date() };
  assert.equal(inspectMigrationHistory([...history, completedCounterpart], inventory), true);
  assert.equal(inspectMigrationHistory([...history, { ...completedCounterpart, checksum: "b".repeat(64) }], inventory), false);
  assert.equal(inspectMigrationHistory([...history, completedCounterpart, completedCounterpart], inventory), false);
  assert.equal(inspectMigrationHistory([...history.slice(1), completedCounterpart], inventory), false);
  assert.equal(inspectMigrationHistory([...history, completedCounterpart, { migration_name: "failed", finished_at: null, rolled_back_at: null }], inventory), false);
});
