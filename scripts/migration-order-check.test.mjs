import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluateMigrationOrder,
  latestMigration,
  migrationSortKey,
  parseMigrationTree,
  runMigrationOrderCheck,
} from "./migration-order-check.mjs";

const master = [
  "20260709090000_postgresql_baseline",
  "202607170001_team_funnel_domain",
  "20261018090000_post_purchase_recovery_guard",
  "20261019120000_user_policy_consent",
];

test("legacy 12-digit prefixes sort by time with 14-digit ones", () => {
  assert.ok(migrationSortKey("202607170001_team_funnel_domain") < migrationSortKey("20260724150000_harden_supabase_data_api"));
  assert.ok(migrationSortKey("20260709090000_postgresql_baseline") < migrationSortKey("202607170001_team_funnel_domain"));
  assert.equal(migrationSortKey("migration_lock.toml"), null);
  assert.equal(latestMigration(master), "20261019120000_user_policy_consent");
  assert.equal(latestMigration([]), null);
});

test("parses ls-tree output and ignores non-migration entries", () => {
  assert.deepEqual(
    parseMigrationTree("20261019120000_user_policy_consent\r\nmigration_lock.toml\n\n202607170001_team_funnel_domain\n"),
    ["20261019120000_user_policy_consent", "202607170001_team_funnel_domain"],
  );
});

test("accepts a branch that adds a newer migration", () => {
  const result = evaluateMigrationOrder({
    baseMigrations: master,
    mergeBaseMigrations: master,
    headMigrations: [...master, "20261020090000_enable_rls_all_tables"],
  });
  assert.deepEqual(result, {
    ok: true,
    latestBase: "20261019120000_user_policy_consent",
    added: ["20261020090000_enable_rls_all_tables"],
    errors: [],
  });
});

test("accepts a branch with no migration changes", () => {
  const result = evaluateMigrationOrder({ baseMigrations: master, mergeBaseMigrations: master, headMigrations: master });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added, []);
});

test("rejects a migration that sorts before or equal to the newest base migration", () => {
  const result = evaluateMigrationOrder({
    baseMigrations: master,
    mergeBaseMigrations: master,
    headMigrations: [...master, "20261007010000_learner_notifications", "20261019120000_user_policy_consent_again"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^20261007010000_learner_notifications: must sort after the newest base migration 20261019120000_user_policy_consent/u);
});

test("rejects a branch that fell behind a newer master migration", () => {
  const newerMaster = [...master, "20261021080000_other_line"];
  const result = evaluateMigrationOrder({
    baseMigrations: newerMaster,
    mergeBaseMigrations: master,
    headMigrations: [...master, "20261020090000_enable_rls_all_tables"],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /rebase and rename/u);
});

test("rejects new legacy-style or malformed names", () => {
  const result = evaluateMigrationOrder({
    baseMigrations: master,
    mergeBaseMigrations: master,
    headMigrations: [...master, "202610210001_short_prefix"],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /<YYYYMMDDHHMMSS>_<snake_case>/u);
});

test("rejects deleting or renaming a migration the branch started from", () => {
  const result = evaluateMigrationOrder({
    baseMigrations: master,
    mergeBaseMigrations: master,
    headMigrations: master.filter((name) => name !== "20261018090000_post_purchase_recovery_guard"),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "20261018090000_post_purchase_recovery_guard: existing migration was deleted or renamed; migrations are forward-only.",
  ]);
});

function gitIn(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function addMigration(root, name) {
  const directory = path.join(root, "prisma", "migrations", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "migration.sql"), "SELECT 1;\n");
}

test("reads migrations from a real git base ref and merge base", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-migration-order-"));
  try {
    gitIn(root, "init", "--quiet", "--initial-branch=master");
    gitIn(root, "config", "user.email", "synthetic@example.test");
    gitIn(root, "config", "user.name", "Synthetic");
    addMigration(root, "20261019120000_user_policy_consent");
    fs.writeFileSync(path.join(root, "prisma", "migrations", "migration_lock.toml"), "provider = \"postgresql\"\n");
    gitIn(root, "add", ".");
    gitIn(root, "commit", "--quiet", "-m", "base");
    gitIn(root, "checkout", "--quiet", "-b", "feature");
    addMigration(root, "20261020090000_enable_rls_all_tables");
    gitIn(root, "add", ".");
    gitIn(root, "commit", "--quiet", "-m", "feature");

    assert.deepEqual(runMigrationOrderCheck({ root, baseRef: "master" }), {
      ok: true,
      latestBase: "20261019120000_user_policy_consent",
      added: ["20261020090000_enable_rls_all_tables"],
      errors: [],
    });

    gitIn(root, "checkout", "--quiet", "master");
    addMigration(root, "20261021080000_other_line");
    gitIn(root, "add", ".");
    gitIn(root, "commit", "--quiet", "-m", "newer master");
    gitIn(root, "checkout", "--quiet", "feature");
    const behind = runMigrationOrderCheck({ root, baseRef: "master" });
    assert.equal(behind.ok, false);
    assert.equal(behind.added.includes("20261020090000_enable_rls_all_tables"), true);

    assert.throws(() => runMigrationOrderCheck({ root, baseRef: "--output=x" }), /plain git ref/u);
    assert.throws(() => runMigrationOrderCheck({ root, baseRef: "missing/ref" }), /fetch-depth: 0/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
