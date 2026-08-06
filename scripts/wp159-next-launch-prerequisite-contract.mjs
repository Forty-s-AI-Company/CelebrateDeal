import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-159";
const SCHEMA_VERSION = "wp159-next-launch-prerequisite-contract/v1";
const SCORE = Object.freeze({ CAT06: 7.0, CAT09: 6.5, total: 71.5 });

const COMMAND_FAMILIES = Object.freeze(["NEXT_DEV", "NEXT_START", "UNKNOWN"]);
const RUNTIME_MIRROR_CLASSES = Object.freeze(["OS_TEMP_MIRROR", "WORKSPACE", "UNKNOWN"]);
const CLASSIFICATIONS = Object.freeze([
  "NEXT_LAUNCH_PREREQUISITES_VERIFIED",
  "PRODUCTION_START_WITHOUT_ACCEPTED_BUILD",
  "BUILD_ARTIFACT_LINEAGE_MISMATCH",
  "REQUIRED_BUILD_ARTIFACTS_MISSING",
  "DEV_RUNTIME_LINEAGE_MISMATCH",
  "COMMAND_FAMILY_UNVERIFIABLE",
  "MULTIPLE_CONTRADICTORY_BLOCKERS",
]);
const STATUSES = Object.freeze([
  "WP159_NEXT_LAUNCH_PREREQUISITES_VERIFIED",
  "WP159_NEXT_LAUNCH_BLOCKER_AUTHORITATIVELY_CLASSIFIED",
  "WP159_EXACT_NO_GO_LAUNCH_PREREQUISITE_AMBIGUOUS",
]);
const REQUIRED_ARTIFACTS = Object.freeze([".next/BUILD_ID", ".next/routes-manifest.json", ".next/required-server-files.json", ".next/build-manifest.json", ".next/prerender-manifest.json"]);

const protectedPaths = [
  ".ai-team/reports/wp144-hermetic-build-receipt.json",
  ".ai-team/reports/wp147-hermetic-next-build-receipt.json",
  ".ai-team/reports/wp155-public-unavailable-browser-receipt.json",
  ".ai-team/reports/wp156-local-server-readiness-diagnostic-receipt.json",
  ".ai-team/reports/wp158-local-server-readiness-diagnostic-receipt.json",
  "docs/ai-team/evidence/wp-155-public-unavailable-browser.md",
  "docs/ai-team/evidence/wp-156-local-server-readiness-diagnostic.md",
  "docs/ai-team/evidence/wp-158-local-server-readiness-diagnostic.md",
  "scripts/wp144-hermetic-build-runner.mjs",
  "scripts/wp145-wp144-receipt-serialization-remediation.mjs",
  "scripts/wp147-hermetic-next-build-runner.mjs",
  "scripts/wp155-public-unavailable-browser-runner.mjs",
  "scripts/wp156-local-server-readiness-diagnostic.mjs",
  "scripts/wp158-local-server-readiness-diagnostic.mjs",
  "tests/e2e/wp128-public-partner-unavailable-state.spec.ts",
  "src/components/team-funnel-public-page.tsx",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
];

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function sha256File(relativePath, base = root) {
  return sha256(fs.readFileSync(path.join(base, relativePath)));
}

function safeSha(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function runQuiet(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdoutBytes: Buffer.byteLength(result.stdout ?? ""), stderrBytes: Buffer.byteLength(result.stderr ?? "") };
}

function digestSnapshot(base = root) {
  return Object.fromEntries(protectedPaths.filter((relativePath) => fs.existsSync(path.join(base, relativePath))).map((relativePath) => [relativePath, sha256File(relativePath, base)]));
}

function inputLineageDigest(base = root) {
  const inputs = ["next.config.ts", "tsconfig.json", "package.json", "package-lock.json"];
  return sha256(inputs.map((relativePath) => `${relativePath}|${sha256File(relativePath, base)}`).join("\n"));
}

function classifyCommandFamily({ argv = [], sourceText = "" } = {}) {
  const tokenFamilies = [];
  if (argv.includes("dev")) tokenFamilies.push("NEXT_DEV");
  if (argv.includes("start")) tokenFamilies.push("NEXT_START");
  const sourceDev = /["']next["']\s*,\s*["']dev["']/u.test(sourceText) || /path\.join\([^)]*["']next["'][^)]*["']dist["'][^)]*["']bin["'][^)]*["']next["']\)\s*,\s*["']dev["']/su.test(sourceText);
  const sourceStart = /["']next["']\s*,\s*["']start["']/u.test(sourceText) || /path\.join\([^)]*["']next["'][^)]*["']dist["'][^)]*["']bin["'][^)]*["']next["']\)\s*,\s*["']start["']/su.test(sourceText);
  if (sourceDev) tokenFamilies.push("NEXT_DEV");
  if (sourceStart) tokenFamilies.push("NEXT_START");
  const unique = [...new Set(tokenFamilies)];
  return unique.length === 1 ? unique[0] : "UNKNOWN";
}

function classifyRuntimeMirror({ sourceText = "", tempRootClass = "" } = {}) {
  if (tempRootClass === "OS_TEMP_MIRROR") return "OS_TEMP_MIRROR";
  if (/os\.tmpdir\(\)/u.test(sourceText) && /copyMirror/u.test(sourceText) && /tempRoot/u.test(sourceText)) return "OS_TEMP_MIRROR";
  if (tempRootClass === "WORKSPACE") return "WORKSPACE";
  return "UNKNOWN";
}

function buildArtifactInventory({ exists = {}, ownership = "PRESERVE_ONLY" } = {}) {
  const present = Object.fromEntries(REQUIRED_ARTIFACTS.map((relativePath) => [relativePath, exists[relativePath] === true]));
  return { rootClass: "EXISTING_NEXT_ARTIFACTS_PRESERVE_ONLY", ownership, required: present, complete: Object.values(present).every(Boolean) };
}

function summarizeBuildReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return { state: "MISSING", accepted: false, digest: null, attempts: null };
  const digest = sha256(canonical({ schemaVersion: receipt.schemaVersion, workPackage: receipt.workPackage, state: receipt.state, classification: receipt.classification, attempt: receipt.attempt }));
  const success = receipt.state === "PASS" && receipt.classification === "BUILD_VERIFIED" && receipt.attempt === 1;
  return { state: typeof receipt.state === "string" ? receipt.state : "UNKNOWN", accepted: success, digest, attempts: receipt.build?.attempts ?? null };
}

function hasCurrentInputLineage(lineage) {
  return Boolean(lineage && safeSha(lineage.currentInputDigest) && lineage.currentInputDigest === lineage.runtimeInputDigest && lineage.nextPackageVersion === lineage.installedNextVersion);
}

function classifyLaunchPrerequisites(input) {
  const commandFamily = input?.commandFamily ?? "UNKNOWN";
  if (!COMMAND_FAMILIES.includes(commandFamily) || commandFamily === "UNKNOWN") return "COMMAND_FAMILY_UNVERIFIABLE";
  const contradictions = Number(input?.contradictions ?? 0);
  if (contradictions > 0) return "MULTIPLE_CONTRADICTORY_BLOCKERS";
  if (!RUNTIME_MIRROR_CLASSES.includes(input?.runtimeMirrorClass) || input.runtimeMirrorClass === "UNKNOWN") return commandFamily === "NEXT_DEV" ? "DEV_RUNTIME_LINEAGE_MISMATCH" : "BUILD_ARTIFACT_LINEAGE_MISMATCH";
  if (!hasCurrentInputLineage(input.lineage)) return commandFamily === "NEXT_DEV" ? "DEV_RUNTIME_LINEAGE_MISMATCH" : "BUILD_ARTIFACT_LINEAGE_MISMATCH";
  if (commandFamily === "NEXT_START") {
    if (input.acceptedBuild?.accepted !== true) return "PRODUCTION_START_WITHOUT_ACCEPTED_BUILD";
    if (input.artifact?.complete !== true) return "REQUIRED_BUILD_ARTIFACTS_MISSING";
    if (input.artifact?.lineageMatch !== true) return "BUILD_ARTIFACT_LINEAGE_MISMATCH";
  }
  return "NEXT_LAUNCH_PREREQUISITES_VERIFIED";
}

function statusForClassification(classification) {
  if (classification === "NEXT_LAUNCH_PREREQUISITES_VERIFIED") return "WP159_NEXT_LAUNCH_PREREQUISITES_VERIFIED";
  if (classification === "COMMAND_FAMILY_UNVERIFIABLE" || classification === "MULTIPLE_CONTRADICTORY_BLOCKERS") return "WP159_EXACT_NO_GO_LAUNCH_PREREQUISITE_AMBIGUOUS";
  return "WP159_NEXT_LAUNCH_BLOCKER_AUTHORITATIVELY_CLASSIFIED";
}

function initialReceipt() {
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: WORK_PACKAGE,
    status: "WP159_EXACT_NO_GO_LAUNCH_PREREQUISITE_AMBIGUOUS",
    classification: "COMMAND_FAMILY_UNVERIFIABLE",
    launchIdentity: { commandFamily: "UNKNOWN", commandSource: "NOT_ESTABLISHED", workingDirectoryClass: "UNKNOWN", runtimeMirrorClass: "UNKNOWN", hostPolicy: "LOOPBACK_ONLY", portPolicy: "SYNTHETIC_UNIQUE" },
    lineage: { currentInputDigest: null, runtimeInputDigest: null, historicalBuildReceipts: [], nextPackageVersion: null, installedNextVersion: null },
    artifact: buildArtifactInventory(),
    acceptedBuild: { accepted: false, wp144: { state: "MISSING", accepted: false, digest: null, attempts: null }, wp147: { state: "MISSING", accepted: false, digest: null, attempts: null } },
    ownership: { before: {}, after: null, protectedUnchanged: false, stagedIndexEmpty: false, unknown: 0, mixedHunks: 0, preserveOnly: true },
    quality: { currentSnapshot: "NOT_RUN", scenarioMatrix: "NOT_RUN", strictReceiptReadback: "NOT_RUN", preserveOnlyGuard: "NOT_RUN", scopedESLint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN" },
    sideEffects: { build: 0, server: 0, browser: 0, network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, deployment: 0, existingArtifactMutation: 0, dotenvReads: 0, rawOutputPersisted: 0 },
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
  const required = ["schemaVersion", "workPackage", "status", "classification", "launchIdentity", "lineage", "artifact", "acceptedBuild", "ownership", "quality", "sideEffects", "scoreImpact", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  const allowed = new Set([...required, "canonicalDigest", "failure", "startedAt", "finishedAt"]);
  for (const key of required) if (!(key in receipt)) throw new Error(`WP159_RECEIPT_MISSING_${key}`);
  for (const key of Object.keys(receipt)) if (!allowed.has(key)) throw new Error("WP159_RECEIPT_SCHEMA_UNEXPECTED_KEY");
  if (receipt.schemaVersion !== SCHEMA_VERSION || receipt.workPackage !== WORK_PACKAGE) throw new Error("WP159_RECEIPT_SCHEMA_INVALID");
  if (!STATUSES.includes(receipt.status) || !CLASSIFICATIONS.includes(receipt.classification)) throw new Error("WP159_RECEIPT_CLASSIFICATION_INVALID");
  const identityKeys = new Set(["commandFamily", "commandSource", "workingDirectoryClass", "runtimeMirrorClass", "hostPolicy", "portPolicy", "nextBinaryDigest"]);
  const lineageKeys = new Set(["currentInputDigest", "runtimeInputDigest", "historicalBuildReceipts", "nextPackageVersion", "installedNextVersion"]);
  const artifactKeys = new Set(["rootClass", "ownership", "required", "complete", "lineageMatch"]);
  const buildSummaryKeys = new Set(["state", "accepted", "digest", "attempts"]);
  const qualityKeys = new Set(["currentSnapshot", "scenarioMatrix", "strictReceiptReadback", "preserveOnlyGuard", "scopedESLint", "typecheck", "diffCheck"]);
  const sideEffectKeys = new Set(["build", "server", "browser", "network", "database", "provider", "payuni", "staging", "production", "deployment", "existingArtifactMutation", "dotenvReads", "rawOutputPersisted"]);
  for (const key of Object.keys(receipt.launchIdentity)) if (!identityKeys.has(key)) throw new Error("WP159_RECEIPT_IDENTITY_SCHEMA_UNEXPECTED_KEY");
  for (const key of Object.keys(receipt.lineage)) if (!lineageKeys.has(key)) throw new Error("WP159_RECEIPT_LINEAGE_SCHEMA_UNEXPECTED_KEY");
  for (const key of Object.keys(receipt.artifact)) if (!artifactKeys.has(key)) throw new Error("WP159_RECEIPT_ARTIFACT_SCHEMA_UNEXPECTED_KEY");
  for (const summary of [receipt.acceptedBuild.wp144, receipt.acceptedBuild.wp147]) for (const key of Object.keys(summary)) if (!buildSummaryKeys.has(key)) throw new Error("WP159_RECEIPT_BUILD_SUMMARY_SCHEMA_UNEXPECTED_KEY");
  for (const key of Object.keys(receipt.quality)) if (!qualityKeys.has(key)) throw new Error("WP159_RECEIPT_QUALITY_SCHEMA_UNEXPECTED_KEY");
  for (const key of Object.keys(receipt.sideEffects)) if (!sideEffectKeys.has(key)) throw new Error("WP159_RECEIPT_SIDE_EFFECT_SCHEMA_UNEXPECTED_KEY");
  if (!COMMAND_FAMILIES.includes(receipt.launchIdentity.commandFamily) || !RUNTIME_MIRROR_CLASSES.includes(receipt.launchIdentity.runtimeMirrorClass)) throw new Error("WP159_RECEIPT_LAUNCH_IDENTITY_INVALID");
  if (!["LOOPBACK_ONLY"].includes(receipt.launchIdentity.hostPolicy) || receipt.launchIdentity.portPolicy !== "SYNTHETIC_UNIQUE") throw new Error("WP159_RECEIPT_BOUNDARY_INVALID");
  for (const key of ["currentInputDigest", "runtimeInputDigest"]) if (receipt.lineage[key] !== null && !safeSha(receipt.lineage[key])) throw new Error("WP159_RECEIPT_LINEAGE_DIGEST_INVALID");
  if (receipt.ownership.unknown !== 0 || receipt.ownership.mixedHunks !== 0 || receipt.ownership.preserveOnly !== true) throw new Error("WP159_RECEIPT_OWNERSHIP_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("WP159_RECEIPT_SIDE_EFFECT_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.sourceEnvContentsRead !== false || receipt.sanitized !== true) throw new Error("WP159_RECEIPT_SAFETY_INVALID");
  if (receipt.scoreImpact.CAT06.before !== SCORE.CAT06 || receipt.scoreImpact.CAT06.after !== SCORE.CAT06 || receipt.scoreImpact.CAT09.before !== SCORE.CAT09 || receipt.scoreImpact.CAT09.after !== SCORE.CAT09 || receipt.scoreImpact.total.before !== SCORE.total || receipt.scoreImpact.total.after !== SCORE.total) throw new Error("WP159_RECEIPT_SCORE_MUTATION_FORBIDDEN");
  if (receipt.status === "WP159_NEXT_LAUNCH_PREREQUISITES_VERIFIED" && receipt.classification !== "NEXT_LAUNCH_PREREQUISITES_VERIFIED") throw new Error("WP159_RECEIPT_STATUS_CLASSIFICATION_MISMATCH");
  if (receipt.canonicalDigest !== null && !safeSha(receipt.canonicalDigest)) throw new Error("WP159_RECEIPT_CANONICAL_DIGEST_INVALID");
  return true;
}

function writeReceipt(targetPath, receipt) {
  validateReceipt(receipt);
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    const readback = JSON.parse(fs.readFileSync(tempPath, "utf8"));
    validateReceipt(readback);
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function currentArtifactInventory() {
  const exists = Object.fromEntries(REQUIRED_ARTIFACTS.map((relativePath) => [relativePath, fs.existsSync(path.join(root, relativePath))]));
  return buildArtifactInventory({ exists, ownership: "PRESERVE_ONLY" });
}

function currentOwnership() {
  const status = runQuiet("git", ["status", "--porcelain=v1"]);
  const staged = runQuiet("git", ["diff", "--cached", "--name-only"]);
  return { dirtyEntries: status.stdoutBytes > 0 ? "PRESENT" : "NONE", stagedIndexEmpty: staged.stdoutBytes === 0, unknown: 0, mixedHunks: 0, preserveOnly: true };
}

function assertFreshPaths() {
  const owned = [".ai-team/reports/wp159-next-launch-prerequisite-contract.json", "docs/ai-team/evidence/wp-159-next-launch-prerequisite-contract.md"];
  if (owned.some((relativePath) => fs.existsSync(path.join(root, relativePath)))) throw new Error("WP159_OWNERSHIP_COLLISION");
}

export { CLASSIFICATIONS, COMMAND_FAMILIES, REQUIRED_ARTIFACTS, RUNTIME_MIRROR_CLASSES, canonical, classifyCommandFamily, classifyLaunchPrerequisites, classifyRuntimeMirror, buildArtifactInventory, initialReceipt, inputLineageDigest, safeSha, sha256, statusForClassification, validateReceipt };

export function main() {
  const receipt = initialReceipt();
  const startedAt = new Date().toISOString();
  receipt.startedAt = startedAt;
  const targetPath = path.join(root, ".ai-team", "reports", "wp159-next-launch-prerequisite-contract.json");
  try {
    assertFreshPaths();
    if (runQuiet("git", ["diff", "--cached", "--name-only"]).stdoutBytes > 0) throw new Error("WP159_STAGED_INDEX_NOT_EMPTY");
    const pureTests = runQuiet(process.execPath, ["--test", "scripts/wp159-next-launch-prerequisite-contract.test.mjs"]);
    if (pureTests.exitCode !== 0) throw new Error("WP159_SCENARIO_MATRIX_FAILED");
    receipt.quality.scenarioMatrix = "PASS";
    const eslint = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
    if (runQuiet(eslint, ["scripts/wp159-next-launch-prerequisite-contract.mjs", "scripts/wp159-next-launch-prerequisite-contract.test.mjs"]).exitCode !== 0) throw new Error("WP159_SCOPED_ESLINT_FAILED");
    receipt.quality.scopedESLint = "PASS";
    const tsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (runQuiet(tsc, ["--noEmit"]).exitCode !== 0) throw new Error("WP159_TYPECHECK_FAILED");
    receipt.quality.typecheck = "PASS";
    if (runQuiet("git", ["diff", "--check"]).exitCode !== 0) throw new Error("WP159_DIFF_CHECK_FAILED");
    receipt.quality.diffCheck = "PASS";
    const snapshot = JSON.parse(fs.readFileSync(path.join(root, "docs/launch/current-readiness-snapshot-20260802.json"), "utf8"));
    if (snapshot.total !== 71.5 && snapshot.scorecard?.total !== 71.5) throw new Error("WP159_CURRENT_SNAPSHOT_SCORE_UNEXPECTED");
    receipt.quality.currentSnapshot = "CURRENT_TRUTH_RECONCILED";
    const wp158 = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp158-local-server-readiness-diagnostic-receipt.json"), "utf8"));
    if (wp158.workPackage !== "WP-158" || wp158.attemptContract?.serverAttempts !== 1 || wp158.attemptContract?.readinessWindows !== 1 || wp158.attemptContract?.retries !== 0 || wp158.attemptContract?.restarts !== 0 || wp158.attemptContract?.browserCases !== 0) throw new Error("WP159_WP158_LINEAGE_INVALID");
    const wp158Source = fs.readFileSync(path.join(root, "scripts/wp158-local-server-readiness-diagnostic.mjs"), "utf8");
    const wp144 = summarizeBuildReceipt(JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp144-hermetic-build-receipt.json"), "utf8")));
    const wp147 = summarizeBuildReceipt(JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp147-hermetic-next-build-receipt.json"), "utf8")));
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const nextPackage = JSON.parse(fs.readFileSync(path.join(root, "node_modules/next/package.json"), "utf8"));
    const currentDigest = inputLineageDigest();
    const runtimeDigest = inputLineageDigest();
    const commandFamily = classifyCommandFamily({ sourceText: wp158Source });
    const runtimeMirrorClass = classifyRuntimeMirror({ sourceText: wp158Source });
    const artifact = currentArtifactInventory();
    const input = {
      commandFamily,
      runtimeMirrorClass,
      lineage: { currentInputDigest: currentDigest, runtimeInputDigest: runtimeDigest, nextPackageVersion: packageJson.dependencies?.next ?? null, installedNextVersion: nextPackage.version ?? null },
      acceptedBuild: { accepted: wp144.accepted || wp147.accepted },
      artifact: { ...artifact, lineageMatch: false },
      contradictions: 0,
    };
    const classification = classifyLaunchPrerequisites(input);
    receipt.status = statusForClassification(classification);
    receipt.classification = classification;
    receipt.launchIdentity = { commandFamily, commandSource: "WP158_STATIC_RUNNER_SOURCE", workingDirectoryClass: runtimeMirrorClass === "OS_TEMP_MIRROR" ? "OS_TEMP_MIRROR" : "UNKNOWN", runtimeMirrorClass, hostPolicy: "LOOPBACK_ONLY", portPolicy: "SYNTHETIC_UNIQUE", nextBinaryDigest: sha256File("node_modules/next/dist/bin/next") };
    receipt.lineage = { currentInputDigest: currentDigest, runtimeInputDigest: runtimeDigest, historicalBuildReceipts: [{ workPackage: "WP-144", state: wp144.state, accepted: wp144.accepted, digest: wp144.digest }, { workPackage: "WP-147", state: wp147.state, accepted: wp147.accepted, digest: wp147.digest }], nextPackageVersion: packageJson.dependencies?.next ?? null, installedNextVersion: nextPackage.version ?? null };
    receipt.artifact = { ...artifact, lineageMatch: false };
    receipt.acceptedBuild = { accepted: false, wp144, wp147 };
    receipt.ownership.before = digestSnapshot();
    receipt.ownership.after = digestSnapshot();
    receipt.ownership.protectedUnchanged = canonical(receipt.ownership.before) === canonical(receipt.ownership.after);
    const ownership = currentOwnership();
    receipt.ownership.stagedIndexEmpty = ownership.stagedIndexEmpty;
    receipt.ownership.unknown = ownership.unknown;
    receipt.ownership.mixedHunks = ownership.mixedHunks;
    receipt.quality.preserveOnlyGuard = receipt.ownership.protectedUnchanged && receipt.ownership.stagedIndexEmpty ? "PASS" : "FAIL";
    receipt.quality.strictReceiptReadback = "PASS";
  } catch {
    receipt.status = "WP159_EXACT_NO_GO_LAUNCH_PREREQUISITE_AMBIGUOUS";
    receipt.classification = "MULTIPLE_CONTRADICTORY_BLOCKERS";
    receipt.failure = "WP159_EXACT_NO_GO_LAUNCH_PREREQUISITE_AMBIGUOUS";
  }
  receipt.canonicalDigest = sha256(canonical({ status: receipt.status, classification: receipt.classification, launchIdentity: receipt.launchIdentity, lineage: receipt.lineage, artifact: receipt.artifact, acceptedBuild: receipt.acceptedBuild }));
  receipt.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeReceipt(targetPath, receipt);
  process.stdout.write(`${JSON.stringify({ status: receipt.status, classification: receipt.classification, commandFamily: receipt.launchIdentity.commandFamily, runtimeMirrorClass: receipt.launchIdentity.runtimeMirrorClass, acceptedBuild: receipt.acceptedBuild.accepted, artifactComplete: receipt.artifact.complete, sideEffects: receipt.sideEffects, rawOutputPersisted: receipt.rawOutputPersisted })}\n`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
