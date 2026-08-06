import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateWp167Receipt } from "./wp167-vercel-preview-redeploy-runner.mjs";

const receiptPath = new URL("../.ai-team/reports/wp167-vercel-preview-redeploy-receipt.json", import.meta.url);

test("accepts the sanitized WP-167 terminal receipt", async () => {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(validateWp167Receipt(receipt), true);
});

test("rejects a Production target", async () => {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.throws(() => validateWp167Receipt({ ...receipt, target: "production" }));
});

test("rejects alias drift and dirty workspace upload", async () => {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.throws(() => validateWp167Receipt({
    ...receipt,
    redeploy: { ...receipt.redeploy, dirtyWorkspaceIncluded: true },
  }));
  assert.throws(() => validateWp167Receipt({
    ...receipt,
    alias: { ...receipt.alias, currentDeploymentId: "different" },
  }));
});
