import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { captureCanonicalMigrationFingerprint, assertCanonicalMigrationStable,
  assertAppliedCanonicalMigrations } from "./canonical-migration-source-fingerprint.mjs";

const ownedRoots = [];
afterEach(() => {
  for (const root of ownedRoots.splice(0)) {
    // Only exact mkdtemp roots created by these tests may be removed.
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("celebratedeal-migration-fingerprint-")) {
      throw new Error("invalid-owned-test-root");
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-migration-fingerprint-"));
  ownedRoots.push(root);
  const directory = path.join(root, "prisma/migrations/20261001000000_synthetic_initial");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "migration.sql"), "SELECT 1;\n");
  fs.writeFileSync(path.join(root, "prisma/migrations/migration_lock.toml"), 'provider = "postgresql"\n');
  fs.writeFileSync(path.join(root, "source.ts"), "export const synthetic = true;\n");
  return root;
}

it("accepts stable source only when the applied migration set is exact", () => {
  const root = fixture();
  const before = captureCanonicalMigrationFingerprint(root, ["source.ts"]);
  const after = captureCanonicalMigrationFingerprint(root, ["source.ts"]);
  expect(() => assertCanonicalMigrationStable(before, after)).not.toThrow();
  expect(() => assertAppliedCanonicalMigrations(before, [...before.migrationNames])).not.toThrow();
});

it("rejects a migration added after initial source capture", () => {
  const root = fixture();
  const before = captureCanonicalMigrationFingerprint(root, ["source.ts"]);
  const directory = path.join(root, "prisma/migrations/20261002000000_synthetic_added");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "migration.sql"), "SELECT 2;\n");
  const after = captureCanonicalMigrationFingerprint(root, ["source.ts"]);
  expect(() => assertCanonicalMigrationStable(before, after)).toThrow("migration-source-changed");
});

it("rejects a changed migration lock even when migration names stay the same", () => {
  const root = fixture();
  const before = captureCanonicalMigrationFingerprint(root, ["source.ts"]);
  fs.writeFileSync(path.join(root, "prisma/migrations/migration_lock.toml"), 'provider = "sqlite"\n');
  const after = captureCanonicalMigrationFingerprint(root, ["source.ts"]);
  expect(() => assertCanonicalMigrationStable(before, after)).toThrow("source-changed");
});

it("rejects an applied migration subset or a replacement name", () => {
  const root = fixture();
  const before = captureCanonicalMigrationFingerprint(root, ["source.ts"]);
  expect(() => assertAppliedCanonicalMigrations(before, [])).toThrow("applied-migration-set-mismatch");
  expect(() => assertAppliedCanonicalMigrations(before, ["20261001000000_other"])).toThrow("applied-migration-set-mismatch");
});
