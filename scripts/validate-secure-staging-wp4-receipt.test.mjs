import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialReceipt } from "./secure-staging-wp4-payuni.mjs";
import { validateReceiptPath } from "./validate-secure-staging-wp4-receipt.mjs";

test("WP4 validator accepts only its canonical non-symlink runner-temp receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "secure-wp4-receipt-test-"));
  try {
    const directory = path.join(root, "celebratedeal-secure-receipts");
    fs.mkdirSync(directory);
    const receiptPath = path.join(directory, "wp4-payuni-sandbox-reconciliation-receipt.json");
    fs.writeFileSync(receiptPath, `${JSON.stringify(createInitialReceipt("146f8db0616fef63451d80f2d8d23a243f58860b"))}\n`);
    assert.deepEqual(validateReceiptPath(receiptPath, root), { ok: true, result: "BLOCKED" });
    const wrongName = path.join(directory, "wrong-receipt.json");
    fs.writeFileSync(wrongName, "{}\n");
    assert.equal(validateReceiptPath(wrongName, root).reason, "PATH_OUTSIDE_RUNNER_TEMP");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
