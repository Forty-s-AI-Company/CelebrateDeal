import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { summarizeAudit } from "./production-dependency-audit.mjs";

const output = (high, critical) => JSON.stringify({ metadata: { vulnerabilities: { high, critical } } });
test("CI retains a mandatory audit after the product verification steps", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const audit = "      - name: Production dependency audit";
  assert.equal(workflow.split(audit).length, 2);
  assert.ok(workflow.indexOf(audit) > workflow.indexOf("      - name: Preflight"));
  assert.equal(workflow.slice(workflow.indexOf(audit)).trim(),
    `${audit.trim()}\n        run: node scripts/production-dependency-audit.mjs`);
});
test("passes only a successful complete audit without High/Critical findings", () => {
  assert.equal(summarizeAudit({ status: 0, stdout: output(0, 0) }).exitCode, 0);
  for (const status of [1, null]) assert.equal(summarizeAudit({ status, stdout: output(0, 0) }).exitCode, 1);
});
test("never bypasses High/Critical findings even if npm unexpectedly exits zero", () => {
  for (const [high, critical] of [[1, 0], [0, 1]]) {
    const result = summarizeAudit({ status: 0, stdout: output(high, critical) });
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.category, "HIGH_OR_CRITICAL_VULNERABILITY");
  }
});
test("fails closed on malformed, missing or invalid counts", () => {
  for (const stdout of ["not json", "{}", output(-1, 0), output("0", 0)]) {
    assert.equal(summarizeAudit({ status: 0, stdout }).exitCode, 1);
  }
});
test("classifies network failure without exposing raw error bodies or stderr", () => {
  const result = summarizeAudit({ status: 1, stdout: JSON.stringify({ error: { code: "ETIMEDOUT", body: "synthetic-private-detail" } }), stderr: "synthetic-private-detail" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.category, "AUDIT_ENDPOINT_UNAVAILABLE");
  assert.equal(JSON.stringify(result).includes("synthetic-private-detail"), false);
});
test("does not trust a partial report after timeout or termination", () => {
  for (const extra of [{ signal: "SIGTERM" }, { error: { code: "ETIMEDOUT" } }]) {
    assert.equal(summarizeAudit({ status: 0, stdout: output(0, 0), ...extra }).exitCode, 1);
  }
});
