import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMarkerUrl,
  buildMetadataArgs,
  buildSafeEnvironment,
  deploymentIdentityDigest,
  parseInventory,
  validateMarkerResponse,
  validateReceipt,
} from "./fin08y-latest-preview-marker-attestation.mjs";

const NOW = Date.now();
const oldDigest = "sha256:" + "0".repeat(64);
const row = (uid, createdAt, overrides = {}) => ({ uid, name: "celebrate-deal-staging", target: "preview", readyState: "READY", createdAt, url: `${uid}.vercel.app`, ...overrides });
const marker = {
  schemaVersion: "celebratedeal-preview-lineage/v2",
  baseWorkPackage: "WP-187",
  baseSourceDigest: "sha256:cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34",
  remediationWorkPackage: "FIN-08U",
  sourceDigestSemantics: "wp187_base_lineage",
};

test("metadata query is one bounded exact-project Preview command", () => {
  assert.deepEqual(buildMetadataArgs(), ["list", "celebrate-deal-staging", "--json", "--limit", "20", "--status", "READY", "--target", "preview", "--scope", "a25814740s-projects", "--no-color"]);
});

test("safe environment excludes dotenv, token and database values", () => {
  assert.deepEqual(Object.keys(buildSafeEnvironment({ PATH: "x", USERPROFILE: "y", VERCEL_TOKEN: "secret", DATABASE_URL: "db", NEXT_PUBLIC_SUPABASE_URL: "url" })).sort(), ["PATH", "USERPROFILE"]);
});

test("empty and malformed inventory fail closed", () => {
  assert.equal(parseInventory("[]", 0, { protectedDigests: [] }).latest, null);
  assert.equal(parseInventory("not-json", 0, { protectedDigests: [] }).parseOk, false);
  assert.equal(parseInventory("[]", 1, { protectedDigests: [] }).parseOk, false);
});

test("multiple rows keep one strictly newest eligible Preview candidate", () => {
  const result = parseInventory(JSON.stringify([row("new", NOW), row("old", NOW - 60_000)]), 0, { protectedDigests: [oldDigest] });
  assert.equal(result.orderOk, true);
  assert.equal(result.eligible.length, 2);
  assert.equal(result.latestUnique, true);
  assert.equal(result.latestCandidateCount, 1);
  assert.equal(result.latest.identityDigest.startsWith("sha256:"), true);
});

test("timestamp tie and non-monotonic inventory are rejected", () => {
  const tie = parseInventory(JSON.stringify([row("a", NOW), row("b", NOW)]), 0, { protectedDigests: [] });
  assert.equal(tie.latest, null);
  assert.equal(tie.latestTie, true);
  const nonMonotonic = parseInventory(JSON.stringify([row("a", NOW - 60_000), row("b", NOW)]), 0, { protectedDigests: [] });
  assert.equal(nonMonotonic.orderOk, false);
  assert.equal(nonMonotonic.latest, null);
});

test("production, wrong target, old digest and missing identity are excluded", () => {
  const result = parseInventory(JSON.stringify([
    row("old", NOW, { uid: "old" }),
    row("prod", NOW - 1, { target: "production" }),
    row("wrong", NOW - 2, { target: "preview", name: "other" }),
    row("missing", NOW - 3, { uid: undefined }),
  ]), 0, { protectedDigests: [deploymentIdentityDigest("old")] });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.latest, null);
});

test("marker URL rejects userinfo, query, hash, port and non-HTTPS", () => {
  assert.equal(buildMarkerUrl(new URL("https://preview.example"))?.pathname, "/__celebratedeal_wp187_fingerprint.json");
  assert.equal(buildMarkerUrl(new URL("http://preview.example")), null);
  assert.equal(buildMarkerUrl(new URL("https://user:pass@preview.example")), null);
  assert.equal(buildMarkerUrl(new URL("https://preview.example:8443")), null);
});

test("exact v2 marker contract and security headers pass", () => {
  const result = validateMarkerResponse({ status: 200, redirect: false, payload: marker, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("legacy, extra-key, redirect and header drift fail closed", () => {
  assert.equal(validateMarkerResponse({ status: 200, redirect: true, payload: marker, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" } }).ok, false);
  assert.equal(validateMarkerResponse({ status: 200, redirect: false, payload: { ...marker, extra: true }, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" } }).ok, false);
  assert.equal(validateMarkerResponse({ status: 404, redirect: false, payload: marker, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" } }).ok, false);
  assert.equal(validateMarkerResponse({ status: 200, redirect: false, payload: marker, headers: { cacheControl: "public, max-age=60", contentTypeOptions: "nosniff" } }).ok, false);
});

test("success receipt requires exactly one inventory query and marker GET", () => {
  const base = {
    schemaVersion: "fin08y-latest-preview-marker-attestation/v1", status: "FIN08Y_LATEST_PREVIEW_V2_MARKER_ATTESTED", deployments: 0, redeployments: 0,
    metadataInventoryQueries: 1, markerGets: 1, markerHeads: 0, otherHttpRequests: 0, latestCandidateCount: 1, latestUnique: true, markerStatus: 200,
    markerV2Contract: true, headersNoStore: true, headersNoSniff: true, noRedirect: true, identityDigest: oldDigest, createdAtMinuteBucket: 1, aliasMutations: 0, environmentMutations: 0,
    databaseOperations: 0, payuniOperations: 0, playwrightOperations: 0, scoreApplied: false,
    safety: { rawOutputPersisted: false, urlPersisted: false, credentialRead: false, rawMarkerPersisted: false },
  };
  assert.equal(validateReceipt(base).ok, true);
  assert.equal(validateReceipt({ ...base, markerGets: 2 }).ok, false);
  assert.equal(validateReceipt({ ...base, markerV2Contract: false }).ok, false);
});
