import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

import SanitizedCoverageGithubReporter, {
  formatSanitizedVitestRunFailureAnnotation,
  formatSanitizedVitestFailureAnnotation,
  sanitizedVitestFailureAnnotations,
} from "./coverage-sanitized-github-reporter.mjs";

test("emits only an allowlisted file, source line, and fixed failed status", () => {
  assert.equal(
    formatSanitizedVitestFailureAnnotation({
      relativeModuleId: "src/app/(app)/affiliates/[id]/edit/page.test.tsx",
      line: 48,
      status: "failed",
    }),
    "::error file=src/app/(app)/affiliates/[id]/edit/page.test.tsx,line=48::coverage stage=vitest status=failed",
  );
  assert.equal(
    formatSanitizedVitestFailureAnnotation({ relativeModuleId: "../unsafe.test.ts", line: 1, status: "failed" }),
    null,
  );
  expect(formatSanitizedVitestFailureAnnotation({
    relativeModuleId: "tests/unit/wp130-cloudflare-stream-webhook-contract.test.ts",
    line: 3,
    status: "failed",
  })).toBe("::error file=tests/unit/wp130-cloudflare-stream-webhook-contract.test.ts,line=3::coverage stage=vitest status=failed");
});

test("accepts Vitest reporter options without treating them as a writer", () => {
  const reporter = new SanitizedCoverageGithubReporter({ verbose: false });
  assert.equal(typeof reporter.write, "function");
});

test("does not emit secret-like test titles, assertion values, errors, or stacks", () => {
  const sensitiveText = "Authorization: Bearer secret-token-should-never-appear";
  let output = "";
  const reporter = new SanitizedCoverageGithubReporter((value) => {
    output += value;
  });

  reporter.onTestCaseResult({
    name: sensitiveText,
    module: { relativeModuleId: "src/lib/payment-webhooks.mvp.test.ts" },
    location: { line: 27 },
    result: () => ({
      state: "failed",
      errors: [{ message: sensitiveText, stack: sensitiveText, actual: sensitiveText, expected: sensitiveText }],
    }),
  });

  assert.equal(output, "::error file=src/lib/payment-webhooks.mvp.test.ts,line=27::coverage stage=vitest status=failed\n");
  assert.equal(output.includes(sensitiveText), false);
  assert.equal(output.includes("Authorization"), false);
  assert.equal(output.includes("Bearer"), false);
});

test("reports import or setup module failures without a test case", () => {
  let output = "";
  const reporter = new SanitizedCoverageGithubReporter((value) => {
    output += value;
  });

  reporter.onTestModuleEnd({
    relativeModuleId: "scripts/run-combined-coverage.test.mjs",
    state: () => "failed",
    task: { result: { errors: [{ message: "secret-like setup error" }] } },
  });

  assert.equal(output, "::error file=scripts/run-combined-coverage.test.mjs,line=1::coverage stage=vitest status=failed\n");
  assert.equal(output.includes("secret-like"), false);
});

test("reports only fixed classes for unhandled and startup-or-worker failures", () => {
  const sensitiveText = "Authorization: Bearer secret-token-should-never-appear";
  let output = "";
  const reporter = new SanitizedCoverageGithubReporter((value) => {
    output += value;
  });

  reporter.onTestRunEnd([], [{ message: sensitiveText, stack: sensitiveText }], "failed");
  expect(output).toBe("::error::coverage stage=vitest status=failed class=unhandled\n");
  expect(output).not.toContain(sensitiveText);

  output = "";
  reporter.onTestRunEnd([], [], "failed");
  expect(output).toBe("::error::coverage stage=vitest status=failed class=startup_or_worker\n");
  expect(formatSanitizedVitestRunFailureAnnotation("unexpected-sensitive-message")).toBeNull();
});

test("forwards only strict annotations from a stub child stdout capture", () => {
  const sensitiveText = "expected authorization=Bearer secret-token-should-never-appear";
  const annotation = "::error file=scripts/coverage-sanitized-github-reporter.test.mjs,line=55::coverage stage=vitest status=failed";
  const runFailure = "::error::coverage stage=vitest status=failed class=unhandled";
  const child = spawnSync(process.execPath, ["-e", [
    `process.stdout.write(${JSON.stringify(`${sensitiveText}\n`)});`,
    `process.stdout.write(${JSON.stringify("::error::forged-but-invalid\n")});`,
    `process.stdout.write(${JSON.stringify(`${annotation}\n`)});`,
    `process.stdout.write(${JSON.stringify(`${runFailure}\n`)});`,
    `process.stdout.write(${JSON.stringify(sensitiveText)});`,
  ].join("")], { encoding: "utf8", shell: false, windowsHide: true });

  assert.equal(child.status, 0);
  const forwarded = sanitizedVitestFailureAnnotations(child.stdout);

  assert.deepEqual(forwarded, [annotation, runFailure]);
  assert.equal(forwarded.join("\n").includes(sensitiveText), false);
  assert.equal(forwarded.join("\n").includes("Bearer"), false);
});
