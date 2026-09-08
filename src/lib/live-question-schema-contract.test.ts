import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("live Q&A spotlight persistence contract", () => {
  it("keeps questions tenant-bound, pseudonymous, and constrained to one spotlight per live", async () => {
    const migration = await readFile("prisma/migrations/20260907180000_live_qa_spotlight/migration.sql", "utf8");

    expect(migration).toContain('CREATE TABLE "LiveQuestion"');
    expect(migration).toContain('"participantHash" TEXT NOT NULL');
    expect(migration).not.toContain('"participantId"');
    expect(migration).not.toContain('"email" TEXT');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id")');
    expect(migration).toContain('CREATE UNIQUE INDEX "LiveQuestion_one_spotlight_per_live_key"');
    expect(migration).toContain('WHERE "status" = \'spotlight\'');
  });

  it("keeps the Prisma model aligned with the durable status and relation contract", async () => {
    const schema = await readFile("prisma/schema.prisma", "utf8");

    expect(schema).toMatch(/enum LiveQuestionStatus \{[\s\S]*?pending[\s\S]*?spotlight[\s\S]*?answered[\s\S]*?hidden/);
    expect(schema).toMatch(/model LiveQuestion \{[\s\S]*?vendorId\s+String[\s\S]*?liveId\s+String[\s\S]*?participantHash\s+String[\s\S]*?displayName\s+String\?[\s\S]*?body\s+String[\s\S]*?status\s+LiveQuestionStatus\s+@default\(pending\)/);
    expect(schema).toMatch(/live\s+Live\s+@relation\(fields: \[vendorId, liveId\], references: \[vendorId, id\], onDelete: Cascade\)/);
    expect(schema).toContain("@@index([vendorId, liveId, status, createdAt])");
  });
});
