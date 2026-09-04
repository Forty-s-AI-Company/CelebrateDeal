import path from "node:path";
import type { FullResult, Reporter, TestCase } from "@playwright/test/reporter";

const allowedTestPath = /^tests\/e2e\/[A-Za-z0-9_.()[\]/-]+\.spec\.(?:[cm]?[jt]sx?)$/u;
const fixedStatuses = new Set(["failed", "timedout", "flaky"]);

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

/**
 * CI-only reporter: never forwards test titles, error messages, stack traces,
 * body output, attachments, or arbitrary paths into GitHub annotations.
 */
export default class SanitizedPlaywrightCiReporter implements Reporter {
  private readonly write: (value: string) => void;
  private readonly tests = new Map<string, TestCase>();
  private globalErrors = 0;

  constructor(optionsOrWrite: unknown = {}) {
    this.write = typeof optionsOrWrite === "function"
      ? optionsOrWrite as (value: string) => void
      : (value) => process.stdout.write(value);
  }

  onTestEnd(test: TestCase) {
    this.tests.set(test.id, test);
  }

  onError() {
    this.globalErrors += 1;
    this.write("::error::playwright status=failed class=global_error\n");
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
      const annotation = formatSanitizedPlaywrightAnnotation({
        file: test.location.file,
        line: test.location.line,
        status,
        retry: test.results.length - 1,
      });
      if (!annotation) continue;
      this.write(`${annotation}\n`);
    }

    const status = result.status === "passed" || result.status === "failed" || result.status === "timedout" || result.status === "interrupted"
      ? result.status
      : "failed";
    this.write(`::notice::playwright status=${status} failed=${failed} timedout=${timedout} flaky=${flaky} global=${this.globalErrors}\n`);
  }
}
