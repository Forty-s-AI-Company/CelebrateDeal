import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
const root = process.cwd();
const out = path.join(root, "docs/ai-team/evidence/product-audit-20261011/WP-11/whole-current");
const { main } = await import(pathToFileURL(path.join(root, "scripts/prisma-loopback-disposable-migration-runner.mjs")));
const { startPrivateChatLoopbackIngress } = await import(pathToFileURL(path.join(root, "scripts/live-private-loopback-ingress.mjs")));
const report = { status: "IN_PROGRESS", engines: [], serverStopped: false };
async function vacant(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  await new Promise(resolve => server.close(resolve));
}
const receipt = await main({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  await vacant(31024); await vacant(31025);
  const mirror = path.join(tempRoot, "wp11-browser"); fs.mkdirSync(mirror);
  for (const name of ["src", "public", "prisma", "scripts"]) fs.cpSync(path.join(root, name), path.join(mirror, name), { recursive: true, filter: candidate => !path.basename(candidate).startsWith(".env") });
  for (const name of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "sentry.server.config.ts", "sentry.edge.config.ts"]) fs.copyFileSync(path.join(root, name), path.join(mirror, name));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(mirror, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const env = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31024", RATE_LIMIT_PROVIDER: "memory", ENTRY_CLIENT_IP_TRUST_MODE: "cloudflare", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "cloudflare", ENTRY_CLIENT_IP_INGRESS_SECRET: "synthetic-browser-entry-proof-000000000000", CSRF_SECRET: "synthetic-wp11-browser-session-key-only-20261012", SENTRY_DISABLE_AUTO_UPLOAD: "true", NEXT_TELEMETRY_DISABLED: "1" };
  // Retain every existing browser assertion; replace only the old fixed DB binding.
  // Reuse the installed browser binaries while keeping the isolated home and DB.
  env.PLAYWRIGHT_BROWSERS_PATH = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
  let browserSource = fs.readFileSync(path.join(root, "docs/ai-team/evidence/product-audit-20261011/WP-11/security-followup/browser.cjs"), "utf8");
  browserSource = browserSource.replace(/^process\.env\.DATABASE_URL=.*\r?\n/m, "");
  browserSource = browserSource.replace('const suffix=randomUUID();', 'report.stage="fixture";const suffix=randomUUID();').replace('browser=await engines[engine].launch();', 'report.stage="browser-launch";browser=await engines[engine].launch();');
  const browserPath = path.join(mirror, "wp11-browser.cjs"); fs.writeFileSync(browserPath, browserSource);
  let stopProxy, app;
  try {
    stopProxy = await startPrivateChatLoopbackIngress({ port: 31024, upstreamPort: 31025, proof: env.ENTRY_CLIENT_IP_INGRESS_SECRET });
    app = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "31025"], { cwd: mirror, env, windowsHide: true, stdio: "ignore" });
    let ready = false;
    for (let i = 0; i < 90; i++) {
      if (app.exitCode !== null) throw new Error("app-exited");
      try { const response = await fetch("http://127.0.0.1:31024/api/automation/vouchers/redeem", { signal: AbortSignal.timeout(3000), redirect: "manual" }); await response.arrayBuffer(); if ([303, 307, 400, 410].includes(response.status)) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error("app-readiness-timeout");
    for (const engine of ["chromium", "firefox"]) {
      const exitCode = await new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), browserPath, engine], { cwd: mirror, env, windowsHide: true, stdio: "ignore" });
        const timer = setTimeout(() => { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else child.kill(); }, 240000);
        child.once("error", () => { clearTimeout(timer); resolve(1); }); child.once("close", code => { clearTimeout(timer); resolve(code ?? 1); });
      });
      const file = path.join(mirror, `browser-${engine}-result.json`);
      const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { status: "MISSING_RECEIPT" };
      report.engines.push({ engine, exitCode, ...result });
      if (exitCode !== 0 || result.status !== "PASS") throw new Error("browser-regression-failed");
    }
  } finally {
    if (app?.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else app.kill();
      if (app.exitCode === null) await new Promise(resolve => app.once("close", resolve));
      report.serverStopped = true;
    }
    if (stopProxy) await stopProxy();
  }
} });
report.status = receipt.status; report.cleanup = receipt.cleanup; report.failure = receipt.failure;
fs.writeFileSync(path.join(out, "browser-result.json"), JSON.stringify(report, null, 2));

if (report.status !== "PASS" || report.engines.length !== 2 || report.engines.some(engine => engine.status !== "PASS" || engine.exitCode !== 0) || !report.serverStopped || Object.values(receipt.cleanup).some(value => value !== "PASS")) process.exitCode = 1;
