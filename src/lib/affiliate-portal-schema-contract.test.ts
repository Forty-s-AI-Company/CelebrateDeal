import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("affiliate portal schema contract", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260905090000_affiliate_portal/migration.sql", "utf8");

  it("binds one portal user per affiliate and tenant", () => {
    expect(schema).toMatch(/model Affiliate \{[\s\S]*?userId\s+String\?[\s\S]*?@@unique\(\[vendorId, userId\]\)/);
    expect(schema).toMatch(/portalUser\s+User\?[\s\S]*?onDelete: SetNull/);
    expect(migration).toContain('FOREIGN KEY ("userId") REFERENCES "User"("id")');
  });

  it("preserves the encrypted bank destination used for a payout request", () => {
    expect(schema).toMatch(/model AffiliatePayout \{[\s\S]*?requestedAt\s+DateTime\?[\s\S]*?requestedBankAccountEncrypted\s+String\?/);
    expect(migration).toContain('ADD COLUMN "requestedBankAccountEncrypted" TEXT');
  });
});

