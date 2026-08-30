import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateWp167Receipt } from "./wp167-vercel-preview-redeploy-runner.mjs";
import { createSyntheticJsonFixture } from "./test-contract-synthetic-fixtures.mjs";

const syntheticReceiptFixture = createSyntheticJsonFixture("wp167-vercel-preview-redeploy-receipt.json", {
  schemaVersion: "wp167-vercel-preview-redeploy/v1",
  status: "WP167_PREVIEW_REDEPLOY_AND_ALIAS_FRESHNESS_VERIFIED",
  project: "celebrate-deal-staging",
  target: "preview",
  previewEnvironmentProvisionedAt: "2026-01-01T00:00:00.000Z",
  oldDeployment: { id: "synthetic-old-deployment", readyState: "READY" },
  newDeployment: { id: "synthetic-new-deployment", readyState: "READY", createdAt: "2026-01-01T00:01:00.000Z" },
  redeploy: { externalAttempts: 1, retries: 0, source: "EXISTING_REMOTE_DEPLOYMENT", localWorkspaceUploaded: false, dirtyWorkspaceIncluded: false },
  health: { newDeploymentHeadStatus: 200, stagingAliasHeadStatus: 200 },
  alias: { currentDeploymentId: "synthetic-new-deployment", switchAttempts: 1 },
  sideEffects: { productionDeployments: 0, environmentVariableMutations: 0, databaseOperations: 0, payuniOperations: 0 },
  safety: { environmentValuesRead: false, rawLogsPersisted: false },
  ownership: { stagedIndexEmpty: true },
});
const receiptPath = syntheticReceiptFixture.path;
test.after(() => syntheticReceiptFixture.cleanup());

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
