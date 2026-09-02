import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FIXED_PREREQUISITE_GAPS,
  OWNER_SESSION_COMPLETE_GAPS,
  REQUIRED_CONFIG_KEYS,
  REQUIRED_SECRET_KEYS,
  WP4_CHILD_MAX_REQUESTS,
  WP4_CHILD_TIMEOUT_MS,
  WP4_NETWORK_REQUEST_TIMEOUT_MS,
  childEnvironment,
  createInitialReceipt,
  markChildAttemptUnknown,
  parseChildOutput,
  runFixtureSetup,
  runFixturePreflight,
  runOwnerSession,
  runParent,
  runWp4Child,
  safeDiagnosticCategory,
  validateInvocation,
  validateReceipt,
} from "./secure-staging-wp4-payuni.mjs";

const sha = "146f8db0616fef63451d80f2d8d23a243f58860b";
const safeEnvironment = {
  GITHUB_TOKEN: "present",
  JOB_SECRET: "test-only-job-secret",
  PAYUNI_SANDBOX_ONETIME_CARD_NO: "4111111111111111",
  PAYUNI_TEST_EXPIRY: "1230",
  PAYUNI_TEST_CVV: "123",
  CELEBRATEDEAL_SOURCE_SHA: sha,
  CELEBRATEDEAL_DEPLOYMENT_HOST: "safe-preview.vercel.app",
  RUNNER_TEMP: "/tmp/runner",
};

test("parent timeout covers every bounded child request plus shutdown headroom", () => {
  assert.ok(
    WP4_CHILD_TIMEOUT_MS >= (WP4_NETWORK_REQUEST_TIMEOUT_MS * WP4_CHILD_MAX_REQUESTS) + 5_000,
  );
});

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
    "PAYUNI_SANDBOX_ONETIME_CARD_NO",
    "PAYUNI_TEST_CVV",
    "PAYUNI_TEST_EXPIRY",
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
  assert.equal(receipt.diagnosticCategory, "NOT_RUN");
});

test("diagnostic categories are closed, sanitized and never persist raw errors", () => {
  assert.equal(safeDiagnosticCategory(new Error("GITHUB_DEPLOYMENT_READ_FAILED")), "GITHUB_DEPLOYMENT_READ_FAILED");
  assert.equal(safeDiagnosticCategory("CHILD_OUTPUT_INVALID"), "CHILD_OUTPUT_INVALID");
  assert.equal(safeDiagnosticCategory(new Error("https://unexpected.example/?token=secret")), "UNCLASSIFIED_INTERNAL_FAILURE");
  const receipt = createInitialReceipt(sha);
  receipt.diagnosticCategory = "https://unexpected.example/?token=secret";
  assert.equal(validateReceipt(receipt).errors.includes("DIAGNOSTIC_CATEGORY"), true);
});

async function runParentInTemp(dependencies) {
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp4-test-"));
  try {
    const receiptPath = await runParent({ ...safeEnvironment, RUNNER_TEMP: runnerTemp }, dependencies);
    return JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } finally {
    fs.rmSync(runnerTemp, { recursive: true, force: true });
  }
}

test("parent persists a closed lineage diagnostic without raw error text", async () => {
  const receipt = await runParentInTemp({
    verifyDeploymentImpl: async () => { throw new Error("GITHUB_DEPLOYMENT_READ_FAILED"); },
  });
  assert.equal(receipt.diagnosticCategory, "GITHUB_DEPLOYMENT_READ_FAILED");
  assert.equal(receipt.lineage.deploymentReads, 0);
  assert.equal(receipt.sideEffects.sessionCreationAttempts, 0);
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
});

test("parent classifies a non-200 Preview health response without starting the child", async () => {
  const receipt = await runParentInTemp({
    verifyDeploymentImpl: async () => ({
      reads: 2,
      host: safeEnvironment.CELEBRATEDEAL_DEPLOYMENT_HOST,
      deploymentMatched: true,
      sourceMatched: true,
      preview: true,
      ready: true,
    }),
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  assert.equal(receipt.diagnosticCategory, "STAGING_HEALTH_FAILED");
  assert.equal(receipt.lineage.deploymentReads, 0);
  assert.equal(receipt.sideEffects.sessionCreationAttempts, 0);
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
});

test("parent preserves unknown fixture side effects when child output is invalid", async () => {
  const receipt = await runParentInTemp({
    verifyDeploymentImpl: async () => ({
      reads: 2,
      host: safeEnvironment.CELEBRATEDEAL_DEPLOYMENT_HOST,
      deploymentMatched: true,
      sourceMatched: true,
      preview: true,
      ready: true,
    }),
    fetchImpl: async () => new Response(null, { status: 200 }),
    spawnSyncImpl: () => ({ status: 1, signal: null, stdout: "", stderr: "must-not-persist" }),
  });
  assert.equal(receipt.diagnosticCategory, "CHILD_OUTPUT_INVALID");
  assert.equal(receipt.prerequisites.exactPreviewLineage, true);
  assert.equal(receipt.sideEffects.fixtureSetupAttempts, 1);
  assert.equal(receipt.sideEffects.fixtureRowsCreated, null);
  assert.equal(receipt.sideEffects.sessionCreationAttempts, 0);
  assert.equal(JSON.stringify(receipt).includes("must-not-persist"), false);
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
});

test("receipt rejects fabricated payment, refund, callback, lineage and provider evidence", () => {
  const receipt = createInitialReceipt(sha);
  assert.equal(validateReceipt({ ...receipt, result: "PASS" }).errors.includes("RESULT_MUST_BE_BLOCKED"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, payments: 3 } }).errors.includes("FORBIDDEN_SIDE_EFFECTS"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, refunds: 6 } }).errors.includes("FORBIDDEN_SIDE_EFFECTS"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, callbackReplays: 6 } }).errors.includes("FORBIDDEN_SIDE_EFFECTS"), true);
  assert.equal(validateReceipt({ ...receipt, lineage: { ...receipt.lineage, deploymentReads: 2 } }).errors.includes("LINEAGE_CONTRACT"), true);
  assert.equal(validateReceipt({ ...receipt, purposes: receipt.purposes.map((purpose) => ({ ...purpose, providerStatus: "refunded", status: "PASS" })) }).errors.includes("PURPOSE_MUST_NOT_RUN"), true);
  assert.equal(validateReceipt({
    ...receipt,
    fixturePreflight: { ...receipt.fixturePreflight, requests: 1, responseAccepted: true, buyerOrderReady: true, platformSubscriptionReady: true, invoicePaymentReady: true },
  }).errors.includes("OWNER_WITHOUT_FIXTURES"), true);
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

function mockResponse(url, status, { cookies = [], location, json, extraHeaders = {} } = {}) {
  const headers = new Headers();
  if (location) headers.set("location", location);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  let body = { cancel: async () => undefined };
  if (json !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
    body = new Response(JSON.stringify(json)).body;
  }
  return {
    url,
    status,
    body,
    headers: {
      has: (name) => headers.has(name),
      get: (name) => headers.get(name),
      getSetCookie: () => cookies,
    },
  };
}

const readyFixtures = {
  ready: true,
  buyerOrder: true,
  platformSubscription: true,
  invoicePayment: true,
};

const readyFixtureSetup = {
  ready: true,
  createdCount: 6,
  reusedCount: 0,
};

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

function successfulWp4Fetch(requests) {
  const ownerFetch = successfulOwnerFetch(requests);
  return async (url, options) => {
    if (url.endsWith("/wp4-fixture")) {
      requests.push({ url, options });
      return mockResponse(url, 200, { json: readyFixtureSetup });
    }
    if (url.endsWith("/wp4-preflight")) {
      requests.push({ url, options });
      return mockResponse(url, 200, { json: readyFixtures });
    }
    return ownerFetch(url, options);
  };
}

test("fixture setup accepts only bounded deterministic counters", async () => {
  const requests = [];
  const setup = await runFixtureSetup(safeEnvironment, successfulWp4Fetch(requests));

  assert.deepEqual(setup, {
    requests: 1,
    outcome: "ACCEPTED",
    responseAccepted: true,
    createdRows: 6,
    reusedRows: 0,
  });
  assert.deepEqual(requests.map(({ url, options }) => [options.method, new URL(url).pathname]), [
    ["POST", "/api/admin/ops/payuni/wp4-fixture"],
  ]);
  assert.equal(Object.hasOwn(requests[0].options, "body"), false);
});

test("fixture setup fails closed for auth, conflict, schema drift and redirects", async () => {
  const cases = [
    [async (url) => mockResponse(url, 401), "AUTHORIZATION_REJECTED"],
    [async (url) => mockResponse(url, 503, { extraHeaders: { "x-celebratedeal-wp4-fixture": "SOURCE_CONFIGURATION_UNAVAILABLE" } }), "SOURCE_CONFIGURATION_UNAVAILABLE"],
    [async (url) => mockResponse(url, 404, { extraHeaders: { "x-celebratedeal-wp4-fixture": "SOURCE_MISMATCH" } }), "SOURCE_MISMATCH"],
    [async (url) => mockResponse(url, 404, { extraHeaders: { "x-celebratedeal-wp4-fixture": "BODY_REJECTED" } }), "BODY_REJECTED"],
    [async (url) => mockResponse(url, 409), "CONFLICT"],
    [async (url) => mockResponse(url, 200, { json: { ...readyFixtureSetup, createdCount: 7 } }), "RESPONSE_INVALID"],
    [async (url) => mockResponse(url, 302, { location: "https://production.example.com" }), "HTTP_REJECTED"],
  ];
  for (const [fetchImpl, outcome] of cases) {
    const setup = await runFixtureSetup(safeEnvironment, fetchImpl);
    assert.equal(setup.outcome, outcome);
    assert.equal(setup.responseAccepted, false);
    assert.equal(JSON.stringify(setup).includes("production.example.com"), false);
  }
});

test("fixture preflight accepts only the exact fixed boolean projection", async () => {
  const requests = [];
  const fixture = await runFixturePreflight(safeEnvironment, successfulWp4Fetch(requests));

  assert.deepEqual(fixture, {
    requests: 1,
    outcome: "ACCEPTED",
    responseAccepted: true,
    buyerOrderReady: true,
    platformSubscriptionReady: true,
    invoicePaymentReady: true,
  });
  assert.deepEqual(requests.map(({ url, options }) => [options.method, new URL(url).pathname]), [
    ["POST", "/api/admin/ops/payuni/wp4-preflight"],
  ]);
  assert.equal(Object.hasOwn(requests[0].options, "body"), false);
});

test("fixture preflight fails closed for redirect, schema drift and oversized output", async () => {
  const redirect = await runFixturePreflight(safeEnvironment, async (url) => mockResponse(url, 302, {
    location: "https://production.example.com",
  }));
  const drift = await runFixturePreflight(safeEnvironment, async (url) => mockResponse(url, 200, {
    json: { ...readyFixtures, identifier: "must-not-persist" },
  }));
  const oversized = await runFixturePreflight(safeEnvironment, async (url) => mockResponse(url, 200, {
    json: { ...readyFixtures, padding: "x".repeat(1_100) },
  }));

  for (const [result, outcome] of [
    [redirect, "HTTP_REJECTED"],
    [drift, "RESPONSE_INVALID"],
    [oversized, "NETWORK_FAILED"],
  ]) {
    assert.deepEqual(result, {
      requests: 1,
      outcome,
      responseAccepted: false,
      buyerOrderReady: false,
      platformSubscriptionReady: false,
      invoicePaymentReady: false,
    });
    assert.equal(JSON.stringify(result).includes("must-not-persist"), false);
    assert.equal(JSON.stringify(result).includes("production.example.com"), false);
  }
});

test("fixture preflight persists only a closed HTTP failure classification", async () => {
  const cases = [
    [401, "AUTHORIZATION_REJECTED"],
    [404, "DISABLED_OR_FIXTURE_UNAVAILABLE"],
    [503, "CONFIGURATION_UNAVAILABLE"],
    [429, "HTTP_REJECTED"],
  ];

  for (const [status, outcome] of cases) {
    const result = await runFixturePreflight(
      safeEnvironment,
      async (url) => mockResponse(url, status),
    );
    assert.equal(result.outcome, outcome);
    assert.equal(result.responseAccepted, false);
    assert.equal(JSON.stringify(result).includes(String(status)), false);
  }
});

test("fixture preflight accepts only closed authenticated 404 classifications", async () => {
  for (const outcome of ["EXECUTOR_DISABLED", "FIXTURE_UNAVAILABLE"]) {
    const result = await runFixturePreflight(
      safeEnvironment,
      async (url) => mockResponse(url, 404, {
        extraHeaders: { "x-celebratedeal-wp4-preflight": outcome },
      }),
    );
    assert.equal(result.outcome, outcome);
  }

  const rejected = await runFixturePreflight(
    safeEnvironment,
    async (url) => mockResponse(url, 404, {
      extraHeaders: { "x-celebratedeal-wp4-preflight": "raw-fixture-identifier" },
    }),
  );
  assert.equal(rejected.outcome, "DISABLED_OR_FIXTURE_UNAVAILABLE");
  assert.equal(JSON.stringify(rejected).includes("raw-fixture-identifier"), false);
});

test("WP4 child verifies fixtures before creating one bounded owner session", async () => {
  const requests = [];
  const result = await runWp4Child(safeEnvironment, successfulWp4Fetch(requests));

  assert.equal(result.fixturePreflight.responseAccepted, true);
  assert.equal(result.fixtureSetup.responseAccepted, true);
  assert.equal(result.ownerSession.invoicesProbeAuthenticated, true);
  assert.deepEqual(requests.map(({ url, options }) => [options.method, new URL(url).pathname]), [
    ["POST", "/api/admin/ops/payuni/wp4-fixture"],
    ["POST", "/api/admin/ops/payuni/wp4-preflight"],
    ["POST", "/api/admin/ops/payuni/wp4-session"],
    ["GET", "/billing/plans"],
    ["GET", "/billing/invoices"],
  ]);
});

test("WP4 child does not create a session when fixture preflight is unconfirmed", async () => {
  const requests = [];
  const result = await runWp4Child(safeEnvironment, async (url, options) => {
    requests.push({ url, options });
    return mockResponse(url, 404);
  });

  assert.equal(result.fixturePreflight.responseAccepted, false);
  assert.equal(result.ownerSession.sessionCreationAttempts, 0);
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
    "/api/admin/ops/payuni/wp4-fixture",
  ]);
});

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
  receipt.fixtureSetup = await runFixtureSetup(safeEnvironment, successfulWp4Fetch([]));
  receipt.fixturePreflight = await runFixturePreflight(safeEnvironment, successfulWp4Fetch([]));
  receipt.ownerSession = await runOwnerSession(safeEnvironment, successfulOwnerFetch([]));
  receipt.sideEffects.fixtureSetupAttempts = 1;
  receipt.sideEffects.fixtureRowsCreated = 6;
  receipt.sideEffects.fixtureRowsReused = 0;
  receipt.sideEffects.sessionCreationAttempts = 1;
  receipt.sideEffects.sessionCreationOutcome = "CONFIRMED";
  receipt.sideEffects.sessionRowsCreated = 1;
  receipt.sideEffects.sessionTtlSeconds = 900;
  receipt.prerequisites.gaps = [...OWNER_SESSION_COMPLETE_GAPS];
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });

  const unbound = createInitialReceipt(sha);
  unbound.fixturePreflight = receipt.fixturePreflight;
  unbound.ownerSession = receipt.ownerSession;
  unbound.sideEffects = { ...receipt.sideEffects };
  unbound.prerequisites.gaps = [...OWNER_SESSION_COMPLETE_GAPS];
  assert.equal(validateReceipt(unbound).errors.includes("CHILD_WITHOUT_LINEAGE"), true);

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
  markChildAttemptUnknown(receipt);
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(receipt.fixtureSetup.responseAccepted, null);
  assert.equal(receipt.fixturePreflight.responseAccepted, false);
  assert.equal(receipt.ownerSession.sessionCreationOutcome, "NOT_ATTEMPTED");
  assert.deepEqual(receipt.prerequisites.gaps, FIXED_PREREQUISITE_GAPS);
});

test("invalid child output preserves the parent-level unknown attempt projection", () => {
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
  markChildAttemptUnknown(receipt);

  assert.equal(parseChildOutput("", 1).ok, false);
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(receipt.fixtureSetup.responseAccepted, null);
  assert.equal(receipt.sideEffects.fixtureRowsCreated, null);
  assert.equal(receipt.sideEffects.sessionCreationOutcome, "NOT_ATTEMPTED");
});

test("receipt rejects a session attempt when fixture preflight never ran", () => {
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

  assert.equal(validateReceipt(receipt).errors.includes("OWNER_WITHOUT_FIXTURES"), true);
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

test("sterile child output accepts exactly one canonical preflight and owner projection", async () => {
  const childResult = await runWp4Child(safeEnvironment, successfulWp4Fetch([]));
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify(childResult)}\n`, 2).ok, true);
  assert.equal(parseChildOutput(`noise\nSECURE_WP4_RESULT:${JSON.stringify(childResult)}\n`, 2).ok, false);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify(childResult)}\n`, 0).ok, false);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify({ ...childResult, cookie: "leak" })}\n`, 2).ok, false);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify({
    fixtureSetup: childResult.fixtureSetup,
    fixturePreflight: childResult.fixturePreflight,
    ownerSession: createInitialReceipt(sha).ownerSession,
  })}\n`, 2).ok, false);
});

test("runner cannot load provider fixtures, Prisma, or create external payment side effects", () => {
  const source = fs.readFileSync(new URL("./secure-staging-wp4-payuni.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /payuni-fixtures|@prisma\/client|queryPayment|refundPayment|createCheckoutSession/u);
  assert.match(source, /\/api\/health/u);
  assert.doesNotMatch(source, /sandbox-api\.payuni\.com\.tw/u);
  assert.doesNotMatch(source, /Object\.(?:keys|entries)\(process\.env\)/u);
  assert.doesNotMatch(source, /\.json\(\)|\.text\(\)/u);
  assert.match(source, /spawnSyncImpl\(process\.execPath/u);
  assert.match(source, /PAYUNI_SANDBOX_ONETIME_CARD_NO/u);
  assert.match(source, /FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE/u);
});
