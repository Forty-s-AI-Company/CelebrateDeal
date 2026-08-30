import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export function validateWp167Receipt(receipt) {
  assert.equal(receipt.schemaVersion, "wp167-vercel-preview-redeploy/v1");
  assert.equal(receipt.status, "WP167_PREVIEW_REDEPLOY_AND_ALIAS_FRESHNESS_VERIFIED");
  assert.equal(receipt.project, "celebrate-deal-staging");
  assert.equal(receipt.target, "preview");
  assert.equal(receipt.oldDeployment.readyState, "READY");
  assert.equal(receipt.newDeployment.readyState, "READY");
  assert.notEqual(receipt.newDeployment.id, receipt.oldDeployment.id);
  assert.ok(receipt.newDeployment.createdAt > receipt.previewEnvironmentProvisionedAt);
  assert.equal(receipt.redeploy.externalAttempts, 1);
  assert.equal(receipt.redeploy.retries, 0);
  assert.equal(receipt.redeploy.source, "EXISTING_REMOTE_DEPLOYMENT");
  assert.equal(receipt.redeploy.localWorkspaceUploaded, false);
  assert.equal(receipt.redeploy.dirtyWorkspaceIncluded, false);
  assert.equal(receipt.health.newDeploymentHeadStatus, 200);
  assert.equal(receipt.health.stagingAliasHeadStatus, 200);
  assert.equal(receipt.alias.currentDeploymentId, receipt.newDeployment.id);
  assert.equal(receipt.alias.switchAttempts, 1);
  assert.equal(receipt.sideEffects.productionDeployments, 0);
  assert.equal(receipt.sideEffects.environmentVariableMutations, 0);
  assert.equal(receipt.sideEffects.databaseOperations, 0);
  assert.equal(receipt.sideEffects.payuniOperations, 0);
  assert.equal(receipt.safety.environmentValuesRead, false);
  assert.equal(receipt.safety.rawLogsPersisted, false);
  assert.equal(receipt.ownership.stagedIndexEmpty, true);
  return true;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const receipt = JSON.parse(await readFile(process.argv[2], "utf8"));
  validateWp167Receipt(receipt);
  process.stdout.write("WP167_RECEIPT_VALID\n");
}
