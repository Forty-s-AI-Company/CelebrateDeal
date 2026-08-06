import assert from "node:assert/strict";
import test from "node:test";
import { CLASSIFICATIONS, classifyResult, sanitizeDiagnosticText } from "./wp133-public-unavailable-browser-runner.mjs";

const passing = {
  preflight: { digestMatch: true, stagedIndexEmpty: true },
  mirror: { missing: [], forbiddenCopied: [] },
  junction: { ok: true },
  resolution: { ok: true },
  port: { ok: true },
  database: { containerAvailable: true, schemaReady: true },
  server: { spawned: true, spawnError: null, exitBeforeReady: false },
  browser: { ok: true },
  cleanup: { ok: true },
};

test("accepts only a complete local browser contract", () => {
  assert.equal(classifyResult(passing), CLASSIFICATIONS.PASS);
});

test("fails closed on digest, mirror, server, browser, or cleanup boundaries", () => {
  assert.equal(classifyResult({ ...passing, preflight: { digestMatch: false, stagedIndexEmpty: true } }), CLASSIFICATIONS.DIGEST_MISMATCH);
  assert.equal(classifyResult({ ...passing, mirror: { missing: ["package.json"], forbiddenCopied: [] } }), CLASSIFICATIONS.MIRROR_INPUT_MISSING);
  assert.equal(classifyResult({ ...passing, server: { spawned: true, spawnError: null, exitBeforeReady: true } }), CLASSIFICATIONS.SERVER_PRE_READINESS_EXIT);
  assert.equal(classifyResult({ ...passing, browser: { ok: false } }), CLASSIFICATIONS.BROWSER_CONTRACT_FAILURE);
  assert.equal(classifyResult({ ...passing, cleanup: { ok: false } }), CLASSIFICATIONS.CLEANUP_FAILURE);
});

test("sanitizes diagnostics and never keeps secret-like values", () => {
  const sanitized = sanitizeDiagnosticText("C:\\Users\\eden\\.env.local TOKEN=secret https://example.test postgres://user:pass@example.invalid/db");
  assert.equal(sanitized.includes("C:\\Users"), false);
  assert.equal(sanitized.includes("secret"), false);
  assert.equal(sanitized.includes("example.test"), false);
  assert.equal(sanitized.includes("user:pass"), false);
});
