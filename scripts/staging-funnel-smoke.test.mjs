import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyFunnelRequest, funnelCreateFeedbackKind, funnelRouteCategory, runStagingFunnelSmoke } from "./staging-funnel-smoke.mjs";

function request(url, method = "GET", headers = {}, postData = null) {
  return { url: () => url, method: () => method, headers: () => headers, postData: () => postData };
}

test("only owner-side Funnel server actions may write", () => {
  const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
  const headers = { "next-action": "synthetic-action" };
  assert.equal(classifyFunnelRequest(request(`${origin}/projects/new`, "POST")), "PROJECT_CREATE");
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

test("navigation evidence contains only fixed route categories", () => {
  const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
  assert.equal(funnelRouteCategory(`${origin}/landing-pages/new?secret=hidden`), "FUNNEL_NEW");
  assert.equal(funnelRouteCategory(`${origin}/onboarding`), "ONBOARDING");
  assert.equal(funnelRouteCategory(`${origin}/projects/abc123`), "PROJECT");
  assert.equal(funnelRouteCategory(`${origin}/login`), "LOGIN");
  assert.equal(funnelRouteCategory(`${origin}/arbitrary/private`), "OTHER");
  assert.equal(funnelRouteCategory("invalid"), "INVALID_URL");
});

test("create feedback reveals only known fixed categories", () => {
  assert.equal(funnelCreateFeedbackKind([]), "NONE");
  assert.equal(funnelCreateFeedbackKind(["草稿已建立。"]), "CREATED");
  assert.equal(funnelCreateFeedbackKind(["請先選擇一個銷售專案後再管理一頁式網站。"]), "SCOPE_REQUIRED");
  assert.equal(funnelCreateFeedbackKind(["頁面內容格式不正確或資料過大，請重新整理後再試。"]), "FORMAT_INVALID");
  assert.equal(funnelCreateFeedbackKind(["請確認頁面內容與已選的報名表單、直播都屬於目前專案且可公開使用。"]), "BINDING_INVALID");
  assert.equal(funnelCreateFeedbackKind(["暫時無法完成操作；內容仍保留，請稍後再試。"]), "SERVER_FAILURE");
  assert.equal(funnelCreateFeedbackKind(["連線中斷，Funnel 尚未建立，請稍後再試。"]), "NETWORK_FAILURE");
  assert.equal(funnelCreateFeedbackKind(["sensitive unknown message"]), "OTHER");
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
