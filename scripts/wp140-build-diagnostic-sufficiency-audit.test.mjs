import assert from "node:assert/strict";
import test from "node:test";
import { CLASSIFICATIONS, evaluateEvidence, validateSanitizedReceipt } from "./wp140-build-diagnostic-sufficiency-audit.mjs";

function receipt(overrides = {}) {
  const base = {
    classification: "LOCAL_ISOLATED_NEXT_BUILD_EXACT_NO_GO",
    build: {
      attempts: 1,
      exitCode: 1,
      markers: { pass: false },
      rawOutputPersisted: false,
      ...overrides.build,
    },
    protectedInputs: { unchanged: true, before: { package: "a" }, after: { package: "a" } },
    repositoryNext: { unchanged: true, contentReads: 0 },
    cleanup: { tempMirrorRemoved: true },
    dirtyInventory: { unchanged: true },
    ownership: { stagedIndexEmpty: true },
  };
  return { ...base, ...overrides, build: { ...base.build, ...overrides.build } };
}

test("accepts a complete reviewable contract without authorizing more than one candidate", () => {
  const result = evaluateEvidence({
    receipt: receipt({ build: { normalizedPhase: "compile", errorFamily: "TYPECHECK", errorCode: "TS9999", currentNormalizedRelativePath: "src/app/example.ts", symbol: "handler", span: { start: 1, end: 2 } } }),
    ownership: { unknown: 0, mixedHunks: 0 },
    staged: true,
  });
  assert.equal(result.classification, CLASSIFICATIONS.REVIEWABLE);
  assert.equal(result.candidatePath, "src/app/example.ts");
  assert.equal(result.candidateSymbol, "handler");
  assert.equal(result.authorizedHunkCount, 1);
});

for (const [label, buildPatch] of [
  ["phase", { errorFamily: "TYPECHECK", errorCode: "TS9999", currentNormalizedRelativePath: "src/app/example.ts", symbol: "handler" }],
  ["family", { normalizedPhase: "compile", errorCode: "TS9999", currentNormalizedRelativePath: "src/app/example.ts", symbol: "handler" }],
  ["code", { normalizedPhase: "compile", errorFamily: "TYPECHECK", currentNormalizedRelativePath: "src/app/example.ts", symbol: "handler" }],
  ["path", { normalizedPhase: "compile", errorFamily: "TYPECHECK", errorCode: "TS9999", symbol: "handler" }],
  ["symbol", { normalizedPhase: "compile", errorFamily: "TYPECHECK", errorCode: "TS9999", currentNormalizedRelativePath: "src/app/example.ts" }],
]) {
  test(`missing ${label} is an exact no-go`, () => {
    const result = evaluateEvidence({ receipt: receipt({ build: buildPatch }), ownership: { unknown: 0, mixedHunks: 0 }, staged: true });
    assert.equal(result.classification, CLASSIFICATIONS.EXACT_NO_GO);
    assert.equal(result.candidatePath, null);
    assert.equal(result.authorizedHunkCount, 0);
  });
}

test("digest lineage mismatch cannot authorize a candidate", () => {
  const result = evaluateEvidence({
    receipt: receipt({ protectedInputs: { unchanged: false, before: { package: "a" }, after: { package: "b" } }, build: { normalizedPhase: "compile", errorFamily: "TYPECHECK", errorCode: "TS9999", currentNormalizedRelativePath: "src/app/example.ts", symbol: "handler" } }),
    ownership: { unknown: 0, mixedHunks: 0 },
    staged: true,
  });
  assert.equal(result.classification, CLASSIFICATIONS.EXACT_NO_GO);
  assert.equal(result.missing.includes("digestLineage"), true);
});

test("opaque fingerprint and historical references never map a candidate", () => {
  const result = evaluateEvidence({
    receipt: receipt({ build: { outputSha256: "opaque", normalizedPhase: null, errorFamily: null, errorCode: null } }),
    ownership: { unknown: 0, mixedHunks: 0 },
    staged: true,
    historicalReference: true,
  });
  assert.equal(result.classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(result.candidatePath, null);
});

test("unknown or mixed ownership fails closed", () => {
  const build = { normalizedPhase: "compile", errorFamily: "TYPECHECK", errorCode: "TS9999", currentNormalizedRelativePath: "src/app/example.ts", symbol: "handler" };
  assert.equal(evaluateEvidence({ receipt: receipt({ build }), ownership: { unknown: 1, mixedHunks: 0 }, staged: true }).classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(evaluateEvidence({ receipt: receipt({ build }), ownership: { unknown: 0, mixedHunks: 1 }, staged: true }).classification, CLASSIFICATIONS.UNKNOWN);
});

test("sanitizer rejects raw fields, absolute paths and URLs", () => {
  assert.equal(validateSanitizedReceipt({ rawStdout: "error" }).valid, false);
  assert.equal(validateSanitizedReceipt({ path: "C:\\Users\\eden\\file.ts" }).valid, false);
  assert.equal(validateSanitizedReceipt({ url: "https://example.invalid" }).valid, false);
  assert.equal(validateSanitizedReceipt({ sanitized: true, outputSha256: "opaque" }).valid, true);
});
