import assert from "node:assert/strict";
import test from "node:test";

import { expectedCells, scoreEligible, validateReceipt } from "./wp194-staging-ux-matrix-receipt.mjs";

function baseReceipt() {
  return {
    schemaVersion: "wp194-staging-ux-matrix/v1",
    status: "WP194_COMPLETE_CANDIDATE",
    versionGate: { status: "PASS" },
    browser: { automationControl: "AVAILABLE", authenticatedSession: "VALID", axeExecution: "PASS", sessionFinalized: true },
    ownership: { preserveOnly: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: true },
    attempts: { versionInspect: 1, versionMarker: 1, chromeConnect: 1, navigation: 1, matrixCells: 8, axeStart: 8 },
    matrix: {
      expected: 8,
      completed: 8,
      cells: expectedCells().map((key) => {
        const [surface, viewport] = key.split(":");
        return { surface, viewport, pass: true, seriousOrCritical: 0, overflowPx: 0, focusPass: true, semanticPass: true, errorRecoveryPass: true };
      }),
    },
    sideEffects: { versionReadOnlyOperations: 2, browserNavigationGets: 8, formSubmits: 0, dataWrites: 0, databaseOperations: 0, providerOperations: 0, productionOperations: 0, deploymentMutations: 0, aliasMutations: 0, environmentMutations: 0, dnsMutations: 0, gitMutations: 0 },
    safety: { cookieRead: false, localStorageRead: false, credentialRead: false, rawHtmlPersisted: false, rawAxePersisted: false, rawDomPersisted: false, rawUrlPersisted: false, screenshotsPersisted: false },
    scoreImpact: { CAT06: { before: 7, after: 7.5 }, total: { before: 73, after: 73.5 }, applied: false },
  };
}

test("contract defines four surfaces across desktop and mobile", () => {
  assert.equal(expectedCells().length, 8);
  assert.equal(new Set(expectedCells()).size, 8);
});

test("complete safe matrix is score eligible", () => {
  const receipt = baseReceipt();
  assert.equal(scoreEligible(receipt), true);
  assert.deepEqual(validateReceipt(receipt).errors, []);
});

test("Chrome control timeout fails closed without score", () => {
  const receipt = baseReceipt();
  receipt.status = "CHROME_CONTROL_TIMEOUT";
  receipt.browser.automationControl = "UNRELIABLE_TIMEOUT";
  receipt.browser.authenticatedSession = "UNVERIFIED";
  receipt.browser.axeExecution = "NOT_STARTED";
  receipt.attempts.matrixCells = 0;
  receipt.attempts.axeStart = 0;
  receipt.matrix.completed = 0;
  receipt.matrix.cells = [];
  receipt.scoreImpact = { CAT06: { before: 7, after: 7 }, total: { before: 73, after: 73 }, applied: false };
  const checked = validateReceipt(receipt);
  assert.equal(checked.ok, true);
  assert.equal(checked.scoreEligible, false);
});

test("matrix gap, axe gap and accessibility issue are not score eligible", () => {
  const missing = baseReceipt();
  missing.matrix.cells.pop();
  missing.matrix.completed = 7;
  assert.equal(scoreEligible(missing), false);
  const axe = baseReceipt();
  axe.browser.axeExecution = "NOT_STARTED";
  assert.equal(scoreEligible(axe), false);
  const issue = baseReceipt();
  issue.matrix.cells[0].seriousOrCritical = 1;
  assert.equal(scoreEligible(issue), false);
});

test("attempt overflow, forbidden mutation and raw URL are rejected", () => {
  const attempts = baseReceipt();
  attempts.attempts.navigation = 2;
  assert.equal(validateReceipt(attempts).errors.includes("ATTEMPT_BUDGET"), true);
  const mutation = baseReceipt();
  mutation.sideEffects.dataWrites = 1;
  assert.equal(scoreEligible(mutation), false);
  const leak = baseReceipt();
  leak.note = "https://example.invalid/private";
  assert.equal(validateReceipt(leak).errors.includes("LEAK_TEXT"), true);
});
