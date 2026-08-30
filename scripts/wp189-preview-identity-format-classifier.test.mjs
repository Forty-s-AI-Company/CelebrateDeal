import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildBrokerArgs,
  buildIsolationCommand,
  childSafe,
  classifyEnvironment,
  parseBrokerOutput,
  validateReceipt,
} from "./wp189-preview-identity-format-classifier.mjs";
import { TARGET_KEYS } from "./wp169-preview-env-broker-isolation-runner.mjs";

const valid = {
  STAGING_DATABASE_URL: ["postgres", "ql://"].join("") + "user.projectref:fixture@pool.pooler.supabase.com/db",
  NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  PAYUNI_ENV: "sandbox",
  PAYUNI_MERCHANT_ID: "fixture-merchant",
  PAYUNI_HASH_KEY: "fixture-key",
  PAYUNI_HASH_IV: "fixture-iv",
};

test("valid bindings classify the preserved WP-188 failure as parser contract problem", () => {
  const result = classifyEnvironment(valid, true);
  assert.equal(result.primaryClassification, "PARSER_CONTRACT_PROBLEM");
  assert.equal(result.primaryBinding, null);
  assert.equal(result.dbSupabaseIdentityMatch, true);
  assert.equal(childSafe(result), true);
});

test("classification priority covers missing, empty, whitespace and quotes", () => {
  assert.equal(classifyEnvironment({ ...valid, STAGING_DATABASE_URL: undefined }).primaryClassification, "EMPTY_BINDING");
  const missing = { ...valid }; delete missing.STAGING_DATABASE_URL;
  assert.equal(classifyEnvironment(missing).primaryClassification, "MISSING_BINDING");
  assert.equal(classifyEnvironment({ ...valid, STAGING_DATABASE_URL: ` ${valid.STAGING_DATABASE_URL}` }).primaryClassification, "WHITESPACE_CONTAMINATION");
  assert.equal(classifyEnvironment({ ...valid, STAGING_DATABASE_URL: `"${valid.STAGING_DATABASE_URL}"` }).primaryClassification, "MATCHING_QUOTE_WRAPPED");
});

test("classification distinguishes URL, scheme and identity failures", () => {
  assert.equal(classifyEnvironment({ ...valid, STAGING_DATABASE_URL: "not a url" }).primaryClassification, "URL_PARSE_FAILED");
  assert.equal(classifyEnvironment({ ...valid, STAGING_DATABASE_URL: "https://example.invalid/db" }).primaryClassification, "SCHEME_NOT_ALLOWED");
  assert.equal(classifyEnvironment({ ...valid, STAGING_DATABASE_URL: "postgresql://hostonly" }).primaryClassification, "URL_IDENTITY_INCOMPLETE");
  assert.equal(classifyEnvironment({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid" }).primaryClassification, "SUPABASE_PROJECT_SHAPE_INVALID");
  assert.equal(classifyEnvironment({ ...valid, STAGING_DATABASE_URL: ["postgres", "ql://"].join("") + "user.other:fixture@pool.pooler.supabase.com/db" }).primaryClassification, "DB_SUPABASE_IDENTITY_MISMATCH");
  assert.equal(classifyEnvironment({ ...valid, NEXT_PUBLIC_APP_URL: "https://other.invalid" }).primaryClassification, "APP_STAGING_MISMATCH");
});

test("classification distinguishes PayUni environment and binding failures", () => {
  assert.equal(classifyEnvironment({ ...valid, PAYUNI_ENV: "production" }).primaryClassification, "PAYUNI_ENV_MISMATCH");
  const missing = { ...valid }; delete missing.PAYUNI_HASH_KEY;
  assert.equal(classifyEnvironment(missing).primaryClassification, "MISSING_BINDING");
});

test("classification output contains only approved fixed fields and no sentinel value", () => {
  const sentinel = "leak-sentinel-host-user-password";
  const result = classifyEnvironment({ ...valid, PAYUNI_HASH_KEY: sentinel });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(sentinel), false);
  assert.equal(childSafe(result), true);
  assert.doesNotMatch(serialized, /length|rawValue|password|prefix|suffix|https?:\/\//u);
});

test("isolation command removes exactly seven names and broker argv is Preview-only", () => {
  const isolation = buildIsolationCommand(path.resolve("node.exe"), path.resolve("runner.mjs"));
  assert.equal((isolation.match(/Remove-Item -LiteralPath/gu) ?? []).length, 7);
  for (const key of TARGET_KEYS) assert.equal(isolation.split(`Env:${key}`).length - 1, 1);
  const args = buildBrokerArgs("C:\\node.exe", "C:\\runner.mjs", "C:\\temp\\wp189");
  assert.deepEqual(args.slice(0, 7), ["env", "run", "-e", "preview", "--project", "celebrate-deal-staging", "--"]);
});

test("broker accepts exactly one safe child and rejects banners, assignments and duplicates", () => {
  const line = `WP189_CHILD_RESULT:${JSON.stringify(classifyEnvironment(valid))}`;
  assert.equal(parseBrokerOutput(`${line}\n`, "", 0).ok, true);
  assert.equal(parseBrokerOutput(`${line}\n${line}\n`, "", 0).ok, false);
  assert.equal(parseBrokerOutput(line, "Loaded env from C:\\x\\.env.local", 0).ok, false);
  assert.equal(parseBrokerOutput(`${line}\nSTAGING_DATABASE_URL=value`, "", 0).ok, false);
  assert.equal(parseBrokerOutput(line, "", 1).ok, false);
});

test("receipt validator rejects attempts, persistence and unapproved classifier fields", () => {
  const classification = classifyEnvironment(valid);
  const receipt = {
    schemaVersion: "wp189-preview-identity-format-classifier/v1",
    status: "WP189_CLASSIFICATION_COMPLETE",
    processIsolation: { exactNamesRemoved: 7, valuesReadByParent: false, isolatedTargetKeyPresenceCount: 0, childLaunchAttempts: 1 },
    freshness: { metadataReads: 1, markerReads: 1, healthHeadProbes: 1 },
    broker: { attempts: 1, retries: 0, childValid: true },
    classification: { ...classification },
    attempts: { databaseConnects: 0, databaseQueries: 0, payuniQueries: 0, deployments: 0, environmentMutations: 0, aliasMutations: 0, dnsMutations: 0, production: 0, gitMutations: 0 },
    safety: { rawValuesPersisted: false, rawBrokerOutputPersisted: false, lengthsPersisted: false, hostsPersisted: false, pathsPersisted: false, hashesPersisted: false, credentialsPersisted: false },
  };
  delete receipt.classification.schema;
  assert.deepEqual(validateReceipt(receipt).errors, []);
  receipt.attempts.databaseConnects = 1;
  receipt.safety.rawValuesPersisted = true;
  receipt.classification.database.extra = false;
  const errors = validateReceipt(receipt).errors;
  assert.ok(errors.includes("FORBIDDEN_ATTEMPT"));
  assert.ok(errors.includes("SENSITIVE_PERSISTENCE"));
  assert.ok(errors.includes("CLASSIFICATION_SCHEMA"));
});
