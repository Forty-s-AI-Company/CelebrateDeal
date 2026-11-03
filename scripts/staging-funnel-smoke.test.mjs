import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyFunnelRequest, createPageBlocked, funnelCreateFeedbackKind, funnelEditorNavigationKind, funnelRouteCategory, inspectSyntheticProjectStatus, inspectPublicSurface, syntheticFunnelSlug, runStagingFunnelSmoke } from "./staging-funnel-smoke.mjs";

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
