import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_CATALOG,
  WP166_CONSTANTS,
  runWp166,
  validateCapabilityCatalog,
  validateCommandSafety,
  validateReceipt,
  validateWp86RerunGuard,
} from "./wp166-vercel-deployment-env-lineage-capability.mjs";

const HEAD = "a".repeat(40);

function metadata(overrides = {}) {
  return {
    projectName: WP166_CONSTANTS.EXPECTED_PROJECT,
    route: WP166_CONSTANTS.EXPECTED_ROUTE,
    routeAliasMatched: true,
    deploymentIdPresent: true,
    deploymentIdDigest: "sha256:" + "1".repeat(64),
    deploymentUrlPresent: true,
    readyState: "READY",
    target: "preview",
    deployedCommitSha: HEAD,
    headSha: HEAD,
    workspaceDirty: true,
    dirtyWorkspaceClaimedDeployed: false,
    customHostStatus: 200,
    deploymentHostStatus: 200,
    previewBindingPresent: true,
    deploymentEnvironmentSnapshotId: "snapshot-test",
    deploymentBindingLineage: true,
    ...overrides,
  };
}

test("capability catalog contains safe, value-bearing, mutating, and unknown classes", () => {
  assert.equal(validateCapabilityCatalog().ok, true);
  assert.equal(CAPABILITY_CATALOG.some((item) => item.classification === "MAY_RETURN_SECRET_VALUE"), true);
  assert.equal(CAPABILITY_CATALOG.some((item) => item.classification === "MUTATING"), true);
  assert.equal(CAPABILITY_CATALOG.some((item) => item.classification === "SCHEMA_UNKNOWN"), true);
});

test("command safety allows only known metadata reads", () => {
  assert.equal(validateCommandSafety("vercel.cmd", ["inspect", "route", "--json"]).ok, true);
  assert.equal(validateCommandSafety("vercel.cmd", ["env", "ls", "preview", "--json", "--project", "celebrate-deal-staging"]).ok, true);
  assert.equal(validateCommandSafety("vercel.cmd", ["env", "pull"]).ok, false);
  assert.equal(validateCommandSafety("vercel.cmd", ["deploy"]).ok, false);
  assert.equal(validateCommandSafety("vercel.cmd", ["inspect", "--token", "secret"]).ok, false);
});

test("current project env list without deployment snapshot is exact NO-GO", async () => {
  const receipt = await runWp166({ metadata: metadata({ deploymentEnvironmentSnapshotId: null, deploymentBindingLineage: false }) });
  assert.equal(receipt.status, "WP166_EXACT_NO_GO_VERCEL_METADATA_CAPABILITY_INSUFFICIENT");
  assert.equal(receipt.failure, "WP166_EXACT_NO_GO_VERCEL_METADATA_CAPABILITY_INSUFFICIENT");
  assert.equal(receipt.environmentBinding.currentProjectListPresent, true);
  assert.equal(receipt.environmentBinding.deploymentSpecificLineage, false);
  assert.equal(validateReceipt(receipt).ok, true);
});

test("complete deployment snapshot lineage can satisfy the proof contract", async () => {
  const receipt = await runWp166({ metadata: metadata() });
  assert.equal(receipt.status, "WP166_DEPLOYMENT_ENV_BINDING_FRESHNESS_PROOF_VERIFIED");
  assert.equal(receipt.quality.deploymentLineage, "PASS");
  assert.equal(receipt.quality.strictReceiptReadback, "PASS");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("WP-86 rerun guard only accepts the authoritative terminal status", () => {
  assert.deepEqual(validateWp86RerunGuard("ACCEPT"), { ok: true, reason: null });
  assert.equal(validateWp86RerunGuard("MISSING").ok, false);
});

test("receipt rejects raw response fields", async () => {
  const receipt = await runWp166({ metadata: metadata({ deploymentEnvironmentSnapshotId: null, deploymentBindingLineage: false }) });
  const unsafe = structuredClone(receipt);
  unsafe.routeDeployment.rawResponse = "raw";
  assert.equal(validateReceipt(unsafe).ok, false);
});
