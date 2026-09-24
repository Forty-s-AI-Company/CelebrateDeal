import assert from "node:assert/strict";
import test from "node:test";

import { classifySessionStatus, runBrowserSmoke, validateBrowserSmokeBinding } from "./staging-browser-smoke.mjs";

const INPUT = {
  CELEBRATEDEAL_SOURCE_SHA: "9193326824b8b6bf774bdfa28e4783a1a1b8f304",
  CELEBRATEDEAL_DEPLOYMENT_HOST: "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app",
  JOB_SECRET: "synthetic-owner-session-secret",
  PATH: "synthetic-path",
};

test("fixed source and host are required before launching a browser", async () => {
  assert.equal(validateBrowserSmokeBinding(INPUT), true);
  assert.equal(validateBrowserSmokeBinding({ ...INPUT, CELEBRATEDEAL_DEPLOYMENT_HOST: "other.example.test" }), false);
  assert.equal(validateBrowserSmokeBinding({ ...INPUT, JOB_SECRET: "" }), false);
  const report = await runBrowserSmoke({ ...INPUT, CELEBRATEDEAL_SOURCE_SHA: "different" }, {
    playwright: { chromium: { launch: () => { throw new Error("browser must not launch"); } } },
  });
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.reason, "INVALID_BINDING");
  assert.equal(report.sideEffects.syntheticSessionCreated, 0);
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
    playwright: { chromium: { launch: async (options) => {
      launchOptions = options;
      return { newContext: async () => context, close: async () => {} };
    } } },
  });
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.session, "FIXTURE_UNAVAILABLE");
  assert.equal(report.sideEffects.syntheticSessionCreated, 0);
  assert.equal(report.browser.unsafeRequestsBlocked, 1);
  assert.equal(unsafeRequestAborted, true);
  assert.equal(report.browser.webSocketsBlocked, 1);
  assert.equal(webSocketClosed, true);
  assert.equal(pageCreated, false);
  assert.equal(launchOptions.env.JOB_SECRET, undefined);
  assert.equal(JSON.stringify(report).includes(INPUT.JOB_SECRET), false);
  assert.equal(sessionRequest.url, "https://celebrate-deal-staging.carry-digital-nomad.in.net/api/admin/ops/payuni/wp4-session");
  assert.equal(sessionRequest.options.maxRedirects, 0);
});

test("session status categories remain bounded", () => {
  assert.equal(classifySessionStatus(204), "ISSUED");
  assert.equal(classifySessionStatus(401), "UNAUTHORIZED");
  assert.equal(classifySessionStatus(503), "SERVICE_UNAVAILABLE");
  assert.equal(classifySessionStatus(302), "HTTP_REJECTED");
});
