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
});

