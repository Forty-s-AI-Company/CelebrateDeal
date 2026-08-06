import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  extractGeneratedInventory,
  mapGeneratedRouteContract,
  parseSourceExports,
} from "./wp135-temp-route-lineage-runner.mjs";
import { auditNextMetadata, hasExcludedNextSegment, shouldIncludeInTempMirror } from "./wp136-next-temp-isolation-auditor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryNext = path.join(root, ".next");
const targetRoute = "src/app/api/cloudflare/stream-webhook/route.ts";
const reportPath = path.join(root, ".ai-team", "reports", "wp137-temp-next-route-lineage-receipt.json");
const wp136ReceiptPath = path.join(root, ".ai-team", "reports", "wp136-next-temp-isolation-audit-receipt.json");
const protectedInputs = [targetRoute, "next.config.ts", "tsconfig.json", "package.json", "package-lock.json"];
const ownedPaths = new Set([
  "scripts/wp137-temp-next-route-lineage-runner.mjs",
  "scripts/wp137-temp-next-route-lineage-runner.test.mjs",
  ".ai-team/reports/wp137-temp-next-route-lineage-receipt.json",
  "docs/ai-team/evidence/wp-137-temp-next-route-lineage.md",
]);

export const CLASSIFICATIONS = Object.freeze({
  CLEAN_SEPARABLE_CANDIDATE: "CLEAN_SEPARABLE_CANDIDATE",
  EXACT_PRESERVE_ONLY_NO_GO: "EXACT_PRESERVE_ONLY_NO_GO",
  TARGET_ROUTE_OMITTED_EXACT_NO_GO: "TARGET_ROUTE_OMITTED_EXACT_NO_GO",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

const allowedOutcomeSet = new Set([
  CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE,
  CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO,
  CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO,
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function digestFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normalizeRelativePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/+/gu, "/")
    .replace(/\/$/u, "");
}

function pathSegments(value) {
  return normalizeRelativePath(value).split("/").filter(Boolean).map((segment) => segment.toLowerCase());
}

function isForbiddenMirrorPath(relativePath) {
  const segments = pathSegments(relativePath);
  const basename = segments.at(-1) ?? "";
  if (!shouldIncludeInTempMirror(relativePath)) return true;
  if (segments.some((segment) => segment.startsWith(".env"))) return true;
  if (segments.some((segment) => [".git", ".ai-team", "node_modules", ".vercel", "coverage", ".cache", "dist", "build", "out"].includes(segment))) return true;
  if (segments.some((segment) => /(?:secret|credential|token|cookie|private|password)/iu.test(segment))) return true;
  if (/\.(?:db|sqlite|sqlite3|pem|key|crt|p12|pfx)$/iu.test(basename)) return true;
  return false;
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
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

function readWp136Receipt() {
  const receipt = JSON.parse(fs.readFileSync(wp136ReceiptPath, "utf8"));
  if (receipt.classification !== "SAFE_TEMP_EXCLUSION_PROVEN" || receipt.repositoryNext?.metadataUnchanged !== true) {
    throw new Error("WP136_CONTRACT_NOT_ACCEPTED");
  }
  return receipt;
}

function assertRepositoryNextBaseline(wp136Receipt, currentMetadata) {
  const baseline = wp136Receipt.repositoryNext.after;
  const keys = ["fileCount", "directoryCount", "totalBytes", "reparsePointCount", "metadataDigest"];
  for (const key of keys) {
    if (currentMetadata[key] !== baseline[key]) throw new Error(`REPOSITORY_NEXT_METADATA_DRIFT_${key.toUpperCase()}`);
  }
  if (currentMetadata.contentReadCount !== 0) throw new Error("REPOSITORY_NEXT_CONTENT_READ_DETECTED");
}

function copyTree(sourceDirectory, targetDirectory, relative = "", summary = null) {
  const state = summary ?? {
    copiedFiles: 0,
    copiedDirectories: 0,
    excludedEntries: 0,
    excludedNextEntries: 0,
    skippedReparseEntries: 0,
    excludedClassDigest: null,
  };
  fs.mkdirSync(targetDirectory, { recursive: true });
  if (!summary) state.copiedDirectories += 1;
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const childRelative = normalizeRelativePath(relative ? `${relative}/${entry.name}` : entry.name);
    if (isForbiddenMirrorPath(childRelative)) {
      state.excludedEntries += 1;
      if (hasExcludedNextSegment(childRelative)) state.excludedNextEntries += 1;
      state.excludedClassDigest = sha256(`${state.excludedClassDigest ?? ""}|${pathSegments(childRelative).at(-1) ?? ""}`);
      continue;
    }
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      state.skippedReparseEntries += 1;
      continue;
    }
    if (stat.isDirectory()) {
      state.copiedDirectories += 1;
      copyTree(sourcePath, targetPath, childRelative, state);
      continue;
    }
    if (!stat.isFile()) {
      state.excludedEntries += 1;
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
    state.copiedFiles += 1;
  }
  return state;
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
  const safeInherited = ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "WINDIR"];
  const environment = Object.fromEntries(safeInherited.filter((name) => typeof process.env[name] === "string").map((name) => [name, process.env[name]]));
  return {
    ...environment,
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
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp137_typegen",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp137_typegen",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:32137",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    CSRF_SECRET: "wp137-local-csrf-synthetic-value",
    JOB_SECRET: "wp137-local-job-synthetic-value",
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

function sourceRouteOwnership() {
  const status = runGit(["status", "--short", "--", targetRoute]).stdout.trim();
  const diff = runGit(["diff", "--unified=0", "--", targetRoute]).stdout;
  const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu)].map((match) => ({
    startLine: Number(match[1]),
    endLine: Number(match[1]) + Math.max(Number(match[2] ?? 1), 1) - 1,
  }));
  return { statusCode: status.slice(0, 2), ownership: status ? "PRESERVE_ONLY_DIRTY" : "TRACKED_CLEAN", dirtyHunkCount: ranges.length, ranges };
}

function mapCurrentRoute(tempRoot, inventory) {
  const validator = inventory.files.find((file) => file.path.endsWith("validator.ts"));
  if (!validator) return { mapped: false, reason: "ROUTE_HANDLER_VALIDATOR_MISSING" };
  const validatorText = fs.readFileSync(path.join(tempRoot, validator.path), "utf8");
  const mapping = mapGeneratedRouteContract(validatorText);
  return {
    ...mapping,
    validatorDigest: sha256(validatorText),
  };
}

function classifyLineage({ typegen, inventory, mapping, sourceExports, ownership, targetSourceDigestMatches }) {
  if (!typegen.outputRootInsideTemp || typegen.exitCode !== 0 || !inventory.inventoryComplete) {
    return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "TYPEGEN_FAILED_OR_INVENTORY_INCOMPLETE" };
  }
  if (!targetSourceDigestMatches) return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "TEMP_SOURCE_DIGEST_MISMATCH" };
  if (inventory.targetReferences.length === 0) {
    return { classification: CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO, subreason: "TARGET_ROUTE_OMITTED_FROM_COMPLETE_INVENTORY" };
  }
  if (!mapping.mapped) return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: mapping.reason ?? "ROUTE_MAPPING_UNRESOLVED" };
  const disallowed = sourceExports.filter((symbol) => !mapping.allowed.includes(symbol.name));
  if (disallowed.length !== 1) return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, subreason: "DISALLOWED_EXPORT_COUNT_NOT_EXACTLY_ONE" };
  const symbol = disallowed[0];
  const overlaps = ownership.ranges.some((range) => symbol.startLine <= range.endLine && symbol.endLine >= range.startLine);
  const diagnostic = {
    symbol: symbol.name,
    kind: symbol.kind,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    signatureFingerprint: symbol.signatureFingerprint,
    dirtyHunkOverlap: overlaps,
  };
  if (ownership.ownership === "PRESERVE_ONLY_DIRTY" && overlaps) {
    return { classification: CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO, subreason: "EXACT_DISALLOWED_EXPORT_OVERLAPS_PRESERVE_ONLY_HUNK", diagnostic };
  }
  if (ownership.ownership === "TRACKED_CLEAN" && !overlaps) {
    return { classification: CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE, subreason: "EXACT_DISALLOWED_EXPORT_CLEAN_SEPARABLE", diagnostic };
  }
  return { classification: CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO, subreason: "EXACT_ROUTE_CONTRACT_REQUIRES_PRESERVE_ONLY_REVIEW", diagnostic };
}

function sanitizeInventory(inventory) {
  return {
    fileCount: inventory.files.length,
    targetReferenceCount: inventory.targetReferences.length,
    inventoryComplete: inventory.inventoryComplete,
    requiredFilesPresent: inventory.requiredFilesPresent,
    routeReferenceDigest: sha256(inventory.targetReferences.map((file) => `${file.path}|${file.digest}`).sort().join("\n")),
    inventoryDigest: sha256(inventory.files.map((file) => `${file.path}|${file.digest}|${file.targetHit}`).sort().join("\n")),
  };
}

export function buildSyntheticEnvironment(tempRoot) {
  return buildEnvironment(tempRoot);
}

export function classifySyntheticLineage(input) {
  return classifyLineage(input);
}

export function isAllowedOutcome(classification) {
  return allowedOutcomeSet.has(classification);
}

export function runAudit() {
  const startedAt = new Date().toISOString();
  let tempRoot = null;
  let junctionPath = null;
  let typegen = { attempts: 0, exitCode: null, timedOut: false, stdoutBytes: 0, stderrBytes: 0, outputRootInsideTemp: false };
  let classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  let subreason = "NOT_STARTED";
  let receipt;
  try {
    if (fs.existsSync(reportPath)) throw new Error("WP137_RECEIPT_ALREADY_EXISTS");
    const wp136Receipt = readWp136Receipt();
    const dirtyBefore = dirtyInventory();
    const stagedBefore = stagedIndexEmpty();
    const protectedBefore = protectedDigests();
    const repositoryNextBefore = auditNextMetadata(repositoryNext);
    assertRepositoryNextBaseline(wp136Receipt, repositoryNextBefore);
    const sourceDigest = protectedBefore[targetRoute];
    const sourceOwnership = sourceRouteOwnership();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp137-"));
    const copySummary = copyTree(root, tempRoot);
    const tempRoute = path.join(tempRoot, targetRoute);
    if (!fs.existsSync(tempRoute)) throw new Error("TEMP_TARGET_ROUTE_MISSING");
    const tempSourceDigest = digestFile(tempRoute);
    const targetSourceDigestMatches = tempSourceDigest === sourceDigest;
    junctionPath = createNodeModulesJunction(tempRoot);
    typegen = runTypegen(tempRoot);

    let generated = { files: [], targetReferences: [], inventoryComplete: false, requiredFilesPresent: false };
    let mapping = { mapped: false, reason: "TYPEGEN_NOT_READY" };
    let sourceExports = [];
    if (typegen.outputRootInsideTemp) {
      generated = extractGeneratedInventory(tempRoot);
      mapping = mapCurrentRoute(tempRoot, generated);
      sourceExports = parseSourceExports(fs.readFileSync(tempRoute, "utf8"), targetRoute);
    }
    const decision = classifyLineage({ typegen, inventory: generated, mapping, sourceExports, ownership: sourceOwnership, targetSourceDigestMatches });
    classification = decision.classification;
    subreason = decision.subreason;
    const cleanup = cleanupTemp(tempRoot, junctionPath);
    tempRoot = null;
    junctionPath = null;
    if (!cleanup) {
      classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
      subreason = "TEMP_CLEANUP_FAILED";
    }
    const repositoryNextAfter = auditNextMetadata(repositoryNext);
    const protectedAfter = protectedDigests();
    const dirtyAfter = dirtyInventory();
    const stagedAfter = stagedIndexEmpty();
    const workspaceUnchanged = repositoryNextBefore.metadataDigest === repositoryNextAfter.metadataDigest
      && JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter)
      && dirtyBefore.fingerprint === dirtyAfter.fingerprint
      && dirtyBefore.count === dirtyAfter.count
      && stagedBefore
      && stagedAfter;
    if (!workspaceUnchanged) {
      classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
      subreason = "WORKSPACE_PRESERVATION_CHECK_FAILED";
    }
    receipt = {
      schemaVersion: "wp137-temp-next-route-lineage/v1",
      workPackage: "WP-137",
      status: isAllowedOutcome(classification) ? "COMPLETED" : "BLOCKED_OR_FAILED",
      classification,
      subreason,
      startedAt,
      finishedAt: new Date().toISOString(),
      scope: "one temp-only Next type-generation and current route-lineage mapping",
      dependency: {
        workPackage: "WP-136",
        classification: wp136Receipt.classification,
        repositoryNextContract: "root-prune-before-recursion",
      },
      ownership: {
        targetRoute: sourceOwnership.ownership,
        statusCode: sourceOwnership.statusCode,
        dirtyHunkCount: sourceOwnership.dirtyHunkCount,
        sourceDigest,
        tempSourceDigest,
        tempSourceDigestMatches: targetSourceDigestMatches,
      },
      typegen: {
        ...typegen,
        outputPathInsideTempOnly: typegen.outputRootInsideTemp,
        generatedRawOutputPersisted: false,
      },
      mirror: {
        copiedFiles: copySummary.copiedFiles,
        copiedDirectories: copySummary.copiedDirectories,
        excludedEntries: copySummary.excludedEntries,
        excludedNextEntries: copySummary.excludedNextEntries,
        selectedNextEntries: 0,
        skippedReparseEntries: copySummary.skippedReparseEntries,
        rootPruneBeforeRecursion: copySummary.excludedNextEntries > 0,
        excludedClassDigest: copySummary.excludedClassDigest,
      },
      generatedInventory: sanitizeInventory(generated),
      routeMapping: {
        mapped: mapping.mapped === true,
        reason: mapping.reason ?? null,
        allowedExports: mapping.allowed ?? [],
        validatorDigest: mapping.validatorDigest ?? null,
      },
      diagnostic: decision.diagnostic ?? null,
      preservation: {
        repositoryNextMetadataDigestBefore: repositoryNextBefore.metadataDigest,
        repositoryNextMetadataDigestAfter: repositoryNextAfter.metadataDigest,
        repositoryNextContentReads: repositoryNextBefore.contentReadCount + repositoryNextAfter.contentReadCount,
        repositoryNextUnchanged: repositoryNextBefore.metadataDigest === repositoryNextAfter.metadataDigest,
        protectedInputsUnchanged: JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter),
        dirtyBefore,
        dirtyAfter,
        dirtyUnchanged: dirtyBefore.fingerprint === dirtyAfter.fingerprint && dirtyBefore.count === dirtyAfter.count,
        stagedIndexEmpty: stagedBefore && stagedAfter,
        workspaceUnchanged,
      },
      cleanup: { tempMirrorRemoved: true, junctionRemoved: true },
      sideEffects: {
        serverRuns: 0,
        browserRuns: 0,
        databaseOperations: 0,
        externalOperations: 0,
        payuniOperations: 0,
        stagingOperations: 0,
        deploymentOperations: 0,
        productionOperations: 0,
        dotenvReads: 0,
      },
      scoreImpact: {
        CAT06: { before: 7.0, after: 7.0 },
        CAT09: { before: 6.5, after: 6.5 },
        total: { before: 71.0, after: 71.0 },
      },
      sanitized: true,
    };
  } catch (error) {
    try {
      if (tempRoot) cleanupTemp(tempRoot, junctionPath);
    } catch {
      subreason = "TEMP_CLEANUP_FAILED_AFTER_ERROR";
    }
    receipt = {
      schemaVersion: "wp137-temp-next-route-lineage/v1",
      workPackage: "WP-137",
      status: "BLOCKED_OR_FAILED",
      classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
      subreason: subreason === "NOT_STARTED" ? String(error?.message ?? "UNKNOWN").replaceAll(/[^A-Z0-9_:-]/giu, "_") : subreason,
      startedAt,
      finishedAt: new Date().toISOString(),
      typegen: { ...typegen, generatedRawOutputPersisted: false },
      sideEffects: { serverRuns: 0, browserRuns: 0, databaseOperations: 0, externalOperations: 0, dotenvReads: 0 },
      scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, CAT09: { before: 6.5, after: 6.5 }, total: { before: 71.0, after: 71.0 } },
      sanitized: true,
    };
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
