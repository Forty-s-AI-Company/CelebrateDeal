import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

test("G7-54 current readiness truth preserves canonical scores and records the function delta", () => {
  const script = path.resolve("scripts/readiness-truth-reconciliation.mjs");
  const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
  const receipt = JSON.parse(output);
  assert.deepEqual(receipt, {
    work_package: "G7-54",
    status: "PASS",
    total: 75.5,
    category_count: 10,
    g1: "CLOSED",
    sandbox_ready: false,
    production_ready: false,
    legacy_sources_classified: 5,
    score_change: 0,
    staging_rollback_gate: "CLOSED_FOR_STAGING",
    wp131_score_change: 0.5,
    g7_23_score_change: 0.5,
    g7_48_score_change: 0.5,
    g7_49_score_change: 0.5,
    g7_51_score_change: 0.5,
    g7_53_score_change: 0,
    g7_54_score_change: 0,
  });
});
