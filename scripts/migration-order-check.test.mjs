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
  parseChangedMigrationDirectories,
  parseMigrationTree,
  readHeadMigrations,
  runMigrationOrderCheck,
} from "./migration-order-check.mjs";

const master = [
  "20260709090000_postgresql_baseline",
  "202607170001_team_funnel_domain",
  "20261018090000_post_purchase_recovery_guard",
  "20261019120000_user_policy_consent",
];

// Each of these would be applied by Prisma; none may slip past the check.
const malformedNames = [
  "20261001000000_AddFoo",
  "20261001000000-add-foo",
  "2026100100_x",
  "202610210001_short_prefix",
  "20991231235959_trailing-hyphen",
  "add_foo",
];

function addMigration(root, name) {
  const directory = path.join(root, "prisma", "migrations", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "migration.sql"), "SELECT 1;\n");
}

function gitIn(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("legacy 12-digit prefixes sort by time with 14-digit ones", () => {
  assert.ok(migrationSortKey("202607170001_team_funnel_domain") < migrationSortKey("20260724150000_harden_supabase_data_api"));
  assert.ok(migrationSortKey("20260709090000_postgresql_baseline") < migrationSortKey("202607170001_team_funnel_domain"));
  assert.equal(migrationSortKey("migration_lock.toml"), null);
  assert.equal(latestMigration(master), "20261019120000_user_policy_consent");
  assert.equal(latestMigration([...master, "20991231235959_AddFoo"]), "20261019120000_user_policy_consent");
  assert.equal(latestMigration([]), null);
});

test("parses every directory from ls-tree output without filtering names", () => {
  const tree = [
    "040000 tree 1111111111111111111111111111111111111111\t20261019120000_user_policy_consent",
    "100644 blob 2222222222222222222222222222222222222222\tmigration_lock.toml",
    "",
    "040000 tree 3333333333333333333333333333333333333333\t202607170001_team_funnel_domain",
    "040000 tree 4444444444444444444444444444444444444444\t20261001000000_AddFoo",
  ].join("\r\n");
  assert.deepEqual(parseMigrationTree(tree), [
    "20261019120000_user_policy_consent",
    "202607170001_team_funnel_domain",
    "20261001000000_AddFoo",
  ]);
});

test("parses edited migration directories from git diff output", () => {
  assert.deepEqual(
    [...parseChangedMigrationDirectories("prisma/migrations/20261019120000_user_policy_consent/migration.sql\r\nprisma/migrations/migration_lock.toml\n\n")],
    ["20261019120000_user_policy_consent"],
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

test("rejects every malformed or legacy-style new name, even ones that sort early", () => {
  const result = evaluateMigrationOrder({
    baseMigrations: master,
    mergeBaseMigrations: master,
    headMigrations: [...master, ...malformedNames],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.added, [...malformedNames].sort());
  assert.equal(result.errors.length, malformedNames.length);
  for (const error of result.errors) assert.match(error, /<YYYYMMDDHHMMSS>_<lowercase_snake_case>/u);
});

test("reads every working-tree migration directory without filtering names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-migration-dirs-"));
  try {
    for (const name of ["20261019120000_user_policy_consent", ...malformedNames]) addMigration(root, name);
    fs.writeFileSync(path.join(root, "prisma", "migrations", "migration_lock.toml"), "provider = \"postgresql\"\n");
    assert.deepEqual(readHeadMigrations(root).sort(), ["20261019120000_user_policy_consent", ...malformedNames].sort());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test("rejects editing a migration the branch started from", () => {
  const result = evaluateMigrationOrder({
    baseMigrations: master,
    mergeBaseMigrations: master,
    headMigrations: master,
    // The branch's own new migration may change freely before merge.
    changedDirectories: new Set(["20261018090000_post_purchase_recovery_guard", "20261020090000_enable_rls_all_tables"]),
  });
  assert.deepEqual(result.errors, [
    "20261018090000_post_purchase_recovery_guard: existing migration was edited; add a new forward migration instead.",
  ]);
});

test("checks a real git repository end to end", () => {
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

    // Push to master after a squash merge: compare against the parent.
    assert.deepEqual(runMigrationOrderCheck({ root, baseRef: "HEAD^1" }), {
      ok: true,
      latestBase: "20261019120000_user_policy_consent",
      added: ["20261021080000_other_line"],
      errors: [],
    });

    gitIn(root, "checkout", "--quiet", "feature");
    const behind = runMigrationOrderCheck({ root, baseRef: "master" });
    assert.equal(behind.ok, false);
    assert.equal(behind.added.includes("20261020090000_enable_rls_all_tables"), true);

    // Malformed directory names go through the real git path, not around it.
    gitIn(root, "checkout", "--quiet", "master");
    gitIn(root, "checkout", "--quiet", "-b", "malformed");
    for (const name of malformedNames) addMigration(root, name);
    const malformed = runMigrationOrderCheck({ root, baseRef: "master" });
    assert.equal(malformed.ok, false);
    assert.deepEqual(malformed.added, [...malformedNames].sort());
    assert.equal(malformed.errors.length, malformedNames.length);
    gitIn(root, "add", ".");
    gitIn(root, "commit", "--quiet", "-m", "malformed");
    assert.equal(runMigrationOrderCheck({ root, baseRef: "master" }).errors.length, malformedNames.length);

    // Editing an existing migration fails, uncommitted or committed.
    gitIn(root, "checkout", "--quiet", "master");
    gitIn(root, "checkout", "--quiet", "-b", "edit");
    fs.appendFileSync(path.join(root, "prisma", "migrations", "20261019120000_user_policy_consent", "migration.sql"), "SELECT 2;\n");
    assert.deepEqual(runMigrationOrderCheck({ root, baseRef: "master" }).errors, [
      "20261019120000_user_policy_consent: existing migration was edited; add a new forward migration instead.",
    ]);
    gitIn(root, "commit", "--quiet", "-am", "edit existing migration");
    assert.equal(runMigrationOrderCheck({ root, baseRef: "master" }).ok, false);

    assert.throws(() => runMigrationOrderCheck({ root, baseRef: "--output=x" }), /plain git ref/u);
    assert.throws(() => runMigrationOrderCheck({ root, baseRef: "missing/ref" }), /fetch-depth: 0/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
