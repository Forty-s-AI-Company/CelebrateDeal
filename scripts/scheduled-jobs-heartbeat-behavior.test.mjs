import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Runs the real heartbeat and ensure scripts with fake `node` and `gh` shims
// prepended to PATH. The shims live in a throwaway absolute directory, GH_HOST
// points at an invalid host and the shims never exec the real binaries, so these
// tests cannot reach GitHub or the staging alias.
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const heartbeatScript = path.join(scriptsDir, "scheduled-jobs-heartbeat.sh");
const ensureScript = path.join(scriptsDir, "scheduled-jobs-ensure-heartbeat.sh");
const posix = (value) => value.replace(/\\/gu, "/");

function findBash() {
  if (process.env.BASH_PATH) return process.env.BASH_PATH;
  if (process.platform === "win32") {
    for (const candidate of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "bash";
}
const bash = findBash();

const NODE_SHIM = `#!/usr/bin/env bash
echo "node $*" >> "$FAKE_LOG"
job="$2"
for failing in $FAKE_FAIL_JOBS; do
  if [ "$failing" = "$job" ]; then echo "stub $job outcome=failed"; exit 1; fi
done
echo "stub $job outcome=ok"
exit 0
`;

const GH_SHIM = `#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_LOG"
case "$1 $2" in
  "workflow view") [ -n "$FAKE_VIEW_FAIL" ] && exit 1; exit 0 ;;
  "api repos/"*) echo "\${FAKE_STATE:-active}"; exit 0 ;;
  "run list") echo "\${FAKE_ACTIVE_RUNS:-0}"; exit 0 ;;
  "workflow run") echo "DISPATCH $*" >> "$FAKE_LOG"; exit 0 ;;
esac
case "$1" in
  api) echo "\${FAKE_STATE:-active}"; exit 0 ;;
esac
exit 0
`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heartbeat-shim-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "node"), NODE_SHIM, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "gh"), GH_SHIM, { mode: 0o755 });
  return { dir, bin, log: path.join(dir, "calls.log"), output: path.join(dir, "github-output") };
}

function run(script, env, overrides = {}) {
  const ctx = setup();
  fs.writeFileSync(ctx.log, "");
  fs.writeFileSync(ctx.output, "");
  const result = spawnSync(bash, [posix(script)], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: `${posix(ctx.bin)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      GH_HOST: "invalid.invalid",
      GH_TOKEN: "test-token",
      GH_REPO: "owner/repo",
      GITHUB_RUN_ID: "100",
      GITHUB_OUTPUT: posix(ctx.output),
      JOB_SECRET: "test-secret",
      HEARTBEAT_JOBS: "email-deliveries line-notifications webhook-retry",
      HEARTBEAT_DURATION_SECONDS: "3",
      HEARTBEAT_INTERVAL_SECONDS: "1",
      FAKE_LOG: posix(ctx.log),
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      ...env,
    },
    ...overrides,
  });
  const lines = fs.readFileSync(ctx.log, "utf8").split("\n").filter(Boolean);
  const output = fs.readFileSync(ctx.output, "utf8");
  fs.rmSync(ctx.dir, { recursive: true, force: true });
  return { result, lines, output, nodeCalls: lines.filter((line) => line.startsWith("node ")), dispatches: lines.filter((line) => line.startsWith("DISPATCH")) };
}

test("a failing job does not stop the loop, the other jobs keep running and the run ends red", () => {
  const { result, nodeCalls, output } = run(heartbeatScript, { FAKE_FAIL_JOBS: "webhook-retry" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(nodeCalls.length, 9, "3 ticks x 3 jobs, sequential");
  assert.equal(nodeCalls.filter((line) => line.endsWith("email-deliveries")).length, 3);
  assert.match(result.stdout, /::error::heartbeat tick 1: scheduled job webhook-retry/u);
  assert.match(result.stdout, /::error::3 heartbeat call\(s\) failed/u);
  assert.match(output, /preflight=ok/u);
  // Jobs run in the configured order inside a tick.
  assert.deepEqual(nodeCalls.slice(0, 3).map((line) => line.split(" ").pop()), ["email-deliveries", "line-notifications", "webhook-retry"]);
});

test("the successor is requested exactly once per run", () => {
  const { result, dispatches } = run(heartbeatScript, {});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(dispatches.length, 1);
  assert.match(dispatches[0], /workflow run scheduled-jobs-heartbeat\.yml --ref master/u);
});

test("a preflight failure runs nothing, requests no successor and writes no output", () => {
  for (const env of [{ FAKE_VIEW_FAIL: "1" }, { JOB_SECRET: "   " }, { GH_TOKEN: "" }, { HEARTBEAT_JOBS: " " }]) {
    const { result, nodeCalls, dispatches, output } = run(heartbeatScript, env);
    assert.equal(result.status, 1, JSON.stringify(env));
    assert.equal(nodeCalls.length, 0);
    assert.equal(dispatches.length, 0);
    assert.equal(output, "", JSON.stringify(env));
  }
});

test("a disabled workflow ends the loop without calling jobs or starting a successor", () => {
  const { result, nodeCalls, dispatches } = run(heartbeatScript, { FAKE_STATE: "disabled_manually" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /heartbeat stopping: workflow state is 'disabled_manually'/u);
  assert.equal(nodeCalls.length, 0);
  assert.equal(dispatches.length, 0);
});

test("the runner never receives the GitHub token and the ensure script never receives JOB_SECRET", () => {
  const source = fs.readFileSync(heartbeatScript, "utf8");
  assert.match(source, /env -u GH_TOKEN node /u);
  assert.match(source, /env -u JOB_SECRET bash /u);
});

test("ensure does not dispatch while a heartbeat run is active", () => {
  const { result, dispatches } = run(ensureScript, { FAKE_ACTIVE_RUNS: "1" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(dispatches.length, 0);
  assert.match(result.stdout, /already active/u);
});

test("ensure dispatches when nothing is active, and not when the workflow is disabled", () => {
  const idle = run(ensureScript, { FAKE_ACTIVE_RUNS: "0" });
  assert.equal(idle.result.status, 0, idle.result.stdout + idle.result.stderr);
  assert.equal(idle.dispatches.length, 1);

  const disabled = run(ensureScript, { FAKE_ACTIVE_RUNS: "0", FAKE_STATE: "disabled_manually" });
  assert.equal(disabled.result.status, 0);
  assert.equal(disabled.dispatches.length, 0);
});
