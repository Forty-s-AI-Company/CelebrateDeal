import assert from "node:assert/strict";
import test from "node:test";
import { completeQaFinanceMfa, qaFinanceTotpCode, QaFinanceMfaError, QA_FINANCE_TOTP_ENV, requireQaFinanceTotpSeed } from "./qa-finance-totp.mjs";

// RFC 6238 appendix B SHA1 seed ("12345678901234567890"), public test vector.
const RFC_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("computes RFC 6238 SHA1 six-digit codes", () => {
  for (const [seconds, code] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"],
    [1234567890, "005924"], [2000000000, "279037"]]) {
    assert.equal(qaFinanceTotpCode(RFC_SEED, seconds * 1000), code);
  }
});

test("missing or malformed seeds fail closed with fixed explanations only", () => {
  const lines = [];
  const log = (line) => lines.push(line);
  for (const env of [{}, { [QA_FINANCE_TOTP_ENV]: "" }, { [QA_FINANCE_TOTP_ENV]: "   " }]) {
    assert.throws(() => requireQaFinanceTotpSeed(env, { log }), (error) => error instanceof QaFinanceMfaError && error.category === "SEED_MISSING");
  }
  for (const value of ["123456", "GEZDGNBVGY3TQOJQ", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJ1", "synthetic-not-base32-synthetic-not-base32"]) {
    assert.throws(() => requireQaFinanceTotpSeed({ [QA_FINANCE_TOTP_ENV]: value }, { log }),
      (error) => error.category === "SEED_INVALID" && !error.message.includes(value));
    assert.equal(lines.some((line) => line.includes(value)), false);
  }
  assert.ok(lines.every((line) => line.startsWith("[qa-finance-mfa] ")));
  assert.ok(lines.some((line) => line.includes(QA_FINANCE_TOTP_ENV)));
});

test("normalizes spacing, padding and case of a valid seed", () => {
  const spaced = `${RFC_SEED.toLowerCase().match(/.{4}/gu).join(" ")}==`;
  assert.equal(requireQaFinanceTotpSeed({ [QA_FINANCE_TOTP_ENV]: spaced }, { log: () => {} }), RFC_SEED);
});

function fakePage(initialPath, afterSubmitPath) {
  let path = initialPath;
  const calls = { filled: [], clicked: [] };
  return {
    calls,
    url: () => `https://staging.invalid${path}`,
    locator: (selector) => ({ fill: async (value) => { calls.filled.push([selector, value]); } }),
    getByRole: (role, options) => ({ click: async () => { calls.clicked.push([role, options.name]); path = afterSubmitPath; } }),
  };
}

test("submits the current seed-derived code on /mfa/verify", async () => {
  const page = fakePage("/mfa/verify?next=%2Fadmin%2Fbilling%2Fdashboard", "/admin/billing/dashboard");
  let waited = 0;
  const result = await completeQaFinanceMfa(page, { seed: RFC_SEED, now: () => 59_000, waitAfterMfa: async () => { waited += 1; }, log: () => {} });
  assert.equal(result, true);
  assert.equal(waited, 1);
  assert.deepEqual(page.calls.filled, [['input[name="code"]', "287082"]]);
  assert.deepEqual(page.calls.clicked, [["button", "確認並繼續"]]);
});

test("never enrolls a server-generated secret on /mfa/setup", async () => {
  const lines = [];
  const page = fakePage("/mfa/setup?next=%2Fadmin%2Fbilling%2Fdashboard", "/admin/billing/dashboard");
  await assert.rejects(completeQaFinanceMfa(page, { seed: RFC_SEED, waitAfterMfa: async () => {}, log: (line) => lines.push(line) }),
    (error) => error.category === "NOT_ENROLLED");
  assert.deepEqual(page.calls, { filled: [], clicked: [] });
  assert.match(lines.join("\n"), /bootstrap/u);
});

test("does nothing when no MFA page is shown and rejects an unfinished verification", async () => {
  const dashboard = fakePage("/admin/billing/dashboard", "/admin/billing/dashboard");
  assert.equal(await completeQaFinanceMfa(dashboard, { seed: RFC_SEED, waitAfterMfa: async () => {}, log: () => {} }), false);
  assert.deepEqual(dashboard.calls, { filled: [], clicked: [] });
  const rejected = fakePage("/mfa/verify", "/mfa/verify?error=invalid");
  await assert.rejects(completeQaFinanceMfa(rejected, { seed: RFC_SEED, waitAfterMfa: async () => {}, log: () => {} }),
    (error) => error.category === "NOT_COMPLETED");
});
