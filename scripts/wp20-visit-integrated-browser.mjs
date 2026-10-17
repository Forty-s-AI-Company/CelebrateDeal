import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";

const require = createRequire(import.meta.url);

/** Called only by the owned disposable PostgreSQL runner after identity check.
 * Actual route, proof/collection services, browser cookies/locks and DB execute.
 * Dependency adapters replace DB/key injection and the deployment rate limiter.
 */
export async function verifyIntegratedVisitBrowser(db, scope, versionId, proofs) {
  const receipt = { status: "FAIL", checks: [], cleanup: "NOT_RUN", excluded: ["deployment_rate_limiter", "Next_server_routing", "remote_TLS"] };
  let browser, server;
  receipt.httpStatuses = [];
  const injection = "__wp20OwnedVisitIntegration";
  assert.equal(globalThis[injection], undefined);
  globalThis[injection] = { db, proofs };
  try {
    const routeBundle = await build({ entryPoints: ["src/app/api/live-metrics/[vendorId]/[liveId]/visits/route.ts"], bundle: true,
      platform: "node", format: "cjs", packages: "external", write: false, logLevel: "silent",
      define: { "process.env.LIVE_METRIC_VISITOR_KEYRING": '"synthetic-injected"', "process.env.NEXT_PUBLIC_APP_URL": '"http://127.0.0.1"' },
      plugins: [{ name: "owned-dependencies", setup(build) {
        build.onResolve({ filter: /^@\/lib\/(db|trusted-entry-rate-limit|live-metric-visitor-config)$/ }, args => ({ path: args.path, namespace: "owned" }));
        build.onLoad({ filter: /.*/, namespace: "owned" }, args => ({ contents:
          args.path.endsWith("/db") ? `export function getDb(){return globalThis.${injection}.db}`
            : args.path.endsWith("/trusted-entry-rate-limit") ? "export async function checkRateLimit(){return null}"
              : `export function metricVisitorProofsFromConfig(){return globalThis.${injection}.proofs}`, loader: "js" }));
      } }],
    });
    const compiled = { exports: {} };
    new Function("require", "module", "exports", routeBundle.outputFiles[0].text)(require, compiled, compiled.exports);
    const { NextRequest } = require("next/server");
    const clientBundle = await build({ entryPoints: ["src/lib/live-metric-visit-client.ts"], bundle: true,
      platform: "browser", format: "iife", globalName: "VisitDriver", write: false, logLevel: "silent" });
    const endpoint = `/api/live-metrics/${scope.vendorId}/${scope.liveId}/visits`;
    server = http.createServer(async (incoming, outgoing) => {
      try {
        if (incoming.url === "/") { outgoing.setHeader("Content-Type", "text/html"); outgoing.end('<p>Synthetic integration</p><script src="/client.js"></script>'); return; }
        if (incoming.url === "/client.js") { outgoing.setHeader("Content-Type", "text/javascript"); outgoing.end(clientBundle.outputFiles[0].text); return; }
        if (incoming.url !== endpoint || incoming.method !== "POST") { outgoing.statusCode = 404; outgoing.end(); return; }
        let body = ""; for await (const chunk of incoming) { body += chunk; if (body.length > 2048) throw new Error("synthetic input limit"); }
        const request = new NextRequest(`http://127.0.0.1:${server.address().port}${endpoint}`, { method: "POST", headers: incoming.headers, body });
        const response = await compiled.exports.POST(request, { params: Promise.resolve(scope) });
        outgoing.statusCode = response.status;
        receipt.httpStatuses.push(response.status);
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        outgoing.end(await response.text());
      } catch { outgoing.statusCode = 500; outgoing.end('{"error":"synthetic integration failure"}'); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const counts = async () => (await db.$queryRawUnsafe('SELECT count(*)::int AS visits, count(DISTINCT "visitorId")::int AS visitors FROM "LiveMetricVisit" WHERE "versionId"=$1', versionId))[0];
    const before = await counts();
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext();
    await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(pages.map(page => page.goto(`http://127.0.0.1:${server.address().port}`)));
    const results = await Promise.all(pages.map(page => page.evaluate(async scope => {
      const client = VisitDriver.createMetricVisitClient(scope.vendorId, scope.liveId);
      const first = await client.collect(); const retry = await client.collect();
      return { first, retry, hidden: !document.cookie.includes("__Host-cd-metric-") };
    }, scope)));
    receipt.clientStatuses = results.map(result => ({ first: result.first.status, retry: result.retry.status }));
    for (const result of results) {
      assert.deepEqual(result.first, { status: "recorded", versionId });
      assert.deepEqual(result.retry, result.first); assert.equal(result.hidden, true);
    }
    const after = await counts(); assert.equal(after.visits - before.visits, 2); assert.equal(after.visitors - before.visitors, 1);
    const denied = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, { method: "POST",
      headers: { origin: "https://foreign.example.test", "x-celebratedeal-client": "web", "content-type": "application/json" }, body: '{"action":"prepare"}' });
    assert.equal(denied.status, 403); assert.deepEqual(await counts(), after);
    receipt.checks = ["actual_route_database_browser", "two_tabs_one_visitor_two_visits", "cached_retry_no_extra_visit", "http_only_cookie_hidden", "cross_origin_denied"];
    receipt.status = "PASS";
  } finally {
    await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve));
    delete globalThis[injection]; receipt.cleanup = "PASS";
    fs.writeFileSync("docs/ai-team/evidence/product-audit-20261011/WP-20/visit-integrated/browser-result.json", JSON.stringify(receipt, null, 2));
  }
}
