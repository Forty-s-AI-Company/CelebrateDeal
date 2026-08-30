import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const OUTCOMES = Object.freeze({
  CLEAN_SEPARABLE_CANDIDATE: "CLEAN_SEPARABLE_CANDIDATE",
  EXACT_NO_GO: "EXACT_NO_GO",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

const EXPECTED_GENERATED_PATH = ".next/types/app/api/cloudflare/stream-webhook/route.ts";
const EXPECTED_SOURCE_PATH = "src/app/api/cloudflare/stream-webhook/route.ts";
const EXPECTED_EXPORTS = Object.freeze(["POST", "createCloudflareStreamWebhookHandler"]);

function posix(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

export function mapGeneratedToSource(generatedPath) {
  const normalized = posix(generatedPath);
  if (!normalized.startsWith(".next/types/")) return null;
  return `src/${normalized.slice(".next/types/".length)}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function extractExportInventory(sourceText) {
  const source = String(sourceText ?? "");
  const exports = [];
  const add = (name, kind, index) => {
    const line = source.slice(0, index).split(/\r?\n/).length;
    exports.push({ name, kind, line });
  };
  for (const match of source.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    add(match[1], "function", match.index);
  }
  for (const match of source.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    const declaration = match[0].match(/\b(const|let|var)\b/);
    add(match[1], declaration?.[1] ?? "const", match.index);
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const item of match[1].split(",")) {
      const name = item.trim().split(/\s+as\s+/i).at(-1)?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) add(name, "named", match.index);
    }
  }
  return exports.sort((left, right) => left.name.localeCompare(right.name));
}

export function extractImportPaths(sourceText) {
  const source = String(sourceText ?? "");
  const imports = new Set();
  for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
    const specifier = match[2];
    if (specifier.startsWith("@/")) imports.add(`src/${specifier.slice(2)}`);
    else if (specifier.startsWith(".") || specifier.startsWith("/")) imports.add(specifier);
    else imports.add("<package>");
  }
  return [...imports].sort();
}

export function extractSymbolSpans(sourceText, inventory = extractExportInventory(sourceText)) {
  const lines = String(sourceText ?? "").split(/\r?\n/);
  return inventory.map((item) => {
    let end = item.line;
    for (let index = item.line; index < lines.length; index += 1) {
      if (index > item.line - 1 && /^export\s+/.test(lines[index])) break;
      end = index + 1;
    }
    return { name: item.name, startLine: item.line, endLine: end };
  });
}

export function parseDiffHunks(diffText) {
  const hunks = [];
  for (const line of String(diffText ?? "").split(/\r?\n/)) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
    const startLine = Number(match[1]);
    const count = Number(match[2] ?? 1);
    hunks.push({ startLine, endLine: startLine + Math.max(count, 1) - 1 });
  }
  return hunks;
}

export function spansOverlap(hunks, spans) {
  return spans.some((span) => hunks.some((hunk) => hunk.startLine <= span.endLine && span.startLine <= hunk.endLine));
}

function gitOutput(workspaceRoot, args) {
  try {
    return execFileSync("git", args, { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function pathOwnership(workspaceRoot, sourcePath) {
  const status = gitOutput(workspaceRoot, ["status", "--short", "--untracked-files=all", "--", sourcePath]).trim();
  const staged = gitOutput(workspaceRoot, ["diff", "--cached", "--name-only", "--", sourcePath]).trim();
  const diff = gitOutput(workspaceRoot, ["diff", "--unified=0", "--", sourcePath]);
  const dirtyHunks = parseDiffHunks(diff);
  return {
    statusPresent: status.length > 0,
    stagedPresent: staged.length > 0,
    dirtyHunkCount: dirtyHunks.length,
    statusDigest: status ? sha256(status) : null,
    dirtyHunks,
  };
}

export function classifySourceOwnership(ownership, spans) {
  if (ownership.stagedPresent || ownership.statusPresent) {
    return {
      classification: OUTCOMES.EXACT_NO_GO,
      ownership: "PRESERVE_ONLY",
      overlap: spansOverlap(ownership.dirtyHunks, spans),
    };
  }
  return {
    classification: OUTCOMES.CLEAN_SEPARABLE_CANDIDATE,
    ownership: "CLEAN_OR_UNCHANGED",
    overlap: false,
  };
}

export function analyzeRouteContract({ workspaceRoot, generatedPath = EXPECTED_GENERATED_PATH, sourcePath = EXPECTED_SOURCE_PATH, generatedArtifactPresent = false }) {
  const mappedSourcePath = mapGeneratedToSource(generatedPath);
  if (!mappedSourcePath || posix(sourcePath) !== mappedSourcePath || posix(generatedPath) !== EXPECTED_GENERATED_PATH) {
    return { status: OUTCOMES.UNKNOWN_FAIL_CLOSED, reason: "UNSTABLE_PATH_MAPPING" };
  }
  const absoluteSourcePath = path.join(workspaceRoot, ...sourcePath.split("/"));
  if (!fs.existsSync(absoluteSourcePath)) {
    return { status: OUTCOMES.UNKNOWN_FAIL_CLOSED, reason: "SOURCE_PATH_MISSING", generatedPath, sourcePath };
  }
  const sourceText = fs.readFileSync(absoluteSourcePath, "utf8");
  const inventory = extractExportInventory(sourceText);
  const exportedNames = inventory.map((item) => item.name);
  const expectedExportsPresent = EXPECTED_EXPORTS.every((name) => exportedNames.includes(name));
  const unexpectedExports = exportedNames.filter((name) => !EXPECTED_EXPORTS.includes(name));
  const spans = extractSymbolSpans(sourceText, inventory);
  const imports = extractImportPaths(sourceText);
  const ownership = pathOwnership(workspaceRoot, sourcePath);
  const ownershipResult = classifySourceOwnership(ownership, spans);
  if (!expectedExportsPresent || unexpectedExports.length > 0) {
    return {
      status: OUTCOMES.UNKNOWN_FAIL_CLOSED,
      reason: "ROUTE_CONTRACT_MISMATCH",
      generatedPath,
      sourcePath,
      generatedArtifactPresent,
      expectedExportsPresent,
      unexpectedExportCount: unexpectedExports.length,
      exportedSymbols: exportedNames,
      importCount: imports.length,
      ownership: ownershipResult,
    };
  }
  return {
    status: ownershipResult.classification,
    reason: ownershipResult.classification === OUTCOMES.EXACT_NO_GO ? "SOURCE_PATH_DIRTY_PRESERVE_ONLY" : "SOURCE_PATH_CLEAN_SEPARABLE",
    generatedPath,
    sourcePath,
    mappedSourcePath,
    generatedArtifactPresent,
    generatedArtifactState: generatedArtifactPresent ? "PRESENT" : "ABSENT_WORKSPACE_NOT_REGENERATED",
    expectedExportsPresent,
    exportedSymbols: exportedNames,
    exportKinds: inventory.map(({ name, kind }) => ({ name, kind })),
    importCount: imports.length,
    importPathDigest: sha256(imports.join("\n")),
    ownership: {
      ...ownershipResult,
      dirtyHunkCount: ownership.dirtyHunkCount,
      statusPresent: ownership.statusPresent,
      stagedPresent: ownership.stagedPresent,
      statusDigest: ownership.statusDigest,
    },
    sourceDigest: sha256(sourceText),
    rawSourcePersisted: false,
    sourceSnippetsPersisted: false,
  };
}

export const CONTRACT = Object.freeze({ EXPECTED_GENERATED_PATH, EXPECTED_SOURCE_PATH, EXPECTED_EXPORTS });
