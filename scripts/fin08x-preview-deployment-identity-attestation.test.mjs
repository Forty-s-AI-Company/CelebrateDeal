import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMetadataArgs,
  buildSafeEnvironment,
  parseInventory,
  validatePrerequisite,
  validateReceipt,
} from "./fin08x-preview-deployment-identity-attestation.mjs";

const NOW = Date.now();
const row = (uid, overrides = {}) => ({ uid, name: "celebrate-deal-staging", target: "preview", readyState: "READY", createdAt: NOW, ...overrides });
const oldDigest = "sha256:" + "0".repeat(64);

test("metadata command is bounded to one exact-project Preview listing", () => {
  assert.deepEqual(buildMetadataArgs(), ["list", "celebrate-deal-staging", "--json", "--limit", "20", "--status", "READY", "--scope", "a25814740s-projects", "--no-color"]);
});

test("safe child environment excludes application and token values", () => {
  assert.deepEqual(Object.keys(buildSafeEnvironment({ PATH: "x", USERPROFILE: "y", VERCEL_TOKEN: "z", DATABASE_URL: "db" })).sort(), ["PATH", "USERPROFILE"]);
});

test("inventory excludes old, production, non-ready and external-project rows", () => {
  const raw = JSON.stringify([row("new", { url: "https://new.vercel.app" }), row("old", { url: "https://old.vercel.app" }), row("prod", { target: "production", url: "https://prod.vercel.app" }), row("other", { name: "other", url: "https://other.vercel.app" })]);
  const result = parseInventory(raw, 0, { oldDigests: [oldDigest], lowerBound: NOW - 1_000 });
  assert.equal(result.orderOk, true);
  assert.equal(result.candidates.length, 2);
});

test("inventory requires monotonic creation order and explicit lower bound", () => {
  const result = parseInventory(JSON.stringify([row("a", { createdAt: NOW - 10_000 }), row("b", { createdAt: NOW })]), 0, { oldDigests: [], lowerBound: NOW - 20_000 });
  assert.equal(result.orderOk, false);
  assert.equal(result.candidates.length, 2);
  const noBoundary = parseInventory(JSON.stringify([row("a")]), 0, { oldDigests: [], lowerBound: null });
  assert.equal(noBoundary.candidates.length, 0);
});

test("prerequisite fails closed when time boundary is absent", () => {
  const result = validatePrerequisite({
    fin08v: { deploymentAttempts: 1 },
    fin08w: { deployments: 0, metadataQueries: 0, markerGets: 0, markerHeads: 0 },
    oldDigests: [oldDigest],
    lowerBound: null,
    protectedStable: true,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ["TIME_BOUNDARY_MISSING"]);
});

test("receipt keeps all mutation and marker counters at zero", () => {
  const receipt = { schemaVersion: "fin08x-preview-deployment-identity-attestation/v1", status: "FIN08X_TERMINAL_NO_GO_PRECHECK", deployments: 0, redeployments: 0, metadataInventoryQueries: 0, markerRequests: 0, aliasMutations: 0, environmentMutations: 0, databaseOperations: 0, payuniOperations: 0, playwrightOperations: 0, scoreApplied: false, safety: { rawOutputPersisted: false, urlPersisted: false, credentialRead: false } };
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, markerRequests: 1 }).ok, false);
  assert.equal(validateReceipt({ ...receipt, identityDigest: "https://bad.example" }).ok, false);
});
