import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260724150000_harden_supabase_data_api",
  "migration.sql",
);
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const normalizedMigrationSql = migrationSql.replace(/\s+/g, " ");

describe("Supabase Data API hardening migration", () => {
  it("revokes existing Data API object privileges from every API role", () => {
    expect(migrationSql).toContain(
      "ARRAY['anon', 'authenticated', 'service_role']",
    );
    expect(migrationSql).toContain(
      "'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I'",
    );
    expect(migrationSql).toContain(
      "'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I'",
    );
    expect(migrationSql).toContain(
      "'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I'",
    );
    expect(migrationSql).toContain(
      "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;",
    );
    expect(migrationSql).toContain(
      "REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;",
    );
    expect(migrationSql).toContain(
      "REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;",
    );
  });

  it("enables RLS for every existing public base or partitioned table", () => {
    expect(migrationSql).toContain("relation.relkind IN ('r', 'p')");
    expect(migrationSql).toContain(
      "'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY'",
    );
    expect(migrationSql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
  });

  it("removes automatic Data API grants from future Prisma objects", () => {
    expect(migrationSql).not.toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE/i);
    expect(normalizedMigrationSql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;",
    );
    expect(normalizedMigrationSql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;",
    );
    expect(normalizedMigrationSql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC;",
    );
    expect(migrationSql).toContain(
      "'REVOKE ALL PRIVILEGES ON TABLES FROM %I'",
    );
    expect(migrationSql).toContain(
      "'REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I'",
    );
    expect(migrationSql).toContain(
      "'REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I'",
    );
  });

  it("does not add permissive policies or destructive data/schema operations", () => {
    expect(migrationSql).not.toMatch(/CREATE\s+POLICY/i);
    expect(migrationSql).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(migrationSql).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bTRUNCATE\b/i);
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrationSql).not.toMatch(/\bUPDATE\s+\S+\s+SET\b/i);
    expect(migrationSql).not.toMatch(/\bRENAME\b/i);
  });
});
