import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = join(import.meta.dirname, "..", "..");
const schemaPath = join(projectRoot, "prisma", "schema.prisma");
const migrationsRoot = join(projectRoot, "prisma", "migrations");
const migrationDir = "20260806090000_affiliate_payout_contract";
const migrationPath = join(migrationsRoot, migrationDir, "migration.sql");

function affiliatePayoutModel(schema: string): string {
  const match = schema.match(/model AffiliatePayout \{[\s\S]*?\n\}/);
  if (!match) throw new Error("AffiliatePayout model is missing");
  return match[0];
}

describe("AffiliatePayout FIN-03 schema contract", () => {
  it("requires vendor/affiliate/month identity and a non-null affiliate relation", () => {
    const model = affiliatePayoutModel(readFileSync(schemaPath, "utf8"));

    expect(model).toContain("affiliateId           String");
    expect(model).not.toContain("affiliateId           String?");
    expect(model).toContain("affiliate Affiliate  @relation(fields: [vendorId, affiliateId]");
    expect(model).toContain("@@unique([vendorId, affiliateId, monthKey])");
  });

  it("keeps the migration fail-closed and free of automatic data repair", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain('WHERE "affiliateId" IS NULL');
    expect(migration).toContain('GROUP BY "vendorId", "affiliateId", "monthKey"');
    expect(migration).toContain('WHERE "finalAmountCents" < 0');
    expect(migration).toContain("ALTER COLUMN \"affiliateId\" SET NOT NULL");
    expect(migration).toContain('CHECK ("finalAmountCents" >= 0)');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "AffiliatePayout_vendorId_affiliateId_monthKey_key"',
    );
    expect(migration).not.toMatch(/\b(DELETE|UPDATE)\s+FROM?\s*"AffiliatePayout"/i);
    expect(migration).not.toMatch(/\b(TRUNCATE|DROP TABLE)\b/i);
  });

  it("is the latest canonical migration and does not introduce a second payout writer", () => {
    const migrationDirs = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(migrationDirs.at(-1)).toBe(migrationDir);
    expect(readFileSync(migrationPath, "utf8")).not.toMatch(/PayoutBatch|PayoutItem|bank|KYC/i);
  });
});
