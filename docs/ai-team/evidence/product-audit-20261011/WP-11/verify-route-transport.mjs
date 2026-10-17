import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Keep application imports in a child with an explicit synthetic environment.
// No database URL or provider credential is inherited or loaded from a file.
if (!process.argv.includes("--isolated")) {
  const env = Object.fromEntries(["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"].map(key => [key, process.env[key] ?? ""]));
  const child = spawn(process.execPath, [process.argv[1], "--isolated"], {
    cwd: process.cwd(), env: { ...env, RATE_LIMIT_PROVIDER: "memory", NODE_ENV: "test", ENTRY_CLIENT_IP_TRUST_MODE: "cloudflare", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "cloudflare", ENTRY_CLIENT_IP_INGRESS_SECRET: "synthetic-route-transport-proof-only-0000000000" },
    windowsHide: true, stdio: "ignore",
  });
  process.exitCode = await new Promise(resolve => {
    child.once("error", () => resolve(1));
    child.once("close", code => resolve(code ?? 1));
  });
} else {
  const root = process.cwd();
  const out = path.join(root, "docs/ai-team/evidence/product-audit-20261011/WP-11");
  const assets = path.join(root, ".ai-team/tmp/wp11-route-transport");
  fs.mkdirSync(assets, { recursive: true });
  const report = { status: "IN_PROGRESS", scope: "Actual POST route and memory limiter over local HTTP; invalid payload only; no database, Next server, or cloud deployment", checks: [], cleanup: false };
  let server, stopProxy;
  try {
    const bundled = path.join(assets, "route.cjs");
    const result = await build({ stdin: { contents: 'export { POST } from "./src/app/api/live-admission/route"; export { resetInMemoryRateLimitForTests } from "./src/lib/rate-limit";', resolveDir: root, loader: "ts" }, outfile: bundled, bundle: true, platform: "node", format: "cjs", packages: "external", metafile: true });
    const sources = Object.keys(result.metafile.inputs).filter(file => file !== "<stdin>");
    report.sources = Object.fromEntries(sources.map(file => [file, createHash("sha256").update(fs.readFileSync(path.resolve(root, file))).digest("hex")]));
    const { POST, resetInMemoryRateLimitForTests } = createRequire(import.meta.url)(bundled);
    const { startPrivateChatLoopbackIngress } = await import(pathToFileURL(path.join(root, "scripts/live-private-loopback-ingress.mjs")));
    server = http.createServer(async (incoming, response) => {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(key, value);
        // Fixed invalid payload always exits the real route before getDb().
        const result = await POST(new Request("http://127.0.0.1:32211/api/live-admission", { method: "POST", headers, body: "{}" }));
        response.writeHead(result.status); response.end();
      } catch { response.writeHead(500); response.end(); }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(32211, "127.0.0.1", resolve); });
    stopProxy = await startPrivateChatLoopbackIngress({ port: 32212, upstreamPort: 32211, proof: "synthetic-route-transport-proof-only-0000000000" });
    for (const mode of ["proxy", "direct"]) {
      resetInMemoryRateLimitForTests();
      const statuses = [];
      for (let index = 0; index < 121; index++) {
        const result = await fetch(`http://127.0.0.1:${mode === "proxy" ? 32212 : 32211}/api/live-admission`, {
          method: "POST", headers: { origin: "http://127.0.0.1:32211", "x-celebratedeal-client": "web", "content-type": "application/json", "cf-connecting-ip": `198.51.100.${index + 1}` }, body: "{}", signal: AbortSignal.timeout(5000),
        });
        statuses.push(result.status); await result.arrayBuffer();
      }
      const passed = mode === "proxy" ? statuses.slice(0, 120).every(status => status === 400) && statuses[120] === 429 : statuses.every(status => status === 503);
      report.checks.push({ case: `${mode}-rotating-untrusted-ip`, status: passed ? "PASS" : "FAIL", requests: statuses.length, invalidPayloadResponses: statuses.filter(status => status === 400).length, limitedResponses: statuses.filter(status => status === 429).length, expectedFinalStatus: mode === "proxy" ? 429 : 503, actualFinalStatus: statuses[120] });
    }
    report.status = report.checks.every(check => check.status === "PASS") ? "PASS" : "FAIL";
  } catch (error) { report.status = "FAIL"; report.errorType = error.name; }
  finally {
    if (stopProxy) await stopProxy();
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    report.cleanup = true;
    fs.writeFileSync(path.join(out, "trusted-entry/route-transport-result.json"), JSON.stringify(report, null, 2));
    process.exitCode = report.status === "PASS" ? 0 : 1;
  }
}
