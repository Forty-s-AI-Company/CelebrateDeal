import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const schema = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "prisma", "migrations", "20260808020000_live_resource_tenant_binding", "migration.sql"),
  "utf8",
);

describe("Live resource tenant binding contract", () => {
  it("declares vendor-scoped unique parents for composite foreign keys", () => {
    expect(schema.match(/model Video \{([\s\S]*?)\n\}/)?.[1] ?? "").toContain("@@unique([vendorId, id])");
    expect(schema.match(/model RegistrationForm \{([\s\S]*?)\n\}/)?.[1] ?? "").toContain("@@unique([vendorId, id])");
  });

  it("fails closed before backfill and enforces both composite resource bindings", () => {
    expect(migration).toContain("Live resource tenant preflight failed");
    expect(migration).toContain('CREATE UNIQUE INDEX "Video_vendorId_id_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "RegistrationForm_vendorId_id_key"');
    expect(migration).toContain('"Live_vendorId_videoId_fkey"');
    expect(migration).toContain('"Live_vendorId_formId_fkey"');
    expect(migration).toContain('ON DELETE NO ACTION ON UPDATE CASCADE');
    expect(migration).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
    expect(migration).not.toMatch(/\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
  });

  it("does not rely on application-only ownership checks", () => {
    expect(migration).toMatch(/FOREIGN KEY \("vendorId", "videoId"\)/);
    expect(migration).toMatch(/FOREIGN KEY \("vendorId", "formId"\)/);
  });
});
