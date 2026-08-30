import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDeployArgs,
  buildSafeEnvironment,
  isAllowedMirrorFile,
  isForbiddenRelativePath,
  parseDeployment,
  parseInspect,
  validateMarkerResponse,
  validateReceipt,
  validateV2Payload,
} from "./fin08v-preview-marker-deployment-verification.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const V2 = {
  schemaVersion: "celebratedeal-preview-lineage/v2",
  baseWorkPackage: "WP-187",
  baseSourceDigest: DIGEST,
  remediationWorkPackage: "FIN-08U",
  sourceDigestSemantics: "wp187_base_lineage",
};

test("allowlist excludes dotenv, workspace metadata, credentials, tests and artifacts", () => {
  assert.equal(isForbiddenRelativePath(".env"), true);
  assert.equal(isForbiddenRelativePath("src/.env.local"), true);
  assert.equal(isForbiddenRelativePath(".ai-team/reports/receipt.json"), true);
  assert.equal(isForbiddenRelativePath("src/secret-config.ts"), true);
  assert.equal(isForbiddenRelativePath("src/app/page.test.tsx"), true);
  assert.equal(isForbiddenRelativePath("src/app/page.tsx"), false);
  assert.equal(isAllowedMirrorFile("src/app/__celebratedeal_wp187_fingerprint.json/route.ts"), true);
  assert.equal(isAllowedMirrorFile("scripts/preflight.ts"), true);
});
test("safe child environment does not inherit application values", () => {
  const env = buildSafeEnvironment({ PATH: "path", USERPROFILE: "profile", DATABASE_URL: "db", PAYUNI_ENV: "sandbox", VERCEL_TOKEN: "token" });
  assert.deepEqual(Object.keys(env).sort(), ["PATH", "USERPROFILE"]);
});

test("deployment argv is exactly one Preview mutation with no production, env or alias command", () => {
  const args = buildDeployArgs("C:\\Temp\\mirror");
  assert.deepEqual(args, ["deploy", "C:\\Temp\\mirror", "--yes", "--target", "preview", "--project", "celebrate-deal-staging", "--scope", "a25814740s-projects", "--skip-domain", "--json", "--no-color"]);
  assert.equal(args.includes("--prod"), false);
  assert.equal(args.includes("--env"), false);
  assert.equal(args.includes("alias"), false);
});

test("v2 payload is exact and legacy or extra shapes fail closed", () => {
  assert.equal(validateV2Payload(V2, DIGEST), true);
  assert.equal(validateV2Payload({ workPackage: "WP-187", sourceDigest: DIGEST }, DIGEST), false);
  assert.equal(validateV2Payload({ ...V2, extra: "no" }, DIGEST), false);
  assert.equal(validateV2Payload({ ...V2, baseSourceDigest: `sha256:${"b".repeat(64)}` }, DIGEST), false);
});

test("marker responses require exact status, headers, no redirect and method body rules", () => {
  assert.equal(validateMarkerResponse({ method: "GET", status: 200, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" }, payload: V2, expectedBaseDigest: DIGEST }).ok, true);
  assert.equal(validateMarkerResponse({ method: "HEAD", status: 200, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" }, bodyEmpty: true, expectedBaseDigest: DIGEST }).ok, true);
  assert.equal(validateMarkerResponse({ method: "GET", status: 404, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" }, payload: V2, expectedBaseDigest: DIGEST }).ok, false);
  assert.equal(validateMarkerResponse({ method: "GET", status: 200, redirected: true, headers: { cacheControl: "no-store, max-age=0", contentTypeOptions: "nosniff" }, payload: V2, expectedBaseDigest: DIGEST }).ok, false);
  assert.equal(validateMarkerResponse({ method: "GET", status: 200, headers: { cacheControl: "private", contentTypeOptions: "nosniff" }, payload: V2, expectedBaseDigest: DIGEST }).ok, false);
});

test("deployment and inspect parsers fail closed without retaining raw identifiers", () => {
  const deployed = parseDeployment(JSON.stringify({ url: "https://preview-example.vercel.app", id: "raw-id" }), 0);
  assert.equal(deployed.ok, true);
  assert.equal(deployed.url, "https://preview-example.vercel.app");
  assert.equal(parseDeployment(JSON.stringify({ url: "https://evil.example.test" }), 0).ok, false);
  assert.deepEqual(parseInspect(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "deployment-id" }), 0), {
    ok: true,
    projectMatched: true,
    preview: true,
    ready: true,
    nonProduction: true,
    identityDigest: parseInspect(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "deployment-id" }), 0).identityDigest,
  });
  assert.equal(parseInspect(JSON.stringify({ name: "celebrate-deal-staging", target: "production", readyState: "READY", id: "deployment-id" }), 0).ok, false);
});

test("receipt rejects retry, side effect and sensitive persistence", () => {
  const receipt = {
    schemaVersion: "fin08v-preview-marker-deployment-verification/v1",
    status: "FIN08V_TERMINAL_NO_GO_MARKER",
    deploymentAttempts: 1,
    productionDeployments: 0,
    aliasMutations: 0,
    environmentCommands: 0,
    metadataReads: 1,
    markerGets: 1,
    markerHeads: 1,
    databaseOperations: 0,
    payuniOperations: 0,
    retryCount: 0,
    scoreImpact: { applied: false },
    safety: { dotenvRead: false, rawOutputPersisted: false, credentialsPersisted: false },
  };
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, deploymentAttempts: 2 }).ok, false);
  assert.equal(validateReceipt({ ...receipt, databaseOperations: 1 }).ok, false);
  assert.equal(validateReceipt({ ...receipt, rawUrl: "https://private.example.test" }).ok, false);
});
