import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// Always test freshly compiled source, never a stale artifact from a prior run.
import "./build-metric-worker.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { createMetricExecutor, createCompletionExecutor } = require(path.join(root, ".metric-worker/live-metric-executor.js"));
const { calculateCoreMetrics } = require(path.join(root, ".metric-worker/live-core-metrics-read-model.js"));
const output = path.join(root, "docs/ai-team/evidence/product-audit-20261011/WP-20/report-executor");
fs.mkdirSync(output, { recursive: true });
const tempParent = path.resolve(root, "tmp"); fs.mkdirSync(tempParent, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempParent, "metric-executor-"));
const checks = [];
const loadMeasurements = [];
async function check(name, run) { try { await run(); checks.push({ name, status: "PASS" }); } catch { checks.push({ name, status: "FAIL" }); } }
const scope = { vendorId: "synthetic-v", liveId: "synthetic-l", contentVersionId: "synthetic-version", mode: "live" };
const input = { scope, startMs: 0, endMs: 200000, durationMs: 100000,
  visits: [{ scope, browserId: "browser", visitedAtMs: 0 }], registrations: [{ scope, personId: "person", browserId: "browser", verifiedAtMs: 1000 }],
  viewing: [{ scope, personId: "person", wallStartMs: 1000, wallEndMs: 91000, mediaStartMs: 0, mediaEndMs: 90000 }], completions: [{ scope, personId: "person", firstCompletedAtMs: 91000 }], orders: [] };
let cleanup = "NOT_RUN";
try {
  const execute = createMetricExecutor(pathToFileURL(path.join(root, ".metric-worker/live-metric-worker.js")));
  await check("real worker equals canonical calculation", async () => {
    const actual = await execute(input); assert.equal(actual.status, "available");
    assert.deepEqual(actual.metrics, calculateCoreMetrics(input));
    assert.equal(actual.metrics.completionRate.value, 100);
  });
  await check("real bounded completion worker produces first-crossing candidates", async () => {
    const project=createCompletionExecutor(pathToFileURL(path.join(root,".metric-worker/live-metric-worker.js")));
    assert.deepEqual(await project(input),{status:"available",projection:{status:"available",cohortCount:1,
      rows:[{scope,personId:"person",firstCompletedAtMs:91000}]}});
    assert.deepEqual(await project({...input,viewing:null}),{status:"available",projection:{status:"unavailable",reason:"missing_data"}});
    assert.deepEqual(await project({...input,viewing:new Array(1000001)}),{status:"unavailable",reason:"input_limit"});
  });
  for (const people of [10000, 50000]) {
    await check(`completion load ${people} people with 18 intervals each`, async () => {
      const registrations = Array.from({length: people}, (_, i) => ({scope,personId:`load-${i}`,browserId:null,verifiedAtMs:1000}));
      const viewing = registrations.flatMap(({personId}) => Array.from({length:18},(_,i)=>({scope,personId,
        wallStartMs:1000+i*5000,wallEndMs:1000+(i+1)*5000,mediaStartMs:i*5000,mediaEndMs:(i+1)*5000})));
      const project = createCompletionExecutor(pathToFileURL(path.join(root,".metric-worker/live-metric-worker.js")));
      const started = performance.now();
      const result = await project({...input,registrations,viewing});
      loadMeasurements.push({people,intervals:viewing.length,inputRows:people+viewing.length,elapsedMs:Math.round(performance.now()-started),
        status:result.status,reason:result.reason??null,projectionStatus:result.projection?.status??null});
      assert.equal(result.status,"available");
      assert.equal(result.projection.status,"available");
      assert.equal(result.projection.rows.length,people);
      assert.ok(result.projection.rows.every(row=>row.firstCompletedAtMs===91000));
    });
  }
  await check("oversized facts reject before starting worker", async () => {
    assert.deepEqual(await execute({ ...input, viewing: new Array(1000001) }), { status: "unavailable", reason: "input_limit" });
  });
  const hang = path.join(temp, "hang.cjs"); fs.writeFileSync(hang, "while (true) {}\n");
  await check("hard timeout terminates busy calculation and parent stays responsive", async () => {
    const executeHang = createMetricExecutor(pathToFileURL(hang), 150);
    let ticks = 0; const timer = setInterval(() => ticks++, 5);
    try {
      const pending = executeHang(input);
      assert.deepEqual(await executeHang(input), { status: "unavailable", reason: "busy" });
      assert.deepEqual(await pending, { status: "unavailable", reason: "timeout" });
      assert.ok(ticks >= 5);
      assert.deepEqual(await executeHang(input), { status: "unavailable", reason: "timeout" });
    } finally { clearInterval(timer); }
  });
  const crash = path.join(temp, "crash.cjs"); fs.writeFileSync(crash, 'throw new Error("synthetic worker failure");\n');
  await check("crash fails closed without synchronous fallback", async () => {
    assert.deepEqual(await createMetricExecutor(pathToFileURL(crash))(input), { status: "unavailable", reason: "worker_failed" });
  });
} finally {
  const resolved = path.resolve(temp);
  assert.ok(resolved.startsWith(tempParent + path.sep) && path.basename(resolved).startsWith("metric-executor-"));
  fs.rmSync(resolved, { recursive: true, force: true }); cleanup = "PASS";
}
const result = { status: checks.every(check => check.status === "PASS") ? "PASS" : "FAIL", checks, loadMeasurements, cleanup, scope: "Local isolated worker threads, synthetic facts; no DB or secrets" };
fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result)); process.exitCode = result.status === "PASS" ? 0 : 1;
