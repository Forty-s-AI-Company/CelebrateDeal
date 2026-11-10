import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initialReceipt } from "./secure-staging-line-notifications.mjs";
import { RUNNER_STAGE_FILENAME, readRunnerStage, sanitizeFailureCode, validateReceiptPath } from "./validate-secure-staging-line-receipt.mjs";

test("receipt validator rejects paths outside the canonical runner directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-receipt-test-"));
  const candidate = path.join(root, "line-notifications-e2e-receipt.json");
  fs.writeFileSync(candidate, "{}\n");
  const expected = { CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
  assert.deepEqual(validateReceiptPath(candidate, root, expected), { ok: false, reason: "RECEIPT_ROOT_MISSING" });
  fs.rmSync(root, { recursive: true, force: true });
});

test("receipt validator returns only a fixed diagnostic for an invalid receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-receipt-test-"));
  const receiptRoot = path.join(root, "celebratedeal-secure-receipts");
  fs.mkdirSync(receiptRoot);
  const candidate = path.join(receiptRoot, "line-notifications-e2e-receipt.json");
  fs.writeFileSync(candidate, "{}\n");
  const expected = { CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
  assert.deepEqual(validateReceiptPath(candidate, root, expected), {
    ok: false,
    reason: "RECEIPT_INVALID",
    diagnostic: "SCHEMA_KEYS",
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("a missing receipt reports the fixed workflow stage that stopped the LINE step", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-receipt-test-"));
  fs.mkdirSync(path.join(root, "celebratedeal-secure-receipts"));
  const candidate = path.join(root, "celebratedeal-secure-receipts", "line-notifications-e2e-receipt.json");
  const expected = { CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
  assert.deepEqual(validateReceiptPath(candidate, root, expected), { ok: false, reason: "RECEIPT_FILE_MISSING" });
  fs.writeFileSync(path.join(root, RUNNER_STAGE_FILENAME), "report_missing_bindings\n");
  assert.deepEqual(validateReceiptPath(candidate, root, expected), {
    ok: false, reason: "RECEIPT_FILE_MISSING", diagnostic: "RUNNER_STAGE_REPORT_MISSING_BINDINGS",
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("runner stage text outside the fixed allowlist is never echoed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-receipt-test-"));
  assert.equal(readRunnerStage(root), "NONE");
  fs.writeFileSync(path.join(root, RUNNER_STAGE_FILENAME), `${["postgres", "//synthetic-user:synthetic-pass@db.example.test/postgres"].join(":")}\n`);
  assert.equal(readRunnerStage(root), "RUNNER_STAGE_UNKNOWN");
  fs.writeFileSync(path.join(root, RUNNER_STAGE_FILENAME), `${"require_database_binding".repeat(5)}\n`);
  assert.equal(readRunnerStage(root), "RUNNER_STAGE_UNKNOWN");
  fs.writeFileSync(path.join(root, RUNNER_STAGE_FILENAME), "require_database_binding\n");
  assert.equal(readRunnerStage(root), "RUNNER_STAGE_REQUIRE_DATABASE_BINDING");
  fs.rmSync(root, { recursive: true, force: true });
});

function writeReceipt(overrides) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-receipt-test-"));
  const receiptRoot = path.join(root, "celebratedeal-secure-receipts");
  fs.mkdirSync(receiptRoot);
  const candidate = path.join(receiptRoot, "line-notifications-e2e-receipt.json");
  const expected = { CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
  const receipt = initialReceipt({ ...expected });
  Object.assign(receipt, overrides);
  fs.writeFileSync(candidate, JSON.stringify(receipt));
  return { root, candidate, expected };
}

test("a FAILED receipt exposes its sanitized failure code and false check keys", () => {
  const { root, candidate, expected } = writeReceipt({ result: "FAILED", failureCode: "PREVIEW_DATABASE_BINDING_MISMATCH" });
  const result = validateReceiptPath(candidate, root, expected);
  assert.equal(result.ok, true);
  assert.equal(result.result, "FAILED");
  assert.equal(result.failure, "PREVIEW_DATABASE_BINDING_MISMATCH");
  assert.match(result.failedChecks, /runtimeDatabaseBound/u);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a null failure code prints NONE", () => {
  const { root, candidate, expected } = writeReceipt({ result: "FAILED", failureCode: null });
  assert.equal(validateReceiptPath(candidate, root, expected).failure, "NONE");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a malformed failure code is never echoed", () => {
  for (const bad of ["lower case text", "AB", "X".repeat(81), "SECRET value=1", 42, {}]) {
    assert.equal(sanitizeFailureCode(bad), "UNCLASSIFIED_FAILURE");
  }
  const { root, candidate, expected } = writeReceipt({ result: "FAILED", failureCode: "https://example.test/x" });
  assert.equal(validateReceiptPath(candidate, root, expected).failure, "UNCLASSIFIED_FAILURE");
  fs.rmSync(root, { recursive: true, force: true });
});
