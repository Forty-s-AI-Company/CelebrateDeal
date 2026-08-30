import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CONTRACT, classifyOutcome, evaluateMarker, parseAliasInspect, validateReceipt } from "./wp192-staging-alias-propagation-verification.mjs";

test("contract is fixed to the approved staging Preview identity", () => {
  assert.equal(CONTRACT.project, "celebrate-deal-staging");
  assert.equal(CONTRACT.scope, "a25814740s-projects");
  assert.equal(CONTRACT.markerPath, "/__celebratedeal_wp187_fingerprint.json");
  assert.equal(CONTRACT.maxAliasMarkerGets, 2);
});

test("live runner source has no mutation, health, database or provider call path", async () => {
  const source = await readFile(fileURLToPath(new URL("./wp192-staging-alias-propagation-verification.mjs", import.meta.url)), "utf8");
  assert.equal(source.includes("/api/health"), false);
  assert.equal(/\[\s*["']alias["']\s*,\s*["']set["']/u.test(source), false);
  assert.equal(/\[\s*["']deploy["']/u.test(source), false);
  assert.equal(/\b(?:getDb|PrismaClient|queryRaw|executeRaw)\s*\(/u.test(source), false);
  assert.equal(/\/api\/trade\/(?:query|refund)|sandbox-api\.payuni/iu.test(source), false);
});

test("alias inspect requires exact project, Preview, READY and deployment", () => {
  const valid = JSON.stringify({ id: CONTRACT.latestId, name: CONTRACT.project, target: "preview", readyState: "READY" });
  assert.equal(parseAliasInspect(valid).qualified, true);
  assert.equal(parseAliasInspect(JSON.stringify({ id: "wrong", name: CONTRACT.project, target: "preview", readyState: "READY" })).qualified, false);
  assert.equal(parseAliasInspect(JSON.stringify({ id: CONTRACT.latestId, name: CONTRACT.project, target: "production", readyState: "READY" })).qualified, false);
  assert.equal(parseAliasInspect("not-json").qualified, false);
});

test("marker matrix rejects redirects, malformed identity and non-200", () => {
  const good = { workPackage: "WP-187", sourceDigest: CONTRACT.sourceDigest };
  assert.equal(evaluateMarker(200, good).matched, true);
  assert.equal(evaluateMarker(200, good, true).matched, false);
  assert.equal(evaluateMarker(200, { ...good, sourceDigest: "wrong" }).matched, false);
  assert.equal(evaluateMarker(404, good).matched, false);
  assert.equal(evaluateMarker(200, null).matched, false);
});

test("outcome classifies routing, direct, propagation, mismatch and login failures", () => {
  const routing = { qualified: true };
  const matched = { status: 200, matched: true };
  const missed = { status: 404, matched: false };
  assert.equal(classifyOutcome({ routing: { qualified: false }, directMarker: matched, aliasMarkers: [matched], login: matched }), "ALIAS_ROUTING_DRIFT");
  assert.equal(classifyOutcome({ routing, directMarker: missed, aliasMarkers: [], login: null }), "LATEST_DEPLOYMENT_MARKER_REGRESSION");
  assert.equal(classifyOutcome({ routing, directMarker: matched, aliasMarkers: [missed, missed], login: null }), "ALIAS_EDGE_PROPAGATION_NOT_CONVERGED");
  assert.equal(classifyOutcome({ routing, directMarker: matched, aliasMarkers: [{ status: 200, matched: false }], login: null }), "ALIAS_CONTENT_IDENTITY_MISMATCH");
  assert.equal(classifyOutcome({ routing, directMarker: matched, aliasMarkers: [matched], login: missed }), "ALIAS_LOGIN_IDENTITY_NOT_PROVEN");
  assert.equal(classifyOutcome({ routing, directMarker: matched, aliasMarkers: [missed, matched], login: matched }), "WP192_COMPLETE_CANDIDATE");
});

function marker(status = 200, matched = true) {
  return { kind: "marker", status, http200: status === 200, workPackageMatched: matched, sourceDigestMatched: matched, redirected: false, matched, timestamp: "2026-08-04T00:00:00.000Z", rawBodyPersisted: false, headersPersisted: false, cookiesPersisted: false, fullUrlPersisted: false };
}

function login(matched = true) {
  return { kind: "login", status: 200, http200: true, redirected: false, matched, timestamp: "2026-08-04T00:00:00.000Z", rawBodyPersisted: false, headersPersisted: false, cookiesPersisted: false, fullUrlPersisted: false };
}

function validReceipt() {
  return {
    schemaVersion: "wp192-staging-alias-propagation-verification/v1", status: "WP192_COMPLETE_CANDIDATE",
    lineage: { wp187Accepted: true, wp191PlanRemediation: true },
    ownership: { preserveOnly: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: true },
    routing: { project: CONTRACT.project, scope: CONTRACT.scope, target: "preview", state: "READY", deploymentId: CONTRACT.latestId, projectMatched: true, targetMatched: true, readyMatched: true, deploymentIdMatched: true, qualified: true }, directMarker: marker(), aliasMarkers: [marker()], login: login(),
    attempts: { aliasInspect: 1, directMarkerGet: 1, aliasMarkerGet: 1, loginGet: 1, aliasMutation: 0, deploymentMutation: 0, environmentMutation: 0, healthRequest: 0, databaseOperation: 0, payuniOperation: 0, productionOperation: 0, dnsMutation: 0, gitMutation: 0 },
    safety: { rawCliOutputPersisted: false, rawHtmlPersisted: false, rawMarkerJsonPersisted: false, headersPersisted: false, cookiesPersisted: false, fullUrlPersisted: false, envFileRead: false, secretRead: false },
  };
}

test("receipt accepts first-fail second-success within the bounded budget", () => {
  const receipt = validReceipt();
  receipt.aliasMarkers = [marker(404, false), marker()];
  receipt.attempts.aliasMarkerGet = 2;
  assert.deepEqual(validateReceipt(receipt).errors, []);
});

test("receipt rejects third marker request and every forbidden operation", () => {
  const receipt = validReceipt();
  receipt.aliasMarkers.push(marker(), marker());
  receipt.attempts.aliasMarkerGet = 3;
  receipt.attempts.aliasMutation = 1;
  const errors = validateReceipt(receipt).errors;
  assert.ok(errors.includes("READ_BUDGET"));
  assert.ok(errors.includes("FORBIDDEN_OPERATION"));
});

test("receipt rejects login before marker success and raw evidence fields", () => {
  const receipt = validReceipt();
  receipt.aliasMarkers = [marker(404, false)];
  receipt.rawCliOutput = "hidden";
  const errors = validateReceipt(receipt).errors;
  assert.ok(errors.includes("LOGIN_ORDER"));
  assert.ok(errors.includes("LEAK_TEXT"));
});
