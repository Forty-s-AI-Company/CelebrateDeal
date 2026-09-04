const allowedTestPath = /^(?:src|scripts|tests)\/[A-Za-z0-9_.()[\]/-]+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const failedTestStatus = "failed";
const annotationPattern = /^::error file=(?:src|scripts|tests)\/[A-Za-z0-9_.()[\]/-]+\.(?:test|spec)\.(?:[cm]?[jt]sx?),line=[1-9]\d{0,5}::coverage stage=vitest status=failed$/;
const fixedRunFailureClasses = new Set(["unhandled", "startup_or_worker"]);

function normalizedTestPath(value) {
  const relativePath = String(value ?? "").replaceAll("\\", "/");
  return allowedTestPath.test(relativePath) ? relativePath : null;
}

function normalizedSourceLine(value) {
  return Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : 1;
}

/**
 * The GitHub workflow must never receive a Vitest title, error message, stack,
 * or assertion value. This formatter permits only a constrained test path,
 * source line, and the fixed failure status.
 */
export function formatSanitizedVitestFailureAnnotation({ relativeModuleId, line, status }) {
  if (status !== failedTestStatus) return null;
  const file = normalizedTestPath(relativeModuleId);
  if (!file) return null;
  return `::error file=${file},line=${normalizedSourceLine(line)}::coverage stage=vitest status=${failedTestStatus}`;
}

export function sanitizedVitestFailureAnnotations(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .filter((line) => annotationPattern.test(line) || /^::error::coverage stage=vitest status=failed class=(?:unhandled|startup_or_worker)$/.test(line));
}

export function formatSanitizedVitestRunFailureAnnotation(failureClass) {
  return fixedRunFailureClasses.has(failureClass)
    ? `::error::coverage stage=vitest status=failed class=${failureClass}`
    : null;
}

export class SanitizedCoverageGithubReporter {
  constructor(optionsOrWrite = {}) {
    // Vitest constructs reporters with an options object. Tests can pass a
    // writer directly, while production always keeps the default stdout sink.
    this.write = typeof optionsOrWrite === "function"
      ? optionsOrWrite
      : (value) => process.stdout.write(value);
    this.failedModules = new Set();
    this.hasFailedModule = false;
  }

  onTestCaseResult(testCase) {
    const result = testCase.result();
    const annotation = formatSanitizedVitestFailureAnnotation({
      relativeModuleId: testCase.module.relativeModuleId,
      line: testCase.location?.line,
      status: result.state,
    });
    if (annotation) {
      this.failedModules.add(testCase.module.relativeModuleId);
      this.write(`${annotation}\n`);
    }
  }

  onTestModuleEnd(testModule) {
    if (testModule.state() !== failedTestStatus) return;
    this.hasFailedModule = true;
    if (this.failedModules.has(testModule.relativeModuleId)) return;
    const annotation = formatSanitizedVitestFailureAnnotation({
      relativeModuleId: testModule.relativeModuleId,
      // Module import and setup failures do not have a test-case location.
      line: 1,
      status: failedTestStatus,
    });
    if (annotation) this.write(`${annotation}\n`);
  }

  onTestRunEnd(_testModules, unhandledErrors, reason) {
    if (reason !== failedTestStatus) return;
    const failureClass = unhandledErrors.length > 0
      ? "unhandled"
      : !this.hasFailedModule
        ? "startup_or_worker"
        : null;
    const annotation = formatSanitizedVitestRunFailureAnnotation(failureClass);
    if (annotation) this.write(`${annotation}\n`);
  }
}

export default SanitizedCoverageGithubReporter;
