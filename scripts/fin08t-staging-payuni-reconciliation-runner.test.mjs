import test from "node:test";
import assert from "node:assert/strict";
import { TARGET_KEYS, buildBrokerArgs, classifyEnvironment, initialReceipt, parseInspectJson, validateReceipt } from "./fin08t-staging-payuni-reconciliation-runner.mjs";

const safe = {
  DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  DIRECT_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  STAGING_DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  PAYUNI_ENV: "sandbox", PAYUNI_MERCHANT_ID: "synthetic-merchant", PAYUNI_HASH_KEY: "x".repeat(32), PAYUNI_HASH_IV: "y".repeat(16),
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net", NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
};

test("FIN-08T accepts only READY Preview metadata", () => {
  const ready = JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "synthetic-deployment" });
  assert.equal(parseInspectJson(ready, 0).ok, true);
  assert.equal(parseInspectJson(ready.replace("preview", "production"), 0).ok, false);
  assert.equal(parseInspectJson(ready.replace("READY", "ERROR"), 0).ok, false);
});

test("FIN-08T classifies all nine bindings and rejects production or mismatched DB identity", () => {
  const facts = classifyEnvironment(safe);
  assert.equal(TARGET_KEYS.length, 9);
  assert.equal(facts.requiredPresent, true);
  assert.equal(facts.app, true);
  assert.equal(facts.sandbox, true);
  assert.equal(facts.db, true);
  assert.equal(facts.supabase, true);
  assert.equal(facts.production, false);
  assert.equal(classifyEnvironment({ ...safe, DIRECT_URL: "postgresql://other@other.example.test/db" }).db, false);
  assert.equal(classifyEnvironment({ ...safe, PAYUNI_ENV: "production" }).sandbox, false);
});

test("FIN-08T isolation terminal is strict but does not require zero parent names", () => {
  const receipt = initialReceipt();
  receipt.status = "FIN08T_TERMINAL_NO_GO_ISOLATION";
  receipt.isolation.beforeCount = 4;
  receipt.isolation.afterCount = 1;
  receipt.sideEffects.providerQueries = 0;
  receipt.sideEffects.databaseConnections = 0;
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, databaseConnections: 1 } }).ok, false);
});

test("FIN-08T success receipt requires zero replay writes and no score claim", () => {
  const receipt = initialReceipt();
  receipt.status = "FIN08T_SANDBOX_RECONCILIATION_VERIFIED";
  receipt.isolation.afterCount = 0;
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, replay: { ...receipt.replay, databaseWrites: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, scoreImpact: { ...receipt.scoreImpact, applied: true } }).ok, false);
});

test("FIN-08T broker args are Preview-only and absolute", () => {
  assert.throws(() => buildBrokerArgs("tsx", "C:\\tsconfig.json", "C:\\temp"), /ABSOLUTE_PATH_REQUIRED/u);
  const args = buildBrokerArgs("C:\\tsx.mjs", "C:\\tsconfig.json", "C:\\temp");
  assert.deepEqual(args.slice(0, 7), ["env", "run", "-e", "preview", "--project", "celebrate-deal-staging", "--"]);
});
