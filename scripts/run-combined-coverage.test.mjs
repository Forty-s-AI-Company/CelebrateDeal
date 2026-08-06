import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import { isProductionScriptCoverage } from "./run-combined-coverage.mjs";

const workspaceRoot = process.cwd();
const fileUrl = (relativePath) => new URL(relativePath, `file://${workspaceRoot.replaceAll("\\", "/")}/`).href;

test("attributes production script coverage for both mjs and ts sources", () => {
  assert.equal(isProductionScriptCoverage({ url: fileUrl("scripts/run-combined-coverage.mjs") }, workspaceRoot), true);
  assert.equal(isProductionScriptCoverage({ url: fileUrl("scripts/node-tap-contract-tests.ts") }, workspaceRoot), true);
});

test("does not attribute test files or sources outside scripts", () => {
  assert.equal(isProductionScriptCoverage({ url: fileUrl("scripts/run-combined-coverage.test.mjs") }, workspaceRoot), false);
  assert.equal(isProductionScriptCoverage({ url: fileUrl("scripts/node-tap-contract-tests.test.ts") }, workspaceRoot), false);
  assert.equal(isProductionScriptCoverage({ url: fileUrl("src/lib/example.ts") }, workspaceRoot), false);
  assert.equal(isProductionScriptCoverage({ url: "https://example.invalid/scripts/runner.mjs" }, workspaceRoot), false);
});

test("strips V8 query strings before applying the source boundary", () => {
  const url = `${fileUrl("scripts/run-combined-coverage.mjs")}?source-map`;
  assert.equal(isProductionScriptCoverage({ url }, workspaceRoot), true);
  assert.equal(path.isAbsolute(workspaceRoot), true);
});
