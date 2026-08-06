import test from "node:test";
import assert from "node:assert/strict";
import {
  TARGET_KEYS,
  buildBrokerArgs,
  classifyEnvironment,
  classifyMarker,
  initialReceipt,
  parseInspectJson,
  validateReceipt,
} from "./fin08r-staging-payuni-reconciliation-runner.mjs";

const env = {
  DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  DIRECT_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  STAGING_DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  PAYUNI_ENV: "sandbox",
  PAYUNI_MERCHANT_ID: "synthetic-merchant",
  PAYUNI_HASH_KEY: "x".repeat(32),
  PAYUNI_HASH_IV: "y".repeat(16),
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
};

test("FIN-08R accepts only READY Preview identity", () => {
  const ready = JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "synthetic-deployment" });
  assert.equal(parseInspectJson(ready, 0).ok, true);
  assert.equal(parseInspectJson(ready.replace("preview", "production"), 0).ok, false);
  assert.equal(parseInspectJson(ready.replace("READY", "ERROR"), 0).ok, false);
  assert.equal(parseInspectJson("not-json", 0).ok, false);
});

test("FIN-08R requires WP-187 marker and exact digest", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(classifyMarker({ workPackage: "WP-187", sourceDigest: digest }, digest), { workPackageMatched: true, sourceDigestValid: true, sourceDigestMatched: true });
  assert.equal(classifyMarker({ workPackage: "WP-196", sourceDigest: digest }, digest).workPackageMatched, false);
  assert.equal(classifyMarker({ workPackage: "WP-187", sourceDigest: "raw" }, digest).sourceDigestValid, false);
});

test("FIN-08R classifies all nine bindings without exposing values", () => {
  const facts = classifyEnvironment(env);
  assert.equal(TARGET_KEYS.length, 9);
  assert.equal(facts.requiredPresent, true);
  assert.equal(facts.appHostMatched, true);
  assert.equal(facts.sandbox, true);
  assert.equal(facts.databaseIdentity, true);
  assert.equal(facts.supabaseIdentity, true);
  assert.equal(facts.production, false);
  assert.equal(classifyEnvironment({ ...env, DIRECT_URL: "postgresql://other@other.example.test/db" }).databaseIdentity, false);
  assert.equal(classifyEnvironment({ ...env, PAYUNI_ENV: "production" }).sandbox, false);
});

test("FIN-08R reserves once and rejects unsafe receipt states", () => {
  const receipt = initialReceipt();
  receipt.processIsolation.targetKeyPresenceBefore = 0;
  receipt.processIsolation.targetKeyPresenceAfter = 0;
  assert.equal(receipt.status, "FIN08R_ATTEMPT_RESERVED");
  assert.equal(validateReceipt(receipt).ok, false);
  assert.equal(validateReceipt({ ...receipt, status: "FIN08R_SANDBOX_RECONCILIATION_VERIFIED" }).ok, true);
  assert.equal(validateReceipt({ ...receipt, status: "FIN08R_SANDBOX_RECONCILIATION_VERIFIED", debugUrl: "https://sensitive.example.test" }).ok, false);
  assert.equal(validateReceipt({ ...receipt, status: "FIN08R_SANDBOX_RECONCILIATION_VERIFIED", replay: { providerQueries: 1, databaseWrites: 0, auditWrites: 0 } }).ok, false);
});

test("FIN-08R broker command requires absolute paths", () => {
  assert.throws(() => buildBrokerArgs("node", "tsx", "tsconfig", "runner", "temp"), /ABSOLUTE_PATH_REQUIRED/u);
  const args = buildBrokerArgs("C:\\node.exe", "C:\\tsx.mjs", "C:\\tsconfig.json", "C:\\runner.mjs", "C:\\temp");
  assert.deepEqual(args.slice(0, 7), ["env", "run", "-e", "preview", "--project", "celebrate-deal-staging", "--"]);
});
