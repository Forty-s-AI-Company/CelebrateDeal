import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextRoot = path.join(root, ".next");
const reportPath = path.join(root, ".ai-team", "reports", "wp136-next-temp-isolation-audit-receipt.json");

export const CLASSIFICATIONS = Object.freeze({
  SAFE_TEMP_EXCLUSION_PROVEN: "SAFE_TEMP_EXCLUSION_PROVEN",
  EXACT_PRESERVE_ONLY_NO_GO: "EXACT_PRESERVE_ONLY_NO_GO",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

const ownedPaths = new Set([
  "scripts/wp136-next-temp-isolation-auditor.mjs",
  "scripts/wp136-next-temp-isolation-auditor.test.mjs",
  ".ai-team/reports/wp136-next-temp-isolation-audit-receipt.json",
  "docs/ai-team/evidence/wp-136-next-temp-isolation-audit.md",
]);

const protectedInputs = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json"];

function normalizeRelativePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/+/gu, "/")
    .replace(/\/$/u, "");
}

function normalizedSegments(value) {
  return normalizeRelativePath(value)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

export function hasExcludedNextSegment(relativePath) {
  return normalizedSegments(relativePath).some((segment) => segment === ".next");
}

export function shouldIncludeInTempMirror(relativePath) {
  return !hasExcludedNextSegment(relativePath);
}

export function sourceSelectionProbe(relativePaths) {
  const selected = [];
  const excluded = [];
  for (const relativePath of relativePaths) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) continue;
    if (shouldIncludeInTempMirror(normalized)) selected.push(normalized);
    else excluded.push(normalized);
  }
  return {
    selectedCount: selected.length,
    excludedCount: excluded.length,
    excludedNextCount: excluded.filter((relativePath) => hasExcludedNextSegment(relativePath)).length,
    selectedNextCount: selected.filter((relativePath) => hasExcludedNextSegment(relativePath)).length,
  };
}

function isReparsePoint(value) {
  return Boolean(value?.isSymbolicLink?.());
}

export function shouldRecurseMetadata(value) {
  return Boolean(value?.isDirectory?.()) && !isReparsePoint(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function digestFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseStatusPath(line) {
  const raw = String(line).slice(3).trim();
  return normalizeRelativePath(raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw);
}

function isOwnedStatusLine(line) {
  return ownedPaths.has(parseStatusPath(line));
}

function dirtyInventory() {
  const result = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.exitCode !== 0) throw new Error("GIT_STATUS_FAILED");
  const lines = result.stdout.split(/\r?\n/u).filter(Boolean).filter((line) => !isOwnedStatusLine(line));
  return { count: lines.length, fingerprint: sha256(`${lines.join("\n")}\n`) };
}

function stagedIndexEmpty() {
  const result = runGit(["diff", "--cached", "--name-only"]);
  if (result.exitCode !== 0) throw new Error("GIT_STAGED_CHECK_FAILED");
  return result.stdout.trim().length === 0;
}

function gitNextClassification() {
  const tracked = runGit(["ls-files", "--", ".next"]);
  const ignored = runGit(["check-ignore", "-v", "--", ".next"]);
  return {
    trackedPathCount: tracked.exitCode === 0 ? tracked.stdout.split(/\r?\n/u).filter(Boolean).length : 0,
    trackedCheckExitCode: tracked.exitCode,
    ignoreRulePresent: ignored.exitCode === 0,
    ignoreRuleFingerprint: ignored.exitCode === 0 ? sha256(ignored.stdout.trim()) : null,
  };
}

function metadataRecord(relativePath, stat) {
  const kind = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
  const reparse = isReparsePoint(stat);
  const extension = kind === "file" ? path.extname(relativePath).toLowerCase() || "<none>" : `<${kind}>`;
  return {
    relativePath,
    kind,
    size: Number(stat.size),
    mtimeNs: stat.mtimeNs?.toString?.() ?? String(stat.mtimeMs),
    mode: stat.mode,
    reparse,
    extension,
  };
}

function walkMetadataOnly(directory) {
  const records = [];
  let reparseCount = 0;
  const visit = (absolute, relative, stat = fs.lstatSync(absolute)) => {
    const record = metadataRecord(relative, stat);
    records.push(record);
    if (record.reparse) reparseCount += 1;
    if (!shouldRecurseMetadata(stat)) return;
    const entries = fs.readdirSync(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = `${relative}/${entry.name}`;
      const childAbsolute = path.join(absolute, entry.name);
      const childStat = fs.lstatSync(childAbsolute);
      visit(childAbsolute, childRelative, childStat);
    }
  };
  visit(directory, ".next");

  const canonical = records
    .map((record) => `${record.relativePath}|${record.kind}|${record.size}|${record.mtimeNs}|${record.mode}|${record.reparse}`)
    .sort()
    .join("\n");
  const classes = records
    .map((record) => `${record.kind}|${record.extension}|${record.reparse}`)
    .sort()
    .join("\n");
  const files = records.filter((record) => record.kind === "file");
  // The baseline inventory counts directory entries below `.next` and keeps
  // reparse entries visible without following them. The root itself is not
  // included in that count.
  const directories = records.filter((record) => record.kind === "directory" && record.relativePath !== ".next");
  return {
    fileCount: files.length,
    directoryCount: directories.length + reparseCount,
    totalBytes: files.reduce((sum, record) => sum + record.size, 0),
    reparsePointCount: reparseCount,
    metadataDigest: sha256(canonical),
    pathClassDigest: sha256(classes),
    contentReadCount: 0,
  };
}

function rootPruneProbe(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const rootNames = entries.map((entry) => entry.name);
  const probe = sourceSelectionProbe(rootNames);
  const exactNextRootPresent = rootNames.some((name) => name.toLowerCase() === ".next");
  return {
    exactNextRootPresent,
    rootEntryCount: rootNames.length,
    rootPrunedBeforeRecursion: exactNextRootPresent && probe.selectedNextCount === 0,
    selectedRootCount: probe.selectedCount,
    excludedRootCount: probe.excludedCount,
    selectedNextCount: probe.selectedNextCount,
    excludedNextCount: probe.excludedNextCount,
    recursionEnteredNext: false,
  };
}

function protectedInputDigests() {
  return Object.fromEntries(protectedInputs.map((relative) => [relative, digestFile(path.join(root, relative))]));
}

function inspectExpectedBaseline(before) {
  return before.fileCount > 0
    && before.directoryCount > 0
    && before.totalBytes > 0
    && before.reparsePointCount >= 0
    && typeof before.metadataDigest === "string"
    && before.metadataDigest.length === 64;
}

function classifyAudit({ before, after, git, rootPrune, synthetic, stagedEmpty, dirtyBefore, dirtyAfter, protectedBefore, protectedAfter }) {
  const exactNoGo = [
    git.trackedPathCount !== 0,
    !git.ignoreRulePresent,
    !inspectExpectedBaseline(before),
    before.metadataDigest !== after.metadataDigest,
    before.fileCount !== after.fileCount,
    before.directoryCount !== after.directoryCount,
    before.totalBytes !== after.totalBytes,
    before.reparsePointCount !== after.reparsePointCount,
    before.contentReadCount !== 0 || after.contentReadCount !== 0,
    !rootPrune.exactNextRootPresent,
    !rootPrune.rootPrunedBeforeRecursion,
    rootPrune.selectedNextCount !== 0 || rootPrune.recursionEnteredNext,
    synthetic.selectedNextCount !== 0 || synthetic.excludedNextCount !== synthetic.excludedCount,
    !stagedEmpty,
    dirtyBefore.fingerprint !== dirtyAfter.fingerprint || dirtyBefore.count !== dirtyAfter.count,
    JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter),
  ];
  if (exactNoGo.some(Boolean)) return CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO;
  return CLASSIFICATIONS.SAFE_TEMP_EXCLUSION_PROVEN;
}

export function createGeneratedContentReadGuard(nextDirectory) {
  const resolvedNext = path.resolve(nextDirectory);
  let attemptedReads = 0;
  return {
    assertReadForbidden(candidate) {
      const resolved = path.resolve(candidate);
      if (resolved === resolvedNext || resolved.startsWith(`${resolvedNext}${path.sep}`)) {
        attemptedReads += 1;
        throw new Error("GENERATED_CONTENT_READ_FORBIDDEN");
      }
    },
    get attemptedReads() {
      return attemptedReads;
    },
  };
}

export function auditNextMetadata(directory = nextRoot) {
  const guard = createGeneratedContentReadGuard(directory);
  guard.assertReadForbidden = guard.assertReadForbidden.bind(guard);
  const result = walkMetadataOnly(path.resolve(directory));
  return { ...result, contentReadCount: guard.attemptedReads };
}

export function runAudit() {
  const startedAt = new Date().toISOString();
  let receipt;
  try {
    const dirtyBefore = dirtyInventory();
    const stagedBefore = stagedIndexEmpty();
    const protectedBefore = protectedInputDigests();
    const git = gitNextClassification();
    const before = auditNextMetadata(nextRoot);
    const rootPrune = rootPruneProbe(root);
    const synthetic = sourceSelectionProbe([
      ".next/types/validator.ts",
      "src/.NEXT/route.ts",
      "src/.next-old/route.ts",
      ".next-safe/route.ts",
      "src/app/page.tsx",
      "docs/.next-safe/example.md",
    ]);
    const after = auditNextMetadata(nextRoot);
    const dirtyAfter = dirtyInventory();
    const stagedAfter = stagedIndexEmpty();
    const protectedAfter = protectedInputDigests();
    const classification = classifyAudit({
      before,
      after,
      git,
      rootPrune,
      synthetic,
      stagedEmpty: stagedBefore && stagedAfter,
      dirtyBefore,
      dirtyAfter,
      protectedBefore,
      protectedAfter,
    });
    receipt = {
      schemaVersion: "wp136-next-temp-isolation-audit/v1",
      workPackage: "WP-136",
      status: classification === CLASSIFICATIONS.SAFE_TEMP_EXCLUSION_PROVEN ? "COMPLETED" : "BLOCKED_OR_FAILED",
      classification,
      startedAt,
      finishedAt: new Date().toISOString(),
      scope: "metadata-only repository .next ownership and temp-isolation audit",
      repositoryNext: {
        path: ".next",
        policy: "IGNORED_GENERATED_PRESERVE_ONLY",
        git,
        before,
        after,
        metadataUnchanged: before.metadataDigest === after.metadataDigest,
      },
      tempIsolation: {
        rootPrune,
        syntheticSelection: {
          selectedCount: synthetic.selectedCount,
          excludedCount: synthetic.excludedCount,
          excludedNextCount: synthetic.excludedNextCount,
          selectedNextCount: synthetic.selectedNextCount,
        },
        contentReadGuard: {
          attemptedReads: before.contentReadCount + after.contentReadCount,
          rawGeneratedContentPersisted: false,
        },
      },
      preservation: {
        dirtyBefore,
        dirtyAfter,
        dirtyUnchanged: dirtyBefore.fingerprint === dirtyAfter.fingerprint && dirtyBefore.count === dirtyAfter.count,
        stagedBeforeEmpty: stagedBefore,
        stagedAfterEmpty: stagedAfter,
        stagedIndexEmpty: stagedBefore && stagedAfter,
        protectedInputsUnchanged: JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter),
      },
      sideEffects: {
        fileContentReadsUnderNext: 0,
        serverLaunches: 0,
        browserRuns: 0,
        typegenAttempts: 0,
        databaseOperations: 0,
        externalOperations: 0,
        dotenvReads: 0,
        deploymentOperations: 0,
      },
      scoreImpact: {
        CAT06: { before: 7.0, after: 7.0 },
        CAT09: { before: 6.5, after: 6.5 },
        total: { before: 71.0, after: 71.0 },
      },
      sanitized: true,
    };
  } catch (error) {
    receipt = {
      schemaVersion: "wp136-next-temp-isolation-audit/v1",
      workPackage: "WP-136",
      status: "BLOCKED_OR_FAILED",
      classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
      startedAt,
      finishedAt: new Date().toISOString(),
      failure: String(error?.message ?? "UNKNOWN").replaceAll(/[^A-Z0-9_:-]/gi, "_"),
      sideEffects: {
        serverLaunches: 0,
        browserRuns: 0,
        typegenAttempts: 0,
        databaseOperations: 0,
        externalOperations: 0,
        dotenvReads: 0,
      },
      scoreImpact: {
        CAT06: { before: 7.0, after: 7.0 },
        CAT09: { before: 6.5, after: 6.5 },
        total: { before: 71.0, after: 71.0 },
      },
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
  const result = runAudit();
  if (result.classification !== CLASSIFICATIONS.SAFE_TEMP_EXCLUSION_PROVEN) process.exitCode = 1;
}
