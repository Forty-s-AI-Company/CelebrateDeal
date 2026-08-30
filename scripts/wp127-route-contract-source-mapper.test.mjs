import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT,
  OUTCOMES,
  classifySourceOwnership,
  extractExportInventory,
  extractImportPaths,
  mapGeneratedToSource,
  parseDiffHunks,
  spansOverlap,
} from "./wp127-route-contract-source-mapper.mjs";

test("maps the exact generated route to its source route", () => {
  assert.equal(mapGeneratedToSource(CONTRACT.EXPECTED_GENERATED_PATH), CONTRACT.EXPECTED_SOURCE_PATH);
  assert.equal(mapGeneratedToSource(".next/types/app/api/other/route.ts"), "src/app/api/other/route.ts");
  assert.equal(mapGeneratedToSource(".next/cache/route.ts"), null);
});

test("extracts export inventory without retaining source snippets", () => {
  const inventory = extractExportInventory("export function createCloudflareStreamWebhookHandler() {}\nexport const POST = 1;");
  assert.deepEqual(inventory.map(({ name, kind }) => ({ name, kind })), [
    { name: "createCloudflareStreamWebhookHandler", kind: "function" },
    { name: "POST", kind: "const" },
  ]);
});

test("normalizes imports to safe counts and paths", () => {
  assert.deepEqual(extractImportPaths("import x from \"@/lib/db\"; import y from \"zod\";"), ["<package>", "src/lib/db"]);
});

test("parses hunk ranges and detects symbol overlap", () => {
  const hunks = parseDiffHunks("@@ -1,2 +10,3 @@\n+hidden\n");
  assert.deepEqual(hunks, [{ startLine: 10, endLine: 12 }]);
  assert.equal(spansOverlap(hunks, [{ name: "POST", startLine: 12, endLine: 20 }]), true);
  assert.equal(spansOverlap(hunks, [{ name: "POST", startLine: 20, endLine: 22 }]), false);
});

test("dirty or staged ownership is preserve-only and fail-closed", () => {
  assert.deepEqual(classifySourceOwnership({ statusPresent: true, stagedPresent: false, dirtyHunks: [] }, []), {
    classification: OUTCOMES.EXACT_NO_GO,
    ownership: "PRESERVE_ONLY",
    overlap: false,
  });
  assert.deepEqual(classifySourceOwnership({ statusPresent: false, stagedPresent: false, dirtyHunks: [] }, []), {
    classification: OUTCOMES.CLEAN_SEPARABLE_CANDIDATE,
    ownership: "CLEAN_OR_UNCHANGED",
    overlap: false,
  });
});
