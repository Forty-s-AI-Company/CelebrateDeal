import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialReceipt } from "./secure-staging-runner.mjs";
import { validateReceiptPath } from "./validate-secure-staging-receipt.mjs";

test("validator accepts only the canonical non-symlink runner-temp receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "secure-receipt-test-"));
  try {
    const directory = path.join(root, "celebratedeal-secure-receipts");
    fs.mkdirSync(directory);
    const receiptPath = path.join(directory, "wp2-readonly-restore-receipt.json");
    fs.writeFileSync(receiptPath, `${JSON.stringify(createInitialReceipt("e65485d5fd5f54d2c6bb9fe8231f55eac809376e"))}\n`);
    assert.deepEqual(validateReceiptPath(receiptPath, root), { ok: true, result: "BLOCKED" });
    assert.equal(validateReceiptPath(path.join(root, "outside.json"), root).reason, "RECEIPT_UNREADABLE");

    const outside = path.join(root, "outside-receipt.json");
    fs.writeFileSync(outside, "{}\n");
    const link = path.join(directory, "linked-receipt.json");
    try {
      fs.symlinkSync(outside, link, "file");
      assert.equal(validateReceiptPath(link, root).reason, "PATH_OUTSIDE_RUNNER_TEMP");
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
