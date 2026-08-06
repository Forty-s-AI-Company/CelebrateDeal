import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASSIFICATIONS,
  buildSyntheticEnvironment,
  classifySyntheticLineage,
  isAllowedOutcome,
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
