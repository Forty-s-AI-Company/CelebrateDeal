import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createControlledChildEnvironment,
  classifyBuildFailure,
  loadControlledEnvironment,
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
