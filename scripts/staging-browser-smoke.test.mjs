import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyBrowserRequest, classifyFinalPath, classifySessionStatus, classifyUnsafeRequestPath, runBrowserSmoke, validateBrowserSmokeBinding } from "./staging-browser-smoke.mjs";

const INPUT = {
  CELEBRATEDEAL_SOURCE_SHA: "9193326824b8b6bf774bdfa28e4783a1a1b8f304",
  CELEBRATEDEAL_DEPLOYMENT_HOST: "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app",
  JOB_SECRET: "synthetic-owner-session-secret",
  GITHUB_TOKEN: "synthetic-github-token",
  PATH: "synthetic-path",
};

test("protected dispatch takes a deployment binding and verifies it before owner secret injection", () => {
  const workflow = readFileSync(new URL("../.github/workflows/staging-browser-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /source_sha:\s*\n\s*description:[^\n]*\n\s*required: true/u);
  assert.match(workflow, /deployment_host:\s*\n\s*description:[^\n]*\n\s*required: true/u);
  assert.match(workflow, /CELEBRATEDEAL_SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/u);
  assert.match(workflow, /CELEBRATEDEAL_DEPLOYMENT_HOST: \$\{\{ inputs\.deployment_host \}\}/u);
  assert.ok(workflow.indexOf("Verify exact Preview lineage before secret injection") < workflow.indexOf("Check authenticated staging pages with synthetic owner"));
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

test("only the exact empty-body attribution reset is allowed among browser POSTs", () => {
  const request = (path, method = "POST", headers = {}, body = null) => ({
    url: () => `https://celebrate-deal-staging.carry-digital-nomad.in.net${path}`,
    method: () => method,
    headers: () => headers,
    postData: () => body,
  });
  const safeHeaders = { "x-celebratedeal-client": "web", "content-type": "application/json" };
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
  const browser = {
    newContext: async () => {
      let handler;
      let currentUrl = origin;
      const locator = { first: () => locator, waitFor: async () => {}, count: async () => 0 };
      return {
        route: async (_pattern, callback) => { handler = callback; },
        routeWebSocket: async () => {},
        request: {
          post: async () => ({ status: () => 204, dispose: async () => {} }),
          delete: async () => ({ status: () => cleanupStatus, dispose: async () => {} }),
        },
        newPage: async () => ({
          on: () => {},
          goto: async (url) => {
            currentUrl = url;
            if (url.endsWith("/billing/plans")) {
              await handler({
                request: () => ({ url: () => `${origin}/api/affiliate-attribution/direct-entry`, method: () => "POST", headers: () => ({ "x-celebratedeal-client": "web", "content-type": "application/json" }), postData: () => null }),
                fulfill: async () => { localNoOps += 1; },
              });
            }
            if (url.endsWith("/dashboard")) {
              await handler({
                request: () => ({ url: () => `${origin}/api/payments/checkout`, method: () => "POST", headers: () => ({}), postData: () => "{}" }),
                abort: async () => { unsafeAborts += 1; },
              });
            }
            return { status: () => 200 };
          },
          getByRole: () => locator,
          getByText: () => locator,
          locator: () => locator,
          url: () => currentUrl,
        }),
        close: async () => {},
      };
    },
    close: async () => {},
  };
  const report = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    playwright: { chromium: { launch: async () => browser } },
  });
  assert.equal(report.journeys.length, 8);
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.browser.unsafeRequestsBlocked, 2);
  assert.equal(report.browser.safeAttributionResets, 2);
  assert.equal(report.sideEffects.syntheticSessionCreated, 2);
  assert.equal(report.sideEffects.syntheticSessionRevoked, 2);
  assert.equal(unsafeAborts, 2);
  assert.equal(localNoOps, 2);
  cleanupStatus = 404;
  const cleanupFailure = await runBrowserSmoke(INPUT, {
    verifyLineage: async () => true,
    playwright: { chromium: { launch: async () => browser } },
  });
  assert.equal(cleanupFailure.result, "BLOCKED");
  assert.equal(cleanupFailure.reason, "SESSION_CLEANUP_FAILED");
  assert.equal(cleanupFailure.sideEffects.syntheticSessionRevoked, 0);
});

test("session status categories remain bounded", () => {
  assert.equal(classifySessionStatus(204), "ISSUED");
  assert.equal(classifySessionStatus(401), "UNAUTHORIZED");
  assert.equal(classifySessionStatus(503), "SERVICE_UNAVAILABLE");
  assert.equal(classifySessionStatus(302), "HTTP_REJECTED");
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
});
