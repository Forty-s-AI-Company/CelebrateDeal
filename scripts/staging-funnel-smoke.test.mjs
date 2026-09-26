import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyFunnelRequest, runStagingFunnelSmoke } from "./staging-funnel-smoke.mjs";

function request(url, method = "GET", headers = {}, postData = null) {
  return { url: () => url, method: () => method, headers: () => headers, postData: () => postData };
}

test("only owner-side Funnel server actions may write", () => {
  const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
  const headers = { "next-action": "synthetic-action" };
  assert.equal(classifyFunnelRequest(request(`${origin}/landing-pages/new`, "POST", headers)), "FUNNEL_WRITE");
  assert.equal(classifyFunnelRequest(request(`${origin}/landing-pages/abc123/operations`, "POST", headers), "/landing-pages/abc123"), "FUNNEL_WRITE");
  assert.equal(classifyFunnelRequest(request(`${origin}/landing-pages/abc123`, "POST", headers), "/landing-pages/abc123"), "FUNNEL_WRITE");
  assert.equal(classifyFunnelRequest(request(`${origin}/landing-pages/other/operations`, "POST", headers), "/landing-pages/abc123"), "BLOCK");
  assert.equal(classifyFunnelRequest(request(`${origin}/landing-pages/abc123`, "POST")), "BLOCK");
  assert.equal(classifyFunnelRequest(request(`${origin}/api/payments/checkout`, "POST", headers)), "BLOCK");
  assert.equal(classifyFunnelRequest(request(`${origin}/api/payments/refund`, "POST", headers)), "BLOCK");
  assert.equal(classifyFunnelRequest(request(`${origin}/api/email/send`, "POST", headers)), "BLOCK");
  assert.equal(classifyFunnelRequest(request("https://example.test/landing-pages/new", "POST", headers)), "EXTERNAL");
});

test("invalid binding cannot issue a session or launch Chromium", async () => {
  const report = await runStagingFunnelSmoke({ CELEBRATEDEAL_SOURCE_SHA: "bad" }, {
    verifyLineage: () => { throw new Error("unexpected lineage check"); },
    playwright: { chromium: { launch: () => { throw new Error("unexpected browser launch"); } } },
  });
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.reason, "INVALID_BINDING");
  assert.equal(report.sideEffects.syntheticSessionCreated, 0);
});

test("protected workflow binds exact source and uploads only sanitized receipt", async () => {
  const workflow = await readFile(new URL("../.github/workflows/staging-funnel-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /github\.ref_protected/u);
  assert.match(workflow, /--verify-lineage/u);
  assert.match(workflow, /--verify-alias/u);
  assert.match(workflow, /celebratedeal-staging-funnel-smoke\.json/u);
  assert.doesNotMatch(workflow, /\.env(?:\.|\b)/u);
});
