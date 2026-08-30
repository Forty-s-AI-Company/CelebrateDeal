import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep WP-131 deterministic and bounded: the accepted WP-130 contract suite
// is the executable regression surface for the newly authorized route hunk.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npx";
const npmArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", "npx vitest run tests/unit/wp130-cloudflare-stream-webhook-contract.test.ts"]
  : ["vitest", "run", "tests/unit/wp130-cloudflare-stream-webhook-contract.test.ts"];
const result = spawnSync(
  npmCommand,
  npmArgs,
  { cwd: repoRoot, encoding: "utf8", windowsHide: true },
);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const filesMatch = output.match(/Test Files\s+(\d+)\s+passed\s+\((\d+)\)/);
const testsMatch = output.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
const receipt = {
  schema_version: "wp131-cloudflare-stream-webhook-idempotency-runner/v1",
  work_package: "WP-131",
  command: "npx vitest run tests/unit/wp130-cloudflare-stream-webhook-contract.test.ts",
  exit_code: result.status ?? 1,
  spawn_error: result.error ? result.error.code ?? "SPAWN_ERROR" : null,
  test_files: filesMatch ? { passed: Number(filesMatch[1]), total: Number(filesMatch[2]) } : null,
  tests: testsMatch ? { passed: Number(testsMatch[1]), total: Number(testsMatch[2]) } : null,
  output_persisted: false,
  raw_output_persisted: false,
  environment_file_read: false,
  external_side_effects: false,
};

process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
const pass = result.status === 0
  && receipt.test_files?.passed === 1
  && receipt.test_files?.total === 1
  && receipt.tests?.passed === 9
  && receipt.tests?.total === 9;
process.exitCode = pass ? 0 : 1;
