import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CLASSIFICATIONS = Object.freeze({
  CLEAN_SEPARABLE_CANDIDATE: "CLEAN_SEPARABLE_CANDIDATE",
  PRESERVE_ONLY_EXACT_PATH: "PRESERVE_ONLY_EXACT_PATH",
  CONFIG_BOUNDARY: "CONFIG_BOUNDARY",
  DEPENDENCY_OR_LOCKFILE_BOUNDARY: "DEPENDENCY_OR_LOCKFILE_BOUNDARY",
  GENERATED_ARTIFACT_BOUNDARY: "GENERATED_ARTIFACT_BOUNDARY",
  NONDETERMINISTIC_FAILURE: "NONDETERMINISTIC_FAILURE",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

const PATH_PATTERN = /(?:[A-Za-z]:\\[^\s)\]>'"]+|(?:src|app|pages|scripts|prisma|public|tests|docs|node_modules|\.next)\/[A-Za-z0-9_./()\[\]-]+\.[A-Za-z0-9_-]+|(?:next\.config\.[A-Za-z0-9]+|tsconfig(?:\.[A-Za-z0-9]+)*|package(?:-lock)?\.json))/g;

export function sanitize(value) {
  return String(value ?? "")
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/https?:\/\/[^\s)]+/gi, "<url>")
    .replaceAll(/[A-Za-z]:\\[^\r\n\s)\]>'"]+/g, "<absolute-path>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, "=<value>")
    .replaceAll(/(['"`])(?:\\.|(?!\1).)*\1/g, "<value>");
}

export function normalizeDiagnostic(output, workspaceRoot) {
  const raw = String(output ?? "");
  const clean = sanitize(raw);
  const diagnostics = new Set();
  if (/failed to compile|type error|typescript/i.test(clean)) diagnostics.add("TYPE_ERROR");
  if (/build worker|worker exited/i.test(clean)) diagnostics.add("BUILD_WORKER_EXIT");
  if (/module not found|cannot find module|could not resolve/i.test(clean)) diagnostics.add("MODULE_RESOLUTION");
  if (/prerender|collecting page data|generating static/i.test(clean)) diagnostics.add("STATIC_RENDER");
  if (/next\.config|invalid.*config/i.test(clean)) diagnostics.add("NEXT_CONFIG");
  if (/dotenv|environment|missing required/i.test(clean)) diagnostics.add("ENVIRONMENT");
  if (diagnostics.size === 0) diagnostics.add("UNKNOWN");
  const pathSet = new Set();
  const rootPrefix = workspaceRoot.replaceAll("\\", "/").replace(/\/$/, "");
  for (const match of raw.matchAll(PATH_PATTERN)) {
    const candidate = match[0].replaceAll("\\", "/");
    if (candidate === "<absolute-path>" || candidate.includes("<value>")) continue;
    const relative = candidate.startsWith(`${rootPrefix}/`)
      ? candidate.slice(rootPrefix.length + 1)
      : candidate.match(/(?:src|app|pages|scripts|prisma|public|tests|docs|node_modules|\.next)\/.+$/)?.[0] ?? candidate;
    if (!relative.startsWith(".env")) pathSet.add(relative);
  }
  const normalized = {
    phase: diagnostics.has("TYPE_ERROR") ? "typecheck-or-webpack" : diagnostics.has("STATIC_RENDER") ? "static-render" : diagnostics.has("BUILD_WORKER_EXIT") ? "build-worker" : "unknown",
    diagnosticCodes: [...diagnostics].sort(),
    relativePaths: [...pathSet].sort(),
    lineCount: clean.split(/\r?\n/).filter(Boolean).length,
    fingerprint: crypto.createHash("sha256").update(clean).digest("hex"),
    rawPersisted: false,
    sourceSnippetsPersisted: false,
  };
  return normalized;
}

function classifyOwnership(filePath, metadata) {
  if (filePath.startsWith(".next/") || filePath.startsWith("dist/")) return CLASSIFICATIONS.GENERATED_ARTIFACT_BOUNDARY;
  if (filePath.startsWith("node_modules/") || /(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock)/.test(filePath)) return CLASSIFICATIONS.DEPENDENCY_OR_LOCKFILE_BOUNDARY;
  if (/^(?:next\.config\.|tsconfig|package\.json)/.test(filePath)) return CLASSIFICATIONS.CONFIG_BOUNDARY;
  if (metadata?.dirty) return CLASSIFICATIONS.PRESERVE_ONLY_EXACT_PATH;
  return CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE;
}

export function extractImportChain(filePath, workspaceRoot, maxDepth = 2) {
  const chain = new Set();
  function visit(current, depth) {
    if (depth > maxDepth || chain.has(current)) return;
    chain.add(current);
    let source;
    try {
      source = fs.readFileSync(path.join(workspaceRoot, current), "utf8");
    } catch {
      return;
    }
    const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map((match) => match[2]).sort();
    for (const specifier of imports) {
      if (specifier.startsWith("@/")) {
        const alias = specifier.slice(2);
        for (const extension of [".ts", ".tsx", ".js", ".jsx"])
          if (fs.existsSync(path.join(workspaceRoot, "src", `${alias}${extension}`))) visit(`src/${alias}${extension}`, depth + 1);
      } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(current), specifier));
        for (const extension of ["", ".ts", ".tsx", ".js", ".jsx"])
          if (fs.existsSync(path.join(workspaceRoot, `${base}${extension}`))) visit(`${base}${extension}`, depth + 1);
      }
    }
  }
  visit(filePath, 0);
  return [...chain].sort();
}

export function auditBoundary(input) {
  const normalized = input.normalized ?? normalizeDiagnostic(input.output, input.workspaceRoot);
  const paths = normalized.relativePaths;
  if (input.fingerprintStable === false) return { classification: CLASSIFICATIONS.NONDETERMINISTIC_FAILURE, confidence: "fail-closed", normalized };
  if (paths.length === 0 || normalized.diagnosticCodes.includes("UNKNOWN")) return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, confidence: "fail-closed", normalized };
  if (normalized.diagnosticCodes.includes("MODULE_RESOLUTION") && normalized.diagnosticCodes.includes("TYPE_ERROR")) return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, confidence: "conflicting-signals", normalized };
  const metadata = input.pathMetadata ?? {};
  const classifications = paths.map((filePath) => classifyOwnership(filePath, metadata[filePath]));
  const unique = [...new Set(classifications)];
  const classification = unique.length === 1 ? unique[0] : CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  return {
    classification,
    confidence: classification === CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED ? "fail-closed" : "deterministic",
    normalized,
    paths: paths.map((filePath, index) => ({ path: filePath, ownership: metadata[filePath]?.dirty ? "PRESERVE_ONLY" : "CLEAN_OR_UNCHANGED", classification: classifications[index] })),
  };
}
