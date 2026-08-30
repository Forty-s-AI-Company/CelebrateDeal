import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMarkerUrl,
  manualAttestation,
  validateManualAttestation,
  validateMarkerResponse,
  validateReceipt,
} from "./fin08z-manual-attested-preview-marker-verification.mjs";

const marker = {
  schemaVersion: "celebratedeal-preview-lineage/v2",
  baseWorkPackage: "WP-187",
  baseSourceDigest: "sha256:cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34",
  remediationWorkPackage: "FIN-08U",
  sourceDigestSemantics: "wp187_base_lineage",
};

test("manual attestation is fixed to five true booleans", () => {
  assert.deepEqual(manualAttestation(), { preview: true, ready: true, ownerConfirmed: true, currentPreview: true, identityConfirmed: true });
  assert.equal(validateManualAttestation(manualAttestation()), true);
  assert.equal(validateManualAttestation({ ...manualAttestation(), ready: false }), false);
  assert.equal(validateManualAttestation({ ...manualAttestation(), extra: true }), false);
  assert.equal(validateManualAttestation({ preview: true }), false);
});
test("marker URL accepts HTTPS host and rejects unsafe authorities", () => {
  assert.equal(buildMarkerUrl("https://preview.example")?.pathname, "/__celebratedeal_wp187_fingerprint.json");
  assert.equal(buildMarkerUrl("http://preview.example"), null);
  assert.equal(buildMarkerUrl("https://user:pass@preview.example"), null);
  assert.equal(buildMarkerUrl("https://preview.example:8443"), null);
  assert.equal(buildMarkerUrl("https://preview.example?x=1"), null);
});

test("exact v2 marker payload and security headers pass", () => {
  const result = validateMarkerResponse({ status: 200, redirect: false, payload: marker, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("legacy, extra-key, wrong status, redirect and header drift fail closed", () => {
  const headers = { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" };
  assert.equal(validateMarkerResponse({ status: 404, redirect: false, payload: marker, headers }).ok, false);
  assert.equal(validateMarkerResponse({ status: 200, redirect: true, payload: marker, headers }).ok, false);
  assert.equal(validateMarkerResponse({ status: 200, redirect: false, payload: { ...marker, extra: true }, headers }).ok, false);
  assert.equal(validateMarkerResponse({ status: 200, redirect: false, payload: marker, headers: { ...headers, cacheControl: "public" } }).ok, false);
  assert.equal(validateMarkerResponse({ status: 200, redirect: false, payload: marker, headers: { ...headers, contentTypeOptions: "" } }).ok, false);
});

test("success receipt requires exactly one marker GET and no prohibited operation", () => {
  const base = {
    schemaVersion: "fin08z-manual-attested-preview-marker-verification/v1", status: "FIN08Z_MANUAL_ATTESTED_PREVIEW_V2_MARKER_VERIFIED", manualAttestation: manualAttestation(),
    metadataQueries: 0, markerGets: 1, markerHeads: 0, otherHttpRequests: 0, markerStatus: 200, redirects: 0, v2Contract: true, headersNoStore: true, headersNoSniff: true,
    deployments: 0, redeployments: 0, aliasMutations: 0, environmentMutations: 0, databaseOperations: 0, payuniOperations: 0, playwrightOperations: 0, scoreApplied: false,
    safety: { rawResponsePersisted: false, urlPersisted: false, credentialRead: false, manualTextPersisted: false },
  };
  assert.equal(validateReceipt(base).ok, true);
  assert.equal(validateReceipt({ ...base, markerGets: 2 }).ok, false);
  assert.equal(validateReceipt({ ...base, metadataQueries: 1 }).ok, false);
  assert.equal(validateReceipt({ ...base, safety: { ...base.safety, rawResponsePersisted: true } }).ok, false);
});

test("terminal no-go receipt remains valid and score-free", () => {
  const receipt = {
    schemaVersion: "fin08z-manual-attested-preview-marker-verification/v1", status: "FIN08Z_TERMINAL_NO_GO_PRECHECK", manualAttestation: manualAttestation(),
    metadataQueries: 0, markerGets: 0, markerHeads: 0, otherHttpRequests: 0, markerStatus: null, redirects: 0, v2Contract: false, headersNoStore: false, headersNoSniff: false,
    deployments: 0, redeployments: 0, aliasMutations: 0, environmentMutations: 0, databaseOperations: 0, payuniOperations: 0, playwrightOperations: 0, scoreApplied: false,
    safety: { rawResponsePersisted: false, urlPersisted: false, credentialRead: false, manualTextPersisted: false },
  };
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, manualAttestation: { ...manualAttestation(), ownerConfirmed: false } }).ok, false);
});
