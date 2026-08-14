import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const schema = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "prisma", "migrations", "20260808010000_live_product_tenant_binding", "migration.sql"),
  "utf8",
);
const actions = fs.readFileSync(path.join(ROOT, "src", "app", "actions.ts"), "utf8");
const seed = fs.readFileSync(path.join(ROOT, "prisma", "seed.ts"), "utf8");

describe("LiveProduct tenant binding contract", () => {
  it("declares vendor-scoped composite relations and lookup ordering", () => {
    const model = schema.match(/model LiveProduct \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(model).toMatch(/vendorId\s+String/);
    expect(model).toContain("vendor  Vendor  @relation(fields: [vendorId], references: [id], onDelete: Cascade)");
    expect(model).toContain("live    Live    @relation(fields: [vendorId, liveId], references: [vendorId, id], onDelete: Cascade)");
    expect(model).toContain("product Product @relation(fields: [vendorId, productId], references: [vendorId, id], onDelete: Cascade)");
    expect(model).toContain("@@unique([vendorId, liveId, productId])");
    expect(model).toContain("@@index([vendorId, liveId, sortOrder])");
  });

  it("backfills safely and replaces unscoped foreign keys without deleting data", () => {
    expect(migration).toContain("LiveProduct tenant preflight failed");
    expect(migration).toContain('ALTER TABLE "LiveProduct" ADD COLUMN "vendorId" TEXT;');
    expect(migration).toContain('SET "vendorId" = l."vendorId"');
    expect(migration).toContain('ALTER COLUMN "vendorId" SET NOT NULL;');
    expect(migration).toContain('DROP CONSTRAINT "LiveProduct_liveId_fkey"');
    expect(migration).toContain('DROP CONSTRAINT "LiveProduct_productId_fkey"');
    expect(migration).toContain('"LiveProduct_vendorId_liveId_fkey"');
    expect(migration).toContain('"LiveProduct_vendorId_productId_fkey"');
    expect(migration).toContain('"LiveProduct_vendorId_liveId_productId_key"');
    expect(migration).not.toMatch(/\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
  });

  it("propagates the authenticated vendor into every production writer", () => {
    expect(actions).toContain("data: { vendorId: input.vendorId, liveId: input.liveId!, productId");
    expect(seed).toContain("create: products.map((product, index) => ({\n          vendorId: vendor.id,");
  });
});
