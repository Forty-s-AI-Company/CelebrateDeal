import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "scripts", "wp124-no-dotenv-build-runner.mjs");

test("WP-124 contract exists and is fail-closed", () => {
  const contract = JSON.parse(fs.readFileSync(path.join(root, "scripts", "wp124-no-dotenv-build-contract.json"), "utf8"));
  assert.equal(contract.work_package, "WP-124");
  assert.equal(contract.source_policy.dotenv, "path-only exclusion; never open, copy, hash, print, rename, or move");
  assert.equal(contract.source_policy.dependency_install, false);
  assert.equal(contract.source_policy.network, false);
  assert.equal(contract.score_gate.preawarded, false);
});

test("synthetic environment contract contains no production endpoint or secret value", () => {
  const source = fs.readFileSync(runner, "utf8");
  assert.equal(source.includes(".env.local"), false);
  assert.equal(source.includes("PAYUNI_HASH_KEY"), false);
  assert.equal(source.includes("PAYUNI_HASH_IV"), false);
  assert.equal(source.includes("https://api.payuni.com.tw"), false);
  assert.equal(source.includes("production.payuni"), false);
  assert.match(source, /allowlisted_names_only/);
});

test("temporary mirror policy excludes dotenv, keys, certificates and database files", () => {
  const source = fs.readFileSync(runner, "utf8");
  for (const fragment of ["dotenvPattern", "secretExtensions", "databaseExtensions", "node_modules", "fs.symlinkSync"]) {
    assert.match(source, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("workspace target receipt stays outside source mirror and temp cleanup is guarded", () => {
  const source = fs.readFileSync(runner, "utf8");
  assert.match(source, /OS_TEMP_ONLY/);
  assert.match(source, /unsafe temp mirror path/);
  assert.ok(os.tmpdir().length > 0);
});
