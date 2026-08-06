import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

test("WP-195 current readiness truth preserves prior baselines and applies accepted deltas", () => {
  const script = path.resolve("scripts/readiness-truth-reconciliation.mjs");
  const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
  const receipt = JSON.parse(output);
  assert.deepEqual(receipt, {
    work_package: "WP-195",
    status: "PASS",
    total: 73.5,
    category_count: 10,
    g1: "CLOSED",
    sandbox_ready: false,
    production_ready: false,
    legacy_sources_classified: 5,
    score_change: 0.5,
    staging_rollback_gate: "CLOSED_FOR_STAGING",
    wp131_score_change: 0.5,
  });
});
