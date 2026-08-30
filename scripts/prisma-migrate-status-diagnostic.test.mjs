import assert from "node:assert/strict";
import { test } from "vitest";

import { classifyPrismaMigrateStatus } from "./prisma-migrate-status-diagnostic.mjs";

test("classifies only whitelisted Prisma connection error codes", () => {
  const cases = [
    ["P1000", "connection-authentication"],
    ["P1001", "database-unreachable"],
    ["P1002", "database-timeout"],
  ];

  for (const [code, category] of cases) {
    assert.deepEqual(
      classifyPrismaMigrateStatus(`Error: ${code}: redacted diagnostic`),
      { category, errorCode: code, pendingMigrations: [], rootCauseConfirmed: true },
    );
  }
});

test("classifies explicit pending migration output and exposes only migration directory names", () => {
  const diagnostic = classifyPrismaMigrateStatus(`
    The following migrations have not yet been applied:
    20260721133000_inventory_reservations
  `, { knownMigrationNames: ["20260721133000_inventory_reservations"] });

  assert.deepEqual(diagnostic, {
    category: "pending-migrations",
    errorCode: null,
    pendingMigrations: ["20260721133000_inventory_reservations"],
    rootCauseConfirmed: true,
  });
});

test("classifies explicit migration history divergence", () => {
  const diagnostic = classifyPrismaMigrateStatus(`
    Your local migration history and the migrations table from your database are different.
    The migrations from the database are not found locally in prisma/migrations.
    20260721133000_inventory_reservations
  `, { knownMigrationNames: ["20260721133000_inventory_reservations"] });

  assert.deepEqual(diagnostic, {
    category: "history-diverged",
    errorCode: null,
    pendingMigrations: ["20260721133000_inventory_reservations"],
    rootCauseConfirmed: true,
  });
});

test("classifies an explicit missing migration table", () => {
  assert.deepEqual(
    classifyPrismaMigrateStatus("No migration table is found."),
    { category: "migration-table-missing", errorCode: null, pendingMigrations: [], rootCauseConfirmed: true },
  );
});

test("classifies failed migrations through explicit text or a whitelisted Prisma code", () => {
  assert.deepEqual(
    classifyPrismaMigrateStatus("Failed migrations are found."),
    { category: "failed-migrations", errorCode: null, pendingMigrations: [], rootCauseConfirmed: true },
  );
  assert.deepEqual(
    classifyPrismaMigrateStatus("Error: P3018: redacted diagnostic"),
    { category: "failed-migrations", errorCode: "P3018", pendingMigrations: [], rootCauseConfirmed: true },
  );
});

test("generic Schema engine errors are classified without asserting a root cause", () => {
  assert.deepEqual(
    classifyPrismaMigrateStatus("Schema engine error"),
    { category: "schema-engine-error", errorCode: null, pendingMigrations: [], rootCauseConfirmed: false },
  );
  assert.deepEqual(
    classifyPrismaMigrateStatus("Schema Engine completed a local startup check."),
    { category: "unknown", errorCode: null, pendingMigrations: [], rootCauseConfirmed: false },
  );
  assert.deepEqual(
    classifyPrismaMigrateStatus("Error: P9999: redacted diagnostic"),
    { category: "unknown", errorCode: null, pendingMigrations: [], rootCauseConfirmed: false },
  );
});

test("pending diagnostics disclose only repository-whitelisted migration names", () => {
  const diagnostic = classifyPrismaMigrateStatus(`
    The following migrations have not yet been applied:
    20260721133000_inventory_reservations
    20990101010101_untrusted_value
  `, { knownMigrationNames: ["20260721133000_inventory_reservations"] });

  assert.deepEqual(diagnostic, {
    category: "pending-migrations",
    errorCode: null,
    pendingMigrations: ["20260721133000_inventory_reservations"],
    rootCauseConfirmed: true,
  });
});

test("keeps legacy 12-digit migration names when explicitly whitelisted", () => {
  const diagnostic = classifyPrismaMigrateStatus(`
    The following migrations have not yet been applied:
    202607170001_team_funnel_domain
  `, { knownMigrationNames: ["202607170001_team_funnel_domain"] });

  assert.deepEqual(diagnostic.pendingMigrations, ["202607170001_team_funnel_domain"]);
});
