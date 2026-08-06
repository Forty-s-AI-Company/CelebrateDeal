import test from "node:test";
import assert from "node:assert/strict";
import { buildAddArgs, buildEnvRunArgs, buildIsolationCommand, buildRemoveArgs, CONTRACT, parseChild, qualifyEnvironment, REBIND_KEYS, rollbackKeys, validateReceipt } from "./wp190-preview-config-rebind-activation.mjs";

const valid = {
  STAGING_DATABASE_URL: "postgresql://user.projectref:fixture@pool.pooler.supabase.com/db",
  NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
  NEXT_PUBLIC_APP_URL: "https://ignored.invalid",
  PAYUNI_ENV: "sandbox",
  PAYUNI_MERCHANT_ID: "fixture-merchant",
  PAYUNI_HASH_KEY: "fixture-key",
  PAYUNI_HASH_IV: "fixture-iv",
};

test("exact allowlists and Preview-only mutation argv", () => {
  assert.deepEqual(REBIND_KEYS, ["STAGING_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV"]);
  for (const key of REBIND_KEYS) {
    assert.deepEqual(buildAddArgs(key).slice(0, 5), ["env", "add", key, "preview", "--force"]);
    assert.ok(buildAddArgs(key).includes("--no-sensitive"));
    assert.deepEqual(buildRemoveArgs(key).slice(0, 4), ["env", "remove", key, "preview"]);
    assert.equal(buildAddArgs(key).includes("production"), false);
  }
  assert.throws(() => buildAddArgs("DATABASE_URL"), /KEY_NOT_ALLOWED/u);
});

test("qualification accepts one staging identity and fixed app constant", () => {
  const result = qualifyEnvironment(valid);
  assert.equal(result.qualified, true);
  assert.equal(result.appExactStaging, true);
  assert.equal(result.nonProductionIdentity, true);
  assert.equal(result.productionLike, false);
});

test("qualification fails closed for empty, malformed, mixed and production-like inputs", () => {
  assert.equal(qualifyEnvironment({ ...valid, STAGING_DATABASE_URL: "" }).qualified, false);
  assert.equal(qualifyEnvironment({ ...valid, STAGING_DATABASE_URL: "not-a-url" }).qualified, false);
  assert.equal(qualifyEnvironment({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }).mixedIdentity, true);
  assert.equal(qualifyEnvironment({ ...valid, PAYUNI_ENV: "production" }).productionLike, true);
});

test("environment brokers use exact non-Production scopes and absolute child paths", () => {
  const args = buildEnvRunArgs("development", "C:\\node.exe", "C:\\runner.mjs", "--development-child", "C:\\temp");
  assert.ok(args.includes("development"));
  assert.ok(args.includes(CONTRACT.project));
  assert.equal(args.includes("production"), false);
  assert.throws(() => buildEnvRunArgs("production", "C:\\node.exe", "C:\\runner.mjs", "--x", "C:\\temp"), /ENVIRONMENT_NOT_ALLOWED/u);
});

test("isolation removes exactly seven names without reading values", () => {
  const command = buildIsolationCommand("C:\\node.exe", "C:\\runner.mjs");
  assert.equal((command.match(/Remove-Item/gu) ?? []).length, 7);
  assert.equal(command.includes("Get-Item"), false);
  assert.equal(command.includes("$env:"), false);
});

test("child parser rejects assignments, dotenv banners, malformed and duplicate records", () => {
  const qualification = qualifyEnvironment(valid);
  const payload = { schema: "wp190-readback/v1", status: "READBACK_PASS", qualification };
  const line = `WP190_READ_RESULT:${JSON.stringify(payload)}`;
  assert.equal(parseChild(line, "", 0, "WP190_READ_RESULT:").ok, true);
  assert.equal(parseChild(`${line}\n${line}`, "", 0, "WP190_READ_RESULT:").ok, false);
  assert.equal(parseChild(`${line}\nPAYUNI_ENV=x`, "", 0, "WP190_READ_RESULT:").ok, false);
  assert.equal(parseChild(line, "Loaded env from C:\\x\\.env.local", 0, "WP190_READ_RESULT:").ok, false);
  assert.equal(parseChild(`WP190_READ_RESULT:${JSON.stringify({ ...payload, extra: "sentinel" })}`, "", 0, "WP190_READ_RESULT:").ok, false);
});

test("rollback reverses every attempted key and detects a partial rollback failure", () => {
  const seen = [];
  const pass = rollbackKeys(REBIND_KEYS.slice(0, 3), (_cmd, args) => { seen.push(args[2]); return { status: 0 }; });
  assert.deepEqual(seen, REBIND_KEYS.slice(0, 3).reverse());
  assert.equal(pass.pass, true);
  let call = 0;
  const fail = rollbackKeys(REBIND_KEYS.slice(0, 3), () => ({ status: ++call === 2 ? 1 : 0 }));
  assert.equal(fail.pass, false);
});

test("receipt validator enforces budgets, forbidden zeros and complete activation gate", () => {
  const q = qualifyEnvironment(valid);
  const receipt = {
    schemaVersion: "wp190-preview-config-rebind-activation/v1", status: "WP190_COMPLETE",
    development: { attempts: 1, qualification: q }, previewReadback: { attempts: 1, qualification: q },
    mutations: { forwardAttempts: 6, rollbackAttempts: 0, forwardJournal: REBIND_KEYS.map((key, i) => ({ key, order: i + 1, attempted: true, ok: true })), rollbackJournal: [] },
    deployment: { redeployAttempts: 1, previewReady: true, markerMatched: true, health200: true },
    aliasCas: { switchAttempts: 1, rollbackAttempts: 0, postIdentityMatched: true, postMarkerMatched: true, postHealth200: true },
    forbidden: { database: 0, payuni: 0, production: 0, dns: 0, gitMutation: 0, rawValuePersistence: 0, rawOutputPersistence: 0 },
  };
  assert.deepEqual(validateReceipt(receipt).errors, []);
  receipt.forbidden.database = 1;
  receipt.mutations.forwardAttempts = 7;
  assert.ok(validateReceipt(receipt).errors.includes("FORBIDDEN"));
  assert.ok(validateReceipt(receipt).errors.includes("BUDGET"));
});

test("synthetic secrets never appear in fixed qualification output", () => {
  const sentinel = "WP190_DO_NOT_LEAK_SECRET_123";
  const output = JSON.stringify(qualifyEnvironment({ ...valid, PAYUNI_HASH_KEY: sentinel, PAYUNI_HASH_IV: sentinel }));
  assert.equal(output.includes(sentinel), false);
});
