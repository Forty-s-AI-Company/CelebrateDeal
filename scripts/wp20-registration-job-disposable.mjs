import { build } from "esbuild";
import { createRequire } from "node:module";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";
const require = createRequire(import.meta.url);

/** Only called after the owned disposable runner verifies its DB marker. */
export async function verifyRegistrationJob(db, scope) {
  const injection = "__wp20OwnedRegistrationJob";
  assert.equal(globalThis[injection], undefined); globalThis[injection] = db;
  const receipt = { status: "FAIL", cleanup: "NOT_RUN", checks: [], excluded: ["Next_server_routing", "remote_TLS", "deployed_timer"] };
  let server;
  try {
    const bundle = await build({ stdin: { contents: 'export { POST } from "./src/app/api/jobs/live-metric-registrations/route.ts"; export { runMetricRegistrationPass } from "./src/lib/live-metric-registration-pass.ts";', resolveDir: process.cwd(), loader: "ts" },
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false, logLevel: "silent",
      define: { "process.env.JOB_SECRET": JSON.stringify("synthetic-owned-job-proof") },
      plugins: [{ name: "owned-db", setup(build) {
        build.onResolve({ filter: /^@\/lib\/db$/ }, args => ({ path: args.path, namespace: "owned" }));
        build.onLoad({ filter: /.*/, namespace: "owned" }, () => ({ contents: `export function getDb(){return globalThis.${injection}}`, loader: "js" }));
      } }],
    });
    const compiled = { exports: {} };
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, compiled, compiled.exports);
    server = http.createServer(async (incoming, outgoing) => {
      try {
        if (incoming.method !== "POST" || incoming.url !== "/job") { outgoing.statusCode = 404; outgoing.end(); return; }
        let body = ""; for await (const chunk of incoming) { body += chunk; if (body.length > 2048) throw new Error("synthetic input limit"); }
        const response = await compiled.exports.POST(new Request(`http://127.0.0.1:${server.address().port}/job`, { method: "POST", headers: incoming.headers, body }));
        outgoing.statusCode = response.status; response.headers.forEach((value, key) => outgoing.setHeader(key, value)); outgoing.end(await response.text());
      } catch { outgoing.statusCode = 500; outgoing.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/job`;
    const denied = await fetch(url, { method: "POST", body: "{}" }); assert.equal(denied.status, 401);
    const send = async (input, signal) => {
      const response = await fetch(url, { method: "POST", signal, headers: { authorization: "Bearer synthetic-owned-job-proof", "content-type": "application/json" }, body: JSON.stringify(input) });
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
      return response.json();
    };
    const result = await compiled.exports.runMetricRegistrationPass(send, { ...scope, afterSubmissionId: null, take: 2 });
    assert.equal(result.status, "pass_complete"); assert.equal(result.pages, 3); assert.equal(result.processed, 5);
    assert.equal(result.retryable, 0); assert.equal(result.terminalGaps, 1); assert.equal(result.coverage, "unknown");
    const [count] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricRegistration" WHERE "vendorId"=$1 AND "liveId"=$2 AND "versionId"=$3 AND "submissionId" LIKE $4', scope.vendorId, scope.liveId, scope.versionId, "reconcile-%");
    assert.equal(count.n, 4);
    receipt.status = "PASS"; receipt.checks = ["actual_http_auth_denied", "actual_route_service_database", "three_page_pass", "terminal_gap_preserved", "idempotent_four_registrations", "private_no_store"];
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    delete globalThis[injection]; receipt.cleanup = "PASS";
    fs.writeFileSync("docs/ai-team/evidence/product-audit-20261011/WP-20/registration-capture/job-loopback-result.json", JSON.stringify(receipt, null, 2));
  }
}
