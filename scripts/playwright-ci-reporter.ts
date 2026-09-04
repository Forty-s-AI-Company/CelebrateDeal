import path from "node:path";
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

const allowedTestPath = /^tests\/(?:e2e|e2e-support)\/[A-Za-z0-9_.()[\]/-]+\.spec\.(?:[cm]?[jt]sx?)$/u;
const fixedStatuses = new Set(["failed", "timedout", "flaky"]);
const allowedSecurityActionOutcomes = new Set([
  "password_reset_smoke",
  "password_reset_smoke_recipient",
  "password_reset_smoke_rate_limited",
  "password_reset_smoke_unavailable",
  "mfa_required",
  "recovery_rate_limited",
  "recovery_unavailable",
  "mfa_code",
  "UNCLASSIFIED",
]);
const allowedMfaSubmitStates = new Set([
  "NOT_OBSERVED",
  "REQUEST_PENDING",
  "RESPONSE_2XX",
  "RESPONSE_3XX",
  "RESPONSE_4XX",
  "RESPONSE_5XX",
  "NETWORK_FAILED",
]);

type AnnotationStatus = "failed" | "timedout" | "flaky";

function sanitizedTestPath(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return null;
  const relative = path.relative(process.cwd(), path.resolve(value)).split(path.sep).join("/");
  return allowedTestPath.test(relative) ? relative : null;
}

function sanitizedLine(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : 1;
}

function sanitizedRetry(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : 0;
}

function sanitizedDuration(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 3_600_000 ? value : 0;
}

export function formatSanitizedPlaywrightAnnotation(input: {
  file: unknown;
  line: unknown;
  status: unknown;
  retry: unknown;
}) {
  if (typeof input.status !== "string" || !fixedStatuses.has(input.status)) return null;
  const file = sanitizedTestPath(input.file);
  if (!file) return null;
  const level = input.status === "flaky" ? "warning" : "error";
  return `::${level} file=${file},line=${sanitizedLine(input.line)}::playwright status=${input.status} retry=${sanitizedRetry(input.retry)}`;
}

function finalAnnotationStatus(test: TestCase): AnnotationStatus | null {
  if (test.outcome() === "flaky") return "flaky";
  if (test.outcome() !== "unexpected") return null;
  const finalResult = test.results.at(-1);
  if (finalResult?.status === "failed") return "failed";
  if (finalResult?.status === "timedOut") return "timedout";
  return null;
}

export function sanitizedSecurityActionOutcome(test: Pick<TestCase, "annotations">) {
  const annotation = test.annotations.find(({ type }) => type === "security-action-outcome");
  if (!annotation) return null;
  return typeof annotation.description === "string" && allowedSecurityActionOutcomes.has(annotation.description)
    ? annotation.description
    : "UNCLASSIFIED";
}

export function sanitizedMfaSubmitState(test: Pick<TestCase, "annotations">) {
  const annotation = test.annotations.find(({ type }) => type === "mfa-submit-state");
  if (!annotation) return null;
  return typeof annotation.description === "string" && allowedMfaSubmitStates.has(annotation.description)
    ? annotation.description
    : "UNCLASSIFIED";
}

/**
 * CI-only reporter: never forwards test titles, error messages, stack traces,
 * body output, attachments, or arbitrary paths into GitHub annotations.
 */
export default class SanitizedPlaywrightCiReporter implements Reporter {
  private readonly write: (value: string) => void;
  private readonly tests = new Map<string, TestCase>();
  private readonly securityActionOutcomes = new Map<string, string>();
  private readonly mfaSubmitStates = new Map<string, string>();
  private globalErrors = 0;
  private readonly failedSteps = new WeakMap<TestResult, string>();

  constructor(optionsOrWrite: unknown = {}) {
    this.write = typeof optionsOrWrite === "function"
      ? optionsOrWrite as (value: string) => void
      : (value) => process.stdout.write(value);
  }

  onTestEnd(test: TestCase, result?: TestResult) {
    this.tests.set(test.id, test);
    const status = result?.status ?? test.results.at(-1)?.status;
    if (status !== "failed" && status !== "timedOut") return;
    const securityActionOutcome = sanitizedSecurityActionOutcome(test);
    if (securityActionOutcome) this.securityActionOutcomes.set(test.id, securityActionOutcome);
    const mfaSubmitState = sanitizedMfaSubmitState(test);
    if (mfaSubmitState) this.mfaSubmitStates.set(test.id, mfaSubmitState);
  }

  onError() {
    this.globalErrors += 1;
    this.write("::error::playwright status=failed class=global_error\n");
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    if (!step.error || this.failedSteps.has(result)) return;
    const annotation = formatSanitizedPlaywrightAnnotation({
      file: step.location?.file ?? test.location.file,
      line: step.location?.line ?? test.location.line,
      status: "failed",
      retry: result.retry,
    });
    if (!annotation) return;
    const category = ["expect", "pw:api", "test.step", "hook", "fixture"].includes(step.category) ? step.category : "other";
    this.failedSteps.set(result, `${annotation} class=step_error category=${category} duration_ms=${sanitizedDuration(step.duration)}\n`);
  }

  onEnd(result: FullResult) {
    let failed = 0;
    let timedout = 0;
    let flaky = 0;

    for (const test of this.tests.values()) {
      const status = finalAnnotationStatus(test);
      if (!status) continue;
      if (status === "failed") failed += 1;
      if (status === "timedout") timedout += 1;
      if (status === "flaky") flaky += 1;
      // Caught/expected step errors in a passing test are not CI failures.
      for (const attempt of test.results) {
        const stepAnnotation = this.failedSteps.get(attempt);
        if (stepAnnotation) this.write(stepAnnotation);
      }
      const annotation = formatSanitizedPlaywrightAnnotation({
        file: test.location.file,
        line: test.location.line,
        status,
        retry: test.results.length - 1,
      });
      if (!annotation) continue;
      const securityActionOutcome = this.securityActionOutcomes.get(test.id);
      const mfaSubmitState = this.mfaSubmitStates.get(test.id);
      const first = test.results[0];
      const firstStatus = first && ["passed", "failed", "timedOut", "skipped", "interrupted"].includes(first.status) ? first.status : "unknown";
      this.write(`${annotation} first_status=${firstStatus} first_duration_ms=${sanitizedDuration(first?.duration)}${securityActionOutcome ? ` security_action_outcome=${securityActionOutcome}` : ""}${mfaSubmitState ? ` mfa_submit_state=${mfaSubmitState}` : ""}\n`);
    }

    const status = result.status === "passed" || result.status === "failed" || result.status === "timedout" || result.status === "interrupted"
      ? result.status
      : "failed";
    this.write(`::notice::playwright status=${status} failed=${failed} timedout=${timedout} flaky=${flaky} global=${this.globalErrors}\n`);
  }
}
