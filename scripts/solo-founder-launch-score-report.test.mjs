import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { calculateSoloFounderScore } from "./solo-founder-launch-score.mjs";

const report = JSON.parse(fs.readFileSync("docs/launch/solo-founder-launch-score.json", "utf8"));

test("current Solo Founder score report is reproducible and unapplied", () => {
  const scores = Object.fromEntries(Object.entries(report.categories).map(([id, value]) => [id, value.score]));
  const calculated = calculateSoloFounderScore(scores);
  assert.equal(typeof report.currentEvidenceAudit, "string");
  assert.equal(fs.existsSync(report.currentEvidenceAudit), true);
  const audit = fs.readFileSync(report.currentEvidenceAudit, "utf8");
  assert.match(audit, new RegExp(`稽核時間：${report.asOf}`, "u"));
  assert.match(audit, /releaseDecision=NO_GO/u);
  assert.equal(calculated.total, report.soloFounderLaunchScore);
  assert.equal(report.scoreAppliedToCanonical, false);
  assert.equal(report.readiness.SANDBOX_READY.value, false);
  assert.equal(report.readiness.PRODUCTION_READY.value, false);
});
