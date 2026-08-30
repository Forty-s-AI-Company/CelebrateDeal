import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTHETIC_PENDING_SQL,
  WP162_CONSTANTS,
  runWp162,
  validateReceipt,
  validateRouteIdentity,
  validateSingleSelect,
} from "./wp162-live-sandbox-reconciliation.mjs";

const HEAD = "a06fe1720b2e9d4eb17b59bdd67ebe5b9281f466";

function routeFacts(overrides = {}) {
  return {
    projectName: WP162_CONSTANTS.EXPECTED_PROJECT,
    deploymentState: "READY",
    readyState: "READY",
    target: "preview",
    route: WP162_CONSTANTS.EXPECTED_ROUTE,
    routeAliasMatched: true,
    deployedCommitSha: HEAD,
    headSha: HEAD,
    workspaceDirty: true,
    dirtyWorkspaceClaimedDeployed: false,
    customHostStatus: 200,
    deploymentHostStatus: 200,
    ...overrides,
  };
}

test("WP-162 SQL contract accepts one SELECT and rejects writes, locks, and multiple statements", () => {
  assert.equal(validateSingleSelect(SYNTHETIC_PENDING_SQL), true);
  assert.equal(validateSingleSelect("SELECT 1; SELECT 2"), false);
  assert.equal(validateSingleSelect("UPDATE \"PaymentTransaction\" SET status = 'paid'"), false);
  assert.equal(validateSingleSelect("SELECT * FROM \"InventoryReservation\" FOR UPDATE"), false);
  assert.equal(validateSingleSelect("SELECT pg_sleep(1)"), false);
});

test("route identity requires preview, expected alias, matching HEAD, and explicit dirty non-deployment claim", () => {
  assert.deepEqual(validateRouteIdentity(routeFacts(), HEAD), { ok: true, reason: null });
  assert.equal(validateRouteIdentity(routeFacts({ target: "production" }), HEAD).ok, false);
  assert.equal(validateRouteIdentity(routeFacts({ routeAliasMatched: false }), HEAD).reason, "ROUTE_ALIAS_MISMATCH");
  assert.equal(validateRouteIdentity(routeFacts({ deployedCommitSha: "b".repeat(40) }), HEAD).reason, "DEPLOYMENT_HEAD_MISMATCH");
  assert.equal(validateRouteIdentity(routeFacts({ dirtyWorkspaceClaimedDeployed: true }), HEAD).reason, "DIRTY_WORKSPACE_CLAIM_INVALID");
});

test("missing controlled staging DB identity fails closed before DB or PayUni reads", async () => {
  let databaseCalls = 0;
  let providerCalls = 0;
  const receipt = await runWp162({
    routeFacts: routeFacts(),
    expectedHead: HEAD,
    dbBroker: { credentialPresent: false, environment: "", permission: "", identityConfirmed: false, productionIdentityDetected: false },
    providerBroker: { officialSandbox: true, requiredCredentialsPresent: true, callbackHostMatches: true, operation: "READ_ONLY_TRANSACTION_LOOKUP", productionIdentityDetected: false },
    queryDatabase: async () => { databaseCalls += 1; return []; },
    lookupPayUni: async () => { providerCalls += 1; return { providerTradeNo: "synthetic", status: "refunded" }; },
  });
  assert.equal(receipt.status, "WP162_EXACT_NO_GO_EXTERNAL_RECONCILIATION_UNSAFE_OR_INCOMPLETE");
  assert.match(receipt.failure, /STAGING_DB_CREDENTIAL_IDENTITY_UNCONFIRMED/u);
  assert.equal(receipt.database.queryCount, 0);
  assert.equal(receipt.payuni.lookupCount, 0);
  assert.equal(databaseCalls, 0);
  assert.equal(providerCalls, 0);
  assert.equal(receipt.sideEffects.databaseWrites, 0);
  assert.equal(receipt.sideEffects.providerWrites, 0);
  assert.equal(receipt.safety.environmentFileRead, false);
  assert.equal(receipt.ownership.stagedIndexEmpty, true);
  assert.equal(validateReceipt(receipt).ok, true);
});

test("receipt validator rejects raw identity and secret-like persistence", async () => {
  const receipt = await runWp162({
    routeFacts: routeFacts(),
    expectedHead: HEAD,
    dbBroker: { credentialPresent: false, environment: "", permission: "", identityConfirmed: false, productionIdentityDetected: false },
    providerBroker: { officialSandbox: true, requiredCredentialsPresent: true, callbackHostMatches: true, operation: "READ_ONLY_TRANSACTION_LOOKUP", productionIdentityDetected: false },
  });
  const unsafe = structuredClone(receipt);
  unsafe.routeIdentity.rawResponse = "raw";
  assert.equal(validateReceipt(unsafe).ok, false);
});
