import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { appNavigationSelectorForViewport, classifyBrowserExecutionFailure, classifyBrowserRequest, classifyFinalPath, classifySessionStatus, classifyUnsafeRequestDetail, classifyUnsafeRequestPath, diagnoseStagingAliasBinding, isCriticalResourceFailure, isFailedCriticalResourceRequest, runBrowserSmoke, validateBrowserSmokeBinding, verifyStagingAliasBinding } from "./staging-browser-smoke.mjs";

const INPUT = {
  CELEBRATEDEAL_SOURCE_SHA: "9193326824b8b6bf774bdfa28e4783a1a1b8f304",
  CELEBRATEDEAL_DEPLOYMENT_HOST: "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app",
  JOB_SECRET: "synthetic-owner-session-secret",
  GITHUB_TOKEN: "synthetic-github-token",
  VERCEL_TOKEN: "synthetic-vercel-token",
  PATH: "synthetic-path",
};

test("protected dispatch takes a deployment binding and verifies it before owner secret injection", () => {
  const workflow = readFileSync(new URL("../.github/workflows/staging-browser-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /source_sha:\s*\n\s*description:[^\n]*\n\s*required: true/u);
  assert.match(workflow, /deployment_host:\s*\n\s*description:[^\n]*\n\s*required: true/u);
  assert.match(workflow, /CELEBRATEDEAL_SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/u);
  assert.match(workflow, /CELEBRATEDEAL_DEPLOYMENT_HOST: \$\{\{ inputs\.deployment_host \}\}/u);
  assert.ok(workflow.indexOf("Verify exact Preview lineage before secret injection") < workflow.indexOf("Check authenticated staging pages with synthetic owner"));
  assert.ok(workflow.indexOf("Verify fixed staging alias before owner secret injection") < workflow.indexOf("Check authenticated staging pages with synthetic owner"));
  assert.match(workflow, /github\.ref_protected/u);
});

test("validated source and immutable Preview host are required before launching a browser", async () => {
  assert.equal(validateBrowserSmokeBinding(INPUT), true);
  assert.equal(validateBrowserSmokeBinding({ ...INPUT, CELEBRATEDEAL_DEPLOYMENT_HOST: "other.example.test" }), false);
  assert.equal(validateBrowserSmokeBinding({ ...INPUT, JOB_SECRET: "" }), false);
  assert.equal(validateBrowserSmokeBinding({ ...INPUT, CELEBRATEDEAL_SOURCE_SHA: "bad" }), false);
  const report = await runBrowserSmoke({ ...INPUT, CELEBRATEDEAL_SOURCE_SHA: "different" }, {
    playwright: { chromium: { launch: () => { throw new Error("browser must not launch"); } } },
  });
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.reason, "INVALID_BINDING");
  assert.equal(report.sideEffects.syntheticSessionCreated, 0);
});

test("failed lineage blocks before browser launch or owner session", async () => {
  const report = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => false,
    playwright: { chromium: { launch: () => { throw new Error("browser must not launch"); } } },
  });
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.reason, "LINEAGE_NOT_VERIFIED");
  assert.equal(report.lineage, "NOT_VERIFIED");
});

test("fixed alias must resolve to the exact immutable Preview before a session is sent", async () => {
  const deployment = { id: "dpl_fixture", projectId: "prj_fixture", url: INPUT.CELEBRATEDEAL_DEPLOYMENT_HOST,
    name: "celebrate-deal-staging", target: null, readyState: "READY" };
  const response = (body) => ({ status: 200, json: async () => body });
  const probe = (aliasDeploymentId) => (_url) => Promise.resolve(
    _url.includes("/v4/aliases/")
      ? response({ alias: "celebrate-deal-staging.carry-digital-nomad.in.net", deploymentId: aliasDeploymentId, projectId: "prj_fixture" })
      : response(deployment),
  );
  assert.equal(await verifyStagingAliasBinding(INPUT, probe("dpl_fixture")), true);
  assert.equal(await verifyStagingAliasBinding(INPUT, probe("dpl_old")), false);
  assert.equal(await diagnoseStagingAliasBinding(INPUT, probe("dpl_old")), "ALIAS_DEPLOYMENT_MISMATCH");
  assert.equal(await diagnoseStagingAliasBinding({ ...INPUT, VERCEL_TOKEN: "" }), "VERCEL_TOKEN_MISSING");
  assert.equal(await diagnoseStagingAliasBinding(INPUT, async () => ({ status: 403 })), "ALIAS_PERMISSION_DENIED");
  assert.equal(await diagnoseStagingAliasBinding(INPUT, async () => ({ status: 401 })), "ALIAS_AUTH_REJECTED");
  let sessionRequested = false;
  const report = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    verifyAlias: async () => false,
    playwright: { chromium: { launch: () => { sessionRequested = true; throw new Error("browser must not launch"); } } },
  });
  assert.equal(report.reason, "ALIAS_NOT_VERIFIED");
  assert.equal(sessionRequested, false);
});

test("synthetic session failure does not visit pages or expose the secret to Chromium", async () => {
  let launchOptions;
  let sessionRequest;
  let pageCreated = false;
  let unsafeRequestAborted = false;
  let webSocketClosed = false;
  let routeHandler;
  const context = {
    route: async (_pattern, handler) => { routeHandler = handler; },
    routeWebSocket: async (_pattern, handler) => {
      await handler({ close: () => { webSocketClosed = true; } });
    },
    request: {
      post: async (url, options) => {
        sessionRequest = { url, options };
        await routeHandler({
          request: () => ({ url: () => `https://celebrate-deal-staging.carry-digital-nomad.in.net/api/products`, method: () => "POST" }),
          abort: () => { unsafeRequestAborted = true; },
          continue: () => { throw new Error("unsafe browser request must not continue"); },
        });
        return { status: () => 404, dispose: async () => {} };
      },
    },
    newPage: () => { pageCreated = true; throw new Error("page must not open"); },
    close: async () => {},
  };
  const report = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    verifyAlias: async () => true,
    playwright: { chromium: { launch: async (options) => {
      launchOptions = options;
      return { newContext: async () => context, close: async () => {} };
    } } },
  });
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.session, "FIXTURE_UNAVAILABLE");
  assert.equal(report.sideEffects.syntheticSessionCreated, 0);
  assert.equal(report.browser.unsafeRequestsBlocked, 1);
  assert.equal(report.browser.unsafeRequestCategories.api, 1);
  assert.equal(unsafeRequestAborted, true);
  assert.equal(report.browser.webSocketsBlocked, 1);
  assert.equal(webSocketClosed, true);
  assert.equal(pageCreated, false);
  assert.equal(launchOptions.env.JOB_SECRET, undefined);
  assert.equal(JSON.stringify(report).includes(INPUT.JOB_SECRET), false);
  assert.equal(JSON.stringify(report).includes(INPUT.GITHUB_TOKEN), false);
  assert.equal(sessionRequest.url, "https://celebrate-deal-staging.carry-digital-nomad.in.net/api/admin/ops/payuni/wp4-session");
  assert.equal(sessionRequest.options.maxRedirects, 0);
});

test("only fixed same-host telemetry and the exact attribution reset receive local no-op responses", () => {
  const request = (path, method = "POST", headers = {}, body = null) => ({
    url: () => `https://celebrate-deal-staging.carry-digital-nomad.in.net${path}`,
    method: () => method,
    headers: () => headers,
    postData: () => body,
  });
  const safeHeaders = { "x-celebratedeal-client": "web", "content-type": "application/json" };
  assert.equal(classifyBrowserRequest(request("/monitoring", "POST", {}, "synthetic telemetry")), "SENTRY_TUNNEL");
  assert.equal(classifyBrowserRequest(request("/api/security/csp-report", "POST", {}, "{}")), "CSP_REPORT");
  assert.equal(classifyBrowserRequest(request("/monitoring?other=1")), "UNSAFE");
  assert.equal(classifyBrowserRequest(request("/api/security/csp-report/extra")), "UNSAFE");
  assert.equal(classifyBrowserRequest(request("/monitoring", "PUT")), "UNSAFE");
  assert.equal(classifyBrowserRequest({ ...request("/monitoring"), url: () => "https://other.example.test/monitoring" }), "EXTERNAL");
  assert.equal(classifyBrowserRequest(request("/api/affiliate-attribution/direct-entry", "POST", safeHeaders)), "ATTRIBUTION_RESET");
  assert.equal(classifyBrowserRequest(request("/api/affiliate-attribution/direct-entry?x=1", "POST", safeHeaders)), "UNSAFE");
  assert.equal(classifyBrowserRequest(request("/api/affiliate-attribution/direct-entry", "POST", safeHeaders, "{}")), "UNSAFE");
  assert.equal(classifyBrowserRequest(request("/api/payments/checkout", "POST", safeHeaders)), "UNSAFE");
  assert.equal(classifyBrowserRequest(request("/dashboard", "POST", { "next-action": "some-action" })), "UNSAFE");
  assert.equal(classifyBrowserRequest(request("/dashboard", "GET")), "READ");
  assert.equal(classifyBrowserRequest({ ...request("/dashboard"), url: () => "https://evil.example.test/dashboard" }), "EXTERNAL");
});

test("a rendered journey remains blocked when an unexpected browser POST occurs", async () => {
  const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
  let unsafeAborts = 0;
  let localNoOps = 0;
  let cleanupStatus = 204;
  let triggerUnsafePost = true;
  let triggerChunk404 = false;
  let triggerChunkNetworkFailure = false;
  let triggerNavigationAbort = false;
  const browser = {
    newContext: async () => {
      let handler;
      let currentUrl = origin;
      const locator = { first: () => locator, waitFor: async () => {}, count: async () => 0, getAttribute: async () => "6",
        click: async () => { currentUrl = `${origin}/products`; } };
      return {
        route: async (_pattern, callback) => { handler = callback; },
        routeWebSocket: async () => {},
        request: {
          post: async () => ({ status: () => 204, dispose: async () => {} }),
          delete: async () => ({ status: () => cleanupStatus, dispose: async () => {} }),
        },
        newPage: async () => {
          let onResponse = () => {};
          let onRequestFailed = () => {};
          return {
          on: (event, callback) => {
            if (event === "response") onResponse = callback;
            if (event === "requestfailed") onRequestFailed = callback;
          },
          goto: async (url) => {
            currentUrl = url;
            if (triggerNavigationAbort) throw new Error(`page.goto: net::ERR_ABORTED at ${origin}/dashboard?private=${INPUT.JOB_SECRET}`);
            if (url.endsWith("/dashboard") && triggerChunk404) onResponse({
              url: () => `${origin}/_next/static/chunks/app.js`, status: () => 404,
              request: () => ({ resourceType: () => "script" }),
            });
            if (url.endsWith("/dashboard") && triggerChunkNetworkFailure) onRequestFailed({
              url: () => `${origin}/_next/static/chunks/app.js`, resourceType: () => "script",
            });
            if (url.endsWith("/billing/plans")) {
              await handler({
                request: () => ({ url: () => `${origin}/api/affiliate-attribution/direct-entry`, method: () => "POST", headers: () => ({ "x-celebratedeal-client": "web", "content-type": "application/json" }), postData: () => null }),
                fulfill: async () => { localNoOps += 1; },
              });
            }
            if (url.endsWith("/dashboard") && triggerUnsafePost) {
              await handler({
                request: () => ({ url: () => `${origin}/api/payments/checkout`, method: () => "POST", headers: () => ({}), postData: () => "{}" }),
                abort: async () => { unsafeAborts += 1; },
              });
            }
            if (url.endsWith("/dashboard")) {
              for (const path of ["/monitoring", "/api/security/csp-report"]) {
                await handler({
                  request: () => ({ url: () => `${origin}${path}`, method: () => "POST" }),
                  fulfill: async ({ status }) => { assert.equal(status, 204); localNoOps += 1; },
                });
              }
            }
            return { status: () => 200 };
          },
          getByRole: () => locator,
          getByLabel: () => ({ selectOption: async () => {} }),
          getByText: () => locator,
          locator: () => locator,
          waitForURL: async () => {},
          url: () => currentUrl,
        }; },
        close: async () => {},
      };
    },
    close: async () => {},
  };
  const report = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    verifyAlias: async () => true,
    playwright: { chromium: { launch: async () => browser } },
  });
  assert.equal(report.journeys.length, 10);
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.browser.unsafeRequestsBlocked, 2);
  assert.equal(report.browser.unsafeRequestDetails.otherApi, 2);
  assert.deepEqual(report.browser.observabilitySuppressed, { sentryTunnel: 2, cspReportApi: 2 });
  assert.equal(report.journeys[0].dashboardReadOperationCount, 6);
  assert.equal(report.journeys[0].dashboardDetailsReadOperationCount, 6);
  assert.equal(report.journeys[0].dashboardKpiAlertVisible, false);
  assert.equal(report.journeys[0].dashboardDetailsAlertVisible, false);
  assert.equal(report.browser.safeAttributionResets, 2);
  assert.equal(report.sideEffects.syntheticSessionCreated, 2);
  assert.equal(report.sideEffects.syntheticSessionRevoked, 2);
  assert.equal(unsafeAborts, 2);
  assert.equal(localNoOps, 6);
  cleanupStatus = 404;
  const cleanupFailure = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    verifyAlias: async () => true,
    playwright: { chromium: { launch: async () => browser } },
  });
  assert.equal(cleanupFailure.result, "BLOCKED");
  assert.equal(cleanupFailure.reason, "SESSION_CLEANUP_FAILED");
  assert.equal(cleanupFailure.sideEffects.syntheticSessionRevoked, 0);
  cleanupStatus = 204;
  triggerUnsafePost = false;
  triggerChunk404 = true;
  const missingChunk = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    verifyAlias: async () => true,
    playwright: { chromium: { launch: async () => browser } },
  });
  assert.equal(missingChunk.browser.unsafeRequestsBlocked, 0);
  assert.equal(missingChunk.browser.criticalResourceFailures, 2);
  assert.equal(missingChunk.browser.navigationInteractionsPassed, 2);
  assert.equal(missingChunk.browser.hydrationInteractionsPassed, 2);
  assert.equal(missingChunk.result, "BLOCKED");
  triggerChunk404 = false;
  triggerChunkNetworkFailure = true;
  const networkFailure = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    verifyAlias: async () => true,
    playwright: { chromium: { launch: async () => browser } },
  });
  assert.equal(networkFailure.browser.criticalResourceFailures, 2);
  assert.equal(networkFailure.result, "BLOCKED");
  triggerChunkNetworkFailure = false;
  let aliasChecks = 0;
  const aliasDriftAfterSession = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    verifyAlias: async () => ++aliasChecks < 3,
    playwright: { chromium: { launch: async () => browser } },
  });
  assert.equal(aliasDriftAfterSession.result, "BLOCKED");
  assert.equal(aliasDriftAfterSession.reason, "SESSION_CLEANUP_FAILED");
  assert.equal(aliasDriftAfterSession.sideEffects.syntheticSessionCreated, 1);
  assert.equal(aliasDriftAfterSession.sideEffects.syntheticSessionRevoked, 0);
  triggerNavigationAbort = true;
  const abortedNavigation = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    verifyAlias: async () => true,
    playwright: { chromium: { launch: async () => browser } },
  });
  assert.equal(abortedNavigation.reason, "BROWSER_EXECUTION_FAILED");
  assert.equal(abortedNavigation.browser.executionPhase, "PAGE_NAVIGATION");
  assert.equal(abortedNavigation.browser.failureCategory, "NAVIGATION_ABORTED");
  assert.equal(abortedNavigation.browser.activeViewport, "desktop");
  assert.equal(abortedNavigation.browser.activeRoute, "dashboard");
  assert.equal(abortedNavigation.sideEffects.syntheticSessionRevoked, 1);
  assert.equal(JSON.stringify(abortedNavigation).includes(INPUT.JOB_SECRET), false);
});

test("browser failures expose only fixed categories", () => {
  assert.equal(classifyBrowserExecutionFailure(Object.assign(new Error("private URL"), { name: "TimeoutError" })), "TIMEOUT");
  assert.equal(classifyBrowserExecutionFailure(new Error("page.goto: net::ERR_FAILED at private URL")), "NETWORK_FAILED");
  assert.equal(classifyBrowserExecutionFailure(new Error("private URL")), "OTHER");
});

test("a failed JavaScript chunk invalidates an otherwise rendered journey", () => {
  const response = (status, resourceType) => ({
    url: () => "https://celebrate-deal-staging.carry-digital-nomad.in.net/_next/static/chunks/app.js",
    status: () => status, request: () => ({ resourceType: () => resourceType }),
  });
  assert.equal(isCriticalResourceFailure(response(404, "script")), true);
  assert.equal(isCriticalResourceFailure(response(200, "script")), false);
  assert.equal(isCriticalResourceFailure(response(404, "image")), false);
  assert.equal(isFailedCriticalResourceRequest({ url: () => "https://celebrate-deal-staging.carry-digital-nomad.in.net/app.js", resourceType: () => "script" }), true);
});

test("session status categories remain bounded", () => {
  assert.equal(classifySessionStatus(204), "ISSUED");
  assert.equal(classifySessionStatus(401), "UNAUTHORIZED");
  assert.equal(classifySessionStatus(503), "SERVICE_UNAVAILABLE");
  assert.equal(classifySessionStatus(302), "HTTP_REJECTED");
});

test("desktop and mobile journeys target the visible app shell navigation", () => {
  const shell = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
  assert.equal(appNavigationSelectorForViewport("desktop"), 'nav[aria-label="主要導覽"]:visible');
  assert.equal(appNavigationSelectorForViewport("mobile"), 'nav[aria-label="行動版主要導覽"]:visible');
  assert.match(shell, /aria-label="主要導覽"/u);
  assert.match(shell, /aria-label="行動版主要導覽"/u);
});

test("final URLs and blocked requests are reduced to fixed, non-sensitive categories", () => {
  const alias = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
  assert.equal(classifyFinalPath(`${alias}/dashboard?private=synthetic`, "/dashboard"), "EXPECTED");
  assert.equal(classifyFinalPath(`${alias}/login?next=/dashboard`, "/dashboard"), "AUTH_REDIRECT");
  assert.equal(classifyFinalPath(`${alias}/products`, "/dashboard"), "OTHER_SAME_HOST");
  assert.equal(classifyFinalPath("https://other.example.test/login?secret=synthetic", "/dashboard"), "OFF_HOST");
  assert.equal(classifyFinalPath("bad-url", "/dashboard"), "INVALID_URL");
  assert.equal(classifyUnsafeRequestPath("/_next/server-action"), "next");
  assert.equal(classifyUnsafeRequestPath("/api/auth/session"), "api");
  assert.equal(classifyUnsafeRequestPath("/dashboard"), "page");
  assert.equal(classifyUnsafeRequestPath("/unlisted/sensitive-id"), "other");
  assert.equal(classifyUnsafeRequestDetail("/_vercel/insights/event"), "vercelTelemetry");
  assert.equal(classifyUnsafeRequestDetail("/__vercel/speed-insights/vitals"), "vercelTelemetry");
  assert.equal(classifyUnsafeRequestDetail("/monitoring"), "sentryTunnel");
  assert.equal(classifyUnsafeRequestDetail("/api/security/csp-report"), "cspReportApi");
  assert.equal(classifyUnsafeRequestDetail("/api/analytics"), "analyticsApi");
  assert.equal(classifyUnsafeRequestDetail("/api/auth/session"), "authApi");
  assert.equal(classifyUnsafeRequestDetail("/private/sensitive-id"), "other");
});
