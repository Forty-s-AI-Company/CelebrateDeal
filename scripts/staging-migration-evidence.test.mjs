import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createStagingMigrationReceipt,
  validateStagingMigrationReceipt,
} from "./staging-migration-evidence.mjs";

const knownMigrations = [
  "20260721133000_inventory_reservations",
  "20260801090000_live_chat_ingress",
];

function completeFacts(overrides = {}) {
  return {
    runId: "staging-migration-synthetic-01",
    executedAtUtc: "2026-08-21T00:00:00.000Z",
    authorizationRecordRef: "ticket-staging-01",
    environmentClass: "staging",
    databaseIdentityClass: "staging-database",
    migrationStatus: "up-to-date",
    expectedMigrationNames: knownMigrations,
    appliedMigrationNames: knownMigrations,
    ...overrides,
  };
}

test("accepts an exact non-Production staging migration receipt", () => {
  const receipt = createStagingMigrationReceipt(completeFacts());

  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.expectedMigrationCount, 2);
  assert.equal(receipt.appliedMigrationCount, 2);
  assert.equal(receipt.unallowlistedMigrationCount, 0);
  assert.equal(receipt.sideEffects.databaseWrites, 0);
  assert.equal(validateStagingMigrationReceipt(receipt), true);
});

test("fails closed when staging identity or authorization is missing", () => {
  const receipt = createStagingMigrationReceipt(completeFacts({
    authorizationRecordRef: "",
    environmentClass: "production",
    databaseIdentityClass: "unknown",
  }));

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(validateStagingMigrationReceipt(receipt), true);
});

test("classifies pending or divergent migration state as failed", () => {
  const receipt = createStagingMigrationReceipt(completeFacts({
    migrationStatus: "pending-migrations",
    appliedMigrationNames: [knownMigrations[0]],
  }));

  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.appliedMigrationCount, 1);
  assert.equal(validateStagingMigrationReceipt(receipt), true);
});

test("does not persist unallowlisted migration names or raw connection text", () => {
  const untrusted = "20990101010101_untrusted_value";
  const receipt = createStagingMigrationReceipt(completeFacts({
    appliedMigrationNames: [...knownMigrations, untrusted],
    runId: "postgresql://user:password@host/db",
  }));
  const serialized = JSON.stringify(receipt);

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.unallowlistedMigrationCount, 1);
  assert.equal(serialized.includes(untrusted), false);
  assert.equal(serialized.includes("postgresql://"), false);
  assert.equal(validateStagingMigrationReceipt(receipt), true);
});

test("rejects a tampered PASS receipt", () => {
  const receipt = createStagingMigrationReceipt(completeFacts());

  assert.equal(validateStagingMigrationReceipt({
    ...receipt,
    sideEffects: { ...receipt.sideEffects, migrationWrites: 1 },
  }), false);
  assert.equal(validateStagingMigrationReceipt({
    ...receipt,
    result: "PASS",
    appliedMigrationCount: 1,
  }), false);
});
