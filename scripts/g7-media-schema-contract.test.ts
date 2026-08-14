import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const schema = fs.readFileSync(path.join(workspaceRoot, "prisma", "schema.prisma"), "utf8");
const migration = fs.readFileSync(
  path.join(workspaceRoot, "prisma", "migrations", "20260808080000_g7_03_media_assets", "migration.sql"),
  "utf8",
);

describe("G7-03 media tenant FK contract", () => {
  it("requires vendorId together with every optional image asset reference", () => {
    for (const relation of [
      '@relation("ProductImageAsset", fields: [vendorId, imageAssetId], references: [vendorId, id], onDelete: Restrict)',
      '@relation("LiveHeroImageAsset", fields: [vendorId, heroImageAssetId], references: [vendorId, id], onDelete: Restrict)',
      '@relation("VideoThumbnailImageAsset", fields: [vendorId, thumbnailAssetId], references: [vendorId, id], onDelete: Restrict)',
    ]) {
      expect(schema).toContain(relation);
    }
    expect(schema).toMatch(/model ImageAsset[\s\S]*@@unique\(\[vendorId, id\]\)/u);
  });

  it("installs composite PostgreSQL foreign keys instead of id-only media links", () => {
    for (const assetField of ["imageAssetId", "heroImageAssetId", "thumbnailAssetId"]) {
      expect(migration).toContain(
        `FOREIGN KEY ("vendorId", "${assetField}") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT`,
      );
    }
    expect(migration).not.toMatch(/FOREIGN KEY \("(?:imageAssetId|heroImageAssetId|thumbnailAssetId)"\) REFERENCES "ImageAsset"\("id"\)/u);
  });
});
