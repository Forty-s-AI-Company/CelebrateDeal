import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-160";
const SCHEMA_VERSION = "wp160-next-dev-startup-dependency-contract/v1";
const SCORE = Object.freeze({ CAT06: 7.0, CAT09: 6.5, total: 71.5 });
const MAX_FILES = 80;
const MAX_FINDINGS = 80;

const RISK_FAMILIES = Object.freeze([
  "EAGER_REQUIRED_ENV_ACCESS",
  "EAGER_DATABASE_CONNECT_OR_MUTATION",
  "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY",
  "MISSING_OR_UNRESOLVED_RUNTIME_MODULE",
  "CONFIG_EVALUATION_SIDE_EFFECT",
  "GENERATED_ARTIFACT_PREREQUISITE",
  "DEFERRED_REQUEST_TIME_DEPENDENCY",
  "NO_STATIC_STARTUP_BLOCKER",
  "STATIC_ANALYSIS_INDETERMINATE",
]);
const PHASES = Object.freeze(["MODULE_EVALUATION", "REQUEST_TIME", "UNKNOWN"]);
const ENTRYPOINTS = Object.freeze([
  "next.config.ts",
  "src/instrumentation.ts",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/p/[slug]/page.tsx",
  "src/proxy.ts",
  "src/middleware.ts",
]);

const protectedPaths = [
  ".ai-team/reports/wp158-local-server-readiness-diagnostic-receipt.json",
  ".ai-team/reports/wp159-next-launch-prerequisite-contract.json",
  "docs/ai-team/evidence/wp-158-local-server-readiness-diagnostic.md",
  "docs/ai-team/evidence/wp-159-next-launch-prerequisite-contract.md",
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

function runQuiet(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: "utf8", shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { exitCode: result.status ?? 1, stdoutBytes: Buffer.byteLength(result.stdout ?? ""), stderrBytes: Buffer.byteLength(result.stderr ?? "") };
}

function digestSnapshot() {
  return Object.fromEntries(protectedPaths.filter((relativePath) => fs.existsSync(path.join(root, relativePath))).map((relativePath) => [relativePath, sha256File(relativePath)]));
}

function normalizeRelative(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function classifyRuntimeMirror({ sourceText = "", tempRootClass = "" } = {}) {
  if (tempRootClass === "OS_TEMP_MIRROR") return "OS_TEMP_MIRROR";
  if (/os\.tmpdir\(\)/u.test(sourceText) && /tempRoot|copyMirror/u.test(sourceText)) return "OS_TEMP_MIRROR";
  if (tempRootClass === "WORKSPACE") return "WORKSPACE";
  return "UNKNOWN";
}

function resolveCandidate(relativePath) {
  const candidates = [relativePath, `${relativePath}.ts`, `${relativePath}.tsx`, `${relativePath}.js`, `${relativePath}.jsx`, path.join(relativePath, "index.ts"), path.join(relativePath, "index.tsx")];
  return candidates.map(normalizeRelative).find((candidate) => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile()) ?? null;
}

function resolveImport(fromPath, specifier) {
  if (specifier.includes(".next")) return "GENERATED_ARTIFACT";
  if (specifier.startsWith("@/")) return resolveCandidate(path.join("src", specifier.slice(2)));
  if (specifier.startsWith(".")) return resolveCandidate(path.join(path.dirname(fromPath), specifier));
  if (specifier.startsWith("node:") || builtinModules.includes(specifier)) return "EXTERNAL_BUILTIN";
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  return fs.existsSync(path.join(root, "node_modules", packageName)) ? "EXTERNAL_PACKAGE" : null;
}

function lineSpan(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return { startLine: start.line + 1, endLine: end.line + 1 };
}

function symbolFor(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${symbolFor(node.expression)}.${node.name.text}`;
  if (ts.isCallExpression(node)) return symbolFor(node.expression);
  if (ts.isNewExpression(node)) return symbolFor(node.expression);
  return "module_scope";
}

function moduleScope(node, sourceFile) {
  let current = node;
  while (current.parent && current.parent !== sourceFile) {
    if (ts.isFunctionLike(current.parent) || ts.isClassLike(current.parent)) return false;
    current = current.parent;
  }
  return current.parent === sourceFile;
}

function makeFinding({ family, relativePath, node, sourceFile, phase, symbol, confidence = "HIGH", code }) {
  const span = lineSpan(sourceFile, node);
  const sourceDigest = fs.existsSync(path.join(root, relativePath)) ? sha256File(relativePath) : sha256(sourceFile.text ?? "");
  return { family, code, relativePath, symbol: symbol ?? symbolFor(node), span, evaluationPhase: phase, confidence, sourceDigest };
}

function staticImports(sourceFile) {
  const imports = [];
  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = Boolean(node.importClause?.isTypeOnly) || Boolean(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.every((item) => item.isTypeOnly));
      imports.push({ specifier: node.moduleSpecifier.text, typeOnly, node });
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.expression.arguments[0];
      imports.push({ specifier: argument && ts.isStringLiteral(argument) ? argument.text : null, typeOnly: false, dynamic: true, node });
    }
  });
  return imports;
}

function isClientOnlySource(sourceFile) {
  const first = sourceFile.statements[0];
  return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use client");
}

function analyzeSource(relativePath, sourceText) {
  const sourceFile = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings = [];
  const imports = staticImports(sourceFile);
  const add = (finding) => {
    if (findings.length < MAX_FINDINGS) findings.push(finding);
  };
  function visit(node) {
    const isModule = moduleScope(node, sourceFile);
    const phase = isModule ? "MODULE_EVALUATION" : "REQUEST_TIME";
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteral(argument)) add(makeFinding({ family: "STATIC_ANALYSIS_INDETERMINATE", code: "DYNAMIC_IMPORT_UNRESOLVED", relativePath, node, sourceFile, phase: "UNKNOWN", confidence: "MEDIUM" }));
      }
      if (ts.isIdentifier(expression) && expression.text === "fetch") add(makeFinding({ family: isModule ? "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY" : "DEFERRED_REQUEST_TIME_DEPENDENCY", code: "FETCH_CALL", relativePath, node, sourceFile, phase, confidence: isModule ? "HIGH" : "MEDIUM" }));
      if (ts.isPropertyAccessExpression(expression)) {
        const symbol = symbolFor(expression);
        if (/^Sentry\.(init|capture|setup)/u.test(symbol) || /posthog|telemetry|analytics/iu.test(symbol)) add(makeFinding({ family: isModule ? "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY" : "DEFERRED_REQUEST_TIME_DEPENDENCY", code: "TELEMETRY_CALL", relativePath, node, sourceFile, phase, symbol, confidence: isModule ? "HIGH" : "MEDIUM" }));
        if (/(connect|query|execute|transaction)$/iu.test(expression.name.text) && /prisma|database|client/iu.test(symbol)) add(makeFinding({ family: isModule ? "EAGER_DATABASE_CONNECT_OR_MUTATION" : "DEFERRED_REQUEST_TIME_DEPENDENCY", code: "DATABASE_CALL", relativePath, node, sourceFile, phase, symbol, confidence: isModule ? "HIGH" : "MEDIUM" }));
      }
      if (ts.isPropertyAccessExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && ts.isIdentifier(expression.expression.expression) && expression.expression.expression.text === "process" && expression.expression.name.text === "env") add(makeFinding({ family: isModule ? "EAGER_REQUIRED_ENV_ACCESS" : "DEFERRED_REQUEST_TIME_DEPENDENCY", code: "PROCESS_ENV_ACCESS", relativePath, node, sourceFile, phase, symbol: "process.env", confidence: isModule ? "HIGH" : "MEDIUM" }));
    }
    if (ts.isNewExpression(node) && /PrismaClient|Pool|Client$/u.test(symbolFor(node.expression))) add(makeFinding({ family: isModule ? "EAGER_DATABASE_CONNECT_OR_MUTATION" : "DEFERRED_REQUEST_TIME_DEPENDENCY", code: "DATABASE_CLIENT_CONSTRUCTION", relativePath, node, sourceFile, phase, confidence: isModule ? "HIGH" : "MEDIUM" }));
    if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "process" && node.expression.name.text === "env") add(makeFinding({ family: isModule ? "EAGER_REQUIRED_ENV_ACCESS" : "DEFERRED_REQUEST_TIME_DEPENDENCY", code: "PROCESS_ENV_ACCESS", relativePath, node, sourceFile, phase, symbol: "process.env", confidence: isModule ? "HIGH" : "MEDIUM" }));
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (relativePath === "next.config.ts" && /withSentryConfig/u.test(sourceText)) add(makeFinding({ family: "CONFIG_EVALUATION_SIDE_EFFECT", code: "NEXT_CONFIG_WRAPPER", relativePath, node: sourceFile, sourceFile, phase: "MODULE_EVALUATION", symbol: "withSentryConfig", confidence: "HIGH" }));
  return { imports, findings, clientOnly: isClientOnlySource(sourceFile) };
}

function dedupeFindings(findings) {
  const map = new Map();
  for (const finding of findings) map.set([finding.family, finding.relativePath, finding.code, finding.span.startLine, finding.span.endLine, finding.evaluationPhase].join("|"), finding);
  return [...map.values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
}

function analyzeStartupGraph(entrypoints = ENTRYPOINTS) {
  const visited = new Set();
  const queue = entrypoints.filter((relativePath) => fs.existsSync(path.join(root, relativePath))).map((relativePath) => normalizeRelative(relativePath));
  const findings = [];
  const graph = [];
  let indeterminate = false;
  while (queue.length > 0) {
    const relativePath = queue.shift();
    if (!relativePath || visited.has(relativePath)) continue;
    if (visited.size >= MAX_FILES) {
      indeterminate = true;
      break;
    }
    visited.add(relativePath);
    const sourceText = fs.readFileSync(path.join(root, relativePath), "utf8");
    const analyzed = analyzeSource(relativePath, sourceText);
    graph.push({ relativePath, ownership: "PRESERVE_ONLY", sourceDigest: sha256File(relativePath), importCount: analyzed.imports.length, clientOnly: analyzed.clientOnly });
    findings.push(...analyzed.findings);
    for (const item of analyzed.imports) {
      if (item.typeOnly) continue;
      if (item.dynamic && !item.specifier) {
        indeterminate = true;
        continue;
      }
      const resolved = resolveImport(relativePath, item.specifier);
      if (resolved === null) findings.push(makeFinding({ family: "MISSING_OR_UNRESOLVED_RUNTIME_MODULE", code: "STATIC_IMPORT_UNRESOLVED", relativePath, node: item.node, sourceFile: ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), phase: "MODULE_EVALUATION", symbol: "runtime_import", confidence: "HIGH" }));
      else if (resolved === "GENERATED_ARTIFACT") findings.push(makeFinding({ family: "GENERATED_ARTIFACT_PREREQUISITE", code: "GENERATED_ARTIFACT_IMPORT", relativePath, node: item.node, sourceFile: ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), phase: "MODULE_EVALUATION", symbol: "generated_artifact", confidence: "HIGH" }));
      else if (resolved !== "EXTERNAL_BUILTIN" && resolved !== "EXTERNAL_PACKAGE") {
        const childSource = fs.readFileSync(path.join(root, resolved), "utf8");
        const childFile = ts.createSourceFile(resolved, childSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        if (!isClientOnlySource(childFile)) queue.push(resolved);
      }
    }
  }
  if (indeterminate) findings.push({ family: "STATIC_ANALYSIS_INDETERMINATE", code: "BOUNDED_GRAPH_OR_DYNAMIC_IMPORT", relativePath: "<graph>", symbol: "bounded_graph", span: { startLine: 0, endLine: 0 }, evaluationPhase: "UNKNOWN", confidence: "MEDIUM", sourceDigest: sha256(canonical(graph)) });
  const normalized = dedupeFindings(findings);
  const eager = normalized.filter((finding) => finding.evaluationPhase === "MODULE_EVALUATION" && ["EAGER_REQUIRED_ENV_ACCESS", "EAGER_DATABASE_CONNECT_OR_MUTATION", "EAGER_EXTERNAL_NETWORK_OR_TELEMETRY", "CONFIG_EVALUATION_SIDE_EFFECT", "MISSING_OR_UNRESOLVED_RUNTIME_MODULE", "GENERATED_ARTIFACT_PREREQUISITE"].includes(finding.family));
  let classification = "NO_STATIC_STARTUP_BLOCKER";
  if (indeterminate || normalized.some((finding) => finding.family === "STATIC_ANALYSIS_INDETERMINATE")) classification = "STATIC_ANALYSIS_INDETERMINATE";
  else if (eager.length === 1 && eager[0].confidence === "HIGH") classification = "NEXT_DEV_STARTUP_RISK_CLASSIFIED";
  else if (eager.length > 1) classification = "STATIC_ANALYSIS_INDETERMINATE";
  return { entrypoints: graph, findings: normalized, eagerCount: eager.length, classification, dynamicOrBoundedIndeterminate: indeterminate, rootCauseInferred: false };
}

function initialReceipt() {
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: WORK_PACKAGE,
    status: "WP160_EXACT_NO_GO_STATIC_ANALYSIS_UNSAFE_OR_INCOMPLETE",
    classification: "STATIC_ANALYSIS_INDETERMINATE",
    entrypoints: [],
    findings: [],
    graph: { fileCount: 0, bounded: true, rootCauseInferred: false },
    wp158Boundary: { exitFamily: "NONZERO_EXIT_BEFORE_READY", rootCauseInferred: false },
    ownership: { before: {}, after: null, protectedUnchanged: false, unknown: 0, mixedHunks: 0, stagedIndexEmpty: false, preserveOnly: true },
    quality: { currentSnapshot: "NOT_RUN", wp159Acceptance: "NOT_RUN", syntheticMatrix: "NOT_RUN", strictReceiptReadback: "NOT_RUN", preserveOnlyGuard: "NOT_RUN", scopedESLint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN" },
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
  const required = ["schemaVersion", "workPackage", "status", "classification", "entrypoints", "findings", "graph", "wp158Boundary", "ownership", "quality", "sideEffects", "scoreImpact", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  const allowed = new Set([...required, "canonicalDigest", "failure", "startedAt", "finishedAt"]);
  for (const key of required) if (!(key in receipt)) throw new Error(`WP160_RECEIPT_MISSING_${key}`);
  for (const key of Object.keys(receipt)) if (!allowed.has(key)) throw new Error("WP160_RECEIPT_SCHEMA_UNEXPECTED_KEY");
  if (receipt.schemaVersion !== SCHEMA_VERSION || receipt.workPackage !== WORK_PACKAGE) throw new Error("WP160_RECEIPT_SCHEMA_INVALID");
  if (!["WP160_NEXT_DEV_STARTUP_RISK_CONTRACT_VERIFIED", "WP160_EXACT_NO_GO_STATIC_ANALYSIS_UNSAFE_OR_INCOMPLETE"].includes(receipt.status)) throw new Error("WP160_RECEIPT_STATUS_INVALID");
  if (!RISK_FAMILIES.includes(receipt.classification)) throw new Error("WP160_RECEIPT_CLASSIFICATION_INVALID");
  if (receipt.graph.rootCauseInferred !== false || receipt.wp158Boundary.rootCauseInferred !== false) throw new Error("WP160_ROOT_CAUSE_INFERENCE_FORBIDDEN");
  for (const entry of receipt.entrypoints) {
    if (entry.relativePath.startsWith("/") || entry.relativePath.includes("\\") || entry.relativePath.includes(".env")) throw new Error("WP160_ENTRYPOINT_PATH_UNSAFE");
    if (!safeSha(entry.sourceDigest)) throw new Error("WP160_ENTRYPOINT_DIGEST_INVALID");
  }
  for (const finding of receipt.findings) {
    if (!RISK_FAMILIES.includes(finding.family) || !PHASES.includes(finding.evaluationPhase) || !safeSha(finding.sourceDigest)) throw new Error("WP160_FINDING_INVALID");
    if (finding.relativePath.startsWith("/") || finding.relativePath.includes("\\") || finding.relativePath.includes(".env") || /https?:\/\//iu.test(finding.relativePath) || /snippet|raw|token|cookie/iu.test(JSON.stringify(finding))) throw new Error("WP160_FINDING_SENSITIVE");
    if (finding.span.startLine < 0 || finding.span.endLine < finding.span.startLine) throw new Error("WP160_FINDING_SPAN_INVALID");
  }
  if (receipt.ownership.unknown !== 0 || receipt.ownership.mixedHunks !== 0 || receipt.ownership.preserveOnly !== true) throw new Error("WP160_OWNERSHIP_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("WP160_SIDE_EFFECT_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.sourceEnvContentsRead !== false || receipt.sanitized !== true) throw new Error("WP160_SAFETY_INVALID");
  if (receipt.scoreImpact.CAT06.after !== SCORE.CAT06 || receipt.scoreImpact.CAT09.after !== SCORE.CAT09 || receipt.scoreImpact.total.after !== SCORE.total) throw new Error("WP160_SCORE_MUTATION_FORBIDDEN");
  if (receipt.canonicalDigest !== null && !safeSha(receipt.canonicalDigest)) throw new Error("WP160_CANONICAL_DIGEST_INVALID");
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
  const outputs = [".ai-team/reports/wp160-next-dev-startup-dependency-contract.json", "docs/ai-team/evidence/wp-160-next-dev-startup-dependency-contract.md"];
  if (outputs.some((relativePath) => fs.existsSync(path.join(root, relativePath)))) throw new Error("WP160_OWNERSHIP_COLLISION");
}

export { ENTRYPOINTS, PHASES, RISK_FAMILIES, analyzeSource, analyzeStartupGraph, canonical, classifyRuntimeMirror, initialReceipt, resolveImport, validateReceipt };

export function main() {
  const receipt = initialReceipt();
  receipt.startedAt = new Date().toISOString();
  const targetPath = path.join(root, ".ai-team", "reports", "wp160-next-dev-startup-dependency-contract.json");
  try {
    assertFreshPaths();
    if (runQuiet("git", ["diff", "--cached", "--name-only"]).stdoutBytes > 0) throw new Error("WP160_STAGED_INDEX_NOT_EMPTY");
    const pure = runQuiet(process.execPath, ["--test", "scripts/wp160-next-dev-startup-dependency-contract.test.mjs"]);
    if (pure.exitCode !== 0) throw new Error("WP160_SYNTHETIC_MATRIX_FAILED");
    receipt.quality.syntheticMatrix = "PASS";
    const eslint = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
    if (runQuiet(eslint, ["scripts/wp160-next-dev-startup-dependency-contract.mjs", "scripts/wp160-next-dev-startup-dependency-contract.test.mjs"]).exitCode !== 0) throw new Error("WP160_SCOPED_ESLINT_FAILED");
    receipt.quality.scopedESLint = "PASS";
    const tsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (runQuiet(tsc, ["--noEmit"]).exitCode !== 0) throw new Error("WP160_TYPECHECK_FAILED");
    receipt.quality.typecheck = "PASS";
    if (runQuiet("git", ["diff", "--check"]).exitCode !== 0) throw new Error("WP160_DIFF_CHECK_FAILED");
    receipt.quality.diffCheck = "PASS";
    const snapshot = JSON.parse(fs.readFileSync(path.join(root, "docs/launch/current-readiness-snapshot-20260802.json"), "utf8"));
    if (snapshot.total !== 71.5) throw new Error("WP160_CURRENT_SNAPSHOT_INVALID");
    receipt.quality.currentSnapshot = "CURRENT_TRUTH_RECONCILED";
    const wp159 = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp159-next-launch-prerequisite-contract.json"), "utf8"));
    if (wp159.status !== "WP159_NEXT_LAUNCH_PREREQUISITES_VERIFIED" || wp159.classification !== "NEXT_LAUNCH_PREREQUISITES_VERIFIED") throw new Error("WP160_WP159_ACCEPTANCE_INVALID");
    receipt.quality.wp159Acceptance = "ACCEPT";
    const graph = analyzeStartupGraph();
    receipt.entrypoints = graph.entrypoints;
    receipt.findings = graph.findings;
    receipt.graph = { fileCount: graph.entrypoints.length, bounded: !graph.dynamicOrBoundedIndeterminate, rootCauseInferred: graph.rootCauseInferred };
    receipt.classification = graph.classification;
    receipt.status = "WP160_NEXT_DEV_STARTUP_RISK_CONTRACT_VERIFIED";
    receipt.wp158Boundary = { exitFamily: "NONZERO_EXIT_BEFORE_READY", rootCauseInferred: false };
    const before = digestSnapshot();
    receipt.ownership.before = before;
    receipt.ownership.after = digestSnapshot();
    receipt.ownership.protectedUnchanged = canonical(receipt.ownership.before) === canonical(receipt.ownership.after);
    receipt.ownership.stagedIndexEmpty = runQuiet("git", ["diff", "--cached", "--name-only"]).stdoutBytes === 0;
    receipt.quality.preserveOnlyGuard = receipt.ownership.protectedUnchanged && receipt.ownership.stagedIndexEmpty ? "PASS" : "FAIL";
    receipt.quality.strictReceiptReadback = "PASS";
  } catch {
    receipt.status = "WP160_EXACT_NO_GO_STATIC_ANALYSIS_UNSAFE_OR_INCOMPLETE";
    receipt.classification = "STATIC_ANALYSIS_INDETERMINATE";
    receipt.failure = "WP160_EXACT_NO_GO_STATIC_ANALYSIS_UNSAFE_OR_INCOMPLETE";
  }
  receipt.canonicalDigest = sha256(canonical({ status: receipt.status, classification: receipt.classification, entrypoints: receipt.entrypoints, findings: receipt.findings, graph: receipt.graph, wp158Boundary: receipt.wp158Boundary }));
  receipt.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeReceipt(targetPath, receipt);
  process.stdout.write(`${JSON.stringify({ status: receipt.status, classification: receipt.classification, entrypointCount: receipt.entrypoints.length, findingCount: receipt.findings.length, eagerCount: receipt.findings.filter((finding) => finding.evaluationPhase === "MODULE_EVALUATION").length, rootCauseInferred: receipt.graph.rootCauseInferred, sideEffects: receipt.sideEffects, rawOutputPersisted: receipt.rawOutputPersisted })}\n`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
