import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("smart automation workflow persistence contract", () => {
  it("keeps automation rows tenant-scoped and idempotent", async () => {
    const migration = await readFile(
      "prisma/migrations/20260906013000_smart_automation_workflows/migration.sql",
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "AutomationRule"');
    expect(migration).toContain('"condition" JSONB NOT NULL');
    expect(migration).toContain('"actions" JSONB NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX "AutomationExecutionLog_vendorId_idempotencyKey_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "AutomationVoucherGrant_claimTokenHash_key"');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "ruleId") REFERENCES "AutomationRule"("vendorId", "id")');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id")');
    expect(migration).toContain('CREATE INDEX "StreamUsageLedgerEntry_liveId_viewerKeyHash_capturedAt_idx"');
    expect(migration).not.toContain('"customerKey" TEXT');
    expect(migration).not.toContain('"viewerKey" TEXT');
    expect(migration).not.toContain('"claimToken" TEXT');
  });

  it("keeps the Prisma schema aligned with the migration contract", async () => {
    const schema = await readFile("prisma/schema.prisma", "utf8");

    expect(schema).toContain("model AutomationRule {");
    expect(schema).toContain("model AutomationExecutionLog {");
    expect(schema).toContain("model CustomerTagAssignment {");
    expect(schema).toContain("model AutomationVoucherGrant {");
    expect(schema).toMatch(/viewerKeyHash\s+String\?/u);
    expect(schema).toContain("@@index([liveId, viewerKeyHash, capturedAt])");
    expect(schema).toContain("@@unique([vendorId, idempotencyKey])");
    expect(schema).toMatch(/claimTokenHash\s+String\s+@unique/u);
  });
});
