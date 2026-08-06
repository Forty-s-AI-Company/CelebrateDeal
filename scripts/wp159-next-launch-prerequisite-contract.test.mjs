import assert from "node:assert/strict";
import test from "node:test";

import {
  CLASSIFICATIONS,
  COMMAND_FAMILIES,
  REQUIRED_ARTIFACTS,
  RUNTIME_MIRROR_CLASSES,
  buildArtifactInventory,
  canonical,
  classifyCommandFamily,
  classifyLaunchPrerequisites,
  classifyRuntimeMirror,
  initialReceipt,
  inputLineageDigest,
  statusForClassification,
  validateReceipt,
} from "./wp159-next-launch-prerequisite-contract.mjs";

const sha = `sha256:${"a".repeat(64)}`;
const matchingLineage = { currentInputDigest: sha, runtimeInputDigest: sha, nextPackageVersion: "16.2.11", installedNextVersion: "16.2.11" };

test("closed enums and deterministic canonical digest are stable", () => {
  assert.deepEqual(COMMAND_FAMILIES, ["NEXT_DEV", "NEXT_START", "UNKNOWN"]);
  assert.equal(CLASSIFICATIONS.length, 7);
  assert.deepEqual(RUNTIME_MIRROR_CLASSES, ["OS_TEMP_MIRROR", "WORKSPACE", "UNKNOWN"]);
  assert.equal(REQUIRED_ARTIFACTS.length, 5);
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  assert.equal(inputLineageDigest().startsWith("sha256:"), true);
});

test("command family is unique only when source and tokens agree", () => {
  assert.equal(classifyCommandFamily({ argv: ["next", "dev"] }), "NEXT_DEV");
  assert.equal(classifyCommandFamily({ argv: ["next", "start"] }), "NEXT_START");
  assert.equal(classifyCommandFamily({ argv: ["next", "dev", "start"] }), "UNKNOWN");
  assert.equal(classifyCommandFamily({ sourceText: 'spawn("next", "dev")' }), "NEXT_DEV");
  assert.equal(classifyCommandFamily({ sourceText: 'spawn("next", "dev"); spawn("next", "start")' }), "UNKNOWN");
});

test("WP-158 source mirror contract is classified as OS temp", () => {
  assert.equal(classifyRuntimeMirror({ sourceText: "const tempRoot = os.tmpdir(); function copyMirror() {}" }), "OS_TEMP_MIRROR");
  assert.equal(classifyRuntimeMirror({ tempRootClass: "WORKSPACE" }), "WORKSPACE");
  assert.equal(classifyRuntimeMirror({ sourceText: "unknown" }), "UNKNOWN");
});

test("NEXT_DEV does not require an accepted production build", () => {
  const classification = classifyLaunchPrerequisites({ commandFamily: "NEXT_DEV", runtimeMirrorClass: "OS_TEMP_MIRROR", lineage: matchingLineage, acceptedBuild: { accepted: false }, artifact: { complete: false }, contradictions: 0 });
  assert.equal(classification, "NEXT_LAUNCH_PREREQUISITES_VERIFIED");
  assert.equal(statusForClassification(classification), "WP159_NEXT_LAUNCH_PREREQUISITES_VERIFIED");
});

test("NEXT_START without accepted build is an explicit blocker", () => {
  const classification = classifyLaunchPrerequisites({ commandFamily: "NEXT_START", runtimeMirrorClass: "OS_TEMP_MIRROR", lineage: matchingLineage, acceptedBuild: { accepted: false }, artifact: { complete: true, lineageMatch: true }, contradictions: 0 });
  assert.equal(classification, "PRODUCTION_START_WITHOUT_ACCEPTED_BUILD");
});

test("failed WP-144/WP-147 receipts cannot become accepted build", () => {
  const classification = classifyLaunchPrerequisites({ commandFamily: "NEXT_START", runtimeMirrorClass: "OS_TEMP_MIRROR", lineage: matchingLineage, acceptedBuild: { accepted: false }, artifact: { complete: true, lineageMatch: true }, contradictions: 0 });
  assert.notEqual(classification, "NEXT_LAUNCH_PREREQUISITES_VERIFIED");
  assert.equal(classification, "PRODUCTION_START_WITHOUT_ACCEPTED_BUILD");
});

test("artifact completeness and lineage are separate gates", () => {
  const missing = classifyLaunchPrerequisites({ commandFamily: "NEXT_START", runtimeMirrorClass: "OS_TEMP_MIRROR", lineage: matchingLineage, acceptedBuild: { accepted: true }, artifact: { complete: false, lineageMatch: true }, contradictions: 0 });
  const stale = classifyLaunchPrerequisites({ commandFamily: "NEXT_START", runtimeMirrorClass: "OS_TEMP_MIRROR", lineage: matchingLineage, acceptedBuild: { accepted: true }, artifact: { complete: true, lineageMatch: false }, contradictions: 0 });
  assert.equal(missing, "REQUIRED_BUILD_ARTIFACTS_MISSING");
  assert.equal(stale, "BUILD_ARTIFACT_LINEAGE_MISMATCH");
});

test("unknown command, runtime mismatch and contradictions fail closed", () => {
  assert.equal(classifyLaunchPrerequisites({ commandFamily: "UNKNOWN", runtimeMirrorClass: "OS_TEMP_MIRROR", lineage: matchingLineage }), "COMMAND_FAMILY_UNVERIFIABLE");
  assert.equal(classifyLaunchPrerequisites({ commandFamily: "NEXT_DEV", runtimeMirrorClass: "WORKSPACE", lineage: { ...matchingLineage, runtimeInputDigest: sha.replace(/a/g, "b") } }), "DEV_RUNTIME_LINEAGE_MISMATCH");
  assert.equal(classifyLaunchPrerequisites({ commandFamily: "NEXT_DEV", runtimeMirrorClass: "OS_TEMP_MIRROR", lineage: matchingLineage, contradictions: 2 }), "MULTIPLE_CONTRADICTORY_BLOCKERS");
});

test("artifact inventory never trusts existence without ownership class", () => {
  const inventory = buildArtifactInventory({ exists: Object.fromEntries(REQUIRED_ARTIFACTS.map((item) => [item, true])) });
  assert.equal(inventory.complete, true);
  assert.equal(inventory.ownership, "PRESERVE_ONLY");
  assert.equal(inventory.rootClass, "EXISTING_NEXT_ARTIFACTS_PRESERVE_ONLY");
});

test("strict receipt rejects raw output, absolute paths and score mutation", () => {
  const receipt = initialReceipt();
  assert.equal(validateReceipt(receipt), true);
  const raw = { ...receipt, rawOutput: "forbidden" };
  assert.throws(() => validateReceipt(raw), /WP159_RECEIPT_SCHEMA_UNEXPECTED_KEY/);
  const absolute = { ...receipt, launchIdentity: { ...receipt.launchIdentity, rawPath: "C:\\\\secret" } };
  assert.throws(() => validateReceipt(absolute), /WP159_RECEIPT_IDENTITY_SCHEMA_UNEXPECTED_KEY/);
  const score = initialReceipt();
  score.scoreImpact.CAT09.after = 7.0;
  assert.throws(() => validateReceipt(score), /WP159_RECEIPT_SCORE_MUTATION_FORBIDDEN/);
});

test("receipt status and classification must agree for verified outcome", () => {
  const receipt = initialReceipt();
  receipt.status = "WP159_NEXT_LAUNCH_PREREQUISITES_VERIFIED";
  assert.throws(() => validateReceipt(receipt), /WP159_RECEIPT_STATUS_CLASSIFICATION_MISMATCH/);
});

test("all side-effect sentinels remain zero and scores unchanged", () => {
  const receipt = initialReceipt();
  assert.deepEqual(Object.values(receipt.sideEffects), Object.values(receipt.sideEffects).map(() => 0));
  assert.equal(receipt.scoreImpact.CAT06.after, 7.0);
  assert.equal(receipt.scoreImpact.CAT09.after, 6.5);
  assert.equal(receipt.scoreImpact.total.after, 71.5);
});

test("command, mirror, artifact and status helpers cover every safe boundary", () => {
  assert.equal(classifyCommandFamily({ argv: ["node"], sourceText: 'spawn("next", "dev")' }), "NEXT_DEV");
  assert.equal(classifyCommandFamily({ sourceText: 'spawn("next", "start")' }), "NEXT_START");
  assert.equal(classifyCommandFamily({ argv: ["dev"], sourceText: 'spawn("next", "start")' }), "UNKNOWN");
  assert.equal(classifyRuntimeMirror({ sourceText: "const tempRoot = os.tmpdir(); copyMirror(tempRoot);" }), "OS_TEMP_MIRROR");
  assert.equal(classifyRuntimeMirror({ tempRootClass: "WORKSPACE" }), "WORKSPACE");
  assert.equal(classifyRuntimeMirror({ sourceText: "const tempRoot = workspace;" }), "UNKNOWN");

  const partial = buildArtifactInventory({ exists: { [REQUIRED_ARTIFACTS[0]]: true }, ownership: "PRESERVE_ONLY" });
  assert.equal(partial.complete, false);
  assert.equal(Object.values(partial.required).filter(Boolean).length, 1);
  assert.equal(statusForClassification("NEXT_LAUNCH_PREREQUISITES_VERIFIED"), "WP159_NEXT_LAUNCH_PREREQUISITES_VERIFIED");
  assert.equal(statusForClassification("COMMAND_FAMILY_UNVERIFIABLE"), "WP159_EXACT_NO_GO_LAUNCH_PREREQUISITE_AMBIGUOUS");
  assert.equal(statusForClassification("REQUIRED_BUILD_ARTIFACTS_MISSING"), "WP159_NEXT_LAUNCH_BLOCKER_AUTHORITATIVELY_CLASSIFIED");
});

test("verified NEXT_START and dev lineage failures remain distinct and deterministic", () => {
  assert.equal(classifyLaunchPrerequisites({
    commandFamily: "NEXT_START",
    runtimeMirrorClass: "OS_TEMP_MIRROR",
    lineage: matchingLineage,
    acceptedBuild: { accepted: true },
    artifact: { complete: true, lineageMatch: true },
  }), "NEXT_LAUNCH_PREREQUISITES_VERIFIED");
  assert.equal(classifyLaunchPrerequisites({
    commandFamily: "NEXT_DEV",
    runtimeMirrorClass: "OS_TEMP_MIRROR",
    lineage: { ...matchingLineage, nextPackageVersion: "16.2.10" },
  }), "DEV_RUNTIME_LINEAGE_MISMATCH");
  assert.equal(classifyLaunchPrerequisites({
    commandFamily: "NEXT_START",
    runtimeMirrorClass: "UNKNOWN",
    lineage: matchingLineage,
  }), "BUILD_ARTIFACT_LINEAGE_MISMATCH");
});
