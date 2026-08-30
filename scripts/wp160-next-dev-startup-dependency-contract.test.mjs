import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTRYPOINTS,
  PHASES,
  RISK_FAMILIES,
  analyzeSource,
  analyzeStartupGraph,
  canonical,
  initialReceipt,
  resolveImport,
  validateReceipt,
} from "./wp160-next-dev-startup-dependency-contract.mjs";

test("bounded enums and receipt are strict and sanitized", () => {
  assert.equal(ENTRYPOINTS.includes("next.config.ts"), true);
  assert.deepEqual(PHASES, ["MODULE_EVALUATION", "REQUEST_TIME", "UNKNOWN"]);
  assert.equal(RISK_FAMILIES.length, 9);
  assert.equal(validateReceipt(initialReceipt()), true);
  assert.equal(canonical({ z: 1, a: 2 }), canonical({ a: 2, z: 1 }));
});

test("module-scope environment access is eager while function access is deferred", () => {
  const result = analyzeSource("fixture.ts", "const x = process.env.SYNTHETIC; export function f() { return process.env.LAZY; }");
  const eager = result.findings.filter((finding) => finding.family === "EAGER_REQUIRED_ENV_ACCESS");
  const deferred = result.findings.filter((finding) => finding.family === "DEFERRED_REQUEST_TIME_DEPENDENCY");
  assert.equal(eager.length >= 1, true);
  assert.equal(deferred.length >= 1, true);
  assert.equal(JSON.stringify(result.findings).includes("SYNTHETIC"), false);
});

test("module-scope database and network operations are distinct risks", () => {
  const result = analyzeSource("fixture.ts", "const db = new PrismaClient(); fetch('/synthetic'); function later() { db.query('x'); fetch('/lazy'); }");
  assert.equal(result.findings.some((finding) => finding.family === "EAGER_DATABASE_CONNECT_OR_MUTATION"), true);
  assert.equal(result.findings.some((finding) => finding.family === "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY"), true);
  assert.equal(result.findings.some((finding) => finding.family === "DEFERRED_REQUEST_TIME_DEPENDENCY"), true);
});

test("dynamic import is indeterminate and type-only import is excluded", () => {
  const result = analyzeSource("fixture.ts", "import type { Foo } from './missing'; const p = import(pathName);");
  assert.equal(result.imports.some((item) => item.typeOnly), true);
  assert.equal(result.findings.some((finding) => finding.family === "STATIC_ANALYSIS_INDETERMINATE"), true);
});

test("config wrapper receives separate side-effect classification", () => {
  const result = analyzeSource("next.config.ts", "const config = {}; export default withSentryConfig(config);");
  assert.equal(result.findings.some((finding) => finding.family === "CONFIG_EVALUATION_SIDE_EFFECT"), true);
});

test("runtime import resolution never evaluates product modules", () => {
  assert.equal(resolveImport("src/app/page.tsx", "@/lib/auth") !== null, true);
  assert.equal(resolveImport("src/app/page.tsx", "node:fs"), "EXTERNAL_BUILTIN");
  assert.equal(resolveImport("src/app/page.tsx", "./does-not-exist"), null);
});

test("unresolved static imports remain a finding candidate without module evaluation", () => {
  const result = analyzeSource("fixture.ts", "import { missing } from './not-present'; export const value = missing;");
  assert.equal(result.imports[0].specifier, "./not-present");
  assert.equal(resolveImport("fixture.ts", result.imports[0].specifier), null);
  assert.equal(result.findings.some((finding) => finding.family === "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY"), false);
});

test("client-only modules are identified for graph exclusion", () => {
  const result = analyzeSource("fixture.tsx", '"use client"; export function Widget() { return fetch("/lazy"); }');
  assert.equal(result.clientOnly, true);
  assert.equal(result.findings.some((finding) => finding.family === "DEFERRED_REQUEST_TIME_DEPENDENCY"), true);
});

test("generated artifact references are never silently trusted", () => {
  const result = analyzeSource("fixture.ts", "import value from './.next/server/app/page'; export default value;");
  assert.equal(result.imports[0].specifier.includes(".next"), true);
  assert.equal(resolveImport("fixture.ts", result.imports[0].specifier), "GENERATED_ARTIFACT");
});

test("telemetry configuration and request-time dependencies preserve phase", () => {
  const result = analyzeSource("fixture.ts", "const telemetry = Sentry.init({}); export function action() { return fetch('/later'); }");
  assert.equal(result.findings.some((finding) => finding.family === "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY"), true);
  assert.equal(result.findings.some((finding) => finding.family === "DEFERRED_REQUEST_TIME_DEPENDENCY"), true);
});

test("cycles and duplicate findings remain bounded and deterministic", () => {
  const result = analyzeSource("fixture.ts", "import './fixture'; const value = process.env.VALUE;");
  const again = analyzeSource("fixture.ts", "import './fixture'; const value = process.env.VALUE;");
  assert.deepEqual(result.findings, again.findings);
});

test("WP-158 failure boundary is not inferred as root cause", () => {
  const receipt = initialReceipt();
  receipt.wp158Boundary = { exitFamily: "NONZERO_EXIT_BEFORE_READY", rootCauseInferred: true };
  assert.throws(() => validateReceipt(receipt), /WP160_ROOT_CAUSE_INFERENCE_FORBIDDEN/);
});

test("receipt rejects snippets, URLs, raw AST and score mutation", () => {
  const receipt = initialReceipt();
  receipt.findings = [{ family: "STATIC_ANALYSIS_INDETERMINATE", code: "X", relativePath: "src/x.ts", symbol: "raw snippet", span: { startLine: 1, endLine: 1 }, evaluationPhase: "UNKNOWN", confidence: "LOW", sourceDigest: `sha256:${"a".repeat(64)}` }];
  assert.throws(() => validateReceipt(receipt), /WP160_FINDING_SENSITIVE/);
  const score = initialReceipt();
  score.scoreImpact.CAT06.after = 7.5;
  assert.throws(() => validateReceipt(score), /WP160_SCORE_MUTATION_FORBIDDEN/);
});

test("all runtime and external side-effect sentinels stay zero", () => {
  const receipt = initialReceipt();
  assert.deepEqual(Object.values(receipt.sideEffects), Object.values(receipt.sideEffects).map(() => 0));
  assert.equal(receipt.graph.rootCauseInferred, false);
});

test("current bounded graph is read-only and does not claim root cause", () => {
  const result = analyzeStartupGraph(["next.config.ts"]);
  assert.equal(result.rootCauseInferred, false);
  assert.equal(["NO_STATIC_STARTUP_BLOCKER", "NEXT_DEV_STARTUP_RISK_CLASSIFIED", "STATIC_ANALYSIS_INDETERMINATE"].includes(result.classification), true);
  assert.equal(result.entrypoints.length >= 1, true);
  assert.equal(result.entrypoints.every((entry) => entry.ownership === "PRESERVE_ONLY"), true);
});

test("classifies runtime mirror evidence without touching the filesystem", () => {
  return import("./wp160-next-dev-startup-dependency-contract.mjs").then(({ classifyRuntimeMirror }) => {
    assert.equal(classifyRuntimeMirror({ tempRootClass: "OS_TEMP_MIRROR" }), "OS_TEMP_MIRROR");
    assert.equal(classifyRuntimeMirror({ sourceText: "const root = os.tmpdir(); copyMirror(root, target);" }), "OS_TEMP_MIRROR");
    assert.equal(classifyRuntimeMirror({ tempRootClass: "WORKSPACE" }), "WORKSPACE");
    assert.equal(classifyRuntimeMirror({ sourceText: "const root = workspaceRoot;" }), "UNKNOWN");
    assert.equal(classifyRuntimeMirror(), "UNKNOWN");
  });
});

test("keeps import resolution fail-closed across aliases, packages, and missing paths", () => {
  assert.equal(resolveImport("src/app/page.tsx", "@/lib/auth") !== null, true);
  assert.equal(resolveImport("src/app/page.tsx", "react"), "EXTERNAL_PACKAGE");
  assert.equal(resolveImport("src/app/page.tsx", "./actions"), "src/app/actions.ts");
  assert.equal(resolveImport("src/app/page.tsx", "./not-present"), null);
  assert.equal(resolveImport("src/app/page.tsx", "./.next/server/app/page"), "GENERATED_ARTIFACT");
});

test("bounds dynamic imports and request-time telemetry without evaluating modules", () => {
  const result = analyzeSource("fixture.ts", "export async function load() { const module = await import(); return Sentry.captureMessage('later'); }");
  assert.equal(result.findings.some((finding) => finding.code === "DYNAMIC_IMPORT_UNRESOLVED"), true);
  assert.equal(result.findings.some((finding) => finding.family === "DEFERRED_REQUEST_TIME_DEPENDENCY"), true);
  assert.equal(result.findings.every((finding) => finding.sourceDigest), true);
});

test("source analysis keeps benign modules and built-in resolution outside startup findings", () => {
  const result = analyzeSource("fixture.ts", "import fs from 'node:fs'; export const value = 1;");
  assert.equal(result.findings.some((finding) => finding.family === "NO_STATIC_STARTUP_BLOCKER"), false);
  assert.equal(result.imports[0].specifier, "node:fs");
  assert.equal(result.clientOnly, false);
  assert.equal(resolveImport("src/app/page.tsx", "node:path"), "EXTERNAL_BUILTIN");
  assert.equal(resolveImport("src/app/page.tsx", "@/components/ui"), "src/components/ui.tsx");
  assert.equal(resolveImport("src/app/page.tsx", "@unknown/package"), null);
});

test("startup graph bounds duplicate entrypoints and empty graphs without root-cause claims", () => {
  const empty = analyzeStartupGraph(["missing-entrypoint.ts"]);
  assert.deepEqual(empty.entrypoints, []);
  assert.equal(empty.classification, "NO_STATIC_STARTUP_BLOCKER");
  assert.equal(empty.rootCauseInferred, false);
  const duplicate = analyzeStartupGraph(["next.config.ts", "next.config.ts"]);
  assert.equal(new Set(duplicate.entrypoints.map((entry) => entry.relativePath)).size, duplicate.entrypoints.length);
  assert.equal(duplicate.rootCauseInferred, false);
});
