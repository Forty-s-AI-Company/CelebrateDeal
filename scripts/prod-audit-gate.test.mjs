import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAudit } from "./prod-audit-gate.mjs";

const advisory = (id, severity = "high") => ({
  source: 1,
  name: "picomatch",
  severity,
  url: `https://github.com/advisories/${id}`,
});
const meta = { vulnerabilities: { high: 5 } };
const chain = (id) => ({
  picomatch: { severity: "high", via: [advisory(id)] },
  fdir: { severity: "high", via: ["picomatch"] },
  "@rollup/pluginutils": { severity: "high", via: ["picomatch"] },
  "@rollup/plugin-commonjs": { severity: "high", via: ["@rollup/pluginutils", "fdir", "picomatch"] },
  "@sentry/nextjs": { severity: "high", via: ["@rollup/plugin-commonjs"] },
});
const before = new Date("2026-11-18T00:00:00Z");

test("the known picomatch chain passes before the expiry date", () => {
  assert.deepEqual(evaluateAudit({ metadata: meta, vulnerabilities: chain("GHSA-fc5q-39xc-vjpf") }, before), []);
});

test("the exception stops working on its expiry date", () => {
  const problems = evaluateAudit(
    { metadata: meta, vulnerabilities: chain("GHSA-fc5q-39xc-vjpf") },
    new Date("2027-01-01T00:00:00Z"),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /expired/);
});

test("any other high advisory still fails", () => {
  const vulnerabilities = {
    ...chain("GHSA-fc5q-39xc-vjpf"),
    lodash: { severity: "high", via: [advisory("GHSA-aaaa-bbbb-cccc")] },
  };
  const problems = evaluateAudit({ metadata: meta, vulnerabilities }, before);
  assert.ok(problems.some((problem) => problem.includes("GHSA-aaaa-bbbb-cccc")));
});

test("a critical advisory outside the chain fails", () => {
  const vulnerabilities = { lodash: { severity: "critical", via: [advisory("GHSA-aaaa-bbbb-cccc", "critical")] } };
  assert.equal(evaluateAudit({ metadata: meta, vulnerabilities }, before).length, 2);
});

test("a new package that is high because of picomatch fails", () => {
  const vulnerabilities = { ...chain("GHSA-fc5q-39xc-vjpf"), "some-runtime-lib": { severity: "high", via: ["picomatch"] } };
  const problems = evaluateAudit({ metadata: meta, vulnerabilities }, before);
  assert.ok(problems.some((problem) => problem.includes("some-runtime-lib")));
});

test("the excepted advisory on a package outside the chain fails", () => {
  const vulnerabilities = {
    ...chain("GHSA-fc5q-39xc-vjpf"),
    "other-lib": { severity: "high", via: [advisory("GHSA-fc5q-39xc-vjpf")] },
  };
  const problems = evaluateAudit({ metadata: meta, vulnerabilities }, before);
  assert.ok(problems.some((problem) => problem.includes("other-lib")));
});

test("moderate findings are ignored and missing metadata fails", () => {
  const vulnerabilities = { glob: { severity: "moderate", via: [advisory("GHSA-xxxx-yyyy-zzzz", "moderate")] } };
  assert.deepEqual(evaluateAudit({ metadata: meta, vulnerabilities }, before), []);
  assert.equal(evaluateAudit({}, before).length, 1);
});
