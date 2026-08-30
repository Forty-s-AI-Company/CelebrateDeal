import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMetadataArgs,
  buildSafeEnvironment,
  parseCandidates,
  validateMarkerResponse,
  validatePrerequisite,
  validateReceipt,
  validateV2Payload,
} from "./fin08w-preview-marker-recovery.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const V2 = {
  schemaVersion: "celebratedeal-preview-lineage/v2",
  baseWorkPackage: "WP-187",
  baseSourceDigest: DIGEST,
  remediationWorkPackage: "FIN-08U",
  sourceDigestSemantics: "wp187_base_lineage",
};

test("metadata argv is exactly one read-only READY Preview listing", () => {
  assert.deepEqual(buildMetadataArgs(), ["list", "celebrate-deal-staging", "--json", "--limit", "20", "--status", "READY", "--scope", "a25814740s-projects", "--no-color"]);
});

test("safe environment excludes workspace application values", () => {
  const environment = buildSafeEnvironment({ PATH: "path", USERPROFILE: "profile", DATABASE_URL: "db", VERCEL_TOKEN: "token" });
  assert.deepEqual(Object.keys(environment).sort(), ["PATH", "USERPROFILE"]);
});

test("prerequisite fails closed when FIN-08V did not persist an identity window", () => {
  const result = validatePrerequisite({
    receipt: { schemaVersion: "fin08v-preview-marker-deployment-verification/v1", deploymentAttempts: 1, productionDeployments: 0, aliasMutations: 0, environmentCommands: 0, metadataReads: 0, markerGets: 0, markerHeads: 0, databaseOperations: 0, payuniOperations: 0, retryCount: 0 },
    evidenceText: "FIN08V_POST_RUN_CLEANUP_VERIFIED=true",
    protectedStable: true,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ["IDENTITY_WINDOW_MISSING"]);
});

test("candidate selection requires exact project, Preview, READY, window and digest", () => {
  const now = Date.now();
  const raw = JSON.stringify([
    { uid: "one", name: "celebrate-deal-staging", target: "preview", readyState: "READY", createdAt: now },
    { uid: "two", name: "other", target: "preview", readyState: "READY", createdAt: now },
  ]);
  const expected = `sha256:${"b".repeat(64)}`;
  const digestOne = parseCandidates(JSON.stringify([{ uid: "one", name: "celebrate-deal-staging", target: "preview", readyState: "READY", createdAt: now, url: "https://one.vercel.app" }]), 0, { windowStart: now - 1_000, windowEnd: now + 1_000 }).candidates[0].identityDigest;
  assert.equal(parseCandidates(raw, 0, { windowStart: now - 1_000, windowEnd: now + 1_000 }).candidates.length, 0);
  assert.equal(parseCandidates(JSON.stringify([{ uid: "one", name: "celebrate-deal-staging", target: "preview", readyState: "READY", createdAt: now, url: "https://one.vercel.app" }]), 0, { windowStart: now - 1_000, windowEnd: now + 1_000, expectedDigest: digestOne }).candidates.length, 1);
  assert.equal(parseCandidates(JSON.stringify([{ uid: "one", name: "celebrate-deal-staging", target: "production", readyState: "READY", createdAt: now, url: "https://one.vercel.app" }]), 0, { windowStart: now - 1_000, windowEnd: now + 1_000 }).candidates.length, 0);
  assert.equal(parseCandidates(JSON.stringify([{ uid: "one", name: "celebrate-deal-staging", target: "preview", readyState: "READY", createdAt: now, url: "https://evil.example" }]), 0, { windowStart: now - 1_000, windowEnd: now + 1_000 }).candidates.length, 0);
  assert.equal(expected.startsWith("sha256:"), true);
});

test("v2 payload and marker headers fail closed on legacy, extra and redirect shapes", () => {
  assert.equal(validateV2Payload(V2, DIGEST), true);
  assert.equal(validateV2Payload({ ...V2, extra: true }, DIGEST), false);
  assert.equal(validateMarkerResponse({ method: "GET", status: 200, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" }, payload: V2, expectedBaseDigest: DIGEST }).ok, true);
  assert.equal(validateMarkerResponse({ method: "HEAD", status: 200, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" }, bodyEmpty: true, expectedBaseDigest: DIGEST }).ok, true);
  assert.equal(validateMarkerResponse({ method: "GET", status: 200, redirected: true, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" }, payload: V2, expectedBaseDigest: DIGEST }).ok, false);
});

test("receipt budgets and sensitive persistence are strict", () => {
  const receipt = { schemaVersion: "fin08w-preview-marker-recovery/v1", status: "FIN08W_TERMINAL_NO_GO_PRECHECK", deployments: 0, metadataQueries: 0, markerGets: 0, markerHeads: 0, aliasMutations: 0, environmentMutations: 0, databaseOperations: 0, payuniOperations: 0, playwrightOperations: 0, scoreApplied: false, safety: { rawOutputPersisted: false, urlPersisted: false, credentialRead: false } };
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, metadataQueries: 2 }).ok, false);
  assert.equal(validateReceipt({ ...receipt, urlPersisted: "https://private.example" }).ok, false);
});
