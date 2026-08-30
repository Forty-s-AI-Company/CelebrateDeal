import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACT, expectedCells, scoreEligible, validateReceipt } from "./wp193-staging-ux-matrix-receipt.mjs";

function baseReceipt() {
  return {
    schemaVersion: "wp193-staging-ux-matrix/v1", status: "WP193_COMPLETE_CANDIDATE",
    versionGate: { status: "PASS" },
    browser: { automationControl: "AVAILABLE", authenticatedSession: "VALID", axeExecution: "PASS" },
    ownership: { preserveOnly: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: true },
    attempts: { versionInspect: 1, versionMarker: 1, chromeConnect: 1, matrixCells: 8, axeStart: 1 },
    matrix: { expected: 8, completed: 8, cells: expectedCells().map((key) => { const [surface, viewport] = key.split(":"); return { surface, viewport, pass: true, seriousOrCritical: 0, overflowPx: 0, focusPass: true, semanticPass: true, errorRecoveryPass: true }; }) },
    sideEffects: { versionReadOnlyOperations: 2, browserNavigationGets: 8, formSubmits: 0, dataWrites: 0, databaseOperations: 0, providerOperations: 0, productionOperations: 0, deploymentMutations: 0, aliasMutations: 0, environmentMutations: 0, dnsMutations: 0, gitMutations: 0 },
    safety: { cookieRead: false, localStorageRead: false, credentialRead: false, rawHtmlPersisted: false, rawAxePersisted: false, rawDomPersisted: false, rawUrlPersisted: false, screenshotsPersisted: false },
    scoreImpact: { CAT06: { before: 7, after: 7.5 }, total: { before: 73, after: 73.5 }, applied: false },
  };
}

test("contract requires four surfaces across two viewports", () => {
  assert.equal(CONTRACT.expectedCellCount, 8);
  assert.deepEqual(expectedCells(), ["home:desktop", "home:mobile", "login:desktop", "login:mobile", "admin_billing:desktop", "admin_billing:mobile", "error_recovery:desktop", "error_recovery:mobile"]);
});

test("full matrix with freshness, authentication and axe is score eligible", () => {
  const receipt = baseReceipt();
  assert.equal(scoreEligible(receipt), true);
  assert.deepEqual(validateReceipt(receipt).errors, []);
});

test("missing cell, axe gap, accessibility issue and overflow all fail closed", () => {
  for (const mutate of [
    (r) => { r.matrix.cells.pop(); r.matrix.completed = 7; },
    (r) => { r.browser.axeExecution = "BLOCKED"; },
    (r) => { r.matrix.cells[0].seriousOrCritical = 1; },
    (r) => { r.matrix.cells[0].overflowPx = 2; },
  ]) {
    const receipt = baseReceipt(); mutate(receipt);
    assert.equal(scoreEligible(receipt), false);
  }
});

test("Chrome extension UI blocker preserves version gate and zero matrix without score", () => {
  const receipt = baseReceipt();
  receipt.status = "CHROME_AUTOMATION_BLOCKED_BY_EXTENSION_UI";
  receipt.browser.automationControl = "BLOCKED_EXTENSION_UI";
  receipt.browser.authenticatedSession = "UNVERIFIED";
  receipt.browser.axeExecution = "NOT_STARTED";
  receipt.attempts.matrixCells = 1;
  receipt.attempts.axeStart = 0;
  receipt.matrix.completed = 0;
  receipt.matrix.cells = [];
  receipt.sideEffects.browserNavigationGets = 1;
  receipt.scoreImpact = { CAT06: { before: 7, after: 7 }, total: { before: 73, after: 73 }, applied: false };
  assert.equal(scoreEligible(receipt), false);
  assert.deepEqual(validateReceipt(receipt).errors, []);
});

test("attempt overflow, forbidden side effect and raw URL are rejected", () => {
  const receipt = baseReceipt();
  receipt.attempts.matrixCells = 17;
  receipt.sideEffects.formSubmits = 1;
  receipt.rawUrl = "https://example.invalid";
  const errors = validateReceipt(receipt).errors;
  assert.ok(errors.includes("ATTEMPT_BUDGET"));
  assert.ok(errors.includes("COMPLETE_GATE"));
  assert.ok(errors.includes("LEAK_TEXT"));
});
