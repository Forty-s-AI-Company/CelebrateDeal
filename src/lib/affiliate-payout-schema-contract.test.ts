import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = join(import.meta.dirname, "..", "..");
const schemaPath = join(projectRoot, "prisma", "schema.prisma");
const migrationsRoot = join(projectRoot, "prisma", "migrations");
const migrationDir = "20260806090000_affiliate_payout_contract";
const migrationPath = join(migrationsRoot, migrationDir, "migration.sql");
const outcomeReasonMigrationPath = join(
  migrationsRoot,
  "20260809060000_g7_28_affiliate_payout_outcome_reason",
  "migration.sql",
);
const taiwanTaxMigrationPath = join(
  migrationsRoot,
  "20260907200000_affiliate_payout_taiwan_withholding",
  "migration.sql",
);

function affiliatePayoutModel(schema: string): string {
  const match = schema.match(/model AffiliatePayout \{[\s\S]*?\n\}/);
  if (!match) throw new Error("AffiliatePayout model is missing");
  return match[0];
}

describe("AffiliatePayout FIN-03 schema contract", () => {
  it("requires vendor/affiliate/month identity and a non-null affiliate relation", () => {
    const model = affiliatePayoutModel(readFileSync(schemaPath, "utf8"));

    expect(model).toMatch(/^\s*affiliateId\s+String\s*$/m);
    expect(model).not.toMatch(/^\s*affiliateId\s+String\?\s*$/m);
    expect(model).toContain("affiliate Affiliate @relation(fields: [vendorId, affiliateId]");
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

  it("keeps later course payout read models separate from AffiliatePayout", () => {
    const migrationDirs = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(migrationDirs).toContain(migrationDir);
    const laterCourseMigrations = migrationDirs.filter((name) => name > migrationDir && name.includes("course"));
    expect(laterCourseMigrations.every((name) => {
      const sqlPath = join(migrationsRoot, name, "migration.sql");
      return !readFileSync(sqlPath, "utf8").match(/AffiliatePayout/i);
    })).toBe(true);
    expect(readFileSync(migrationPath, "utf8")).not.toMatch(/CREATE TABLE\s+"AffiliatePayout"/i);
  });
});

describe("G7-28 AffiliatePayout outcome reason contract", () => {
  it("keeps historical outcome notes nullable and bounds future values", () => {
    const model = affiliatePayoutModel(readFileSync(schemaPath, "utf8"));
    const migration = readFileSync(outcomeReasonMigrationPath, "utf8");

    expect(model).toMatch(/^\s*outcomeReason\s+String\?\s*$/m);
    expect(migration).toContain('ADD COLUMN "outcomeReason" TEXT');
    expect(migration).toContain('"outcomeReason" IS NULL');
    expect(migration).toContain('btrim("outcomeReason") <>');
    expect(migration).toContain('char_length("outcomeReason") BETWEEN 1 AND 500');
    expect(migration).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
  });
});

describe("Taiwan affiliate remuneration snapshot contract", () => {
  it("keeps every statutory amount and signature snapshot explicit", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const model = affiliatePayoutModel(schema);
    for (const field of ["grossAmountCents", "withholdingTaxCents", "nhiSupplementaryTaxCents", "bankFeeCents", "netPayoutAmountCents"]) {
      expect(model).toMatch(new RegExp(`^\\s*${field}\\s+Int\\?\\s*$`, "m"));
    }
    expect(model).toMatch(/^\s*taxCategory\s+String\s+@default\("92_other"\)\s*$/m);
    expect(model).toMatch(/^\s*signedAt\s+DateTime\?\s*$/m);
    expect(model).toMatch(/^\s*requestedTaxIdentityEncrypted\s+String\?\s*$/m);
    expect(schema).toMatch(/^\s*taxIdentityEncrypted\s+String\?\s*$/m);
    expect(schema).not.toMatch(/^\s*(taxIdentity|nationalId|identityNumber)\s+String\??\s*$/m);
  });

  it("adds only backward-compatible nullable snapshots and nonnegative checks", () => {
    const migration = readFileSync(taiwanTaxMigrationPath, "utf8");
    expect(migration).toContain('ADD COLUMN "grossAmountCents" INTEGER');
    expect(migration).toContain('ADD COLUMN "signedAt" TIMESTAMP(3)');
    expect(migration).toContain('ADD COLUMN "taxIdentityEncrypted" TEXT');
    expect(migration).toContain('"netPayoutAmountCents" IS NULL OR "netPayoutAmountCents" >= 0');
    expect(migration).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/i);
  });
});
