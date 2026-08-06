import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFailureFingerprint, runSingleFingerprintBuild, writeSanitizedEvidence } from "./controlled-build-fingerprint.mjs";

test("selects the first safe workspace-relative source file", () => {
  const fingerprint = createFailureFingerprint({
    exitCode: 1,
    output: "./src/first.ts:2:3\nTS1234 first\n./src/second.ts:4:5\nTS9999 second",
  });
  assert.deepEqual(fingerprint, {
    category: "SOURCE_QUALITY_FAILURE",
    error_code: "TS_1234",
    source_file: "src/first.ts",
    failure_fingerprint: "v1|SOURCE_QUALITY_FAILURE|TS_1234|src/first.ts|exit=1",
    owner: "REPOSITORY_SOURCE",
  });
});

test("rejects absolute, traversal and injected source candidates", () => {
  const fingerprint = createFailureFingerprint({
    exitCode: 1,
    output: "C:\\Users\\person\\app.ts\n../src/no.ts\n./src/good.ts?opaque-sentinel=1\nmodule not found",
  });
  assert.equal(fingerprint.source_file, "<none>");
  assert.equal(fingerprint.owner, "UNRESOLVED");
  assert.equal(fingerprint.error_code, "WEBPACK_MODULE_NOT_FOUND");
});

test("build runner has a hard one-attempt limit and never returns raw output", async () => {
  const attempts = { count: 0 };
  let runCalls = 0;
  const result = await runSingleFingerprintBuild({
    attempts,
    loadEnvironment: async () => ({ NEXT_PUBLIC_APP_URL: "https://build.invalid" }),
    createMirror: async () => "C:/synthetic-mirror",
    cleanupMirror: async () => {},
    runChild: async () => {
      runCalls += 1;
      return {
        exitCode: 1,
        signal: null,
        output: "./src/example.ts:1:1\nTS7006 opaque-sentinel-value",
        outputTruncated: false,
      };
    },
  });
  assert.equal(runCalls, 1);
  assert.equal(result.raw_output_saved, false);
  assert.equal(JSON.stringify(result).includes("opaque-sentinel-value"), false);
  await assert.rejects(
    () => runSingleFingerprintBuild({ attempts }),
    /attempt limit reached/,
  );
});

test("sanitized evidence writes only allowlisted keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "celebratedeal-wp99-test-"));
  try {
    const evidence = await writeSanitizedEvidence({
      build_kind: "controlled_no_env_webpack",
      attempt_count: 1,
      exit_code: 1,
      category: "SOURCE_QUALITY_FAILURE",
      error_code: "TS_7006",
      source_file: "src/example.ts",
      failure_fingerprint: "v1|SOURCE_QUALITY_FAILURE|TS_7006|src/example.ts|exit=1",
      owner: "REPOSITORY_SOURCE",
      raw_output_saved: false,
      output_truncated: false,
      mirror_cleanup: "PASS",
      forbidden_detail: "opaque-sentinel-value",
    }, join(root, "receipt.json"));
    assert.equal("forbidden_detail" in evidence, false);
    assert.equal(JSON.stringify(evidence).includes("opaque-sentinel-value"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
