import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createControlledChildEnvironment,
  classifyBuildFailure,
  loadControlledEnvironment,
  runControlledProductionBuild,
  runChild,
  validateControlledEnvironment,
} from "./controlled-production-build.mjs";

const controlled = await loadControlledEnvironment();

test("controlled child environment excludes host application values", () => {
  const environment = createControlledChildEnvironment(controlled, {
    PATH: "synthetic-path",
    TEMP: "synthetic-temp",
    HOST_APPLICATION_MARKER: "host-only-marker",
    HOST_FAKE_SENSITIVE_VALUE: "host-only-sensitive-value",
  });

  assert.equal(environment.HOST_APPLICATION_MARKER, undefined);
  assert.equal(environment.HOST_FAKE_SENSITIVE_VALUE, undefined);
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.PATH, "synthetic-path");
  assert.equal(environment.NEXT_PUBLIC_APP_URL, "https://build.invalid");
  assert.ok(environment.CRON_SECRET);
  assert.ok(environment.LIVE_CHAT_INGRESS_SECRET);
});

test("controlled build runs production preflight before Next build", async () => {
  const calls = [];
  const result = await runControlledProductionBuild({
    createMirror: async () => join(tmpdir(), "celebratedeal-controlled-build-test-mirror"),
    run: async (invocation) => {
      calls.push(invocation);
      return { code: 0, signal: null, output: "" };
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].args[1], /preflight\.ts$/u);
  assert.deepEqual(calls[0].args.at(-1), "--production");
  assert.deepEqual(calls[1].args.slice(-2), ["build", "--webpack"]);
  assert.equal(result.preflightExitCode, 0);
  assert.equal(result.nextBuildExitCode, 0);
});

test("controlled preflight failure stops before Next build", async () => {
  const calls = [];
  const result = await runControlledProductionBuild({
    createMirror: async () => join(tmpdir(), "celebratedeal-controlled-build-test-failing-mirror"),
    run: async (invocation) => {
      calls.push(invocation);
      return { code: calls.length === 1 ? 1 : 0, signal: null, output: calls.length === 1 ? "[FAIL] CSRF_SECRET: missing" : "" };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.nextBuildExitCode, null);
  assert.equal(result.failureCategory, "CONTROLLED_ENV_INCOMPLETE");
});

test("controlled config rejects non-synthetic or incomplete values before build", () => {
  assert.throws(
    () => validateControlledEnvironment({ ...controlled, NEXT_PUBLIC_APP_URL: "https://app.example.com" }),
    /controlled config rejected NEXT_PUBLIC_APP_URL/,
  );
  const incomplete = { ...controlled };
  delete incomplete.SENTRY_DSN;
  assert.throws(() => validateControlledEnvironment(incomplete), /allowlisted keys/);
});

test("child nonzero exit code is returned without forwarding child output", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "celebratedeal-controlled-runner-test-"));
  const childPath = join(fixtureRoot, "child.mjs");
  await writeFile(childPath, "process.stdout.write(process.env.HOST_FAKE_SENSITIVE_VALUE ?? 'absent'); process.exit(7);\n");
  try {
    const result = await runChild({
      executable: process.execPath,
      args: [childPath],
      cwd: fixtureRoot,
      environment: createControlledChildEnvironment(controlled, {
        PATH: process.env.PATH ?? "",
        HOST_FAKE_SENSITIVE_VALUE: "host-only-sensitive-value",
      }),
    });
    assert.equal(result.code, 7);
    assert.equal(result.signal, null);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("build diagnostics are reduced to fixed categories", () => {
  assert.equal(classifyBuildFailure("PrismaClient: connection refused"), "DATABASE_ACCESS_DURING_BUILD");
  assert.equal(classifyBuildFailure("Cannot find module next"), "MIRROR_MODULE_RESOLUTION");
  assert.equal(classifyBuildFailure("unexpected output with host-only-sensitive-value"), "BUILD_FAILURE_UNCLASSIFIED");
});
