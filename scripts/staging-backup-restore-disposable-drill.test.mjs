import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFailure,
  createReceipt,
  isOwnedContainerInspection,
  normalizePublicSchemaDump,
  parseContainerInspection,
  safeEnvironment,
  validateReceipt,
} from "./staging-backup-restore-disposable-drill.mjs";
import { listCanonicalMigrations } from "./prisma-loopback-disposable-migration-runner.mjs";

test("disposable drill environment is explicit and does not inherit application values", () => {
  const sentinel = "STAGING_BACKUP_TEST_SENTINEL";
  const previous = process.env[sentinel];
  process.env[sentinel] = "must-not-propagate";
  try {
    const environment = safeEnvironment("C:\\Temp\\celebratedeal-staging-backup-0123456789abcdef");
    assert.equal(environment[sentinel], undefined);
    assert.equal(environment.PAYMENT_PROVIDER, "demo");
    assert.equal(environment.RATE_LIMIT_PROVIDER, "memory");
    assert.match(environment.HOME, /celebratedeal-staging-backup/u);
  } finally {
    if (previous === undefined) delete process.env[sentinel];
    else process.env[sentinel] = previous;
  }
});

test("container inspection requires exact marker identity and ephemeral mount", () => {
  const inspection = parseContainerInspection("container-id\t/celebratedeal-staging-backup-source-0123456789abcdef\t0123456789abcdef\tstaging-backup:0123456789abcdef:source\ttmpfs=/var/lib/postgresql/data\n");
  const expected = {
    id: "container-id",
    name: "celebratedeal-staging-backup-source-0123456789abcdef",
    run: "0123456789abcdef",
    marker: "staging-backup:0123456789abcdef:source",
  };
  assert.equal(isOwnedContainerInspection(inspection, expected), true);
  assert.equal(isOwnedContainerInspection({ ...inspection, marker: "other" }, expected), false);
  assert.equal(isOwnedContainerInspection({ ...inspection, mount: "volume=/var/lib/postgresql/data" }, expected), false);
  assert.equal(parseContainerInspection("malformed"), null);
});

test("schema dump normalization removes only the default public schema declaration", () => {
  const dump = Buffer.from("SET statement_timeout = 0;\nCREATE SCHEMA public;\nALTER SCHEMA public OWNER TO pg_database_owner;\n", "utf8");
  assert.equal(normalizePublicSchemaDump(dump).toString("utf8"), "SET statement_timeout = 0;\nALTER SCHEMA public OWNER TO pg_database_owner;\n");
  assert.throws(() => normalizePublicSchemaDump(Buffer.alloc(0)), /schema-dump-invalid/u);
  assert.throws(() => normalizePublicSchemaDump(Buffer.from("CREATE SCHEMA public;\nCREATE SCHEMA public;\n", "utf8")), /schema-dump-public-schema-duplicate/u);
});

test("receipt validator accepts only a complete sanitized pass envelope", () => {
  const migrations = listCanonicalMigrations();
  const receipt = createReceipt(migrations);
  receipt.status = "PASS";
  receipt.migrations.source = "PASS";
  receipt.migrations.restored = "PASS";
  receipt.migrations.status = "PASS";
  receipt.backup = { schema: "PASS", data: "PASS", schemaBytes: 10, dataBytes: 20, schemaSha256: "a".repeat(64), dataSha256: "b".repeat(64) };
  receipt.restore = { schema: "PASS", data: "PASS", aggregate: "PASS" };
  receipt.cleanup = { sourceContainer: "PASS", targetContainer: "PASS", tempRoot: "PASS" };
  assert.equal(validateReceipt(receipt, migrations), true);
  assert.equal(validateReceipt({ ...receipt, safety: { ...receipt.safety, rawDumpPersisted: true } }, migrations), false);
  assert.equal(validateReceipt({ ...receipt, backup: { ...receipt.backup, schemaSha256: "not-a-digest" } }, migrations), false);
});

test("failure classification is fixed and never preserves raw output", () => {
  assert.equal(classifyFailure("docker-container-create-failed"), "DOCKER_UNAVAILABLE_OR_OWNERSHIP");
  assert.equal(classifyFailure("pg_dump-failed"), "DATABASE_BACKUP_OR_RESTORE_FAILED");
  assert.equal(classifyFailure("psql-restore-failed:ROLE_DEPENDENCY"), "DATABASE_RESTORE_ROLE_DEPENDENCY");
  assert.equal(classifyFailure("prisma-migrate-status-failed"), "MIGRATION_GATE_FAILED");
  assert.equal(classifyFailure("unexpected"), "DRILL_FAILED_UNCLASSIFIED");
});
