import path from "node:path";
import { listCanonicalMigrations } from "./prisma-loopback-disposable-migration-runner.mjs";
import { captureSourceFingerprint, assertSourceFingerprintStable } from "./qa-source-fingerprint.mjs";

/** Re-enumerate the migration set on every capture, including its lock file. */
export function captureCanonicalMigrationFingerprint(root, sourceFiles) {
  const migrationNames = listCanonicalMigrations(path.join(root, "prisma/migrations"));
  return {
    migrationNames,
    sourceFiles: captureSourceFingerprint(root, [...sourceFiles, "prisma/migrations/migration_lock.toml",
      ...migrationNames.map(name => `prisma/migrations/${name}/migration.sql`)]),
  };
}

export function assertCanonicalMigrationStable(before, after) {
  if (JSON.stringify(before.migrationNames) !== JSON.stringify(after.migrationNames)) {
    throw new Error("migration-source-changed");
  }
  assertSourceFingerprintStable(before.sourceFiles, after.sourceFiles);
}

/** The DB replay must cover exactly the source set, not a prefix or replacement. */
export function assertAppliedCanonicalMigrations(snapshot, appliedNames) {
  if (JSON.stringify(snapshot.migrationNames) !== JSON.stringify(appliedNames)) {
    throw new Error("applied-migration-set-mismatch");
  }
}
