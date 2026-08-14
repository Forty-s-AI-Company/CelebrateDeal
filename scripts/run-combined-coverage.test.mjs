import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import {
  isOwnedCoverageContainer,
  isProductionScriptCoverage,
  parseCoverageContainerInspection,
  selectedCoverageEnvironment,
} from "./run-combined-coverage.mjs";

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

test("selects a hermetic environment without inheriting developer secrets", () => {
  process.env.HOST_FAKE_SENSITIVE_VALUE = "must-not-cross-boundary";
  try {
    const environment = selectedCoverageEnvironment("C:\\Temp\\celebratedeal-combined-coverage-0123456789abcdef");
    assert.equal(environment.HOST_FAKE_SENSITIVE_VALUE, undefined);
    assert.equal(environment.HOME, undefined);
    assert.equal(environment.USERPROFILE, undefined);
    assert.equal(environment.NODE_ENV, "test");
  } finally {
    delete process.env.HOST_FAKE_SENSITIVE_VALUE;
  }
});

test("requires exact container identity, labels, and ephemeral data mount", () => {
  const expected = {
    id: "a".repeat(64),
    name: "celebratedeal-combined-coverage-0123456789abcdef",
    runId: "0123456789abcdef",
    marker: "combined-coverage:0123456789abcdef",
  };
  const inspection = parseCoverageContainerInspection(
    `${expected.id}\t/${expected.name}\t${expected.runId}\t${expected.marker}\ttmpfs=/var/lib/postgresql/data\n`,
  );
  assert.equal(isOwnedCoverageContainer(inspection, expected), true);
  assert.equal(isOwnedCoverageContainer({ ...inspection, marker: "different" }, expected), false);
  assert.equal(isOwnedCoverageContainer({ ...inspection, mount: "volume=/var/lib/postgresql/data" }, expected), false);
  assert.equal(parseCoverageContainerInspection("malformed"), null);
});
