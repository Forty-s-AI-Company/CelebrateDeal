import path from "node:path";
import { classifyPublicLiveBrowserDiagnostic } from "./public-live-browser-diagnostic";
import { classifyPrivateInboxDiagnostic } from "./private-inbox-diagnostic";
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

const allowedTestPath = /^tests\/e2e\/[A-Za-z0-9_.()[\]/-]+\.spec\.(?:[cm]?[jt]sx?)$/u;
// Keep shared guard assertion locations without exposing arbitrary helper paths or errors.
const allowedHelperPaths = new Set(["tests/e2e/helpers/direct-url-guard.ts",
  "tests/subscription-recovery/native-subscription-recovery.browser.ts",
  "tests/subscription-recovery/native-buyer-recovery.browser.ts",
  "tests/tracking/native-tracking-settings.browser.ts"]);
const fixedStatuses = new Set(["failed", "timedout", "flaky"]);
// Fixed WCAG rule IDs from the installed axe inventory. New/unknown rules are
// reported as "unknown"; selectors, HTML and arbitrary error text stay private.
const allowedAxeRuleIds = new Set([
  "area-alt", "aria-allowed-attr", "aria-braille-equivalent", "aria-command-name", "aria-conditional-attr",
  "aria-deprecated-role", "aria-hidden-body", "aria-hidden-focus", "aria-input-field-name", "aria-meter-name",
  "aria-progressbar-name", "aria-prohibited-attr", "aria-required-attr", "aria-required-children", "aria-required-parent",
  "aria-roledescription", "aria-roles", "aria-tab-name", "aria-toggle-field-name", "aria-tooltip-name",
  "aria-valid-attr", "aria-valid-attr-value", "audio-caption", "autocomplete-valid", "avoid-inline-spacing", "blink",
  "button-name", "bypass", "color-contrast", "css-orientation-lock", "definition-list", "dlitem", "document-title",
  "duplicate-id-aria", "form-field-multiple-labels", "frame-focusable-content", "frame-title", "frame-title-unique",
  "html-has-lang", "html-lang-valid", "html-xml-lang-mismatch", "image-alt", "input-button-name", "input-image-alt",
  "label", "label-content-name-mismatch", "link-in-text-block", "link-name", "list", "listitem", "marquee",
  "meta-refresh", "meta-viewport", "nested-interactive", "no-autoplay-audio", "object-alt", "p-as-heading",
  "role-img-alt", "scrollable-region-focusable", "select-name", "server-side-image-map", "summary-name", "svg-img-alt",
  "table-fake-caption", "target-size", "td-has-header", "td-headers-attr", "th-has-data-cells", "valid-lang", "video-caption",
  "unknown",
]);

type AnnotationStatus = "failed" | "timedout" | "flaky";

function sanitizedTestPath(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return null;
  const relative = path.relative(process.cwd(), path.resolve(value)).split(path.sep).join("/");
  return allowedTestPath.test(relative) || allowedHelperPaths.has(relative) ? relative : null;
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

// Only the synthetic checkout test's closed diagnostic grammar is accepted.
// Never forward arbitrary exception text, URLs, identifiers, or payloads.
export function classifySyntheticCheckoutError(value: unknown) {
  if (typeof value !== "string") return null;
  if (value === "G748:COOKIE:MISSING") return "checkout_cookie_missing";
  const match = /^G748:([1-5][0-9]{2}):([APISU]):T([0-9]{1,3})O([0-9]{1,3})S([0-9]{1,3})G([0-9]{1,3})$/u.exec(value);
  return match ? `checkout_http_${match[1]} branch=${match[2]} transactions=${match[3]} orders=${match[4]} snapshots=${match[5]} grants=${match[6]}` : null;
}

/**
 * Optional, test-authored context for an axe failure. `at` is the spec's fixed
 * ASCII scan-point id (never page text); each node is reduced to its tag, the
 * plain utility class names on it and, for color-contrast, the measured
 * colours. Selectors, attribute values, ids, HTML and text are never kept.
 */
export type AxeBlockingContext = {
  at?: unknown;
  nodes?: ReadonlyArray<{ tag?: unknown; classes?: unknown; fg?: unknown; bg?: unknown; ratio?: unknown }>;
};

const axeScanIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+){0,11}$/u;
const axeNodeTagPattern = /^[a-z][a-z0-9]{0,15}$/u;
// Plain class tokens only: no variant colons, arbitrary-value brackets or slashes.
const axeNodeClassPattern = /^[a-z][a-z0-9-]{0,39}$/u;
const axeHexColorPattern = /^#[0-9a-f]{6}$/u;
const maxAxeNodes = 5;
const maxAxeNodeClasses = 8;

function sanitizedAxeNode(node: { tag?: unknown; classes?: unknown; fg?: unknown; bg?: unknown; ratio?: unknown }) {
  const tag = typeof node.tag === "string" && axeNodeTagPattern.test(node.tag) ? node.tag : "node";
  const classes = Array.isArray(node.classes)
    ? node.classes.filter((name): name is string => typeof name === "string" && axeNodeClassPattern.test(name)).slice(0, maxAxeNodeClasses)
    : [];
  const fg = typeof node.fg === "string" ? node.fg.toLowerCase() : "";
  const bg = typeof node.bg === "string" ? node.bg.toLowerCase() : "";
  const ratio = typeof node.ratio === "number" && Number.isFinite(node.ratio) && node.ratio >= 1 && node.ratio <= 21
    ? node.ratio.toFixed(2)
    : null;
  const colours = axeHexColorPattern.test(fg) && axeHexColorPattern.test(bg) && ratio ? `(fg=${fg},bg=${bg},ratio=${ratio})` : "";
  return `${[tag, ...classes].join(".")}${colours}`;
}

/** Produce one bounded diagnostic without retaining axe selectors, HTML or text. */
export function formatSanitizedAxeBlockingError(violations: ReadonlyArray<{ id: unknown }>, context: AxeBlockingContext = {}) {
  const rules = violations.map(({ id }) => typeof id === "string" && allowedAxeRuleIds.has(id) ? id : "unknown");
  let message = `AXE_BLOCKING:RULES:${[...new Set(rules)].sort().join(",")}`;
  if (typeof context.at === "string" && axeScanIdPattern.test(context.at)) message += `:AT:${context.at}`;
  const nodes = Array.isArray(context.nodes) ? context.nodes.slice(0, maxAxeNodes).map(sanitizedAxeNode) : [];
  if (nodes.length > 0) message += `:NODES:${nodes.join(";")}`;
  return message;
}

const axeNodeGrammar = "[a-z][a-z0-9]{0,15}(?:\\.[a-z][a-z0-9-]{0,39}){0,8}(?:\\(fg=#[0-9a-f]{6},bg=#[0-9a-f]{6},ratio=[0-9]{1,2}\\.[0-9]{2}\\))?";
const axeMessagePattern = new RegExp(
  `^(?:Error: )?AXE_BLOCKING:RULES:([a-z0-9-]+(?:,[a-z0-9-]+)*)(?::AT:([a-z0-9]+(?:-[a-z0-9]+){0,11}))?(?::NODES:(${axeNodeGrammar}(?:;${axeNodeGrammar}){0,${maxAxeNodes - 1}}))?$`,
  "u",
);

/** Accept only complete messages generated from the closed rule vocabulary and node grammar. */
export function classifySanitizedAxeError(value: unknown) {
  if (typeof value !== "string" || value.length > 4096) return null;
  const match = axeMessagePattern.exec(value);
  if (!match) return null;
  const rules = match[1].split(",");
  if (rules.length > allowedAxeRuleIds.size || !rules.every((rule) => allowedAxeRuleIds.has(rule))) return null;
  let classification = `axe_blocking rules=${[...new Set(rules)].sort().join(",")}`;
  if (match[2]) classification += ` at=${match[2]}`;
  if (match[3]) classification += ` nodes=${match[3]}`;
  return classification;
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
  private readonly failedSteps = new WeakMap<TestResult, string>();

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
        // Direct database/explicit throws may not produce a failed Playwright step.
        for (const error of attempt.errors ?? []) {
          // Playwright appends worker teardown diagnostics to message. Only the
          // complete first line is considered; the remainder is never forwarded.
          const inboxMessage = typeof error.message === "string" ? error.message.split("\n", 1)[0] : undefined;
          const classification = classifySyntheticCheckoutError(error.message) ?? classifySanitizedAxeError(error.message) ?? classifyPrivateInboxDiagnostic(inboxMessage) ?? classifyPublicLiveBrowserDiagnostic(inboxMessage);
          const location = error.location;
          if (!classification && !location) continue;
          const errorAnnotation = formatSanitizedPlaywrightAnnotation({
            file: location?.file ?? test.location.file,
            line: location?.line ?? test.location.line,
            status: "failed",
            retry: attempt.retry,
          });
          if (errorAnnotation) this.write(`${errorAnnotation} class=${classification ?? "test_error_location"}\n`);
        }
      }
      const annotation = formatSanitizedPlaywrightAnnotation({
        file: test.location.file,
        line: test.location.line,
        status,
        retry: test.results.length - 1,
      });
      if (!annotation) continue;
      const first = test.results[0];
      const firstStatus = first && ["passed", "failed", "timedOut", "skipped", "interrupted"].includes(first.status) ? first.status : "unknown";
      this.write(`${annotation} first_status=${firstStatus} first_duration_ms=${sanitizedDuration(first?.duration)}\n`);
    }

    const status = result.status === "passed" || result.status === "failed" || result.status === "timedout" || result.status === "interrupted"
      ? result.status
      : "failed";
    this.write(`::notice::playwright status=${status} failed=${failed} timedout=${timedout} flaky=${flaky} global=${this.globalErrors}\n`);
  }
}
