import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMigrationSql, runMigrations } from "./staging-payuni-management-migrate";

const migrationRoot = path.resolve("prisma/migrations");
function inventory() {
  return readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, sql: readFileSync(path.join(migrationRoot, entry.name, "migration.sql"), "utf8") }));
}

describe("exact staging migration adapter", () => {
  it("pins the two DDL files and rejects changes or incomplete source inventory", () => {
    const source = inventory();
    expect(() => buildMigrationSql(source)).not.toThrow();
    expect(() => buildMigrationSql(source.slice(1))).toThrow("MIGRATION_INVENTORY_INVALID");
    const changed = source.map((item) => item.name === "20260930094500_payuni_live_probe"
      ? { ...item, sql: `${item.sql}\nSELECT 1;` } : item);
    expect(() => buildMigrationSql(changed)).toThrow("MIGRATION_SOURCE_CHANGED");
  });

  it("rejects duplicate inventory names and binds history and DDL in one transaction", () => {
    const source = inventory();
    expect(() => buildMigrationSql([...source.slice(1), source[1]])).toThrow("MIGRATION_INVENTORY_INVALID");
    const sql = buildMigrationSql(source);
    expect(sql).toContain("count(DISTINCT migration_name)");
    expect(sql).toContain("MIGRATION_HISTORY_MISMATCH");
    expect(sql).toContain("MIGRATION_DATA_API_GRANTS_PRESENT");
    expect(sql).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;/u);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/u);
    expect(sql.match(/INSERT INTO public\._prisma_migrations/gu)).toHaveLength(2);
  });

  it("rejects invocation before any CLI or filesystem mutation", async () => {
    await expect(runMigrations(["--apply"], { NODE_ENV: "test" })).rejects.toThrow("MIGRATION_APPROVAL_REQUIRED");
  });
});
