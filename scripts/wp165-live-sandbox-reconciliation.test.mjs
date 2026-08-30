import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTHETIC_PENDING_SQL,
  WP165_CONSTANTS,
  runWp165,
  validateFreshness,
  validateReceipt,
  validateSingleSelect,
} from "./wp165-live-sandbox-reconciliation.mjs";

const HEAD = "a".repeat(40);

function facts(overrides = {}) {
  return {
    projectName: WP165_CONSTANTS.EXPECTED_PROJECT,
    readyState: "READY",
    target: "preview",
    route: WP165_CONSTANTS.EXPECTED_ROUTE,
    routeAliasMatched: true,
    deployedCommitSha: HEAD,
    workspaceDirty: true,
    dirtyWorkspaceClaimedDeployed: false,
    customHostStatus: 200,
    deploymentHostStatus: 200,
    previewBindingPresent: true,
    deploymentBindingLineage: true,
    deploymentBindingLineageSource: "test-fixture",
    ...overrides,
  };
}

const dbReady = { ready: true, environment: "staging", permission: "read_only", production: false };
const providerReady = { ready: true, environment: "sandbox", permission: "read_only", production: false, officialSandbox: true, operation: "READ_ONLY_TRANSACTION_LOOKUP" };

test("WP-165 SQL contract accepts one SELECT and rejects writes, locks, and multiple statements", () => {
  assert.equal(validateSingleSelect(SYNTHETIC_PENDING_SQL), true);
  assert.equal(validateSingleSelect("SELECT 1; SELECT 2"), false);
  assert.equal(validateSingleSelect("UPDATE \"PaymentTransaction\" SET status = 'paid'"), false);
  assert.equal(validateSingleSelect("SELECT * FROM \"InventoryReservation\" FOR UPDATE"), false);
  assert.equal(validateSingleSelect("SELECT pg_sleep(1)"), false);
});

test("freshness rejects a Preview binding that Vercel CLI cannot tie to the current deployment", () => {
  assert.equal(validateFreshness(facts({ deploymentBindingLineage: false }), HEAD).reason, "DEPLOYMENT_BINDING_LINEAGE_UNAVAILABLE");
});

test("freshness rejects an old deployment even when the binding name exists", () => {
  assert.equal(validateFreshness(facts({ deployedCommitSha: "b".repeat(40) }), HEAD).reason, "DEPLOYMENT_HEAD_MISMATCH");
});

test("freshness and broker identity fail closed before DB or PayUni calls", async () => {
  let dbCalls = 0;
  let providerCalls = 0;
  const receipt = await runWp165({
    routeFacts: facts({ deploymentBindingLineage: false }),
    expectedHead: HEAD,
    dbBroker: dbReady,
    providerBroker: providerReady,
    queryDatabase: async () => { dbCalls += 1; return []; },
    lookupPayUni: async () => { providerCalls += 1; return null; },
  });
  assert.equal(receipt.status, "WP165_EXACT_NO_GO_FRESHNESS_OR_IDENTITY_UNSAFE");
  assert.match(receipt.failure, /DEPLOYMENT_BINDING_LINEAGE_UNAVAILABLE/u);
  assert.equal(receipt.database.queryCount, 0);
  assert.equal(receipt.payuni.lookupCount, 0);
  assert.equal(dbCalls, 0);
  assert.equal(providerCalls, 0);
  assert.equal(receipt.sideEffects.deploymentWrites, 0);
  assert.equal(receipt.quality.strictReceiptReadback, "PASS");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("agent-blind broker metadata enables exactly one synthetic SELECT and one Sandbox lookup", async () => {
  const reference = "synthetic-provider-reference";
  const receipt = await runWp165({
    routeFacts: facts(),
    expectedHead: HEAD,
    dbBroker: dbReady,
    providerBroker: providerReady,
    queryDatabase: async () => [{ provider_reference: reference }],
    lookupPayUni: async (opaqueReference) => ({ providerReference: opaqueReference, status: "pending" }),
  });
  assert.equal(receipt.status, "WP165_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED");
  assert.equal(receipt.database.queryCount, 1);
  assert.equal(receipt.payuni.lookupCount, 1);
  assert.equal(receipt.lineage.providerReferenceMatches, true);
  assert.equal(validateReceipt(receipt).ok, true);
});

test("receipt validator rejects raw provider response persistence", async () => {
  const receipt = await runWp165({ routeFacts: facts({ deploymentBindingLineage: false }), expectedHead: HEAD, dbBroker: dbReady, providerBroker: providerReady });
  const unsafe = structuredClone(receipt);
  unsafe.routeIdentity.rawResponse = "raw";
  assert.equal(validateReceipt(unsafe).ok, false);
});
