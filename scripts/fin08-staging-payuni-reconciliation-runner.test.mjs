import test from "node:test";
import assert from "node:assert/strict";
import {
  TARGET_KEYS,
  classifyChildEnvironment,
  classifyMarker,
  initialReceipt,
  parseInspectJson,
  validateReceipt,
} from "./fin08-staging-payuni-reconciliation-runner.mjs";

const safeEnv = {
  STAGING_DATABASE_URL: "postgresql://synthetic.projectref:masked@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  PAYUNI_ENV: "sandbox",
  PAYUNI_MERCHANT_ID: "synthetic-merchant",
  PAYUNI_HASH_KEY: "x".repeat(32),
  PAYUNI_HASH_IV: "y".repeat(16),
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
};

test("FIN-08 freshness accepts only named Preview READY metadata", () => {
  const ready = JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "synthetic-deployment" });
  assert.equal(parseInspectJson(ready, 0).ok, true);
  assert.equal(parseInspectJson(ready.replace("preview", "production"), 0).ok, false);
  assert.equal(parseInspectJson(ready.replace("READY", "ERROR"), 0).ok, false);
  assert.equal(parseInspectJson("not-json", 0).ok, false);
});

test("FIN-08 marker gate requires accepted WP-187 source digest", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(classifyMarker({ workPackage: "WP-187", sourceDigest: digest }, digest), {
    workPackageMatched: true,
    sourceDigestValid: true,
    sourceDigestMatched: true,
  });
  assert.equal(classifyMarker({ workPackage: "WP-196", sourceDigest: digest }, digest).workPackageMatched, false);
  assert.equal(classifyMarker({ workPackage: "WP-187", sourceDigest: "raw" }, digest).sourceDigestValid, false);
});

test("FIN-08 child environment reports presence and exact sandbox classification only", () => {
  const facts = classifyChildEnvironment(safeEnv);
  assert.equal(TARGET_KEYS.length, 7);
  assert.equal(facts.requiredPresent, true);
  assert.equal(facts.appHostMatched, true);
  assert.equal(facts.sandbox, true);
  assert.equal(facts.databaseIdentity, true);
  assert.equal(facts.supabaseIdentity, true);
  assert.equal(facts.production, false);
  assert.equal(classifyChildEnvironment({ ...safeEnv, PAYUNI_ENV: "production" }).sandbox, false);
  assert.equal(classifyChildEnvironment({ ...safeEnv, NEXT_PUBLIC_APP_URL: "https://production.example.test" }).appHostMatched, false);
});

test("FIN-08 receipt validator rejects values, URLs and non-idempotent replay", () => {
  const receipt = initialReceipt();
  receipt.processIsolation.targetKeyPresenceBefore = 0;
  receipt.processIsolation.targetKeyPresenceAfter = 0;
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, debugUrl: "https://sensitive.example.test" }).ok, false);
  assert.equal(validateReceipt({ ...receipt, replay: { ...receipt.replay, databaseWrites: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, safety: { ...receipt.safety, rawValuesPersisted: true } }).ok, false);
});
