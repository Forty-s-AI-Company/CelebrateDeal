import assert from "node:assert/strict";
import { test } from "node:test";
import { attestStagingPreview } from "./staging-preview-preflight-attestation.mjs";

const host = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
const secret = "synthetic-staging-job-secret";
const ready = {
  environment: { ok: true, checks: [
    { key: "PAYUNI_ENV", status: "pass", message: "PayUni environment 與 sandbox deployment boundary 一致" },
    { key: "PAYUNI_HASH_KEY", status: "pass", message: "configured" },
    { key: "PAYUNI_HASH_IV", status: "pass", message: "configured" },
    { key: "PAYUNI_MERCHANT_ID", status: "pass", message: "configured" },
  ] }, database_reachable: true, all_passed: true,
  supabase_url_match: true, database_url_match: true, direct_url_match: true,
  staging_database_url_match: true,
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("attests only the fixed staging Preview and redacts the bearer credential", async () => {
  let called = false;
  const result = await attestStagingPreview({ host, jobSecret: secret, fetchImpl: async (url, options) => {
    called = true;
    assert.equal(url, `https://${host}/api/admin/preflight`);
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(options.redirect, "manual");
    return response(ready);
  } });
  assert.equal(called, true);
  assert.equal(result.result, "PASS");
  assert.deepEqual(result.paymentBinding, {
    providerSelected: true, sandboxEnvironment: true, merchantCredentialsConfigured: true,
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("reports missing or duplicate PayUni checks as unproven without disclosing messages", async () => {
  for (const environmentChecks of [
    [],
    [...ready.environment.checks, ready.environment.checks[0]],
    ready.environment.checks.map((item) => item.key === "PAYUNI_ENV" ? { ...item, status: "fail" } : item),
    ready.environment.checks.filter((item) => item.key !== "PAYUNI_MERCHANT_ID"),
  ]) {
    const result = await attestStagingPreview({ host, jobSecret: secret, fetchImpl: async () => response({
      ...ready,
      environment: { ok: true, checks: environmentChecks },
    }) });
    assert.equal(result.result, "BLOCKED");
    assert.equal(Object.values(result.paymentBinding).every(Boolean), false);
    assert.equal(JSON.stringify(result).includes("configured"), false);
    assert.equal(JSON.stringify(result).includes("PAYUNI_MERCHANT_ID"), false);
  }
});

test("rejects another host before sending the credential", async () => {
  const result = await attestStagingPreview({ host: "other.example.com", jobSecret: secret, fetchImpl: () => { throw new Error("must not fetch"); } });
  assert.deepEqual(result, { result: "BLOCKED", reason: "INVALID_PREVIEW_HOST" });
});

test("fails closed on authorization or staging database mismatch", async () => {
  const unauthorized = await attestStagingPreview({ host, jobSecret: secret, fetchImpl: async () => response({}, 401) });
  assert.deepEqual(unauthorized, { result: "BLOCKED", reason: "PREFLIGHT_UNAUTHORIZED" });
  const wrongDatabase = await attestStagingPreview({ host, jobSecret: secret, fetchImpl: async () => response({ ...ready, database_url_match: false }) });
  assert.equal(wrongDatabase.result, "BLOCKED");
  assert.equal(wrongDatabase.checks.runtimeDatabaseIdentity, false);
});
