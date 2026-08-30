import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CLASSIFICATIONS, auditBoundary, extractImportChain, normalizeDiagnostic, sanitize } from "./wp126-build-boundary-auditor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("WP-126 contract is read-only and new-owned", () => {
  const contract = JSON.parse(fs.readFileSync(path.join(root, "docs/launch/wp126-build-boundary-audit-contract.json"), "utf8"));
  assert.equal(contract.work_package, "WP-126");
  assert.equal(contract.receipt_policy.raw_stderr, false);
  assert.equal(contract.score_gate.score_delta, 0);
});
test("normalizes build phase, diagnostic code and repository-relative path", () => {
  const result = normalizeDiagnostic("Failed to compile: C:\\work\\src\\app\\page.tsx Type error", root);
  assert.equal(result.phase, "typecheck-or-webpack");
  assert.ok(result.diagnosticCodes.includes("TYPE_ERROR"));
  assert.deepEqual(result.relativePaths, ["src/app/page.tsx"]);
  assert.equal(result.rawPersisted, false);
});

test("masks absolute paths, URLs, ANSI and quoted values", () => {
  const value = sanitize("\u001b[31mC:\\Users\\eden\\secret.ts https://private.invalid/a 'value' JOB_SECRET=abc");
  assert.equal(value.includes("C:\\Users"), false);
  assert.equal(value.includes("https://private"), false);
  assert.equal(value.includes("'value'"), false);
  assert.equal(value.includes("abc"), false);
});

test("classifies tracked clean and dirty exact paths", () => {
  const clean = auditBoundary({ output: "Failed to compile src/app/page.tsx Type error", workspaceRoot: root, pathMetadata: { "src/app/page.tsx": { dirty: false } }, fingerprintStable: true });
  const dirty = auditBoundary({ output: "Failed to compile src/app/page.tsx Type error", workspaceRoot: root, pathMetadata: { "src/app/page.tsx": { dirty: true } }, fingerprintStable: true });
  assert.equal(clean.classification, CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE);
  assert.equal(dirty.classification, CLASSIFICATIONS.PRESERVE_ONLY_EXACT_PATH);
});

test("classifies config, dependency and generated boundaries", () => {
  assert.equal(auditBoundary({ output: "Invalid next.config.ts", workspaceRoot: root, pathMetadata: { "next.config.ts": { dirty: false } }, fingerprintStable: true }).classification, CLASSIFICATIONS.CONFIG_BOUNDARY);
  assert.equal(auditBoundary({ output: "Cannot find module node_modules/next/index.js", workspaceRoot: root, pathMetadata: { "node_modules/next/index.js": { dirty: false } }, fingerprintStable: true }).classification, CLASSIFICATIONS.DEPENDENCY_OR_LOCKFILE_BOUNDARY);
  assert.equal(auditBoundary({ output: "Failed to compile .next/types/app.d.ts Type error", workspaceRoot: root, pathMetadata: { ".next/types/app.d.ts": { dirty: false } }, fingerprintStable: true }).classification, CLASSIFICATIONS.GENERATED_ARTIFACT_BOUNDARY);
});

test("conflicting or missing signals fail closed", () => {
  assert.equal(auditBoundary({ output: "unexpected failure", workspaceRoot: root, fingerprintStable: true }).classification, CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(auditBoundary({ output: "Cannot find module src/app/page.tsx Type error", workspaceRoot: root, pathMetadata: { "src/app/page.tsx": { dirty: false } }, fingerprintStable: true }).classification, CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(auditBoundary({ output: "Failed to compile src/app/page.tsx Type error", workspaceRoot: root, pathMetadata: { "src/app/page.tsx": { dirty: false } }, fingerprintStable: false }).classification, CLASSIFICATIONS.NONDETERMINISTIC_FAILURE);
});

test("import chain is deterministic and stores paths only", () => {
  const chain = extractImportChain("scripts/wp126-build-boundary-auditor.mjs", root, 1);
  assert.ok(chain.includes("scripts/wp126-build-boundary-auditor.mjs"));
  assert.equal(chain.some((item) => item.includes(".env")), false);
});
