import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  CLASSIFICATIONS,
  createGeneratedContentReadGuard,
  hasExcludedNextSegment,
  shouldIncludeInTempMirror,
  shouldRecurseMetadata,
  sourceSelectionProbe,
} from "./wp136-next-temp-isolation-auditor.mjs";

test("excludes root and nested .next segments case-insensitively", () => {
  for (const candidate of [".next/types/validator.ts", "src/.NEXT/route.ts", "src\\.Next\\route.ts"]) {
    assert.equal(hasExcludedNextSegment(candidate), true);
    assert.equal(shouldIncludeInTempMirror(candidate), false);
  }
});
test("does not over-exclude similarly named directories", () => {
  for (const candidate of [".next-safe/route.ts", "src/.next-old/route.ts", "docs/.nextsafe/example.md"]) {
    assert.equal(hasExcludedNextSegment(candidate), false);
    assert.equal(shouldIncludeInTempMirror(candidate), true);
  }
});

test("normalizes separators and absolute-like relative paths", () => {
  const probe = sourceSelectionProbe([
    "./.next\\types\\validator.ts",
    "src\\.NEXT\\route.ts",
    "./src/page.tsx",
  ]);
  assert.equal(probe.excludedNextCount, 2);
  assert.equal(probe.selectedNextCount, 0);
  assert.equal(probe.selectedCount, 1);
});

test("root-prune selection is decided before recursion", () => {
  const probe = sourceSelectionProbe([".next", ".next/types/validator.ts", "src", "node_modules"]);
  assert.equal(probe.excludedNextCount, 2);
  assert.equal(probe.selectedNextCount, 0);
  assert.equal(probe.selectedCount, 2);
});

test("reparse points are never followed by metadata traversal", () => {
  assert.equal(shouldRecurseMetadata({ isDirectory: () => true, isSymbolicLink: () => false }), true);
  assert.equal(shouldRecurseMetadata({ isDirectory: () => true, isSymbolicLink: () => true }), false);
  assert.equal(shouldRecurseMetadata({ isDirectory: () => false, isSymbolicLink: () => false }), false);
});

test("generated content read guard fails closed", () => {
  const syntheticNext = path.resolve(process.cwd(), "wp136-synthetic", ".next");
  const guard = createGeneratedContentReadGuard(syntheticNext);
  assert.throws(() => guard.assertReadForbidden(path.join(syntheticNext, "types", "validator.ts")), /GENERATED_CONTENT_READ_FORBIDDEN/);
  assert.equal(guard.attemptedReads, 1);
});

test("selection summary cannot hide an excluded .next path", () => {
  const probe = sourceSelectionProbe(["src/page.tsx", ".next/types/route.ts", "docs/readme.md"]);
  assert.equal(probe.selectedNextCount, 0);
  assert.equal(probe.excludedNextCount, probe.excludedCount);
  assert.equal(CLASSIFICATIONS.SAFE_TEMP_EXCLUSION_PROVEN, "SAFE_TEMP_EXCLUSION_PROVEN");
});
