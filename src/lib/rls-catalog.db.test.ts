import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

/**
 * F-026 / B02-03 / B04-08 catalog gate.
 *
 * CelebrateDeal reaches application tables only through server-side Prisma
 * (table owner, bypasses RLS). The Supabase Data API roles must therefore see
 * nothing: every public table keeps RLS enabled with no policy for them, and
 * neither role nor PUBLIC holds any table privilege.
 *
 * The combined coverage runner (scripts/run-combined-coverage.mjs) creates
 * anon, authenticated and service_role plus Supabase's default
 * `GRANT ALL ... TO anon, authenticated, service_role` privileges BEFORE
 * migrations run, so the revokes in 20260724150000 and every conditional
 * role statement in later migrations execute as they do on Supabase, and the
 * assertions below catch a migration that grants to these roles.
 * For ad-hoc local runs against a database migrated without that fixture the
 * roles are created here as a fallback (NOLOGIN, cluster-wide, left in place);
 * those runs then only prove the PUBLIC-grant and RLS assertions.
 *
 * The target schema is the connection's current_schema(): public on the
 * normal suite and on Supabase, wp17_ci/wp18_ci when the concurrency suite
 * reruns everything in disposable schemas built by the same migrations.
 */
const DATA_API_ROLES = ["anon", "authenticated"] as const;
const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;
const SAFE_SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

let targetSchema = "";

async function ensureNoLoginRole(role: (typeof DATA_API_ROLES)[number]) {
  // Role names come from the fixed list above, never from input.
  await getDb().$executeRawUnsafe(`
    DO $ensure_role$
    BEGIN
      CREATE ROLE "${role}" NOLOGIN;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $ensure_role$;
  `);
}

describe("Prisma schema RLS and Data API privilege catalog", () => {
  beforeAll(async () => {
    for (const role of DATA_API_ROLES) await ensureNoLoginRole(role);
    const [row] = await getDb().$queryRaw<Array<{ schema: string | null }>>`SELECT pg_catalog.current_schema() AS schema`;
    targetSchema = row?.schema ?? "";
    expect(targetSchema).toMatch(SAFE_SCHEMA_NAME);
  });

  it("enables row level security on every table in the migration schema", async () => {
    const tables = await getDb().$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT relation.relname, relation.relrowsecurity
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = ${targetSchema} AND relation.relkind IN ('r', 'p')
      ORDER BY relation.relname
    `;

    // Guard against a vacuous pass on an unmigrated schema.
    expect(tables.map((table) => table.relname)).toEqual(
      expect.arrayContaining(["_prisma_migrations", "Vendor", "CommerceOrder", "SupportCase", "UserPolicyConsent"]),
    );
    expect(tables.filter((table) => !table.relrowsecurity).map((table) => table.relname)).toEqual([]);
  });

  it("grants no table privilege to anon, authenticated or PUBLIC", async () => {
    for (const role of DATA_API_ROLES) {
      for (const privilege of TABLE_PRIVILEGES) {
        const exposed = await getDb().$queryRaw<Array<{ relname: string }>>`
          SELECT relation.relname
          FROM pg_catalog.pg_class AS relation
          INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = ${targetSchema}
            AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND pg_catalog.has_table_privilege(${role}::text, relation.oid, ${privilege}::text)
          ORDER BY relation.relname
        `;
        expect({ role, privilege, exposed: exposed.map((row) => row.relname) }).toEqual({ role, privilege, exposed: [] });
      }
    }
  });

  it("has no policy that admits anon, authenticated or PUBLIC", async () => {
    const policies = await getDb().$queryRaw<Array<{ tablename: string; policyname: string }>>`
      SELECT tablename, policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = ${targetSchema}
        AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
      ORDER BY tablename, policyname
    `;
    expect(policies).toEqual([]);
  });

  it("does not hand new tables to the Data API roles through default privileges", async () => {
    const probe = `rls_catalog_probe_${crypto.randomUUID().replace(/-/g, "")}`;
    const qualified = `"${targetSchema}"."${probe}"`;
    const rollback = new Error("rls-catalog-probe-rollback");
    let observed: Array<{ role: string; exposed: boolean }> = [];

    // Create a table as the migration role inside a transaction that is
    // always rolled back, so the probe never persists. Both identifiers are
    // checked/generated above, never taken from input.
    await expect(getDb().$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE ${qualified} (id integer)`);
      observed = await tx.$queryRawUnsafe<Array<{ role: string; exposed: boolean }>>(
        `SELECT role, pg_catalog.has_table_privilege(role, $2::text, 'SELECT,INSERT,UPDATE,DELETE') AS exposed
         FROM unnest($1::text[]) AS role
         ORDER BY role`,
        [...DATA_API_ROLES],
        qualified,
      );
      throw rollback;
    })).rejects.toBe(rollback);

    expect(observed).toEqual([
      { role: "anon", exposed: false },
      { role: "authenticated", exposed: false },
    ]);
  });
});
