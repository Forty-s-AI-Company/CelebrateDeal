import path from "node:path";
import { describe, expect, it } from "vitest";
import SanitizedPlaywrightCiReporter, { formatSanitizedPlaywrightAnnotation } from "./playwright-ci-reporter";

const safeFile = path.join(process.cwd(), "tests", "e2e", "smoke.spec.ts");

function testCase(input: {
  id: string;
  outcome: "unexpected" | "flaky";
  statuses: Array<"failed" | "passed" | "timedOut">;
  file?: string;
}) {
  return {
    id: input.id,
    title: "Authorization: Bearer secret-token-must-not-appear",
    location: { file: input.file ?? safeFile, line: 42, column: 1 },
    outcome: () => input.outcome,
    results: input.statuses.map((status) => ({
      status,
      error: { message: "Authorization: Bearer secret-token-must-not-appear" },
      attachments: [{ name: "secret", path: "secret-token-must-not-appear" }],
    })),
  };
}

describe("SanitizedPlaywrightCiReporter", () => {
  it("emits only file, line, and fixed failed or timedout status", () => {
    expect(formatSanitizedPlaywrightAnnotation({ file: safeFile, line: 42, status: "failed", retry: 0 }))
      .toBe("::error file=tests/e2e/smoke.spec.ts,line=42::playwright status=failed retry=0");
    expect(formatSanitizedPlaywrightAnnotation({ file: safeFile, line: 2, status: "timedout", retry: 1 }))
      .toBe("::error file=tests/e2e/smoke.spec.ts,line=2::playwright status=timedout retry=1");
  });

  it("rejects paths that escape the repository test directory", () => {
    expect(formatSanitizedPlaywrightAnnotation({ file: "../secrets.spec.ts", line: 1, status: "failed", retry: 0 })).toBeNull();
    expect(formatSanitizedPlaywrightAnnotation({ file: path.join(process.cwd(), "src", "app", "page.spec.ts"), line: 1, status: "failed", retry: 0 })).toBeNull();
  });

  it("reports final failures and flaky retries without leaking synthetic errors", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    reporter.onTestEnd(testCase({ id: "failed", outcome: "unexpected", statuses: ["failed"] }) as never);
    reporter.onTestEnd(testCase({ id: "timedout", outcome: "unexpected", statuses: ["timedOut"] }) as never);
    reporter.onTestEnd(testCase({ id: "flaky", outcome: "flaky", statuses: ["failed", "passed"] }) as never);
    reporter.onEnd({ status: "failed" } as never);

    expect(output).toContain("::error file=tests/e2e/smoke.spec.ts,line=42::playwright status=failed retry=0");
    expect(output).toContain("::error file=tests/e2e/smoke.spec.ts,line=42::playwright status=timedout retry=0");
    expect(output).toContain("::warning file=tests/e2e/smoke.spec.ts,line=42::playwright status=flaky retry=1");
    expect(output).toContain("::notice::playwright status=failed failed=1 timedout=1 flaky=1 global=0");
    expect(output).not.toContain("secret-token-must-not-appear");
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("attachments");
  });

  it("counts an unsafe-path failure and emits a fixed global error without raw details", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    reporter.onTestEnd(testCase({ id: "unsafe", outcome: "unexpected", statuses: ["failed"], file: "../secret.spec.ts" }) as never);
    reporter.onError();
    reporter.onEnd({ status: "failed" } as never);

    expect(output).toContain("::error::playwright status=failed class=global_error");
    expect(output).toContain("::notice::playwright status=failed failed=1 timedout=0 flaky=0 global=1");
    expect(output).not.toContain("secret-token-must-not-appear");
    expect(output).not.toContain("../secret.spec.ts");
  });
});
