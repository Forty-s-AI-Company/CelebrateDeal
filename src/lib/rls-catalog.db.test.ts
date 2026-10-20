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
 * Plain PostgreSQL in CI and on loopback does not ship the Supabase roles, so
 * the test creates them as NOLOGIN roles first. They are left in place; they
 * cannot log in and own nothing.
 */
const DATA_API_ROLES = ["anon", "authenticated"] as const;
const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

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

describe("public schema RLS and Data API privilege catalog", () => {
  beforeAll(async () => {
    for (const role of DATA_API_ROLES) await ensureNoLoginRole(role);
  });

  it("enables row level security on every public table", async () => {
    const tables = await getDb().$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT relation.relname, relation.relrowsecurity
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
      ORDER BY relation.relname
    `;

    // Guard against a vacuous pass on an unmigrated database.
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
          WHERE namespace.nspname = 'public'
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
      WHERE schemaname = 'public'
        AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
      ORDER BY tablename, policyname
    `;
    expect(policies).toEqual([]);
  });

  it("does not hand new public tables to the Data API roles through default privileges", async () => {
    const probe = `rls_catalog_probe_${crypto.randomUUID().replace(/-/g, "")}`;
    const rollback = new Error("rls-catalog-probe-rollback");
    let observed: Array<{ role: string; exposed: boolean }> = [];

    // Create a table as the migration role inside a transaction that is
    // always rolled back, so the probe never persists.
    await expect(getDb().$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE public."${probe}" (id integer)`);
      observed = await tx.$queryRawUnsafe<Array<{ role: string; exposed: boolean }>>(
        `SELECT role, pg_catalog.has_table_privilege(role, 'public."${probe}"', 'SELECT,INSERT,UPDATE,DELETE') AS exposed
         FROM unnest($1::text[]) AS role
         ORDER BY role`,
        [...DATA_API_ROLES],
      );
      throw rollback;
    })).rejects.toBe(rollback);

    expect(observed).toEqual([
      { role: "anon", exposed: false },
      { role: "authenticated", exposed: false },
    ]);
  });
});
