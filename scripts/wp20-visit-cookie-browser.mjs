import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import assert from "node:assert/strict";

// Fresh synthetic cookie only; never access any existing browser profile.
const name = "__Host-cd-metric-synthetic";
let stored = false;
const server = http.createServer((request, response) => {
  if (request.url === "/") { response.setHeader("Content-Type", "text/html"); response.end("<p>Synthetic cookie test</p>"); return; }
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/prepare") {
    response.setHeader("Set-Cookie", `${name}=synthetic-proof; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(Date.now() + 60000).toUTCString()}`);
    response.end(JSON.stringify({ proofExpiresAtMs: Date.now() + 100 })); return;
  }
  if (request.url === "/expire") {
    response.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
    response.end("{}"); return;
  }
  if (request.url === "/check") {
    // Only return a Boolean; never record raw cookie/header material.
    stored = (request.headers.cookie ?? "").split(";").some(part => part.trim() === `${name}=synthetic-proof`);
    response.end(JSON.stringify({ retained: stored })); return;
  }
  response.statusCode = 404; response.end("{}");
});
const receipt = { status: "FAIL", checks: [], cleanup: "NOT_RUN" }; let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true }); const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const preparation = await (await fetch("/prepare", { method: "POST" })).json();
    await new Promise(resolve => setTimeout(resolve, 250));
    const retained = await (await fetch("/check", { method: "POST" })).json();
    const hidden = !document.cookie.includes("__Host-cd-metric-synthetic");
    await fetch("/expire", { method: "POST" });
    const expired = await (await fetch("/check", { method: "POST" })).json();
    return { retained: retained.retained, hidden, removed: !expired.retained, proofExpired: Date.now() > preparation.proofExpiresAtMs };
  });
  assert.deepEqual(result, { retained: true, hidden: true, removed: true, proofExpired: true });
  receipt.checks = ["http_only_hidden", "retained_after_shorter_proof_lifetime", "expired_cookie_removed"];
  receipt.status = "PASS";
} catch { receipt.status = "FAIL"; }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); receipt.cleanup = "PASS";
  fs.writeFileSync("docs/ai-team/evidence/product-audit-20261011/WP-20/visit-cookie-lifetime/browser-result.json", JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify(receipt)); process.exitCode = receipt.status === "PASS" ? 0 : 1;
