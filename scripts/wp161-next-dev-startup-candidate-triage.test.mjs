import assert from "node:assert/strict";
import test from "node:test";
import {
  DISPOSITIONS,
  classifyCandidate,
  syntheticSemanticMatrix,
  validateReceipt,
} from "./wp161-next-dev-startup-candidate-triage.mjs";

function candidate(sourceText, line, overrides = {}) {
  return {
    family: "EAGER_REQUIRED_ENV_ACCESS",
    code: "PROCESS_ENV_ACCESS",
    relativePath: "next.config.ts",
    span: { startLine: line, endLine: line },
    evaluationPhase: "MODULE_EVALUATION",
    ...overrides,
  };
}

test("synthetic semantic matrix covers the bounded disposition rules", () => {
  assert.deepEqual(syntheticSemanticMatrix(), { cases: 14, status: "PASS" });
});

test("module-evaluation required environment assertion is high confidence", () => {
  const result = classifyCandidate(candidate("if (!process.env.REQUIRED) { throw new Error(\"missing\"); }", 1), "if (!process.env.REQUIRED) { throw new Error(\"missing\"); }");
  assert.equal(result.disposition, "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK");
});

test("optional environment comparison is eliminated by explicit fallback", () => {
  const source = 'const enabled = process.env.FLAG === "true";';
  assert.equal(classifyCandidate(candidate(source, 1), source).disposition, "ELIMINATED_SAFE_FALLBACK_PRESENT");
});

test("function and callback environment access is not startup eager", () => {
  const functionSource = "function read() { return process.env.FLAG; }";
  const callbackSource = "const read = () => process.env.FLAG;";
  assert.equal(classifyCandidate(candidate(functionSource, 1), functionSource).disposition, "ELIMINATED_NOT_STARTUP_REACHABLE");
  assert.equal(classifyCandidate(candidate(callbackSource, 1), callbackSource).disposition, "ELIMINATED_NOT_STARTUP_REACHABLE");
});

test("direct option without a statically safe fallback requires runtime evidence", () => {
  const source = "const config = { authToken: process.env.SENTRY_AUTH_TOKEN };";
  assert.equal(classifyCandidate(candidate(source, 1), source).disposition, "REQUIRES_RUNTIME_EVIDENCE");
});

test("external configuration wrapper requires runtime evidence", () => {
  const source = "export default withSentryConfig(config);";
  assert.equal(classifyCandidate(candidate(source, 1, { family: "CONFIG_EVALUATION_SIDE_EFFECT", code: "NEXT_CONFIG_WRAPPER" }), source).disposition, "REQUIRES_RUNTIME_EVIDENCE");
});

test("module-evaluation network and database side effects are high confidence", () => {
  const network = candidate("const result = fetch(\"/health\");", 1, { family: "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY", code: "FETCH_CALL" });
  const database = candidate("const result = prisma.connect();", 1, { family: "EAGER_DATABASE_CONNECT_OR_MUTATION", code: "DATABASE_CALL" });
  assert.equal(classifyCandidate(network, "const result = fetch(\"/health\");").disposition, "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK");
  assert.equal(classifyCandidate(database, "const result = prisma.connect();").disposition, "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK");
});

test("client-only paths are not startup reachable", () => {
  const source = "const value = process.env.FLAG;";
  assert.equal(classifyCandidate(candidate(source, 1, { clientOnly: true }), source).disposition, "ELIMINATED_NOT_STARTUP_REACHABLE");
});

test("unsupported candidate shape fails closed", () => {
  const result = classifyCandidate(candidate("const value = 1;", 1, { family: "UNKNOWN", code: "UNKNOWN" }), "const value = 1;");
  assert.equal(result.disposition, "OWNERSHIP_UNSAFE");
});

test("disposition vocabulary is closed", () => {
  assert.deepEqual(DISPOSITIONS, [
    "ELIMINATED_NOT_MODULE_EAGER",
    "ELIMINATED_NOT_STARTUP_REACHABLE",
    "ELIMINATED_SAFE_FALLBACK_PRESENT",
    "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK",
    "REQUIRES_RUNTIME_EVIDENCE",
    "OWNERSHIP_UNSAFE",
  ]);
});

test("receipt validator rejects source snippets, raw AST and sensitive fields", () => {
  const receipt = {
    schemaVersion: "wp161-next-dev-startup-candidate-triage/v1",
    workPackage: "WP-161",
    status: "WP161_STARTUP_CANDIDATE_TRIAGE_VERIFIED",
    conclusion: "WP161_STATIC_TRIAGE_REMAINS_INDETERMINATE",
    input: { workPackage: "WP-160", candidateCount: 7, wp160CanonicalDigest: "sha256:" + "a".repeat(64) },
    candidates: Array.from({ length: 7 }, (_, index) => ({ disposition: "REQUIRES_RUNTIME_EVIDENCE", relativePath: "next.config.ts", symbol: "process.env", span: { startLine: index + 1, endLine: index + 1 }, phase: "MODULE_EVALUATION", reachability: "SYNC_FROM_NEXT_CONFIG", normalizedGuard: "direct_option_without_static_fallback", confidence: "MEDIUM", sourceDigest: "sha256:" + "b".repeat(64), reason: "runtime semantics" })),
    dispositionCounts: { ELIMINATED_NOT_MODULE_EAGER: 0, ELIMINATED_NOT_STARTUP_REACHABLE: 0, ELIMINATED_SAFE_FALLBACK_PRESENT: 0, CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK: 0, REQUIRES_RUNTIME_EVIDENCE: 7, OWNERSHIP_UNSAFE: 0 },
    rootCauseInferred: false,
    quality: { currentSnapshot: "CURRENT_TRUTH_RECONCILED", wp160Acceptance: "ACCEPT", syntheticMatrix: "PASS", strictReceiptReadback: "PASS", preserveOnlyGuard: "PASS", scopedESLint: "PASS", typecheck: "PASS", diffCheck: "PASS" },
    ownership: { before: {}, after: {}, protectedUnchanged: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: true, preserveOnly: true },
    sideEffects: { build: 0, server: 0, processSpawn: 0, browser: 0, network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, deployment: 0, productModuleEvaluation: 0, dotenvReads: 0, rawOutputPersisted: 0 },
    scoreImpact: { CAT06: { before: 7, after: 7 }, CAT09: { before: 6.5, after: 6.5 }, total: { before: 71.5, after: 71.5 } },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
    canonicalDigest: null,
    failure: null,
  };
  assert.doesNotThrow(() => validateReceipt(receipt));
  const sensitive = structuredClone(receipt);
  sensitive.candidates[0].reason = "source snippet: process.env.SECRET_TOKEN";
  assert.throws(() => validateReceipt(sensitive), /SENSITIVE/u);
});

test("receipt validator rejects candidate count drift and score mutation", () => {
  const receipt = {
    schemaVersion: "wp161-next-dev-startup-candidate-triage/v1",
    workPackage: "WP-161",
    status: "WP161_STARTUP_CANDIDATE_TRIAGE_VERIFIED",
    conclusion: "WP161_NO_STATIC_STARTUP_RISK_FOUND",
    input: { workPackage: "WP-160", candidateCount: 0, wp160CanonicalDigest: "sha256:" + "a".repeat(64) },
    candidates: [],
    dispositionCounts: {},
    rootCauseInferred: false,
    quality: {},
    ownership: { before: {}, after: {}, protectedUnchanged: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: true, preserveOnly: true },
    sideEffects: { build: 0, server: 0, processSpawn: 0, browser: 0, network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, deployment: 0, productModuleEvaluation: 0, dotenvReads: 0, rawOutputPersisted: 0 },
    scoreImpact: { CAT06: { before: 7, after: 7.5 }, CAT09: { before: 6.5, after: 6.5 }, total: { before: 71.5, after: 72 } },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
    canonicalDigest: null,
    failure: null,
  };
  assert.throws(() => validateReceipt(receipt), /COUNT|SCORE/u);
});

test("all candidate dispositions are terminal and no root cause is inferred", () => {
  const source = "const value = process.env.FLAG || \"fallback\";";
  const result = classifyCandidate(candidate(source, 1), source);
  assert.ok(DISPOSITIONS.includes(result.disposition));
  assert.equal(result.disposition === "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK" && result.reason.includes("WP-158"), false);
});

test("WP-86 rerun is not represented by the triage contract", () => {
  const source = "const value = process.env.FLAG ?? \"fallback\";";
  const result = classifyCandidate(candidate(source, 1), source);
  assert.equal(result.disposition, "ELIMINATED_SAFE_FALLBACK_PRESENT");
});

test("rejects candidates outside the next config module boundary", () => {
  const source = "const value = process.env.FLAG;";
  assert.equal(classifyCandidate(candidate(source, 1, { relativePath: "src/app/page.tsx" }), source).disposition, "ELIMINATED_NOT_STARTUP_REACHABLE");
  assert.equal(classifyCandidate(candidate(source, 1, { evaluationPhase: "REQUEST_TIME" }), source).disposition, "ELIMINATED_NOT_STARTUP_REACHABLE");
  assert.equal(classifyCandidate(candidate(source, 2), source).disposition, "OWNERSHIP_UNSAFE");
});

test("keeps canonical serialization stable for nulls, arrays, and nested keys", async () => {
  const { canonical } = await import("./wp161-next-dev-startup-candidate-triage.mjs");
  assert.equal(canonical(null), "null");
  assert.equal(canonical(["b", "a"]), "[\"b\",\"a\"]");
  assert.equal(canonical({ z: { b: 2, a: 1 }, a: true }), "{\"a\":true,\"z\":{\"a\":1,\"b\":2}}");
});

test("candidate ownership and phase guards fail closed before semantic classification", () => {
  const source = "const value = process.env.FLAG;";
  assert.equal(classifyCandidate(null, source).disposition, "OWNERSHIP_UNSAFE");
  assert.equal(classifyCandidate(candidate(source, 1, { clientOnly: true }), source).disposition, "ELIMINATED_NOT_STARTUP_REACHABLE");
  assert.equal(classifyCandidate(candidate(source, 1, { relativePath: "src/app/page.tsx" }), source).disposition, "ELIMINATED_NOT_STARTUP_REACHABLE");
  assert.equal(classifyCandidate(candidate(source, 1, { code: "OTHER" }), source).disposition, "REQUIRES_RUNTIME_EVIDENCE");
});

test("required assertion and non-null guards remain high-confidence startup risks", () => {
  const guarded = "if (!process.env.REQUIRED) throw new Error(\"missing\");";
  assert.equal(classifyCandidate(candidate(guarded, 1), guarded).disposition, "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK");
  const nonNull = "const value = process.env.REQUIRED!;";
  assert.equal(classifyCandidate(candidate(nonNull, 1), nonNull).disposition, "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK");
  const database = "const client = prisma.connect();";
  assert.equal(classifyCandidate(candidate(database, 1, { family: "EAGER_DATABASE_CONNECT_OR_MUTATION", code: "DATABASE_CALL" }), database).disposition, "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK");
});
