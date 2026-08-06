import assert from "node:assert/strict";
import test from "node:test";
import { CLASSIFICATIONS, ERROR_FAMILIES, classifyErrorFamily, classifyOwnership, classifyPhase, mapGeneratedToSource, sanitizeDiagnosticText } from "./wp134-next-startup-error-mapper.mjs";

test("normalizes paths and redacts diagnostic values", () => {
  const sanitized = sanitizeDiagnosticText("C:\\Users\\eden\\.env.local TOKEN=secret https://example.invalid postgres://u:p@host/db");
  assert.equal(sanitized.includes("C:\\Users"), false);
  assert.equal(sanitized.includes("secret"), false);
  assert.equal(sanitized.includes("example.invalid"), false);
  assert.equal(sanitized.includes("u:p@host"), false);
});

test("maps generated Next route paths to repository source", () => {
  assert.equal(mapGeneratedToSource(".next/types/app/api/cloudflare/stream-webhook/route.ts"), "src/app/api/cloudflare/stream-webhook/route.ts");
  assert.equal(mapGeneratedToSource(".next/types/other.json"), null);
});

test("classifies error family and phase without overclaiming", () => {
  assert.equal(classifyErrorFamily("Type error: route.ts:12:3"), ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR);
  assert.equal(classifyPhase("Type error: route.ts:12:3", ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR), "TYPECHECK");
  assert.equal(classifyErrorFamily("Cannot find module 'x'"), ERROR_FAMILIES.MODULE_RESOLUTION_FAILURE);
  assert.equal(classifyErrorFamily("unrecognized output"), ERROR_FAMILIES.UNKNOWN);
});

test("requires exact ownership evidence before accepting a candidate", () => {
  assert.equal(classifyOwnership({ source: null, family: ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR, symbol: "POST", line: 12, hunk: { ownership: "PRESERVE_ONLY_DIRTY", overlap: true } }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(classifyOwnership({ source: "src/app/api/cloudflare/stream-webhook/route.ts", family: ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR, symbol: "POST", line: 12, hunk: { ownership: "PRESERVE_ONLY_DIRTY", overlap: true } }), CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO);
  assert.equal(classifyOwnership({ source: "src/app/api/clean/route.ts", family: ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR, symbol: "POST", line: 12, hunk: { ownership: "TRACKED_CLEAN", overlap: false } }), CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE);
});

test("unknown or untracked ownership always fails closed", () => {
  assert.equal(classifyOwnership({ source: "src/app/a.ts", family: ERROR_FAMILIES.UNKNOWN, symbol: "x", line: 1, hunk: { ownership: "TRACKED_CLEAN", overlap: false } }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(classifyOwnership({ source: "src/app/a.ts", family: ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR, symbol: "x", line: 1, hunk: { ownership: "UNTRACKED", overlap: false } }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});

test("covers every supported diagnostic family and phase without running a process", () => {
  const families = [
    ["SyntaxError: unexpected token", ERROR_FAMILIES.JAVASCRIPT_SYNTAX_ERROR, "SERVER_STARTUP"],
    ["TypeError: bad value", ERROR_FAMILIES.JAVASCRIPT_TYPE_ERROR, "SERVER_STARTUP"],
    ["EADDRINUSE: address already in use", ERROR_FAMILIES.PORT_IN_USE, "SERVER_BIND"],
    ["Failed to compile", ERROR_FAMILIES.NEXT_COMPILE_FAILURE, "NEXT_COMPILE"],
    ["PrismaClient configuration", ERROR_FAMILIES.RUNTIME_CONFIGURATION_FAILURE, "SERVER_STARTUP"],
  ];
  for (const [output, family, phase] of families) {
    assert.equal(classifyErrorFamily(output), family);
    assert.equal(classifyPhase(output, family), phase);
  }
  assert.equal(classifyPhase("TypeScript compiler output", ERROR_FAMILIES.UNKNOWN), "TYPECHECK");
  assert.equal(classifyPhase("module resolution failed", ERROR_FAMILIES.MODULE_RESOLUTION_FAILURE), "MODULE_RESOLUTION");
  assert.equal(classifyPhase("compile failed", ERROR_FAMILIES.UNKNOWN), "NEXT_COMPILE");
  assert.equal(classifyPhase("ordinary startup output", ERROR_FAMILIES.UNKNOWN), "SERVER_STARTUP");
});

test("maps only supported generated route roots and rejects malformed path input", () => {
  assert.equal(mapGeneratedToSource(".next/types/pages/account.ts"), "src/pages/account.ts");
  assert.equal(mapGeneratedToSource(".next/types/shared/account.ts"), null);
  assert.equal(mapGeneratedToSource("src/app/page.tsx"), null);
  assert.equal(mapGeneratedToSource(null), null);
});

test("sanitizes nullish and terminal diagnostic markers deterministically", () => {
  assert.equal(sanitizeDiagnosticText(null), "");
  assert.equal(sanitizeDiagnosticText("\u001b[31mDEMO_VALUE=fixture\u001b[0m"), "<env>=<value>");
  assert.equal(sanitizeDiagnosticText("postgresql://fixture:fixture@127.0.0.1/db"), "<database-url>");
});

test("requires complete ownership metadata before accepting a clean candidate", () => {
  assert.equal(classifyOwnership({}), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(classifyOwnership({ source: "src/app/a.ts", family: ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR, symbol: "x", hunk: { ownership: "PRESERVE_ONLY_DIRTY", overlap: false } }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(classifyOwnership({ source: "src/app/a.ts", family: ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR, symbol: "x", hunk: { ownership: "TRACKED_CLEAN", overlap: false } }), CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE);
});
