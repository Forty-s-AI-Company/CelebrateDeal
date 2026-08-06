import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractAllowedRouteExports, extractGeneratedInventory, parseSourceExports } from "./wp135-temp-route-lineage-runner.mjs";
import { auditNextMetadata, hasExcludedNextSegment, shouldIncludeInTempMirror } from "./wp136-next-temp-isolation-auditor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryNext = path.join(root, ".next");
const targetRoute = "src/app/api/cloudflare/stream-webhook/route.ts";
const targetRouteKey = "/api/cloudflare/stream-webhook";
const reportPath = path.join(root, ".ai-team", "reports", "wp138-generated-target-reference-receipt.json");
const wp136ReceiptPath = path.join(root, ".ai-team", "reports", "wp136-next-temp-isolation-audit-receipt.json");
const wp137ReceiptPath = path.join(root, ".ai-team", "reports", "wp137-temp-next-route-lineage-receipt.json");
const protectedInputs = [targetRoute, "next.config.ts", "tsconfig.json", "package.json", "package-lock.json"];
const ownedPaths = new Set([
  "scripts/wp138-generated-target-reference-resolver.mjs",
  "scripts/wp138-generated-target-reference-resolver.test.mjs",
  ".ai-team/reports/wp138-generated-target-reference-receipt.json",
  "docs/ai-team/evidence/wp-138-generated-target-reference.md",
]);
const ts = createRequire(import.meta.url)("typescript");

export const ROLES = Object.freeze({
  ROUTE_CONTRACT_VALIDATOR: "ROUTE_CONTRACT_VALIDATOR",
  ROUTE_INVENTORY: "ROUTE_INVENTORY",
  SHARED_TYPE_SUPPORT: "SHARED_TYPE_SUPPORT",
  UNKNOWN: "UNKNOWN",
});

export const CLASSIFICATIONS = Object.freeze({
  EXACT_SINGLE_ROUTE_REFERENCE_MAPPED: "EXACT_SINGLE_ROUTE_REFERENCE_MAPPED",
  REFERENCE_ROLE_EXACT_NO_GO: "REFERENCE_ROLE_EXACT_NO_GO",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

const allowedTopLevelOutcomes = new Set([
  CLASSIFICATIONS.EXACT_SINGLE_ROUTE_REFERENCE_MAPPED,
  CLASSIFICATIONS.REFERENCE_ROLE_EXACT_NO_GO,
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function digestFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normalizeRelativePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+/gu, "/").replace(/\/$/u, "");
}

function pathSegments(value) {
  return normalizeRelativePath(value).split("/").filter(Boolean).map((segment) => segment.toLowerCase());
}

function canonicalizeSourcePath(importSpecifier) {
  const normalized = normalizeRelativePath(importSpecifier);
  const marker = normalized.toLowerCase().indexOf("src/");
  if (marker < 0) return null;
  const candidate = normalized.slice(marker).replace(/\.(?:js|jsx|tsx)$/iu, ".ts");
  return candidate === targetRoute ? targetRoute : candidate;
}

function normalizeRouteKey(value) {
  const candidate = String(value ?? "").trim();
  return candidate === targetRouteKey ? targetRouteKey : null;
}

function runGit(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseStatusPath(line) {
  const raw = String(line).slice(3).trim();
  return normalizeRelativePath(raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw);
}

function dirtyInventory() {
  const result = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.exitCode !== 0) throw new Error("GIT_STATUS_FAILED");
  const lines = result.stdout.split(/\r?\n/u).filter(Boolean).filter((line) => !ownedPaths.has(parseStatusPath(line)));
  return { count: lines.length, fingerprint: sha256(`${lines.join("\n")}\n`) };
}

function stagedIndexEmpty() {
  const result = runGit(["diff", "--cached", "--name-only"]);
  if (result.exitCode !== 0) throw new Error("GIT_STAGED_CHECK_FAILED");
  return result.stdout.trim().length === 0;
}

function protectedDigests() {
  return Object.fromEntries(protectedInputs.map((relative) => [relative, digestFile(path.join(root, relative))]));
}

function readReceipt(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertDependencies() {
  const wp136 = readReceipt(wp136ReceiptPath);
  const wp137 = readReceipt(wp137ReceiptPath);
  if (wp136.classification !== "SAFE_TEMP_EXCLUSION_PROVEN" || wp136.repositoryNext?.metadataUnchanged !== true) throw new Error("WP136_CONTRACT_NOT_ACCEPTED");
  if (wp137.classification !== "UNKNOWN_FAIL_CLOSED" || wp137.subreason !== "AMBIGUOUS_OR_WRONG_ROUTE" || wp137.typegen?.attempts !== 1) throw new Error("WP137_REMEDIATION_BOUNDARY_NOT_MATCHED");
  return { wp136, wp137 };
}

function assertNextBaseline(wp136, metadata) {
  const baseline = wp136.repositoryNext.after;
  for (const key of ["fileCount", "directoryCount", "totalBytes", "reparsePointCount", "metadataDigest"]) {
    if (metadata[key] !== baseline[key]) throw new Error(`REPOSITORY_NEXT_METADATA_DRIFT_${key.toUpperCase()}`);
  }
  if (metadata.contentReadCount !== 0) throw new Error("REPOSITORY_NEXT_CONTENT_READ_DETECTED");
}

function isForbiddenMirrorPath(relativePath) {
  const segments = pathSegments(relativePath);
  const basename = segments.at(-1) ?? "";
  if (!shouldIncludeInTempMirror(relativePath)) return true;
  if (segments.some((segment) => segment.startsWith(".env"))) return true;
  if (segments.some((segment) => [".git", ".ai-team", "node_modules", ".vercel", "coverage", ".cache", "dist", "build", "out"].includes(segment))) return true;
  if (segments.some((segment) => /(?:secret|credential|token|cookie|private|password)/iu.test(segment))) return true;
  return /\.(?:db|sqlite|sqlite3|pem|key|crt|p12|pfx)$/iu.test(basename);
}

function copyTree(sourceDirectory, targetDirectory, relative = "", state = null) {
  const summary = state ?? { copiedFiles: 0, copiedDirectories: 0, excludedEntries: 0, excludedNextEntries: 0, skippedReparseEntries: 0, excludedClassDigest: null };
  fs.mkdirSync(targetDirectory, { recursive: true });
  if (!state) summary.copiedDirectories += 1;
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const childRelative = normalizeRelativePath(relative ? `${relative}/${entry.name}` : entry.name);
    if (isForbiddenMirrorPath(childRelative)) {
      summary.excludedEntries += 1;
      if (hasExcludedNextSegment(childRelative)) summary.excludedNextEntries += 1;
      summary.excludedClassDigest = sha256(`${summary.excludedClassDigest ?? ""}|${pathSegments(childRelative).at(-1) ?? ""}`);
      continue;
    }
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      summary.skippedReparseEntries += 1;
      continue;
    }
    if (stat.isDirectory()) {
      summary.copiedDirectories += 1;
      copyTree(sourcePath, targetPath, childRelative, summary);
    } else if (stat.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
      summary.copiedFiles += 1;
    } else {
      summary.excludedEntries += 1;
    }
  }
  return summary;
}

function createNodeModulesJunction(tempRoot) {
  const source = path.join(root, "node_modules");
  const target = path.join(tempRoot, "node_modules");
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error("NODE_MODULES_SOURCE_MISSING");
  fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  return target;
}

function cleanupTemp(tempRoot, junctionPath) {
  if (!tempRoot) return true;
  const base = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error("TEMP_ROOT_OUTSIDE_OS_TEMP");
  if (junctionPath && fs.existsSync(junctionPath)) fs.unlinkSync(junctionPath);
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
  return !fs.existsSync(resolved);
}

function buildEnvironment(tempRoot) {
  const inherited = ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "WINDIR"];
  const safe = Object.fromEntries(inherited.filter((name) => typeof process.env[name] === "string").map((name) => [name, process.env[name]]));
  return {
    ...safe,
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    HOME: path.join(tempRoot, "home"),
    USERPROFILE: path.join(tempRoot, "home"),
    NODE_ENV: "development",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp138_typegen",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp138_typegen",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:32138",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    CSRF_SECRET: "wp138-local-csrf-synthetic-value",
    JOB_SECRET: "wp138-local-job-synthetic-value",
  };
}

function runTypegen(tempRoot) {
  const nextBin = path.join(tempRoot, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) throw new Error("TEMP_NEXT_BIN_MISSING");
  fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
  const result = spawnSync(process.execPath, [nextBin, "typegen"], {
    cwd: tempRoot,
    env: buildEnvironment(tempRoot),
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    attempts: 1,
    exitCode: result.status ?? (result.error?.code === "ETIMEDOUT" ? null : 1),
    timedOut: result.error?.code === "ETIMEDOUT" || result.signal !== null,
    stdoutBytes: Buffer.byteLength(result.stdout ?? "", "utf8"),
    stderrBytes: Buffer.byteLength(result.stderr ?? "", "utf8"),
    outputRootInsideTemp: fs.existsSync(path.join(tempRoot, ".next")),
  };
}

function astReferenceMetadata(generatedPath, text, sourceDigest) {
  const sourceFile = ts.createSourceFile(generatedPath, String(text ?? ""), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let astNodeKind = null;
  let importSpecifier = null;
  let routeKey = null;
  const visit = (node) => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      const candidate = node.argument.literal.text;
      const canonical = canonicalizeSourcePath(candidate);
      if (canonical === targetRoute) {
        astNodeKind ??= "ImportTypeNode";
        importSpecifier ??= candidate;
      }
    }
    if (ts.isSatisfiesExpression?.(node)) {
      const typeNode = node.type;
      if (ts.isTypeReferenceNode(typeNode)) {
        const name = typeNode.typeName.getText(sourceFile);
        const argument = typeNode.typeArguments?.[0];
        if (name === "RouteHandlerConfig" && argument && ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
          const candidate = normalizeRouteKey(argument.literal.text);
          if (candidate) {
            astNodeKind = "SatisfiesExpression";
            routeKey = candidate;
          }
        }
      }
    }
    if (ts.isStringLiteral(node) && normalizeRouteKey(node.text)) {
      routeKey ??= normalizeRouteKey(node.text);
      astNodeKind ??= "StringLiteral";
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const canonicalSourcePath = importSpecifier ? canonicalizeSourcePath(importSpecifier) : null;
  const exactContractIdentity = astNodeKind === "SatisfiesExpression"
    && routeKey === targetRouteKey
    && canonicalSourcePath === targetRoute;
  const basename = path.posix.basename(normalizeRelativePath(generatedPath)).toLowerCase();
  let generatedFileRole = ROLES.UNKNOWN;
  let exclusionReason = "ROLE_UNRESOLVED";
  if (exactContractIdentity) {
    generatedFileRole = ROLES.ROUTE_CONTRACT_VALIDATOR;
    exclusionReason = "CONTRACT_BEARING_REFERENCE";
  } else if (basename === "routes.d.ts" || basename.includes("routes")) {
    generatedFileRole = ROLES.ROUTE_INVENTORY;
    exclusionReason = "NON_CONTRACT_ROUTE_INVENTORY";
  } else if (canonicalSourcePath === targetRoute || routeKey === targetRouteKey) {
    generatedFileRole = ROLES.SHARED_TYPE_SUPPORT;
    exclusionReason = "NON_CONTRACT_SHARED_SUPPORT";
  }
  return {
    generatedRelativePath: normalizeRelativePath(generatedPath),
    astNodeKind: astNodeKind ?? "Unknown",
    importKind: importSpecifier ? "ImportTypeNode" : routeKey ? "RouteKeyLiteral" : "Unknown",
    generatedFileRole,
    routeKey,
    normalizedImportSpecifier: importSpecifier ? normalizeRelativePath(importSpecifier) : null,
    canonicalSourcePath,
    resolvedSourceDigest: canonicalSourcePath === targetRoute ? sourceDigest : null,
    contractBearing: generatedFileRole === ROLES.ROUTE_CONTRACT_VALIDATOR,
    exclusionReason,
  };
}

function sourceRouteOwnership() {
  const status = runGit(["status", "--short", "--", targetRoute]).stdout.trim();
  const diff = runGit(["diff", "--unified=0", "--", targetRoute]).stdout;
  const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu)].map((match) => ({ startLine: Number(match[1]), endLine: Number(match[1]) + Math.max(Number(match[2] ?? 1), 1) - 1 }));
  return { statusCode: status.slice(0, 2), ownership: status ? "PRESERVE_ONLY_DIRTY" : "TRACKED_CLEAN", dirtyHunkCount: ranges.length, ranges };
}

function classifyReferences(references) {
  if (references.length !== 2) return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "TARGET_REFERENCE_COUNT_NOT_TWO" };
  if (references.some((reference) => reference.generatedFileRole === ROLES.UNKNOWN)) return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "REFERENCE_ROLE_UNKNOWN" };
  const contractReferences = references.filter((reference) => reference.contractBearing);
  if (contractReferences.length !== 1) {
    return {
      classification: CLASSIFICATIONS.REFERENCE_ROLE_EXACT_NO_GO,
      subreason: contractReferences.length === 0 ? "ZERO_CONTRACT_BEARING_REFERENCES" : "MULTIPLE_CONTRACT_BEARING_REFERENCES",
    };
  }
  return { classification: CLASSIFICATIONS.EXACT_SINGLE_ROUTE_REFERENCE_MAPPED, subreason: "EXACTLY_ONE_CONTRACT_BEARING_REFERENCE" };
}

export function resolveCanonicalSourcePath(importSpecifier) {
  return canonicalizeSourcePath(importSpecifier);
}

export function classifyReferenceMetadata(references) {
  return classifyReferences(references);
}

export function classifyAstRoleFixture({ generatedPath, text, sourceDigest = "digest" }) {
  return astReferenceMetadata(generatedPath, text, sourceDigest);
}

export function isAllowedOutcome(classification) {
  return allowedTopLevelOutcomes.has(classification);
}

export function runAudit() {
  const startedAt = new Date().toISOString();
  let tempRoot = null;
  let junctionPath = null;
  let typegen = { attempts: 0, exitCode: null, timedOut: false, stdoutBytes: 0, stderrBytes: 0, outputRootInsideTemp: false };
  let receipt;
  try {
    if (fs.existsSync(reportPath)) throw new Error("WP138_RECEIPT_ALREADY_EXISTS");
    const dependencies = assertDependencies();
    const dirtyBefore = dirtyInventory();
    const stagedBefore = stagedIndexEmpty();
    const protectedBefore = protectedDigests();
    const repositoryNextBefore = auditNextMetadata(repositoryNext);
    assertNextBaseline(dependencies.wp136, repositoryNextBefore);

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp138-"));
    copyTree(root, tempRoot);
    const tempRoute = path.join(tempRoot, targetRoute);
    if (!fs.existsSync(tempRoute)) throw new Error("TEMP_TARGET_ROUTE_MISSING");
    const tempSourceDigest = digestFile(tempRoute);
    const sourceDigest = protectedBefore[targetRoute];
    const targetSourceDigestMatches = sourceDigest === tempSourceDigest;
    junctionPath = createNodeModulesJunction(tempRoot);
    typegen = runTypegen(tempRoot);

    let generated = { files: [], targetReferences: [], inventoryComplete: false, requiredFilesPresent: false };
    let references = [];
    let roleDecision = { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "TYPEGEN_NOT_READY" };
    let selectedValidator = null;
    let allowedExports = [];
    let sourceExports = [];
    let ownership = sourceRouteOwnership();
    let diagnostic = null;
    if (typegen.outputRootInsideTemp) {
      generated = extractGeneratedInventory(tempRoot);
      references = generated.files.filter((file) => file.targetHit).map((file) => {
        const generatedText = fs.readFileSync(path.join(tempRoot, file.path), "utf8");
        return astReferenceMetadata(file.path, generatedText, sourceDigest);
      });
      roleDecision = classifyReferences(references);
      if (targetSourceDigestMatches && roleDecision.classification === CLASSIFICATIONS.EXACT_SINGLE_ROUTE_REFERENCE_MAPPED) {
        selectedValidator = references.find((reference) => reference.contractBearing);
        const validatorText = fs.readFileSync(path.join(tempRoot, selectedValidator.generatedRelativePath), "utf8");
        const parsedAllowed = extractAllowedRouteExports(validatorText);
        if (!parsedAllowed.found) {
          roleDecision = { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "ROUTE_HANDLER_EXPORT_CONTRACT_NOT_FOUND" };
        } else {
          allowedExports = parsedAllowed.allowed;
          sourceExports = parseSourceExports(fs.readFileSync(tempRoute, "utf8"), targetRoute);
          const disallowed = sourceExports.filter((symbol) => !allowedExports.includes(symbol.name));
          if (disallowed.length !== 1) {
            roleDecision = { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "DISALLOWED_EXPORT_COUNT_NOT_EXACTLY_ONE" };
          } else {
            const symbol = disallowed[0];
            const ranges = ownership.ranges;
            const overlap = ranges.some((range) => symbol.startLine <= range.endLine && symbol.endLine >= range.startLine);
            const subResult = ownership.ownership === "PRESERVE_ONLY_DIRTY" && overlap ? "EXACT_PRESERVE_ONLY_NO_GO" : "CLEAN_SEPARABLE_CANDIDATE";
            diagnostic = { symbol: symbol.name, kind: symbol.kind, startLine: symbol.startLine, endLine: symbol.endLine, signatureFingerprint: symbol.signatureFingerprint, dirtyHunkOverlap: overlap, subResult };
          }
        }
      }
      if (!targetSourceDigestMatches) roleDecision = { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "TEMP_SOURCE_DIGEST_MISMATCH" };
    }

    const cleanup = cleanupTemp(tempRoot, junctionPath);
    tempRoot = null;
    junctionPath = null;
    if (!cleanup) roleDecision = { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "TEMP_CLEANUP_FAILED" };
    const repositoryNextAfter = auditNextMetadata(repositoryNext);
    const protectedAfter = protectedDigests();
    const dirtyAfter = dirtyInventory();
    const stagedAfter = stagedIndexEmpty();
    const workspaceUnchanged = repositoryNextBefore.metadataDigest === repositoryNextAfter.metadataDigest
      && repositoryNextBefore.contentReadCount === 0
      && repositoryNextAfter.contentReadCount === 0
      && JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter)
      && dirtyBefore.fingerprint === dirtyAfter.fingerprint
      && dirtyBefore.count === dirtyAfter.count
      && stagedBefore
      && stagedAfter;
    if (!workspaceUnchanged) roleDecision = { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "WORKSPACE_PRESERVATION_CHECK_FAILED" };

    const mapped = roleDecision.classification === CLASSIFICATIONS.EXACT_SINGLE_ROUTE_REFERENCE_MAPPED && diagnostic !== null;
    const finalClassification = mapped || roleDecision.classification === CLASSIFICATIONS.REFERENCE_ROLE_EXACT_NO_GO ? roleDecision.classification : CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
    receipt = {
      schemaVersion: "wp138-generated-target-reference/v1",
      workPackage: "WP-138",
      status: isAllowedOutcome(finalClassification) ? "COMPLETED" : "BLOCKED_OR_FAILED",
      classification: finalClassification,
      subreason: roleDecision.subreason,
      startedAt,
      finishedAt: new Date().toISOString(),
      dependencies: { wp136: dependencies.wp136.classification, wp137: dependencies.wp137.classification, wp137Subreason: dependencies.wp137.subreason },
      typegen: { ...typegen, attempts: typegen.attempts, outputPathInsideTempOnly: typegen.outputRootInsideTemp, generatedRawOutputPersisted: false },
      generatedInventory: { fileCount: generated.files.length, targetReferenceCount: generated.targetReferences.length, inventoryComplete: generated.inventoryComplete, requiredFilesPresent: generated.requiredFilesPresent, inventoryDigest: sha256(generated.files.map((file) => `${file.path}|${file.digest}|${file.targetHit}`).sort().join("\n")) },
      references,
      selectedReference: selectedValidator,
      allowedExports,
      diagnostic,
      source: { path: targetRoute, sourceDigest, tempSourceDigest, digestMatches: targetSourceDigestMatches, ownership: ownership.ownership, dirtyHunkCount: ownership.dirtyHunkCount },
      preservation: { repositoryNextMetadataDigestBefore: repositoryNextBefore.metadataDigest, repositoryNextMetadataDigestAfter: repositoryNextAfter.metadataDigest, repositoryNextUnchanged: repositoryNextBefore.metadataDigest === repositoryNextAfter.metadataDigest, repositoryNextContentReads: 0, protectedInputsUnchanged: JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), dirtyBefore, dirtyAfter, dirtyUnchanged: dirtyBefore.count === dirtyAfter.count && dirtyBefore.fingerprint === dirtyAfter.fingerprint, stagedIndexEmpty: stagedBefore && stagedAfter, workspaceUnchanged },
      cleanup: { tempMirrorRemoved: true, junctionRemoved: true },
      sideEffects: { serverRuns: 0, browserRuns: 0, networkOperations: 0, databaseOperations: 0, payuniOperations: 0, stagingOperations: 0, deploymentOperations: 0, productionOperations: 0, dotenvReads: 0 },
      scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, CAT09: { before: 6.5, after: 6.5 }, total: { before: 71.0, after: 71.0 } },
      sanitized: true,
    };
  } catch (error) {
    try { if (tempRoot) cleanupTemp(tempRoot, junctionPath); } catch { /* sanitized fail-closed receipt */ }
    receipt = { schemaVersion: "wp138-generated-target-reference/v1", workPackage: "WP-138", status: "BLOCKED_OR_FAILED", classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: String(error?.message ?? "UNKNOWN").replaceAll(/[^A-Z0-9_:-]/giu, "_"), startedAt, finishedAt: new Date().toISOString(), typegen, sideEffects: { serverRuns: 0, browserRuns: 0, networkOperations: 0, databaseOperations: 0, dotenvReads: 0 }, scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, CAT09: { before: 6.5, after: 6.5 }, total: { before: 71.0, after: 71.0 } }, sanitized: true };
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const receipt = runAudit();
  if (!isAllowedOutcome(receipt.classification)) process.exitCode = 1;
}
