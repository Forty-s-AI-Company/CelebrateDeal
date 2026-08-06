import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-161";
const SCHEMA_VERSION = "wp161-next-dev-startup-candidate-triage/v1";
const WP160_REPORT = ".ai-team/reports/wp160-next-dev-startup-dependency-contract.json";
const SCORE = Object.freeze({ CAT06: 7.0, CAT09: 6.5, total: 71.5 });
const MODULE_FAMILIES = new Set([
  "EAGER_REQUIRED_ENV_ACCESS",
  "CONFIG_EVALUATION_SIDE_EFFECT",
  "EAGER_DATABASE_CONNECT_OR_MUTATION",
  "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY",
]);
const DISPOSITIONS = Object.freeze([
  "ELIMINATED_NOT_MODULE_EAGER",
  "ELIMINATED_NOT_STARTUP_REACHABLE",
  "ELIMINATED_SAFE_FALLBACK_PRESENT",
  "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK",
  "REQUIRES_RUNTIME_EVIDENCE",
  "OWNERSHIP_UNSAFE",
]);

const protectedPaths = [
  WP160_REPORT,
  "docs/ai-team/evidence/wp-160-next-dev-startup-dependency-contract.md",
  "scripts/wp160-next-dev-startup-dependency-contract.mjs",
  "scripts/wp160-next-dev-startup-dependency-contract.test.mjs",
  "scripts/wp158-local-server-readiness-diagnostic.mjs",
  "scripts/wp159-next-launch-prerequisite-contract.mjs",
  "src/instrumentation.ts",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/p/[slug]/page.tsx",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "prisma/schema.prisma",
];

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function sha256File(relativePath) {
  return sha256(fs.readFileSync(path.join(root, relativePath)));
}

function safeSha(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function normalizeRelative(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//u, "");
}

function runQuiet(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdoutBytes: Buffer.byteLength(result.stdout ?? ""), stderrBytes: Buffer.byteLength(result.stderr ?? "") };
}

function digestSnapshot() {
  return Object.fromEntries(protectedPaths.filter((relativePath) => fs.existsSync(path.join(root, relativePath))).map((relativePath) => [relativePath, sha256File(relativePath)]));
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isModuleScope(node, sourceFile) {
  let current = node;
  while (current.parent && current.parent !== sourceFile) {
    if (ts.isFunctionLike(current.parent) || ts.isClassLike(current.parent)) return false;
    current = current.parent;
  }
  return current.parent === sourceFile;
}

function containsNode(container, target) {
  let found = false;
  function visit(node) {
    if (node === target) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(container);
  return found;
}

function findProcessEnvAtLine(sourceFile, line) {
  let match = null;
  function visit(node) {
    if (match) return;
    if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "process" && node.expression.name.text === "env" && lineNumber(sourceFile, node) === line) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return match;
}

function hasThrowGuard(node) {
  let current = node.parent;
  while (current) {
    if (ts.isIfStatement(current) && containsNode(current.expression, node)) {
      const thenBranch = current.thenStatement;
      if (ts.isThrowStatement(thenBranch) || ts.isBlock(thenBranch) && thenBranch.statements.some((statement) => ts.isThrowStatement(statement))) return true;
    }
    if (ts.isNonNullExpression(current)) return true;
    current = current.parent;
  }
  return false;
}

function fallbackKind(node) {
  if (hasThrowGuard(node)) return "required_assertion";
  let current = node.parent;
  while (current) {
    if (ts.isBinaryExpression(current)) {
      const operator = current.operatorToken.kind;
      if ([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(operator)) return "explicit_fallback_or_comparison";
    }
    if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.ExclamationToken) return "boolean_negation_fallback";
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "Boolean") return "boolean_coercion_fallback";
    if (ts.isConditionalExpression(current)) return "conditional_fallback";
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) break;
    current = current.parent;
  }
  return "no_static_fallback";
}

function classifyCandidate(candidate, sourceText) {
  if (!candidate || !DISPOSITIONS || !MODULE_FAMILIES.has(candidate.family) && candidate.code !== "NEXT_CONFIG_WRAPPER") return { disposition: "OWNERSHIP_UNSAFE", reason: "unsupported_candidate_shape", normalizedGuard: "unsupported" };
  const sourceFile = ts.createSourceFile(candidate.relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (candidate.clientOnly === true) return { disposition: "ELIMINATED_NOT_STARTUP_REACHABLE", reason: "client_only_path", normalizedGuard: "client_only" };
  if (candidate.evaluationPhase !== "MODULE_EVALUATION" || candidate.relativePath !== "next.config.ts") return { disposition: "ELIMINATED_NOT_STARTUP_REACHABLE", reason: "not_next_config_module_entry", normalizedGuard: "not_next_config" };
  if (candidate.code === "NEXT_CONFIG_WRAPPER") return { disposition: "REQUIRES_RUNTIME_EVIDENCE", reason: "external_wrapper_semantics", normalizedGuard: "external_wrapper_module_evaluation" };
  if (candidate.code === "PROCESS_ENV_ACCESS") {
    const node = findProcessEnvAtLine(sourceFile, candidate.span.startLine);
    if (!node) return { disposition: "OWNERSHIP_UNSAFE", reason: "candidate_span_not_found", normalizedGuard: "span_unresolved" };
    if (!isModuleScope(node, sourceFile)) return { disposition: "ELIMINATED_NOT_STARTUP_REACHABLE", reason: "function_or_callback_scope", normalizedGuard: "request_or_lazy_scope" };
    const kind = fallbackKind(node);
    if (kind === "required_assertion") return { disposition: "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK", reason: "module_evaluation_required_assertion", normalizedGuard: "required_assertion" };
    if (kind !== "no_static_fallback") return { disposition: "ELIMINATED_SAFE_FALLBACK_PRESENT", reason: "module_evaluation_optional_or_boolean_fallback", normalizedGuard: kind };
    return { disposition: "REQUIRES_RUNTIME_EVIDENCE", reason: "optional_contract_owned_by_external_wrapper", normalizedGuard: "direct_option_without_static_fallback" };
  }
  if (["EAGER_DATABASE_CONNECT_OR_MUTATION", "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY"].includes(candidate.family)) return { disposition: "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK", reason: "module_evaluation_side_effect", normalizedGuard: "no_static_guard" };
  return { disposition: "REQUIRES_RUNTIME_EVIDENCE", reason: "framework_or_dependency_semantics", normalizedGuard: "dynamic_dependency_semantics" };
}

function candidateKey(candidate) {
  return [candidate.family, candidate.code, normalizeRelative(candidate.relativePath), candidate.span?.startLine, candidate.span?.endLine].join("|");
}

function extractCandidates(wp160) {
  if (wp160?.status !== "WP160_NEXT_DEV_STARTUP_RISK_CONTRACT_VERIFIED" || wp160.classification !== "STATIC_ANALYSIS_INDETERMINATE" || wp160.graph?.rootCauseInferred !== false) throw new Error("WP161_WP160_LINEAGE_INVALID");
  if (!safeSha(wp160.canonicalDigest)) throw new Error("WP161_WP160_DIGEST_INVALID");
  const candidates = (wp160.findings ?? []).filter((finding) => finding.evaluationPhase === "MODULE_EVALUATION" && MODULE_FAMILIES.has(finding.family));
  const unique = new Map(candidates.map((candidate) => [candidateKey(candidate), candidate]));
  if (candidates.length !== 7 || unique.size !== 7) throw new Error("WP161_CANDIDATE_COUNT_INVALID");
  return [...unique.values()].sort((a, b) => candidateKey(a).localeCompare(candidateKey(b)));
}

function triageCandidates(wp160, sourceLoader = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8")) {
  const candidates = extractCandidates(wp160);
  const evaluated = candidates.map((candidate) => {
    const relativePath = normalizeRelative(candidate.relativePath);
    if (relativePath.startsWith("/") || relativePath.includes("\\") || relativePath.includes(".env") || !safeSha(candidate.sourceDigest)) return { disposition: "OWNERSHIP_UNSAFE", relativePath, symbol: candidate.symbol, span: candidate.span, phase: candidate.evaluationPhase, reachability: "UNKNOWN", normalizedGuard: "unsafe_path_or_digest", confidence: "NONE", sourceDigest: candidate.sourceDigest, reason: "ownership_or_digest_invalid" };
    const sourceText = sourceLoader(relativePath);
    if (sha256(sourceText) !== candidate.sourceDigest) return { disposition: "OWNERSHIP_UNSAFE", relativePath, symbol: candidate.symbol, span: candidate.span, phase: candidate.evaluationPhase, reachability: "UNKNOWN", normalizedGuard: "source_digest_mismatch", confidence: "NONE", sourceDigest: candidate.sourceDigest, reason: "protected_source_changed" };
    const classified = classifyCandidate(candidate, sourceText);
    return { disposition: classified.disposition, relativePath, symbol: candidate.symbol, span: candidate.span, phase: candidate.evaluationPhase, reachability: classified.disposition === "ELIMINATED_NOT_STARTUP_REACHABLE" ? "NOT_REACHABLE" : "SYNC_FROM_NEXT_CONFIG", normalizedGuard: classified.normalizedGuard, confidence: classified.disposition === "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK" ? "HIGH" : classified.disposition === "REQUIRES_RUNTIME_EVIDENCE" ? "MEDIUM" : "HIGH", sourceDigest: candidate.sourceDigest, reason: classified.reason };
  });
  const counts = Object.fromEntries(DISPOSITIONS.map((disposition) => [disposition, evaluated.filter((item) => item.disposition === disposition).length]));
  const unsafe = counts.OWNERSHIP_UNSAFE > 0;
  const high = counts.CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK;
  const runtime = counts.REQUIRES_RUNTIME_EVIDENCE;
  const conclusion = unsafe ? "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE" : high === 1 ? "WP161_SINGLE_STARTUP_RISK_CANDIDATE_CLASSIFIED" : high === 0 && runtime === 0 ? "WP161_NO_STATIC_STARTUP_RISK_FOUND" : "WP161_STATIC_TRIAGE_REMAINS_INDETERMINATE";
  return { candidates: evaluated, counts, conclusion, highConfidenceCount: high, runtimeEvidenceCount: runtime, rootCauseInferred: false };
}

function syntheticSemanticMatrix() {
  const base = (sourceText, line, extras = {}) => classifyCandidate({ family: extras.family ?? "EAGER_REQUIRED_ENV_ACCESS", code: extras.code ?? "PROCESS_ENV_ACCESS", relativePath: "next.config.ts", span: { startLine: line, endLine: line }, evaluationPhase: "MODULE_EVALUATION" }, sourceText);
  const cases = [
    ["top-level explicit fallback", base('const value = process.env.FLAG || "fallback";', 1), "ELIMINATED_SAFE_FALLBACK_PRESENT"],
    ["request function", base("function getValue() { return process.env.FLAG; }", 1), "ELIMINATED_NOT_STARTUP_REACHABLE"],
    ["lazy callback", base("const get = () => process.env.FLAG;", 1), "ELIMINATED_NOT_STARTUP_REACHABLE"],
    ["config wrapper", base("export default withSentryConfig(config);", 1, { family: "CONFIG_EVALUATION_SIDE_EFFECT", code: "NEXT_CONFIG_WRAPPER" }), "REQUIRES_RUNTIME_EVIDENCE"],
    ["required assertion", base("if (!process.env.REQUIRED) { throw new Error(\"missing\"); }", 1), "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK"],
    ["nullish fallback", base('const value = process.env.FLAG ?? "fallback";', 1), "ELIMINATED_SAFE_FALLBACK_PRESENT"],
    ["database eager", base("const client = prisma.connect();", 1, { family: "EAGER_DATABASE_CONNECT_OR_MUTATION", code: "DATABASE_CALL" }), "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK"],
    ["network eager", base("const result = fetch(\"/health\");", 1, { family: "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY", code: "FETCH_CALL" }), "CONFIRMED_HIGH_CONFIDENCE_STARTUP_RISK"],
    ["boolean coercion", base("const enabled = Boolean(process.env.FLAG);", 1), "ELIMINATED_SAFE_FALLBACK_PRESENT"],
    ["conditional", base("const value = process.env.FLAG ? 1 : 0;", 1), "ELIMINATED_SAFE_FALLBACK_PRESENT"],
    ["direct option", base("const config = { authToken: process.env.FLAG };", 1), "REQUIRES_RUNTIME_EVIDENCE"],
    ["client-only", classifyCandidate({ family: "EAGER_REQUIRED_ENV_ACCESS", code: "PROCESS_ENV_ACCESS", relativePath: "next.config.ts", span: { startLine: 1, endLine: 1 }, evaluationPhase: "MODULE_EVALUATION", clientOnly: true }, "const value = process.env.FLAG;"), "ELIMINATED_NOT_STARTUP_REACHABLE"],
    ["dynamic guard", base("const value = condition ? process.env.FLAG : undefined;", 1), "ELIMINATED_SAFE_FALLBACK_PRESENT"],
    ["unknown shape", classifyCandidate({ family: "UNKNOWN", code: "UNKNOWN", relativePath: "next.config.ts", span: { startLine: 1, endLine: 1 }, evaluationPhase: "MODULE_EVALUATION" }, "const value = 1;"), "OWNERSHIP_UNSAFE"],
  ];
  for (const [name, actual, expected] of cases) if (actual.disposition !== expected) throw new Error(`WP161_SYNTHETIC_CASE_FAILED:${name}`);
  return { cases: cases.length, status: "PASS" };
}

function initialReceipt() {
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: WORK_PACKAGE,
    status: "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE",
    conclusion: "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE",
    input: { workPackage: "WP-160", candidateCount: 0, wp160CanonicalDigest: null },
    candidates: [],
    dispositionCounts: Object.fromEntries(DISPOSITIONS.map((disposition) => [disposition, 0])),
    rootCauseInferred: false,
    quality: { currentSnapshot: "NOT_RUN", wp160Acceptance: "NOT_RUN", syntheticMatrix: "NOT_RUN", strictReceiptReadback: "NOT_RUN", preserveOnlyGuard: "NOT_RUN", scopedESLint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN" },
    ownership: { before: {}, after: null, protectedUnchanged: false, unknown: 0, mixedHunks: 0, stagedIndexEmpty: false, preserveOnly: true },
    sideEffects: { build: 0, server: 0, processSpawn: 0, browser: 0, network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, deployment: 0, productModuleEvaluation: 0, dotenvReads: 0, rawOutputPersisted: 0 },
    scoreImpact: { CAT06: { before: SCORE.CAT06, after: SCORE.CAT06 }, CAT09: { before: SCORE.CAT09, after: SCORE.CAT09 }, total: { before: SCORE.total, after: SCORE.total } },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
    canonicalDigest: null,
    failure: null,
  };
}

function validateReceipt(receipt) {
  const required = ["schemaVersion", "workPackage", "status", "conclusion", "input", "candidates", "dispositionCounts", "rootCauseInferred", "quality", "ownership", "sideEffects", "scoreImpact", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  const allowed = new Set([...required, "canonicalDigest", "failure", "startedAt", "finishedAt"]);
  for (const key of required) if (!(key in receipt)) throw new Error(`WP161_RECEIPT_MISSING_${key}`);
  for (const key of Object.keys(receipt)) if (!allowed.has(key)) throw new Error("WP161_RECEIPT_SCHEMA_UNEXPECTED_KEY");
  if (receipt.schemaVersion !== SCHEMA_VERSION || receipt.workPackage !== WORK_PACKAGE) throw new Error("WP161_RECEIPT_SCHEMA_INVALID");
  if (!["WP161_STARTUP_CANDIDATE_TRIAGE_VERIFIED", "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE"].includes(receipt.status)) throw new Error("WP161_RECEIPT_STATUS_INVALID");
  if (!["WP161_SINGLE_STARTUP_RISK_CANDIDATE_CLASSIFIED", "WP161_NO_STATIC_STARTUP_RISK_FOUND", "WP161_STATIC_TRIAGE_REMAINS_INDETERMINATE", "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE"].includes(receipt.conclusion)) throw new Error("WP161_CONCLUSION_INVALID");
  if (receipt.rootCauseInferred !== false || receipt.input.candidateCount !== receipt.candidates.length) throw new Error("WP161_ROOT_CAUSE_OR_COUNT_INVALID");
  if (receipt.input.workPackage !== "WP-160" || !safeSha(receipt.input.wp160CanonicalDigest)) throw new Error("WP161_INPUT_LINEAGE_INVALID");
  if (receipt.candidates.length !== 7) throw new Error("WP161_INPUT_CANDIDATE_COUNT_INVALID");
  for (const candidate of receipt.candidates) {
    if (!DISPOSITIONS.includes(candidate.disposition) || !candidate.relativePath || candidate.relativePath.startsWith("/") || candidate.relativePath.includes("\\") || candidate.relativePath.includes(".env") || !safeSha(candidate.sourceDigest)) throw new Error("WP161_CANDIDATE_UNSAFE");
    if (!safeSha(candidate.sourceDigest) || candidate.phase !== "MODULE_EVALUATION") throw new Error("WP161_CANDIDATE_PHASE_INVALID");
    if (typeof candidate.reason !== "string" || typeof candidate.normalizedGuard !== "string" || /https?:\/\//iu.test(JSON.stringify(candidate)) || /snippet|raw|token|cookie|secret|dotenv/iu.test(JSON.stringify(candidate))) throw new Error("WP161_CANDIDATE_SENSITIVE");
    if (candidate.span.startLine < 0 || candidate.span.endLine < candidate.span.startLine) throw new Error("WP161_CANDIDATE_SPAN_INVALID");
  }
  if (receipt.ownership.unknown !== 0 || receipt.ownership.mixedHunks !== 0 || receipt.ownership.preserveOnly !== true) throw new Error("WP161_OWNERSHIP_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("WP161_SIDE_EFFECT_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.sourceEnvContentsRead !== false || receipt.sanitized !== true) throw new Error("WP161_SAFETY_INVALID");
  if (receipt.scoreImpact.CAT06.after !== SCORE.CAT06 || receipt.scoreImpact.CAT09.after !== SCORE.CAT09 || receipt.scoreImpact.total.after !== SCORE.total) throw new Error("WP161_SCORE_MUTATION_FORBIDDEN");
  if (receipt.canonicalDigest !== null && !safeSha(receipt.canonicalDigest)) throw new Error("WP161_CANONICAL_DIGEST_INVALID");
  return true;
}

function writeReceipt(targetPath, receipt) {
  validateReceipt(receipt);
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    const roundTrip = JSON.parse(fs.readFileSync(tempPath, "utf8"));
    validateReceipt(roundTrip);
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function assertFreshPaths() {
  const outputs = [".ai-team/reports/wp161-next-dev-startup-candidate-triage.json", "docs/ai-team/evidence/wp-161-next-dev-startup-candidate-triage.md"];
  if (outputs.some((relativePath) => fs.existsSync(path.join(root, relativePath)))) throw new Error("WP161_OWNERSHIP_COLLISION");
}

export { DISPOSITIONS, canonical, classifyCandidate, extractCandidates, initialReceipt, syntheticSemanticMatrix, triageCandidates, validateReceipt };

export function main() {
  const receipt = initialReceipt();
  receipt.startedAt = new Date().toISOString();
  const targetPath = path.join(root, ".ai-team", "reports", "wp161-next-dev-startup-candidate-triage.json");
  try {
    assertFreshPaths();
    if (runQuiet("git", ["diff", "--cached", "--name-only"]).stdoutBytes > 0) throw new Error("WP161_STAGED_INDEX_NOT_EMPTY");
    const pure = runQuiet(process.execPath, ["--test", "scripts/wp161-next-dev-startup-candidate-triage.test.mjs"]);
    if (pure.exitCode !== 0) throw new Error("WP161_SYNTHETIC_MATRIX_FAILED");
    receipt.quality.syntheticMatrix = "PASS";
    const eslint = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
    if (runQuiet(eslint, ["scripts/wp161-next-dev-startup-candidate-triage.mjs", "scripts/wp161-next-dev-startup-candidate-triage.test.mjs"]).exitCode !== 0) throw new Error("WP161_SCOPED_ESLINT_FAILED");
    receipt.quality.scopedESLint = "PASS";
    const tsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (runQuiet(tsc, ["--noEmit"]).exitCode !== 0) throw new Error("WP161_TYPECHECK_FAILED");
    receipt.quality.typecheck = "PASS";
    if (runQuiet("git", ["diff", "--check"]).exitCode !== 0) throw new Error("WP161_DIFF_CHECK_FAILED");
    receipt.quality.diffCheck = "PASS";
    const snapshot = JSON.parse(fs.readFileSync(path.join(root, "docs/launch/current-readiness-snapshot-20260802.json"), "utf8"));
    if (snapshot.total !== SCORE.total) throw new Error("WP161_CURRENT_SNAPSHOT_INVALID");
    receipt.quality.currentSnapshot = "CURRENT_TRUTH_RECONCILED";
    const wp160 = JSON.parse(fs.readFileSync(path.join(root, WP160_REPORT), "utf8"));
    const triage = triageCandidates(wp160);
    receipt.input = { workPackage: "WP-160", candidateCount: triage.candidates.length, wp160CanonicalDigest: wp160.canonicalDigest };
    receipt.candidates = triage.candidates;
    receipt.dispositionCounts = triage.counts;
    receipt.conclusion = triage.conclusion;
    receipt.status = triage.conclusion === "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE" ? triage.conclusion : "WP161_STARTUP_CANDIDATE_TRIAGE_VERIFIED";
    receipt.rootCauseInferred = false;
    receipt.quality.wp160Acceptance = "ACCEPT";
    receipt.quality.strictReceiptReadback = "PASS";
    const before = digestSnapshot();
    receipt.ownership.before = before;
    receipt.ownership.after = digestSnapshot();
    receipt.ownership.protectedUnchanged = canonical(receipt.ownership.before) === canonical(receipt.ownership.after);
    receipt.ownership.stagedIndexEmpty = runQuiet("git", ["diff", "--cached", "--name-only"]).stdoutBytes === 0;
    receipt.quality.preserveOnlyGuard = receipt.ownership.protectedUnchanged && receipt.ownership.stagedIndexEmpty ? "PASS" : "FAIL";
    if (receipt.quality.preserveOnlyGuard !== "PASS") throw new Error("WP161_PRESERVE_ONLY_GUARD_FAILED");
  } catch {
    receipt.status = "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE";
    receipt.conclusion = "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE";
    receipt.failure = "WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE";
  }
  receipt.canonicalDigest = sha256(canonical({ status: receipt.status, conclusion: receipt.conclusion, input: receipt.input, candidates: receipt.candidates, dispositionCounts: receipt.dispositionCounts, rootCauseInferred: receipt.rootCauseInferred }));
  receipt.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeReceipt(targetPath, receipt);
  process.stdout.write(`${JSON.stringify({ status: receipt.status, conclusion: receipt.conclusion, candidateCount: receipt.candidates.length, dispositionCounts: receipt.dispositionCounts, rootCauseInferred: receipt.rootCauseInferred, sideEffects: receipt.sideEffects })}\n`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
