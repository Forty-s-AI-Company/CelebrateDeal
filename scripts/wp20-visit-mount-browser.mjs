import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import http from "node:http";
import fs from "node:fs";
import assert from "node:assert/strict";

// Owned loopback synthetic transport only. No real browser profile or secrets.
const compiled = await build({ stdin: { contents: `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { LiveMetricVisit } from './src/components/live-metric-visit';
const root=createRoot(document.getElementById('root'));
window.mount=()=>root.render(React.createElement(React.StrictMode,null,React.createElement(LiveMetricVisit,{vendorId:'synthetic',liveId:'live'})));
window.unmount=()=>root.unmount();`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, platform: "browser", format: "iife", write: false, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
const events = new Set(); let prepares = 0; let active = 0; let overlap = false; let fail = false;
const server = http.createServer(async (request, response) => {
  if (request.url === "/") { response.setHeader("Content-Type", "text/html"); response.end('<div id="root"></div><script src="/bundle.js"></script>'); return; }
  if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(compiled.outputFiles[0].text); return; }
  if (request.url !== "/api/live-metrics/synthetic/live/visits") { response.statusCode = 404; response.end(); return; }
  let raw = ""; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); response.setHeader("Content-Type", "application/json");
  if (body.action === "prepare") {
    prepares++;
    if (fail) { response.statusCode = 503; response.end('{}'); return; }
    active++; overlap ||= active > 1;
    await new Promise(resolve => setTimeout(resolve, 50));
    response.end(JSON.stringify({ ok: true, prepared: true, versionId: "version" }));
  } else {
    active--; events.add(body.eventId);
    response.end(JSON.stringify({ ok: true, eventId: body.eventId, versionId: "version" }));
  }
});
const receipt = { status: "FAIL", checks: [], cleanup: "NOT_RUN" };
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all(pages.map(page => page.goto(`http://127.0.0.1:${server.address().port}`)));
  await Promise.all(pages.map(page => page.evaluate(() => window.mount())));
  await expect.poll(() => events.size, { timeout: 10000 }).toBe(2);
  assert.equal(prepares, 2); assert.equal(overlap, false); assert.equal(active, 0);
  receipt.checks.push("two_real_tabs_serialized", "strict_mode_one_event_per_mount");
  await Promise.all(pages.map(page => page.evaluate(() => window.unmount())));
  fail = true;
  const retryPage = await context.newPage(); await retryPage.goto(`http://127.0.0.1:${server.address().port}`);
  await retryPage.evaluate(() => window.mount());
  await expect.poll(() => prepares, { timeout: 5000 }).toBe(3);
  await retryPage.evaluate(() => window.unmount());
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(prepares, 3); assert.equal(events.size, 2);
  receipt.checks.push("unmount_cancels_retry"); receipt.status = "PASS";
} catch { receipt.status = "FAIL"; }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); receipt.cleanup = "PASS";
  fs.writeFileSync("docs/ai-team/evidence/product-audit-20261011/WP-20/visit-mount/browser-result.json", JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify(receipt)); process.exitCode = receipt.status === "PASS" ? 0 : 1;
