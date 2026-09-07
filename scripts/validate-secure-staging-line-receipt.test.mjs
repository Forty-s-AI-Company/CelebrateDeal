import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateReceiptPath } from "./validate-secure-staging-line-receipt.mjs";

test("receipt validator rejects paths outside the canonical runner directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-receipt-test-"));
  const candidate = path.join(root, "line-notifications-e2e-receipt.json");
  fs.writeFileSync(candidate, "{}\n");
  const expected = { CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
  assert.deepEqual(validateReceiptPath(candidate, root, expected), { ok: false, reason: "RECEIPT_UNREADABLE" });
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
