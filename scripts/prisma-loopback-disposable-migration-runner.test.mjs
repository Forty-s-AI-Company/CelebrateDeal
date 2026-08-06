import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { classifyFailure, listCanonicalMigrations, parseContainerInspection, verifyReceipt, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

test("discovers canonical migration directory names without a fixed count", () => {
  const migrations = listCanonicalMigrations();
  assert.ok(migrations.length > 0);
  assert.deepEqual([...migrations].sort(), migrations);
  assert.ok(migrations.every((name) => /^\d{12,14}_[a-z0-9_]+$/.test(name)));
});

test("keeps generic Schema engine errors explicitly unconfirmed", () => {
  assert.deepEqual(classifyFailure("Schema engine error", []), {
    category: "schema-engine-error",
    errorCode: null,
    rootCauseConfirmed: false,
  });
});

test("preserves Docker's explicit zero-mount field", () => {
  assert.deepEqual(
    parseContainerInspection("id\t/name\trun\tmarker\t\n"),
    { id: "id", name: "name", run: "run", marker: "marker", mount: "" },
  );
});

test("mirror preserves the canonical migration lock byte-for-byte", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-prisma-mirror-test-"));
  try {
    const mirror = writeMirror(tempRoot, listCanonicalMigrations());
    assert.deepEqual(
      fs.readFileSync(path.join(mirror, "migrations", "migration_lock.toml")),
      fs.readFileSync(path.resolve("prisma/migrations/migration_lock.toml")),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("accepts only sanitized loopback disposable receipts", () => {
  const receipt = {
    schemaVersion: "celebratedeal-prisma-loopback-migration/v1",
    workPackage: "PRISMA_NO_DOTENV_DISPOSABLE",
    status: "PASS",
    phases: { validate: "PASS", deploy: "PASS", status: "PASS" },
    migrationNames: listCanonicalMigrations(),
    failure: { category: "none", errorCode: null, rootCauseConfirmed: false },
    cleanup: { container: "PASS", tempRoot: "PASS" },
    safety: { sourceEnvContentsRead: false, rawOutputPersisted: false, loopbackOnly: true, noPersistentVolume: true },
  };
  assert.equal(verifyReceipt(receipt), true);
  assert.equal(verifyReceipt({ ...receipt, databaseUrl: "forbidden" }), false);
  assert.equal(verifyReceipt({ ...receipt, migrationNames: [] }), false);
  assert.equal(verifyReceipt({ ...receipt, migrationNames: receipt.migrationNames.slice(1) }), false);
  assert.equal(verifyReceipt({ ...receipt, migrationNames: [...receipt.migrationNames, receipt.migrationNames[0]] }), false);
  assert.equal(verifyReceipt({ ...receipt, migrationNames: [...receipt.migrationNames].reverse() }), false);
  assert.equal(verifyReceipt({ ...receipt, phases: { ...receipt.phases, raw: "forbidden" } }), false);
  assert.equal(verifyReceipt({ ...receipt, failure: { ...receipt.failure, detail: "forbidden" } }), false);
  assert.equal(verifyReceipt("not-json"), false);
});

test("classifies allowlisted migration failures without exposing raw diagnostics", () => {
  const knownMigrations = ["202607170001_team_funnel_domain"];

  assert.deepEqual(classifyFailure("Error: P3018: redacted migration failure", knownMigrations), {
    category: "failed-migrations",
    errorCode: "P3018",
    rootCauseConfirmed: true,
  });
  assert.deepEqual(
    classifyFailure(
      "The following migrations have not yet been applied: 202607170001_team_funnel_domain 20990101010101_untrusted",
      knownMigrations,
    ),
    {
      category: "pending-migrations",
      errorCode: null,
      rootCauseConfirmed: true,
    },
  );
});

test("rejects malformed or persistent Docker mount inspection values", () => {
  assert.equal(parseContainerInspection("incomplete"), null);
  assert.deepEqual(
    parseContainerInspection("id\t/name\trun\tmarker\ttmpfs=/var/lib/postgresql/data\n"),
    { id: "id", name: "name", run: "run", marker: "marker", mount: "tmpfs=/var/lib/postgresql/data" },
  );
  assert.deepEqual(
    parseContainerInspection("id\t/name\trun\tmarker\tvolume=/var/lib/postgresql/data\n"),
    { id: "id", name: "name", run: "run", marker: "marker", mount: "volume=/var/lib/postgresql/data" },
  );
});

test("rejects mirror requests for migrations without canonical SQL files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-prisma-mirror-missing-"));
  try {
    assert.throws(
      () => writeMirror(tempRoot, ["20990101010101_missing_migration"]),
      /migration-file-missing/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("keeps the mirror inventory limited to schema, config, lock, and migrations", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-prisma-mirror-inventory-"));
  try {
    const mirror = writeMirror(tempRoot, listCanonicalMigrations());
    assert.deepEqual(fs.readdirSync(mirror).sort(), ["migrations", "prisma.config.mjs", "schema.prisma"]);
    assert.deepEqual(fs.readdirSync(path.join(mirror, "migrations")).sort(), [
      "migration_lock.toml",
      ...listCanonicalMigrations(),
    ].sort());
    assert.equal(fs.existsSync(path.join(mirror, ".env")), false);
    assert.equal(fs.existsSync(path.join(mirror, ".env.local")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
