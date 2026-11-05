import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyFunnelRequest, createPageBlocked, funnelCreateFeedbackKind, funnelEditorNavigationKind, funnelRouteCategory, inspectSyntheticProjectStatus, inspectPublicSurface, syntheticFunnelSlug, runStagingFunnelSmoke } from "./staging-funnel-smoke.mjs";
import { classifyPublishDiagnosis, classifyRequestFailureKind, classifyRouteGetKind, formatPublishSummary, publishBlockedReason, runPublishStage } from "./staging-funnel-smoke.mjs";

test("read-only diagnostics reject arbitrary paths and emit only fixed surface categories", async () => {
  assert.equal(syntheticFunnelSlug('/lp/staging-synthetic-abcdef123456'), 'staging-synthetic-abcdef123456');
  for (const value of ['/lp/customer', '/lp/staging-synthetic-abcdef123456?secret=value', 'https://elsewhere.test/lp/staging-synthetic-abcdef123456', null]) assert.equal(syntheticFunnelSlug(value), null);
  for (const [heading, expected] of [['404', 'NOT_FOUND'], ['此活動已截止', 'CLOSED'], ['系統暫時無法顯示這個頁面', 'APPLICATION_ERROR'], ['private content', 'UNKNOWN']]) {
    const page = { getByRole: (_, options) => ({ count: async () => options.name === heading ? 1 : 0 }) };
    assert.equal(await inspectPublicSurface(page, false), expected);
    assert.equal(await inspectPublicSurface(page, true), 'RENDERER');
  }
});

test("project diagnostic reads only the exact synthetic project and rejects ambiguity", async () => {
  for (const [labels, count, expected] of [[['草稿'], 1, 'DRAFT'], [['已發布'], 1, 'PUBLISHED'], [['已封存'], 1, 'ARCHIVED'], [[], 0, 'MISSING_OR_AMBIGUOUS'], [['草稿'], 2, 'MISSING_OR_AMBIGUOUS'], [['草稿', '已發布'], 1, 'UNKNOWN']]) {
    const page = {
      goto: async (url) => {
        assert.equal(url, 'https://celebrate-deal-staging.carry-digital-nomad.in.net/projects');
        return { status: () => 200 };
      },
      getByRole: (role, options) => {
        assert.equal(role, 'heading');
        if (options.name === '銷售專案') return { waitFor: async () => {} };
        assert.deepEqual(options, { name: 'Staging Synthetic Project', exact: true });
        return { count: async () => count, locator: () => ({ getByText: (label) => ({ count: async () => labels.includes(label) ? 1 : 0 }) }) };
      },
    };
    assert.equal(await inspectSyntheticProjectStatus(page), expected);
  }
  assert.equal(await inspectSyntheticProjectStatus({ goto: async () => { throw new Error('private diagnostic must not escape'); } }), 'UNAVAILABLE');
});

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
  assert.equal(classifyFunnelRequest(request(`${origin}/landing-pages/abc123/edit`, "POST", headers), "/landing-pages/abc123"), "FUNNEL_WRITE");
  assert.equal(classifyFunnelRequest(request(`${origin}/landing-pages/other/edit`, "POST", headers), "/landing-pages/abc123"), "BLOCK");
  assert.equal(classifyFunnelRequest(request(`${origin}/landing-pages/abc123/edit`, "POST"), "/landing-pages/abc123"), "BLOCK");
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
  assert.equal(funnelRouteCategory(`${origin}/landing-pages/abc123/operations?step=s1`), "FUNNEL_OPERATIONS");
  assert.equal(funnelRouteCategory(`${origin}/landing-pages/abc123/edit?step=s1`), "FUNNEL_EDITOR");
  assert.equal(funnelRouteCategory(`${origin}/projects/new`), "PROJECT_NEW");
  assert.equal(funnelRouteCategory(`${origin}/lp/staging-synthetic-abcdef123456`), "PUBLIC_FUNNEL");
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
  assert.equal(funnelCreateFeedbackKind(["建立失敗，一頁式網站尚未建立，請稍後再試。"]), "NETWORK_FAILURE");
  assert.equal(funnelCreateFeedbackKind(["sensitive unknown message"]), "OTHER");
});

test("editor navigation reports only fixed request and dialog categories", () => {
  assert.equal(funnelEditorNavigationKind({ dialogs: 1, requests: 0, responses: 0, finished: 0, failures: 0 }), "CONFIRMATION_DISMISSED");
  assert.equal(funnelEditorNavigationKind({ dialogs: 0, requests: 0, responses: 0, finished: 0, failures: 0 }), "NO_REQUEST");
  assert.equal(funnelEditorNavigationKind({ dialogs: 0, requests: 1, responses: 0, finished: 0, failures: 1 }), "REQUEST_FAILED");
  assert.equal(funnelEditorNavigationKind({ dialogs: 0, requests: 1, responses: 0, finished: 0, failures: 0 }), "NO_RESPONSE");
  assert.equal(funnelEditorNavigationKind({ dialogs: 0, requests: 1, responses: 1, finished: 0, failures: 1 }), "RESPONSE_ABORTED");
  assert.equal(funnelEditorNavigationKind({ dialogs: 0, requests: 1, responses: 1, finished: 0, failures: 0 }), "RESPONSE_UNFINISHED");
  assert.equal(funnelEditorNavigationKind({ dialogs: 0, requests: 1, responses: 1, finished: 1, failures: 0 }), "RESPONSE_FINISHED_NO_ROUTE");
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

test("create page is reported unavailable while the project guidance is still shown", () => {
  assert.equal(createPageBlocked({ status: 200, headingVisible: true, projectStillMissing: false }), false);
  // The guidance keeps the 建立新的一頁式網站 heading, so the heading alone is not enough.
  assert.equal(createPageBlocked({ status: 200, headingVisible: true, projectStillMissing: true }), true);
  assert.equal(createPageBlocked({ status: 200, headingVisible: false, projectStillMissing: false }), true);
  assert.equal(createPageBlocked({ status: 500, headingVisible: true, projectStillMissing: false }), true);
  assert.equal(createPageBlocked({ status: null, headingVisible: true, projectStillMissing: false }), true);
});

const BINDING = {
  CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40),
  CELEBRATEDEAL_DEPLOYMENT_HOST: "celebrate-deal-staging-abc123-a25814740s-projects.vercel.app",
  GITHUB_TOKEN: "synthetic-github-token",
  VERCEL_TOKEN: "synthetic-vercel-token",
  JOB_SECRET: "synthetic-job-secret-123456",
};

function fakeFunnelBrowser({ failLabel }) {
  const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
  const calls = [];
  const page = () => {
    let current = "about:blank";
    const passive = { waitFor: async () => { throw Object.assign(new Error("hidden"), { name: "TimeoutError" }); }, count: async () => 0 };
    return {
      on: () => {},
      goto: async (url) => { current = url; return { status: () => 200 }; },
      url: () => `${current}?private=${BINDING.JOB_SECRET}`,
      getByRole: (role, options) => {
        if (role === "heading" && options?.name === "建立新的一頁式網站") return { waitFor: async () => {} };
        if (role === "button") return { click: async () => { calls.push(`button:${String(options?.name)}`); } };
        if (role === "status") return { allTextContents: async () => [] };
        return passive;
      },
      getByLabel: (label) => ({
        fill: async () => {
          calls.push(`label:${label}`);
          if (label === failLabel) throw Object.assign(new Error(`Timeout 30000ms exceeded at ${origin}/x?secret=${BINDING.JOB_SECRET}`), { name: "TimeoutError" });
        },
      }),
      waitForURL: async () => { throw Object.assign(new Error("no navigation"), { name: "TimeoutError" }); },
    };
  };
  const context = {
    route: async () => {},
    routeWebSocket: async () => {},
    request: {
      post: async () => ({ status: () => 204, dispose: async () => {} }),
      delete: async () => ({ status: () => 204, dispose: async () => {} }),
    },
    newPage: async () => page(),
    close: async () => {},
  };
  return { calls, chromium: { launch: async () => ({ newContext: async () => context, close: async () => {} }) } };
}

test("create uses the goal picker labels and reports only the fixed failing step", async () => {
  const passing = fakeFunnelBrowser({ failLabel: null });
  const reached = await runStagingFunnelSmoke(BINDING, {
    verifyLineage: async () => true, verifyAlias: async () => true, playwright: { chromium: passing.chromium },
  });
  assert.deepEqual(passing.calls, ["label:名稱 *", "label:一頁式網站網址 *", "button:/建立名單/u", "button:建立"]);
  assert.equal(reached.reason, "CREATE_FAILED");
  assert.equal(reached.failureStep, "NONE");

  const failing = fakeFunnelBrowser({ failLabel: "一頁式網站網址 *" });
  const report = await runStagingFunnelSmoke(BINDING, {
    verifyLineage: async () => true, verifyAlias: async () => true, playwright: { chromium: failing.chromium },
  });
  assert.equal(report.reason, "BROWSER_EXECUTION_FAILED");
  assert.equal(report.failureStep, "CREATE_SLUG_FILL");
  assert.equal(report.failureCategory, "TIMEOUT");
  assert.equal(report.failurePage, "FUNNEL_NEW");
  assert.equal(report.sideEffects.syntheticSessionRevoked, 1);
  const serialized = JSON.stringify(report);
  for (const [key, value] of Object.entries(BINDING)) assert.equal(serialized.includes(value), key === "CELEBRATEDEAL_SOURCE_SHA");
  assert.doesNotMatch(serialized, /https?:\/\//u);
});

// Publish stage (2026-11-05 run 42064920668 stopped at PUBLISH without a failure step).
const OPERATIONS = "https://celebrate-deal-staging.carry-digital-nomad.in.net/landing-pages/abc123/operations?step=s1";
const EMAIL_UNVERIFIED_TEXT = "目前是草稿 一頁式網站尚未發布。這個商家的註冊 Email 還沒有完成驗證，所以目前無法發布 owner@example.com";
const LIMIT_TEXT = "免費帳號最多可同時有 3 個不需發布專案就公開的名單型網站，目前已達上限";
const READY_TEXT = "一頁式網站尚未發布，公開網址目前無法開啟。名單型網站發布後即可開啟，不需要先發布專案。";

function fakePublishPage({ reachOperations = true, chipText = READY_TEXT, enabled = true, publishes = false, feedback = [] } = {}) {
  const calls = [];
  const hidden = { waitFor: async () => { throw Object.assign(new Error("hidden"), { name: "TimeoutError" }); }, count: async () => 0 };
  const shown = { waitFor: async () => {} };
  const page = {
    calls,
    url: () => OPERATIONS,
    waitForURL: async () => { if (!reachOperations) throw Object.assign(new Error(`Timeout at ${OPERATIONS}`), { name: "TimeoutError" }); },
    getByRole: (role, options) => {
      if (role === "button" && options?.name === "發布狀態：草稿") {
        return chipText === null ? hidden : { ...shown, click: async () => { calls.push("chip"); } };
      }
      if (role === "region" && options?.name === "公開網址狀態") return { ...shown, innerText: async () => chipText };
      if (role === "button" && options?.name === "發布") {
        return { isEnabled: async () => enabled, click: async () => { calls.push("publish"); } };
      }
      if (role === "button" && options?.name instanceof RegExp) return publishes ? shown : hidden;
      if (role === "status") return { allTextContents: async () => feedback };
      return hidden;
    },
  };
  return page;
}

test("publish diagnosis keeps only fixed categories and never the page text", () => {
  assert.equal(classifyPublishDiagnosis(EMAIL_UNVERIFIED_TEXT), "EMAIL_UNVERIFIED");
  assert.equal(classifyPublishDiagnosis([LIMIT_TEXT]), "LIMIT_REACHED");
  assert.equal(classifyPublishDiagnosis(READY_TEXT), "READY");
  assert.equal(classifyPublishDiagnosis(["", "  "]), "NONE");
  assert.equal(classifyPublishDiagnosis(["owner@example.com 其他訊息"]), "OTHER");
  assert.equal(classifyPublishDiagnosis([null, 42]), "NONE");
  assert.equal(publishBlockedReason("EMAIL_UNVERIFIED"), "PUBLISH_BLOCKED_EMAIL_UNVERIFIED");
  assert.equal(publishBlockedReason("LIMIT_REACHED"), "PUBLISH_LIMIT_REACHED");
  assert.equal(publishBlockedReason("PLATFORM_DISABLED"), "PUBLISH_DISABLED_BY_PLATFORM");
  assert.equal(publishBlockedReason("READY"), null);
  assert.equal(publishBlockedReason("toString"), null);
});

test("an unverified owner e-mail stops before the publish click with its own reason", async () => {
  const page = fakePublishPage({ chipText: EMAIL_UNVERIFIED_TEXT });
  const result = { reason: "INVALID_BINDING", failureStep: "NONE", failureCategory: "NONE", failurePage: "NOT_OBSERVED" };
  assert.equal(await runPublishStage(page, result, { funnelPath: "/landing-pages/abc123" }), false);
  assert.deepEqual(page.calls, ["chip", "chip"]);
  assert.equal(result.reason, "PUBLISH_BLOCKED_EMAIL_UNVERIFIED");
  assert.equal(result.publishPreflight, "EMAIL_UNVERIFIED");
  assert.equal(result.publishOutcome, "NOT_CLICKED");
  assert.equal(result.failureStep, "PUBLISH_PREFLIGHT");
  assert.equal(result.failureCategory, "DATA_PRECONDITION");
  assert.equal(result.failurePage, "FUNNEL_OPERATIONS");
  assert.doesNotMatch(JSON.stringify(result), /@|https?:|驗證/u);
});

test("publish stage reports which step stopped it", async () => {
  const leave = { reason: "x" };
  assert.equal(await runPublishStage(fakePublishPage({ reachOperations: false }), leave, { funnelPath: "/landing-pages/abc123" }), false);
  assert.deepEqual([leave.reason, leave.failureStep, leave.failureCategory, leave.publishOutcome], ["PUBLISH_FAILED", "EDITOR_LEAVE", "CONDITION_NOT_MET", "LEAVE_ROUTE_NOT_REACHED"]);

  const disabled = { reason: "x" };
  const disabledPage = fakePublishPage({ enabled: false });
  assert.equal(await runPublishStage(disabledPage, disabled, { funnelPath: "/landing-pages/abc123", enabledTimeout: 50 }), false);
  assert.equal(disabled.failureStep, "PUBLISH_BUTTON_ENABLED");
  assert.equal(disabled.publishPreflight, "READY");
  assert.ok(!disabledPage.calls.includes("publish"));

  const refused = { reason: "x" };
  let clicked = 0;
  const refusedPage = fakePublishPage({ feedback: [LIMIT_TEXT] });
  assert.equal(await runPublishStage(refusedPage, refused, { funnelPath: "/landing-pages/abc123", onPublishClick: () => { clicked += 1; } }), false);
  assert.equal(clicked, 1);
  assert.deepEqual([refused.reason, refused.failureStep, refused.failureCategory, refused.publishOutcome], ["PUBLISH_LIMIT_REACHED", "PUBLISH_RESULT", "DATA_PRECONDITION", "REFUSED_LIMIT_REACHED"]);

  const silent = { reason: "x" };
  assert.equal(await runPublishStage(fakePublishPage(), silent, { funnelPath: "/landing-pages/abc123" }), false);
  assert.deepEqual([silent.reason, silent.failureStep, silent.publishOutcome], ["PUBLISH_FAILED", "PUBLISH_RESULT", "NO_FEEDBACK"]);

  const missingChip = { reason: "x" };
  assert.equal(await runPublishStage(fakePublishPage({ chipText: null, publishes: true }), missingChip, { funnelPath: "/landing-pages/abc123" }), true);
  assert.equal(missingChip.publishPreflight, "NOT_OBSERVED");
  assert.equal(missingChip.publishOutcome, "PUBLISHED");
});

test("route GET evidence keeps only the request class and abort kind", () => {
  const request = (type, headers = {}, errorText = "") => ({ resourceType: () => type, headers: () => headers, failure: () => ({ errorText }) });
  assert.equal(classifyRouteGetKind(request("document")), "document");
  assert.equal(classifyRouteGetKind(request("fetch", { rsc: "1", "next-router-prefetch": "1" })), "prefetch");
  assert.equal(classifyRouteGetKind(request("fetch", { rsc: "1" })), "rsc");
  assert.equal(classifyRouteGetKind(request("fetch")), "other");
  assert.equal(classifyRouteGetKind({ resourceType: () => { throw new Error("closed"); } }), "other");
  assert.equal(classifyRequestFailureKind(request("fetch", {}, "net::ERR_ABORTED")), "aborted");
  assert.equal(classifyRequestFailureKind(request("fetch", {}, "net::ERR_CONNECTION_RESET")), "other");
  assert.equal(classifyRequestFailureKind({ failure: () => null }), "other");
});

test("publish summary line prints fixed enums only", () => {
  assert.equal(formatPublishSummary({ publishPreflight: "EMAIL_UNVERIFIED", publishOutcome: "NOT_CLICKED", reason: "PUBLISH_BLOCKED_EMAIL_UNVERIFIED", failureStep: "PUBLISH_PREFLIGHT" }),
    "staging_funnel_publish=preflight=EMAIL_UNVERIFIED; outcome=NOT_CLICKED; reason=PUBLISH_BLOCKED_EMAIL_UNVERIFIED; failureStep=PUBLISH_PREFLIGHT");
  assert.match(formatPublishSummary({ publishPreflight: "https://x/?a=b", publishOutcome: "owner@example.com" }), /preflight=UNKNOWN; outcome=UNKNOWN/u);
});
