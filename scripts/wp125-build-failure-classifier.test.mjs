import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CLASSIFICATIONS, classifyFailure, classifyReceipt, sanitizeOutput } from "./wp125-build-failure-classifier.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("WP-125 contract is new-owned and fail-closed", () => {
  const contract = JSON.parse(fs.readFileSync(path.join(root, "docs/launch/wp125-build-failure-classification-contract.json"), "utf8"));
  assert.equal(contract.work_package, "WP-125");
  assert.deepEqual(contract.classifications, Object.values(CLASSIFICATIONS));
  assert.equal(contract.receipt_policy.raw_stderr, false);
  assert.equal(contract.score_gate.preawarded, false);
});
test("classifies unknown environment names as synthetic environment contract", () => {
  assert.equal(classifyFailure({ buildExitCode: 1, unknownEnvironmentNames: ["UNKNOWN_BUILD_FLAG"], junctionStable: true }).classification, CLASSIFICATIONS.SYNTHETIC_ENV_CONTRACT);
});

test("classifies missing safe source as mirror completeness", () => {
  assert.equal(classifyFailure({ buildExitCode: 1, requiredInputsMissing: ["src/app/page.tsx"], junctionStable: true }).classification, CLASSIFICATIONS.MIRROR_COMPLETENESS);
});

test("classifies module resolution and junction drift", () => {
  assert.equal(classifyFailure({ buildExitCode: 1, moduleResolutionFailed: true }).classification, CLASSIFICATIONS.NODE_MODULES_JUNCTION);
  assert.equal(classifyFailure({ buildExitCode: 1, junctionStable: false }).classification, CLASSIFICATIONS.NODE_MODULES_JUNCTION);
});

test("classifies independent typecheck failure outside runner ownership", () => {
  const result = classifyFailure({ buildExitCode: 1, typecheckExitCode: 1, junctionStable: true });
  assert.equal(result.classification, CLASSIFICATIONS.MANIFESTED_WORKSPACE_COMPILE);
  assert.equal(result.owner, "PRESERVE_ONLY application or manifested source");
});

test("classifies a bounded Next/Webpack failure only when independent typecheck passes", () => {
  const result = classifyFailure({ buildExitCode: 1, typecheckExitCode: 0, buildOutput: "Failed to compile: build worker exited with code 1", junctionStable: true });
  assert.equal(result.classification, CLASSIFICATIONS.NEXT_WEBPACK_BOUNDARY);
});

test("ambiguous non-zero build fails closed", () => {
  assert.equal(classifyFailure({ buildExitCode: 1, typecheckExitCode: 0, buildOutput: "something unexpected", junctionStable: true }).classification, CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});

test("success is never inferred from a non-zero build", () => {
  const result = classifyFailure({ buildExitCode: 0, typecheckExitCode: 0, buildOutput: "BUILD_ID present", junctionStable: true });
  assert.equal(result.classification, CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});

test("sanitizes paths, URLs, ANSI and quoted values", () => {
  const sanitized = sanitizeOutput("\u001b[31mError\u001b[0m C:\\workspace\\file.ts https://private.invalid/a 'value'");
  assert.equal(sanitized.includes("C:\\workspace"), false);
  assert.equal(sanitized.includes("https://private"), false);
  assert.equal(sanitized.includes("'value'"), false);
});

test("receipt never stores raw output and records only digest", () => {
  const receipt = classifyReceipt({ buildExitCode: 1, typecheckExitCode: 0, buildOutput: "Failed to compile: C:\\private\\file.ts", junctionStable: true });
  assert.equal(receipt.rawOutputPersisted, false);
  assert.equal(Object.hasOwn(receipt, "buildOutput"), false);
  assert.match(receipt.sanitizedOutputDigest, /^[a-f0-9]{64}$/);
});
