import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLASSIFICATIONS,
  buildSyntheticEnvironment,
  classifySyntheticLineage,
  cleanupTemp,
  copyTree,
  digestFile,
  isForbiddenMirrorPath,
  isAllowedOutcome,
  normalizeRelativePath,
  pathSegments,
  sanitizeInventory,
} from "./wp137-temp-next-route-lineage-runner.mjs";
import { shouldIncludeInTempMirror } from "./wp136-next-temp-isolation-auditor.mjs";

const baseTypegen = { exitCode: 0, outputRootInsideTemp: true };
const baseInventory = {
  inventoryComplete: true,
  targetReferences: [{ path: ".next/types/validator.ts" }],
};
const baseMapping = { mapped: true, allowed: ["POST"] };
const baseExports = [{ name: "createCloudflareStreamWebhookHandler", kind: "function", startLine: 10, endLine: 20, signatureFingerprint: "fp" }, { name: "POST", kind: "const", startLine: 40, endLine: 42, signatureFingerprint: "post" }];

test("accepts only the three exact WP-137 outcomes", () => {
  assert.equal(isAllowedOutcome(CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE), true);
  assert.equal(isAllowedOutcome(CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO), true);
  assert.equal(isAllowedOutcome(CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO), true);
  assert.equal(isAllowedOutcome(CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED), false);
});
test("uses the accepted WP-136 exclusion contract for nested paths", () => {
  assert.equal(shouldIncludeInTempMirror(".next/types/validator.ts"), false);
  assert.equal(shouldIncludeInTempMirror("src/.NEXT/route.ts"), false);
  assert.equal(shouldIncludeInTempMirror("src/.next-safe/route.ts"), true);
});

test("classifies an exact clean separable disallowed export", () => {
  const result = classifySyntheticLineage({
    typegen: baseTypegen,
    inventory: baseInventory,
    mapping: baseMapping,
    sourceExports: baseExports,
    ownership: { ownership: "TRACKED_CLEAN", ranges: [] },
    targetSourceDigestMatches: true,
  });
  assert.equal(result.classification, CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE);
  assert.equal(result.diagnostic.symbol, "createCloudflareStreamWebhookHandler");
});

test("classifies dirty-hunk overlap as exact preserve-only no-go", () => {
  const result = classifySyntheticLineage({
    typegen: baseTypegen,
    inventory: baseInventory,
    mapping: baseMapping,
    sourceExports: baseExports,
    ownership: { ownership: "PRESERVE_ONLY_DIRTY", ranges: [{ startLine: 18, endLine: 22 }] },
    targetSourceDigestMatches: true,
  });
  assert.equal(result.classification, CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO);
  assert.equal(result.diagnostic.dirtyHunkOverlap, true);
});

test("classifies a complete inventory with omitted target as exact omission", () => {
  const result = classifySyntheticLineage({
    typegen: baseTypegen,
    inventory: { inventoryComplete: true, targetReferences: [] },
    mapping: { mapped: false, reason: "TARGET_ROUTE_CONTRACT_NOT_FOUND" },
    sourceExports: [],
    ownership: { ownership: "PRESERVE_ONLY_DIRTY", ranges: [] },
    targetSourceDigestMatches: true,
  });
  assert.equal(result.classification, CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO);
});

test("fails closed when typegen or source lineage is uncertain", () => {
  const typegenFailure = classifySyntheticLineage({
    typegen: { exitCode: 1, outputRootInsideTemp: false },
    inventory: baseInventory,
    mapping: baseMapping,
    sourceExports: baseExports,
    ownership: { ownership: "TRACKED_CLEAN", ranges: [] },
    targetSourceDigestMatches: true,
  });
  assert.equal(typegenFailure.classification, CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);

  const digestFailure = classifySyntheticLineage({
    typegen: baseTypegen,
    inventory: baseInventory,
    mapping: baseMapping,
    sourceExports: baseExports,
    ownership: { ownership: "TRACKED_CLEAN", ranges: [] },
    targetSourceDigestMatches: false,
  });
  assert.equal(digestFailure.classification, CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});

test("uses synthetic process values and does not inherit Sentry credentials", () => {
  const environment = buildSyntheticEnvironment("C:\\temp\\wp137");
  assert.equal(environment.SENTRY_DISABLE_AUTO_UPLOAD, "true");
  assert.equal(environment.NEXT_TELEMETRY_DISABLED, "1");
  assert.equal(Object.hasOwn(environment, "SENTRY_AUTH_TOKEN"), false);
  assert.match(environment.DATABASE_URL, /^postgresql:\/\/synthetic:/u);
});

test("WP137 path policy normalizes separators and rejects sensitive mirror entries", () => {
  assert.equal(normalizeRelativePath("./src\\app//page.tsx/"), "src/app/page.tsx");
  assert.deepEqual(pathSegments("Src\\App\\Page.tsx"), ["src", "app", "page.tsx"]);
  assert.equal(isForbiddenMirrorPath("src/page.tsx"), false);
  assert.equal(isForbiddenMirrorPath(".next/types/validator.ts"), true);
  assert.equal(isForbiddenMirrorPath("src/.env.local"), true);
  assert.equal(isForbiddenMirrorPath("certs/private.key"), true);
});

test("WP137 copyTree copies safe source and excludes generated or sensitive entries", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp137-copy-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  try {
    await fsp.mkdir(path.join(source, "src"), { recursive: true });
    await fsp.mkdir(path.join(source, ".next"), { recursive: true });
    await fsp.mkdir(path.join(source, "certs"), { recursive: true });
    await fsp.writeFile(path.join(source, "src", "page.tsx"), "export default function Page() {}", "utf8");
    await fsp.writeFile(path.join(source, ".env.local"), "never-read", "utf8");
    await fsp.writeFile(path.join(source, ".next", "BUILD_ID"), "generated", "utf8");
    await fsp.writeFile(path.join(source, "certs", "private.key"), "private", "utf8");
    const summary = copyTree(source, target);
    assert.equal(fs.existsSync(path.join(target, "src", "page.tsx")), true);
    assert.equal(fs.existsSync(path.join(target, ".next")), false);
    assert.equal(summary.copiedFiles, 1);
    assert.ok(summary.excludedEntries >= 3);
    assert.match(summary.excludedClassDigest, /^[0-9a-f]{64}$/);
    assert.match(digestFile(path.join(target, "src", "page.tsx")), /^[0-9a-f]{64}$/);
  } finally {
    assert.equal(cleanupTemp(root), true);
  }
});

test("WP137 sanitized inventory is digest-only and deterministic", () => {
  const inventory = {
    inventoryComplete: true,
    targetReferences: [{ path: ".next/types/validator.ts", digest: "digest-a" }],
    files: [{ path: ".next/types/validator.ts", digest: "digest-a", targetHit: true }],
    requiredFilesPresent: true,
  };
  const sanitized = sanitizeInventory(inventory);
  assert.deepEqual(Object.keys(sanitized).sort(), ["fileCount", "inventoryComplete", "inventoryDigest", "requiredFilesPresent", "routeReferenceDigest", "targetReferenceCount"]);
  assert.match(sanitized.routeReferenceDigest, /^[0-9a-f]{64}$/);
  assert.match(sanitized.inventoryDigest, /^[0-9a-f]{64}$/);
});
