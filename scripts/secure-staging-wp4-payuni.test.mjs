import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FIXED_PREREQUISITE_GAPS,
  OWNER_SESSION_COMPLETE_GAPS,
  REQUIRED_CONFIG_KEYS,
  REQUIRED_SECRET_KEYS,
  childEnvironment,
  createInitialReceipt,
  parseChildOutput,
  runOwnerSession,
  validateInvocation,
  validateReceipt,
} from "./secure-staging-wp4-payuni.mjs";

const sha = "146f8db0616fef63451d80f2d8d23a243f58860b";
const safeEnvironment = {
  GITHUB_TOKEN: "present",
  JOB_SECRET: "test-only-job-secret",
  CELEBRATEDEAL_SOURCE_SHA: sha,
  CELEBRATEDEAL_DEPLOYMENT_HOST: "safe-preview.vercel.app",
  RUNNER_TEMP: "/tmp/runner",
};

test("WP4 invocation is fixed-task, exact-source, Preview and staging-only", () => {
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", safeEnvironment).ok, true);
  assert.equal(validateInvocation("arbitrary-command", safeEnvironment).reason, "TASK_NOT_ALLOWLISTED");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, CELEBRATEDEAL_SOURCE_SHA: "main" }).reason, "SOURCE_SHA_INVALID");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, CELEBRATEDEAL_DEPLOYMENT_HOST: "production.example.com" }).reason, "DEPLOYMENT_HOST_INVALID");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, GITHUB_TOKEN: "" }).reason, "REQUIRED_BINDING_MISSING");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, JOB_SECRET: "" }).reason, "REQUIRED_BINDING_MISSING");
});

test("owner-session child environment excludes GitHub and ambient application credentials", () => {
  const child = childEnvironment({ ...safeEnvironment, PATH: "/bin", DATABASE_URL: "must-not-pass" });
  assert.deepEqual(Object.keys(child).sort(), [
    "CELEBRATEDEAL_DEPLOYMENT_HOST",
    "CELEBRATEDEAL_SOURCE_SHA",
    "JOB_SECRET",
    "PATH",
    "RUNNER_TEMP",
  ]);
  assert.equal(child.GITHUB_TOKEN, undefined);
  assert.equal(child.DATABASE_URL, undefined);
});

test("receipt is an explicit bounded-mutation prerequisite contract", () => {
  const receipt = createInitialReceipt(sha);
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(receipt.result, "BLOCKED");
  assert.deepEqual(receipt.prerequisites.requiredSecretBindings, REQUIRED_SECRET_KEYS);
  assert.deepEqual(receipt.prerequisites.requiredConfigBindings, REQUIRED_CONFIG_KEYS);
  assert.deepEqual(receipt.prerequisites.gaps, FIXED_PREREQUISITE_GAPS);
  assert.equal(receipt.purposes.every((purpose) => purpose.status === "NOT_RUN"), true);
  assert.equal(receipt.sideEffects.sessionCreationOutcome, "NOT_ATTEMPTED");
  assert.equal(receipt.sideEffects.sessionRowsCreated, 0);
  assert.equal(receipt.sideEffects.userRowsUpdated, 0);
});

test("receipt rejects fabricated payment, refund, callback, lineage and provider evidence", () => {
  const receipt = createInitialReceipt(sha);
  assert.equal(validateReceipt({ ...receipt, result: "PASS" }).errors.includes("RESULT_MUST_BE_BLOCKED"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, payments: 3 } }).errors.includes("FORBIDDEN_SIDE_EFFECTS"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, refunds: 6 } }).errors.includes("FORBIDDEN_SIDE_EFFECTS"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, callbackReplays: 6 } }).errors.includes("FORBIDDEN_SIDE_EFFECTS"), true);
  assert.equal(validateReceipt({ ...receipt, lineage: { ...receipt.lineage, deploymentReads: 2 } }).errors.includes("LINEAGE_CONTRACT"), true);
  assert.equal(validateReceipt({ ...receipt, purposes: receipt.purposes.map((purpose) => ({ ...purpose, providerStatus: "refunded", status: "PASS" })) }).errors.includes("PURPOSE_MUST_NOT_RUN"), true);
});

test("receipt may prove exact Preview lineage without claiming PayUni execution", () => {
  const receipt = createInitialReceipt(sha);
  receipt.lineage = {
    deploymentReads: 2,
    deploymentMatched: true,
    sourceMatched: true,
    preview: true,
    ready: true,
    healthStatus: 200,
    noRedirect: true,
  };
  receipt.prerequisites.exactPreviewLineage = true;
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.sideEffects.sessionCreationOutcome, "NOT_ATTEMPTED");
  assert.equal(receipt.sideEffects.providerWrites, 0);
});

function mockResponse(url, status, { cookies = [], location } = {}) {
  const headers = new Headers();
  if (location) headers.set("location", location);
  return {
    url,
    status,
    body: { cancel: async () => undefined },
    headers: {
      has: (name) => headers.has(name),
      get: (name) => headers.get(name),
      getSetCookie: () => cookies,
    },
  };
}

function successfulOwnerFetch(requests) {
  const token = "a".repeat(43);
  return async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/wp4-session")) {
      return mockResponse(url, 204, { cookies: [`celebrate_session=${token}; Path=/; HttpOnly; Secure`] });
    }
    return mockResponse(url, 200);
  };
}

test("owner-session child performs one bootstrap and two authenticated read-only probes", async () => {
  const requests = [];
  const ownerSession = await runOwnerSession(safeEnvironment, successfulOwnerFetch(requests));
  assert.deepEqual(ownerSession, {
    bootstrapRequests: 1,
    bootstrapAuthenticated: true,
    sessionCookieCount: 1,
    sessionCreationAttempts: 1,
    sessionCreationOutcome: "CONFIRMED",
    sessionRowsCreated: 1,
    sessionTtlSeconds: 900,
    userRowsUpdated: 0,
    plansProbeRequests: 1,
    plansProbeAuthenticated: true,
    invoicesProbeRequests: 1,
    invoicesProbeAuthenticated: true,
  });
  assert.deepEqual(requests.map(({ url, options }) => [options.method, new URL(url).pathname]), [
    ["POST", "/api/admin/ops/payuni/wp4-session"],
    ["GET", "/billing/plans"],
    ["GET", "/billing/invoices"],
  ]);
  assert.equal(Object.hasOwn(requests[0].options, "body"), false);
  assert.equal(requests.every(({ options }) => options.redirect === "manual"), true);
  assert.equal(JSON.stringify(ownerSession).includes("celebrate_session"), false);
});

test("receipt accepts owner-session evidence only after exact lineage is proven", async () => {
  const receipt = createInitialReceipt(sha);
  receipt.lineage = {
    deploymentReads: 2,
    deploymentMatched: true,
    sourceMatched: true,
    preview: true,
    ready: true,
    healthStatus: 200,
    noRedirect: true,
  };
  receipt.prerequisites.exactPreviewLineage = true;
  receipt.ownerSession = await runOwnerSession(safeEnvironment, successfulOwnerFetch([]));
  receipt.sideEffects.sessionCreationAttempts = 1;
  receipt.sideEffects.sessionCreationOutcome = "CONFIRMED";
  receipt.sideEffects.sessionRowsCreated = 1;
  receipt.sideEffects.sessionTtlSeconds = 900;
  receipt.prerequisites.gaps = [...OWNER_SESSION_COMPLETE_GAPS];
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });

  const unbound = createInitialReceipt(sha);
  unbound.ownerSession = receipt.ownerSession;
  unbound.sideEffects = { ...receipt.sideEffects };
  unbound.prerequisites.gaps = [...OWNER_SESSION_COMPLETE_GAPS];
  assert.equal(validateReceipt(unbound).errors.includes("OWNER_WITHOUT_LINEAGE"), true);

  const zeroWriteOverclaim = {
    ...receipt,
    sideEffects: {
      ...receipt.sideEffects,
      sessionCreationAttempts: 0,
      sessionCreationOutcome: "NOT_ATTEMPTED",
      sessionRowsCreated: 0,
      sessionTtlSeconds: 0,
    },
  };
  assert.equal(validateReceipt(zeroWriteOverclaim).errors.includes("SESSION_SIDE_EFFECTS"), true);
});

test("an indeterminate child outcome records one bounded attempt with unknown persistence", () => {
  const receipt = createInitialReceipt(sha);
  receipt.lineage = {
    deploymentReads: 2,
    deploymentMatched: true,
    sourceMatched: true,
    preview: true,
    ready: true,
    healthStatus: 200,
    noRedirect: true,
  };
  receipt.prerequisites.exactPreviewLineage = true;
  receipt.ownerSession = {
    ...receipt.ownerSession,
    bootstrapRequests: 1,
    sessionCreationAttempts: 1,
    sessionCreationOutcome: "UNKNOWN",
    sessionRowsCreated: null,
    sessionTtlSeconds: 900,
  };
  receipt.sideEffects = {
    ...receipt.sideEffects,
    sessionCreationAttempts: 1,
    sessionCreationOutcome: "UNKNOWN",
    sessionRowsCreated: null,
    sessionTtlSeconds: 900,
  };
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.deepEqual(receipt.prerequisites.gaps, FIXED_PREREQUISITE_GAPS);
});

for (const [name, fetchImpl] of [
  ["bootstrap auth failure", async (url) => mockResponse(url, 401)],
  ["multiple session cookies", async (url) => mockResponse(url, 204, { cookies: [
    `celebrate_session=${"a".repeat(43)}; Path=/`,
    `celebrate_session=${"b".repeat(43)}; Path=/`,
  ] })],
  ["unexpected cookie", async (url) => mockResponse(url, 204, { cookies: [`other_session=${"a".repeat(43)}; Path=/`] })],
  ["redirect", async (url) => mockResponse(url, 302, { location: "https://production.example.com" })],
  ["host drift", async () => mockResponse("https://production.example.com/api/admin/ops/payuni/wp4-session", 204, { cookies: [`celebrate_session=${"a".repeat(43)}; Path=/`] })],
  ["probe failure", async (url) => url.endsWith("/wp4-session")
    ? mockResponse(url, 204, { cookies: [`celebrate_session=${"a".repeat(43)}; Path=/`] })
    : mockResponse(url, 403)],
]) {
  test(`owner-session child fails closed for ${name}`, async () => {
    const ownerSession = await runOwnerSession(safeEnvironment, fetchImpl);
    assert.notEqual(ownerSession.invoicesProbeAuthenticated, true);
    assert.equal(JSON.stringify(ownerSession).includes("production.example.com"), false);
  });
}

test("sterile child output accepts exactly one canonical owner-session projection", async () => {
  const ownerSession = await runOwnerSession(safeEnvironment, successfulOwnerFetch([]));
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify(ownerSession)}\n`, 2).ok, true);
  assert.equal(parseChildOutput(`noise\nSECURE_WP4_RESULT:${JSON.stringify(ownerSession)}\n`, 2).ok, false);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify(ownerSession)}\n`, 0).ok, false);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify({ ...ownerSession, cookie: "leak" })}\n`, 2).ok, false);
});

test("runner cannot load provider fixtures, Prisma, or create external payment side effects", () => {
  const source = fs.readFileSync(new URL("./secure-staging-wp4-payuni.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /payuni-fixtures|@prisma\/client|queryPayment|refundPayment|createCheckoutSession/u);
  assert.match(source, /\/api\/health/u);
  assert.doesNotMatch(source, /sandbox-api\.payuni\.com\.tw/u);
  assert.doesNotMatch(source, /Object\.(?:keys|entries)\(process\.env\)/u);
  assert.doesNotMatch(source, /\.json\(\)|\.text\(\)/u);
  assert.match(source, /spawnSync\(process\.execPath/u);
  assert.match(source, /PAYUNI_SANDBOX_ONETIME_CARD_NO/u);
  assert.match(source, /FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE/u);
});
