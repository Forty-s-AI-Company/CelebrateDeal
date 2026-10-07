import path from "node:path";
import { describe, expect, it } from "vitest";
import SanitizedPlaywrightCiReporter, { classifySanitizedAxeError, classifySyntheticCheckoutError, formatSanitizedAxeBlockingError, formatSanitizedPlaywrightAnnotation } from "./playwright-ci-reporter";

const safeFile = path.join(process.cwd(), "tests", "e2e", "smoke.spec.ts");

function testCase(input: {
  id: string;
  outcome: "unexpected" | "flaky" | "expected";
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
      retry: 0,
      duration: status === "timedOut" ? 90_000 : 14,
      error: { message: "Authorization: Bearer secret-token-must-not-appear" },
      attachments: [{ name: "secret", path: "secret-token-must-not-appear" }],
    })),
  };
}

describe("SanitizedPlaywrightCiReporter", () => {
  it("reports a closed inbox diagnostic and discards appended worker diagnostics", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const current = testCase({ id: "private-inbox", outcome: "unexpected", statuses: ["failed"] });
    Object.assign(current.results[0]!, { errors: [{ message: "Error: PRIVATE_INBOX:N200:A403:P1:M1\n\nFailed worker ran secret-token-must-not-appear\n::error::private", cause: { message: "secret-token-must-not-appear" } }] });
    reporter.onTestEnd(current as never);
    reporter.onEnd({ status: "failed" } as never);
    expect(output).toContain("class=private_inbox navigation_http=200 api_http=403 private_page=1 message_persisted=1");
    expect(output).not.toContain("secret-token-must-not-appear");
    expect(output).not.toContain("::error::private");
  });
  it("formats only fixed axe rule IDs and never forwards nodes or arbitrary IDs", () => {
    const violations = [
      { id: "document-title", nodes: [{ html: "secret-token-must-not-appear", target: ["#private-customer"] }] },
      { id: "color-contrast" }, { id: "document-title" },
      { id: "secret-token-must-not-appear" }, { id: null },
    ];
    const message = formatSanitizedAxeBlockingError(violations);
    expect(message).toBe("AXE_BLOCKING:RULES:color-contrast,document-title,unknown");
    expect(classifySanitizedAxeError(message)).toBe("axe_blocking rules=color-contrast,document-title,unknown");
    expect(classifySanitizedAxeError(`Error: ${message}`)).toBe("axe_blocking rules=color-contrast,document-title,unknown");
    expect(message).toMatch(/AXE_BLOCKING:/u);
    expect(message).not.toContain("private-customer");
    expect(message).not.toContain("secret-token-must-not-appear");
  });

  it("rejects partial axe messages, raw JSON, unknown rules and annotation injection", () => {
    for (const value of [
      null, "AXE_BLOCKING:RULES:", "TypeError: AXE_BLOCKING:RULES:document-title", "AXE_BLOCKING:RULES:document-title\nsecret",
      "AXE_BLOCKING:RULES:document-title,secret-token-must-not-appear", "AXE_BLOCKING:RULES:document-title,%0A::error::secret",
      'AXE_BLOCKING:[{"id":"document-title","nodes":[{"html":"secret"}]}]',
      `AXE_BLOCKING:RULES:${Array.from({ length: 100 }, () => "document-title").join(",")}`,
    ]) expect(classifySanitizedAxeError(value)).toBeNull();
  });

  it("reports a flaky first-attempt axe rule while preserving the failing gate", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const current = testCase({ id: "axe-flaky", outcome: "flaky", statuses: ["failed", "passed"] });
    Object.assign(current.results[0]!, { errors: [{ message: "Error: AXE_BLOCKING:RULES:color-contrast,document-title" }] });
    reporter.onTestEnd(current as never);
    reporter.onEnd({ status: "failed" } as never);
    expect(output).toContain("class=axe_blocking rules=color-contrast,document-title");
    expect(output).toContain("playwright status=failed retry=0");
    expect(output).toContain("playwright status=flaky retry=1");
    expect(output).toContain("playwright status=failed failed=0 timedout=0 flaky=1");
    expect(output).not.toContain("secret-token-must-not-appear");
  });

  it("classifies only the closed synthetic checkout grammar", () => {
    expect(classifySyntheticCheckoutError("G748:503:A:T0O0S0G0")).toBe("checkout_http_503 branch=A transactions=0 orders=0 snapshots=0 grants=0");
    expect(classifySyntheticCheckoutError("G748:COOKIE:MISSING")).toBe("checkout_cookie_missing");
    for (const message of ["G748:503:A:T0O0S0G0\nsecret", "Error: G748:503:A:T0O0S0G0", "G748:503:SECRET:T0O0S0G0", "G748:503:A:T9999O0S0G0", null]) {
      expect(classifySyntheticCheckoutError(message)).toBeNull();
    }
  });

  it("reports direct throw locations and classified counts without arbitrary text", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const current = testCase({ id: "direct", outcome: "flaky", statuses: ["failed", "passed"] });
    Object.assign(current.results[0]!, { errors: [
      { message: "G748:500:S:T1O1S1G0" },
      { message: "secret-token-must-not-appear", location: { file: safeFile, line: 99 } },
      { message: "secret-token-must-not-appear", location: { file: "../secret.spec.ts", line: 2 } },
    ] });
    reporter.onTestEnd(current as never);
    reporter.onEnd({ status: "failed" } as never);
    expect(output).toContain("class=checkout_http_500 branch=S transactions=1 orders=1 snapshots=1 grants=0");
    expect(output).toContain("line=99::playwright status=failed retry=0 class=test_error_location");
    expect(output).not.toContain("secret-token-must-not-appear");
    expect(output).not.toContain("../secret.spec.ts");
  });

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
    expect(output).toContain("first_status=timedOut first_duration_ms=90000");
    expect(output).not.toContain("secret-token-must-not-appear");
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("attachments");
  });

  it("reports one failed step per attempt without reading error text or titles", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const current = testCase({ id: "step", outcome: "unexpected", statuses: ["failed"] });
    const result = current.results[0]!;
    const step = {
      error: { message: "secret-token-must-not-appear" },
      title: "secret-token-must-not-appear",
      category: "expect",
      duration: 100,
      location: { file: safeFile, line: 55 },
    };
    reporter.onStepEnd(current as never, result as never, step as never);
    reporter.onStepEnd(current as never, result as never, step as never);
    reporter.onTestEnd(current as never);
    reporter.onEnd({ status: "failed" } as never);
    expect(output.match(/class=step_error/gu)).toHaveLength(1);
    expect(output).toContain("file=tests/e2e/smoke.spec.ts,line=55");
    expect(output).toContain("class=step_error category=expect duration_ms=100");
    expect(output).not.toContain("secret-token-must-not-appear");
  });

  it("preserves the first allowlisted guard assertion instead of its parent test location", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const current = testCase({ id: "guard", outcome: "flaky", statuses: ["failed", "passed"] });
    const helper = path.join(process.cwd(), "tests", "e2e", "helpers", "direct-url-guard.ts");
    const failed = current.results[0]!;
    reporter.onStepEnd(current as never, failed as never, {
      error: { message: "secret-token-must-not-appear" },
      title: "secret-token-must-not-appear", category: "expect", duration: 2,
      location: { file: helper, line: 268 },
    } as never);
    reporter.onStepEnd(current as never, failed as never, {
      error: {}, category: "test.step", duration: 581,
      location: { file: safeFile, line: 14 },
    } as never);
    reporter.onTestEnd(current as never);
    reporter.onEnd({ status: "failed" } as never);
    expect(output).toContain("file=tests/e2e/helpers/direct-url-guard.ts,line=268");
    expect(output.match(/class=step_error/gu)).toHaveLength(1);
    expect(output).not.toContain("secret-token-must-not-appear");
    for (const file of ["tests/e2e/helpers/credentials.ts", "../tests/e2e/helpers/direct-url-guard.ts", "tests/e2e/helpers/direct-url-guard.ts\nsecret"]) {
      expect(formatSanitizedPlaywrightAnnotation({ file, line: 1, status: "failed", retry: 0 })).toBeNull();
    }
  });

  it("does not emit caught step errors for a passing test", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const current = testCase({ id: "caught", outcome: "expected", statuses: ["passed"] });
    reporter.onStepEnd(current as never, current.results[0] as never, {
      error: {}, category: "expect", duration: 1,
      location: { file: safeFile, line: 55 },
    } as never);
    reporter.onTestEnd(current as never);
    reporter.onEnd({ status: "passed" } as never);
    expect(output).not.toContain("::error");
    expect(output).toContain("status=passed failed=0");
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

 it("retains annotations for both mandatory isolated recovery scenarios", () => {
  for (const name of ["native-subscription-recovery", "native-buyer-recovery"]) {
    expect(formatSanitizedPlaywrightAnnotation({ file: `tests/subscription-recovery/${name}.browser.ts`, line: 35, status: "failed", retry: 0 }))
      .toBe(`::error file=tests/subscription-recovery/${name}.browser.ts,line=35::playwright status=failed retry=0`);
  }
  expect(formatSanitizedPlaywrightAnnotation({ file: "tests/subscription-recovery/credentials.ts", line: 1, status: "failed", retry: 0 })).toBeNull();
 });
