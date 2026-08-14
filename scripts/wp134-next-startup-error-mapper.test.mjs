import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLASSIFICATIONS,
  ERROR_FAMILIES,
  classifyErrorFamily,
  classifyOwnership,
  classifyPhase,
  currentDirtyInventory,
  environment,
  extractLocation,
  extractPaths,
  findSymbol,
  hunkRanges,
  inspectMirror,
  isForbiddenPath,
  mapGeneratedToSource,
  mirrorFilter,
  normalizePathToken,
  preflight,
  requiredInputs,
  sanitizeDiagnosticText,
  sourceIntegrity,
} from "./wp134-next-startup-error-mapper.mjs";

test("normalizes paths and redacts diagnostic values", () => {
  const sanitized = sanitizeDiagnosticText("C:\\Users\\eden\\.env.local TOKEN=secret https://example.invalid " + ["postgres", "://"].join("") + "u:p@host/db");
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
  assert.equal(sanitizeDiagnosticText(["postgres", "ql://"].join("") + "fixture:fixture@127.0.0.1/db"), "<database-url>");
});

test("requires complete ownership metadata before accepting a clean candidate", () => {
  assert.equal(classifyOwnership({}), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(classifyOwnership({ source: "src/app/a.ts", family: ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR, symbol: "x", hunk: { ownership: "PRESERVE_ONLY_DIRTY", overlap: false } }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(classifyOwnership({ source: "src/app/a.ts", family: ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR, symbol: "x", hunk: { ownership: "TRACKED_CLEAN", overlap: false } }), CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE);
});

test("COV-09 WP134 path and hunk attribution is deterministic", () => {
  const tempRoot = path.join(os.tmpdir(), "wp134-mirror");
  assert.equal(normalizePathToken("C:\\tmp\\mirror\\src\\app\\page.tsx:12:4", "C:\\tmp\\mirror"), "src/app/page.tsx");
  assert.equal(normalizePathToken("/tmp/mirror/.next/types/app/page.ts:4:2", "/tmp/mirror"), ".next/types/app/page.ts");
  assert.equal(normalizePathToken("outside/file.ts", tempRoot), null);
  assert.deepEqual(extractPaths("error at C:\\tmp\\mirror\\.next\\types\\app\\page.ts:12:4", "C:\\tmp\\mirror"), { generatedPath: ".next/types/app/page.ts", sourcePath: "src/app/page.ts" });
  assert.deepEqual(extractLocation("src/app/page.ts:12:4"), { line: 12, column: 4 });
  assert.deepEqual(extractLocation("no location"), { line: null, column: null });
  assert.deepEqual(hunkRanges("@@ -1 +5,2 @@\n@@ -9,3 +20 @@"), [{ start: 5, count: 2 }, { start: 20, count: 1 }]);
  assert.deepEqual(hunkRanges(null), []);
  assert.equal(isForbiddenPath(".env.local"), true);
  assert.equal(isForbiddenPath("nested/private-token.txt"), true);
  assert.equal(isForbiddenPath("nested/file.ts"), false);
  assert.equal(mirrorFilter(process.cwd()), true);
  assert.equal(mirrorFilter(path.join(process.cwd(), ".git")), false);
  assert.equal(mirrorFilter(path.join(process.cwd(), ".env.local")), false);
});

test("COV-09 WP134 mirror inspection and source ownership remain sanitized", () => {
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "wp134-inspect-"));
  try {
    for (const relativePath of requiredInputs) {
      const target = path.join(mirror, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(process.cwd(), relativePath), target);
    }
    fs.writeFileSync(path.join(mirror, ".env.local"), "excluded\n");
    const inspected = inspectMirror(mirror);
    assert.deepEqual(inspected.missing, []);
    assert.deepEqual(inspected.forbiddenCopied, [".env.local"]);
    assert.deepEqual(Object.keys(inspected.sourceDigests).sort(), [...requiredInputs].sort());
    assert.equal(Object.values(inspected.sourceDigests).every((value) => /^[a-f0-9]{64}$/u.test(value)), true);
  } finally {
    fs.rmSync(mirror, { recursive: true, force: true });
  }
  const integrity = sourceIntegrity();
  assert.deepEqual(Object.keys(integrity).sort(), [...requiredInputs].sort());
  assert.equal(Object.values(integrity).every((value) => /^[a-f0-9]{64}$/u.test(value)), true);
  const inventory = currentDirtyInventory();
  assert.equal(Number.isInteger(inventory.count), true);
  assert.equal(/^[a-f0-9]{64}$/u.test(inventory.pathStatusFingerprint), true);
  const preflightResult = preflight();
  assert.equal(preflightResult.stagedIndexEmpty, true);
  assert.equal(preflightResult.inputsPresent, true);
});

test("COV-09 WP134 synthetic environment and source symbol lookup stay bounded", () => {
  const environmentSnapshot = environment(path.join(os.tmpdir(), "wp134-runtime"), 32134);
  assert.equal(environmentSnapshot.NODE_ENV, "development");
  assert.equal(environmentSnapshot.DATABASE_URL.startsWith("postgresql://synthetic:"), true);
  assert.equal(environmentSnapshot.NEXT_PUBLIC_APP_URL, "http://127.0.0.1:32134");
  assert.equal(findSymbol(null, 1), null);
  assert.equal(findSymbol("not-a-real-source.ts", 1), null);
  assert.equal(typeof findSymbol("src/app/api/cloudflare/stream-webhook/route.ts", 120), "string");
});
