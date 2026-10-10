import { afterAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { assertLocalTestDatabase } from "./local-database-safety";
import { installMerchantSchema, merchantSchemaState, merchantStatements, MERCHANT_MIGRATION, MERCHANT_TABLES, MERCHANT_SQL_SHA256 } from "./q1-merchant-schema";
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
const db = new PrismaClient();
const sql = await readFile(`prisma/migrations/${MERCHANT_MIGRATION}/migration.sql`, "utf8");
afterAll(() => db.$disconnect());
const rollback = new Error("SYNTHETIC_REPLAY_ROLLBACK");

describe("real PostgreSQL fixed merchant forward replay", () => {
  it("replays the complete pinned migration, guards and ledger atomically on a synthetic pre-migration schema", async () => {
    const before = await db.$transaction(merchantSchemaState);
    expect(before.tables).toBe(7); expect(before.columns).toBe(4);
    await expect(db.$transaction(async tx => {
      // Only this disposable transaction simulates the observed missing schema.
      // It always rolls back, leaving the canonical 95-migration database intact.
      for (const statement of merchantStatements(sql)) {
        const func = statement.match(/^CREATE FUNCTION ([a-z_]+)\(([^)]*)\)/u);
        if (func) await tx.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${func[1]}(${func[2] ? "JSONB" : ""}) CASCADE`);
      }
      for (const table of MERCHANT_TABLES) await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      for (const column of ["merchantCalculationId", "merchantCheckoutId", "merchantLevel", "merchantRecipientId"]) await tx.$executeRawUnsafe(`ALTER TABLE "AffiliateCommission" DROP COLUMN "${column}" CASCADE`);
      await tx.$executeRawUnsafe('ALTER TABLE "AffiliatePayout" DROP COLUMN "heldAmountCents" CASCADE');
      for (const statement of merchantStatements(sql)) {
        const index = statement.match(/^CREATE (?:UNIQUE )?INDEX "([A-Za-z0-9_]+)"/u);
        if (index) await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "${index[1]}" CASCADE`);
      }
      await tx.$executeRaw`DELETE FROM public._prisma_migrations WHERE migration_name=${MERCHANT_MIGRATION}`;
      expect(await merchantSchemaState(tx)).toEqual({ tables: 0, columns: 0, ledger: [] });
      expect(await installMerchantSchema(tx, sql)).toEqual({ installedTables: 7, installedColumns: 4 });
      const after = await merchantSchemaState(tx);
      expect(after.ledger).toEqual([{ checksum: MERCHANT_SQL_SHA256, finished: true, rolled: false }]);
      const rls = await tx.$queryRaw<{ name: string; enabled: boolean }[]>(Prisma.sql`SELECT relname AS name, relrowsecurity AS enabled FROM pg_class WHERE relname IN (${Prisma.join([...MERCHANT_TABLES])}) AND relkind='r' AND relnamespace='public'::regnamespace ORDER BY relname`);
      expect(rls.map(row => row.name)).toEqual([...MERCHANT_TABLES].sort());
      expect(rls.every(row => row.enabled)).toBe(true);
      const guard = await tx.$queryRaw<{ present: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='merchant_affiliate_commission_plan_guard' AND NOT tgisinternal) AS present`;
      expect(guard).toEqual([{ present: true }]);
      await expect(installMerchantSchema(tx, sql)).rejects.toThrow("FIXED_MERCHANT_SCHEMA_REJECTED");
      throw rollback;
    }, { timeout: 60000 })).rejects.toBe(rollback);
    expect(await db.$transaction(merchantSchemaState)).toEqual(before);
  });
  it("rejects an installed migration without mutating its ledger or schema", async () => {
    const before = await db.$transaction(merchantSchemaState);
    await expect(db.$transaction(tx => installMerchantSchema(tx, sql))).rejects.toThrow("FIXED_MERCHANT_SCHEMA_REJECTED");
    expect(await db.$transaction(merchantSchemaState)).toEqual(before);
  });
});
