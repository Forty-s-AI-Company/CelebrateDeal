import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCapabilityArgs,
  buildSafeEnvironment,
  classifyCapability,
  validateArtifact,
  validateReceipt,
  validateRouteEntry,
} from "./fin08aa-preview-route-manifest-attestation.mjs";

const route = { path: "/__celebratedeal_wp187_fingerprint.json", kind: "next-app-route", methods: ["GET", "HEAD"] };

test("capability probe is local help only and excludes logs", () => {
  assert.deepEqual(buildCapabilityArgs("vercel.js"), ["vercel.js", "inspect", "--help"]);
  assert.equal(classifyCapability("inspect --json\n--logs\n", 0).available, false);
  assert.equal(classifyCapability("route manifest --json", 0).available, true);
  assert.equal(classifyCapability("route manifest", 1).available, false);
});
test("safe child environment excludes application and credentials", () => {
  assert.deepEqual(Object.keys(buildSafeEnvironment({ PATH: "x", USERPROFILE: "y", VERCEL_TOKEN: "secret", DATABASE_URL: "db", NEXT_PUBLIC_SUPABASE_URL: "url" })).sort(), ["PATH", "USERPROFILE"]);
});

test("route entry requires exact path and allowlisted kind", () => {
  assert.equal(validateRouteEntry(route), true);
  assert.equal(validateRouteEntry({ ...route, path: "/other" }), false);
  assert.equal(validateRouteEntry({ ...route, kind: "redirect" }), false);
  assert.equal(validateRouteEntry({ ...route, methods: ["GET"] }), false);
  assert.equal(validateRouteEntry({ ...route, methods: undefined }), true);
});

test("artifact requires one current READY Preview and one route", () => {
  const artifact = { candidateCount: 1, projectMatched: true, preview: true, ready: true, nonProduction: true, currentPreview: true, identityUnique: true, routeEntryCount: 1, routePresent: true, routeEntry: route };
  assert.equal(validateArtifact(artifact).ok, true);
  assert.equal(validateArtifact({ ...artifact, candidateCount: 2 }).ok, false);
  assert.equal(validateArtifact({ ...artifact, ready: false }).ok, false);
  assert.equal(validateArtifact({ ...artifact, routeEntryCount: 2 }).ok, false);
});

test("artifact rejects production, non-Preview and unbound identity", () => {
  const base = { candidateCount: 1, projectMatched: true, preview: true, ready: true, nonProduction: true, currentPreview: true, identityUnique: true, routeEntryCount: 1, routePresent: true, routeEntry: route };
  assert.equal(validateArtifact({ ...base, projectMatched: false }).ok, false);
  assert.equal(validateArtifact({ ...base, preview: false }).ok, false);
  assert.equal(validateArtifact({ ...base, nonProduction: false }).ok, false);
  assert.equal(validateArtifact({ ...base, identityUnique: false }).ok, false);
});

test("no-go receipt is sanitized, score-free and side-effect-free", () => {
  const receipt = {
    schemaVersion: "fin08aa-preview-route-manifest-attestation/v1", status: "FIN08AA_TERMINAL_NO_GO_CAPABILITY",
    artifactSource: { queries: 0, applicationHttp: 0, logsRead: false },
    sideEffects: { deployments: 0, environmentMutations: 0, databaseOperations: 0, payuniOperations: 0, playwrightOperations: 0, gitMutations: 0 },
    scoreImpact: { applied: false },
    safety: { rawOutputPersisted: false, rawManifestPersisted: false, urlPersisted: false, credentialRead: false },
  };
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, artifactSource: { ...receipt.artifactSource, queries: 2 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, safety: { ...receipt.safety, rawManifestPersisted: true } }).ok, false);
});

test("success receipt cannot omit route or claim HTTP", () => {
  const receipt = {
    schemaVersion: "fin08aa-preview-route-manifest-attestation/v1", status: "FIN08AA_PREVIEW_ROUTE_MANIFEST_ATTESTED",
    artifactSource: { queries: 1, applicationHttp: 0, logsRead: false }, route: { routePresent: true },
    sideEffects: { deployments: 0, environmentMutations: 0, databaseOperations: 0, payuniOperations: 0, playwrightOperations: 0, gitMutations: 0 },
    scoreImpact: { applied: false }, safety: { rawOutputPersisted: false, rawManifestPersisted: false, urlPersisted: false, credentialRead: false },
  };
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, artifactSource: { ...receipt.artifactSource, applicationHttp: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, route: { routePresent: false } }).ok, false);
});
