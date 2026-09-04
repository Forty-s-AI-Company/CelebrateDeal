import path from "node:path";
import { describe, expect, it } from "vitest";
import SanitizedPlaywrightCiReporter, { formatSanitizedPlaywrightAnnotation, sanitizedMfaSubmitState, sanitizedSecurityActionOutcome } from "./playwright-ci-reporter";

const safeFile = path.join(process.cwd(), "tests", "e2e", "smoke.spec.ts");

function testCase(input: {
  id: string;
  outcome: "unexpected" | "flaky" | "expected";
  statuses: Array<"failed" | "passed" | "timedOut">;
  file?: string;
  annotation?: string;
  mfaSubmitState?: string;
}) {
  return {
    id: input.id,
    title: "Authorization: Bearer secret-token-must-not-appear",
    location: { file: input.file ?? safeFile, line: 42, column: 1 },
    annotations: [
      ...(input.annotation ? [{ type: "security-action-outcome", description: input.annotation }] : []),
      ...(input.mfaSubmitState ? [{ type: "mfa-submit-state", description: input.mfaSubmitState }] : []),
    ],
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
  it("emits only file, line, and fixed failed or timedout status", () => {
    expect(formatSanitizedPlaywrightAnnotation({ file: safeFile, line: 42, status: "failed", retry: 0 }))
      .toBe("::error file=tests/e2e/smoke.spec.ts,line=42::playwright status=failed retry=0");
    expect(formatSanitizedPlaywrightAnnotation({ file: safeFile, line: 2, status: "timedout", retry: 1 }))
      .toBe("::error file=tests/e2e/smoke.spec.ts,line=2::playwright status=timedout retry=1");
    expect(formatSanitizedPlaywrightAnnotation({ file: path.join(process.cwd(), "tests", "e2e-support", "support-case-journey.spec.ts"), line: 1, status: "failed", retry: 0 }))
      .toBe("::error file=tests/e2e-support/support-case-journey.spec.ts,line=1::playwright status=failed retry=0");
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

  it("emits only allowlisted security action outcomes for failed or flaky cases", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const failed = testCase({ id: "action", outcome: "unexpected", statuses: ["failed"], annotation: "password_reset_smoke" });
    const unknown = testCase({ id: "unknown", outcome: "unexpected", statuses: ["failed"], annotation: "Authorization: bearer secret" });
    const passing = testCase({ id: "passing", outcome: "expected", statuses: ["passed"], annotation: "mfa_code" });
    reporter.onTestEnd(failed as never);
    reporter.onTestEnd(unknown as never);
    reporter.onTestEnd(passing as never);
    reporter.onEnd({ status: "failed" } as never);

    expect(output).toContain("security_action_outcome=password_reset_smoke");
    expect(output).toContain("security_action_outcome=UNCLASSIFIED");
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("bearer secret");
    expect(output).not.toContain("security_action_outcome=mfa_code");
  });

  it("allows only fixed invitation redirect outcomes and preserves them across retries", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const flaky = testCase({ id: "invitation", outcome: "flaky", statuses: ["failed", "passed"], annotation: "member_invitation_rate_limited" });
    const unknown = testCase({ id: "invitation-unknown", outcome: "unexpected", statuses: ["failed"], annotation: "member_invitation?token=secret" });
    reporter.onTestEnd(flaky as never, flaky.results[0] as never);
    flaky.annotations = [];
    reporter.onTestEnd(flaky as never, flaky.results[1] as never);
    reporter.onTestEnd(unknown as never);
    reporter.onEnd({ status: "failed" } as never);

    expect(output).toContain("security_action_outcome=member_invitation_rate_limited");
    expect(output).toContain("security_action_outcome=UNCLASSIFIED");
    expect(output).not.toContain("token=secret");
  });

  it("maps missing or unknown action annotations to UNCLASSIFIED without exposing text", () => {
    expect(sanitizedSecurityActionOutcome({ annotations: [] })).toBeNull();
    expect(sanitizedSecurityActionOutcome({ annotations: [{ type: "security-action-outcome", description: "secret=token" }] })).toBe("UNCLASSIFIED");
    expect(sanitizedSecurityActionOutcome({ annotations: [{ type: "security-action-outcome", description: "recovery_unavailable" }] })).toBe("recovery_unavailable");
    expect(sanitizedSecurityActionOutcome({ annotations: [{ type: "other", description: "mfa_code" }] })).toBeNull();
    expect(sanitizedMfaSubmitState({ annotations: [{ type: "mfa-submit-state", description: "RESPONSE_2XX" }] })).toBe("RESPONSE_2XX");
    expect(sanitizedMfaSubmitState({ annotations: [{ type: "mfa-submit-state", description: "secret=token" }] })).toBe("UNCLASSIFIED");
    expect(sanitizedMfaSubmitState({ annotations: [{ type: "other", description: "RESPONSE_2XX" }] })).toBeNull();
  });

  it("retains the sanitized failed attempt outcome when a retry succeeds", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const current = testCase({ id: "flaky-action", outcome: "flaky", statuses: ["failed", "passed"], annotation: "mfa_code" });
    reporter.onTestEnd(current as never, current.results[0] as never);
    current.annotations = [];
    reporter.onTestEnd(current as never, current.results[1] as never);
    reporter.onEnd({ status: "passed" } as never);

    expect(output).toContain("security_action_outcome=mfa_code");
  });

  it("retains the sanitized MFA submit state when a retry succeeds", () => {
    let output = "";
    const reporter = new SanitizedPlaywrightCiReporter((value: string) => { output += value; });
    const current = testCase({ id: "flaky-mfa", outcome: "flaky", statuses: ["failed", "passed"], mfaSubmitState: "REQUEST_PENDING" });
    reporter.onTestEnd(current as never, current.results[0] as never);
    current.annotations = [];
    reporter.onTestEnd(current as never, current.results[1] as never);
    reporter.onEnd({ status: "passed" } as never);

    expect(output).toContain("mfa_submit_state=REQUEST_PENDING");
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
