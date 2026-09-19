import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("advanced live interaction persistence contract", () => {
  it("keeps viewer and voucher bearer identities hashed and tenant-binds every durable row", async () => {
    const migration = await readFile("prisma/migrations/20260906003000_advanced_live_interactions/migration.sql", "utf8");
    expect(migration).toContain('"participantHash" TEXT NOT NULL');
    expect(migration).toContain('"claimTokenHash" TEXT');
    expect(migration).not.toContain('"viewerToken"');
    expect(migration).not.toContain('"claimToken"');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id")');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "runId") REFERENCES "LiveInteractionRun"("vendorId", "id")');
    expect(migration).toContain('CREATE UNIQUE INDEX "LiveInteractionResponse_runId_participantHash_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "LiveInteractionResponse_claimTokenHash_key"');
  });

  it("stores purchased identity and lucky-draw redemption material without plaintext codes", async () => {
    const migration = await readFile("prisma/migrations/20260907090000_live_lucky_draw_purchase_claim/migration.sql", "utf8");
    expect(migration).toContain('"formSubmissionId" TEXT');
    expect(migration).toContain('"winnerClaimCodeEncryptedEnvelope" TEXT');
    expect(migration).toContain('"winnerClaimedAt" TIMESTAMP(3)');
    expect(migration).not.toContain('"winnerClaimCode" TEXT');
    expect(migration).not.toContain('"winnerClaimCodeHash" TEXT');
    const schema = await readFile("prisma/schema.prisma", "utf8");
    expect(schema).toContain("claimTokenHash");
    expect(schema).not.toContain("winnerClaimCodeHash");
    expect(schema).toMatch(/run\s+LiveInteractionRun\s+@relation\(fields: \[vendorId, liveId, runId\], references: \[vendorId, liveId, id\]/);
    expect(schema).toMatch(/formSubmission\s+FormSubmission\?\s+@relation\(fields: \[liveId, formSubmissionId\], references: \[liveId, id\]/);
  });

  it("hardens response ownership across the live, run, and registration tuple", async () => {
    const migration = await readFile("prisma/migrations/20260911080000_live_interaction_tenant_integrity/migration.sql", "utf8");
    expect(migration).toContain('CREATE UNIQUE INDEX "LiveInteractionRun_vendorId_liveId_id_key"');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "liveId", "runId")');
    expect(migration).toContain('REFERENCES "LiveInteractionRun"("vendorId", "liveId", "id")');
    expect(migration).toContain('FOREIGN KEY ("liveId", "formSubmissionId")');
    expect(migration).toContain('REFERENCES "FormSubmission"("liveId", "id")');
    expect(migration).toContain("RAISE EXCEPTION");
  });
});
