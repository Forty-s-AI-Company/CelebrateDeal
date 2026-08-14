import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schema = fs.readFileSync(path.resolve("prisma/schema.prisma"), "utf8");
const migration = fs.readFileSync(
  path.resolve("prisma/migrations/20260808030000_stream_usage_attribution_allocation/migration.sql"),
  "utf8",
);
const usageSource = fs.readFileSync(path.resolve("src/lib/stream-usage.ts"), "utf8");
const billingSource = fs.readFileSync(path.resolve("src/lib/billing.ts"), "utf8");

describe("stream usage attribution contract", () => {
  it("keeps the raw ledger and allocation child tenant scoped", () => {
    expect(schema).toContain("model StreamUsageAllocationEntry {");
    expect(schema).toContain("@@unique([vendorId, ledgerEntryId, recipientKey])");
    expect(schema).toContain("references: [vendorId, teamId, id]");
    expect(migration).toContain("StreamUsageAllocationEntry_vendorId_ledgerEntryId_recipientKey_key");
    expect(migration).toContain("StreamUsageAllocationEntry_vendorId_recipientTeamId_recipientMembershipId_fkey");
    expect(migration).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);
  });

  it("snapshots policy mode and creates allocations in the parent transaction", () => {
    expect(schema).toContain('policyVersion            Int      @default(2)');
    expect(schema).toContain('attributionMode          String   @default("PROMOTER")');
    expect(usageSource).toContain("db.$transaction(async (tx)");
    expect(usageSource).toContain("allocations: {");
    expect(usageSource).toContain("recipientKey: allocation.recipientKey");
  });

  it("keeps provider aggregate settlement separate from internal allocation totals", () => {
    expect(billingSource).toContain("db.streamUsageLedgerEntry.findMany");
    expect(billingSource).toContain("db.streamUsageAllocationEntry.findMany");
    expect(billingSource).toContain("internalStreamUsageAllocations");
  });
});
