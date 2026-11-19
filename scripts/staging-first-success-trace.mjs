/**
 * Failure diagnostics for the staging first-success runner (A3-05).
 *
 * Wraps a Playwright page (and every locator derived from it) so each browser action records its step,
 * action name, sanitized target, duration and the sanitized current page. Only failed actions and a short
 * ring of recent actions are kept. This never changes a timeout or a verdict: the wrapped call is awaited
 * unchanged and its error is rethrown untouched.
 *
 * Output is de-identified like the receipt: no fill values, no query strings or hash, no email, id, slug,
 * token or page text. Selectors are the code's own fixed locators with run markers redacted.
 */
const MAIN_ACTIONS = new Set(["goto", "waitForURL", "click", "fill", "check", "selectOption", "waitFor"]);
/** Polling helpers: kept only when they fail, so a 40-try loop does not flood the recent-action ring. */
const PROBE_ACTIONS = new Set(["evaluate", "inputValue", "getAttribute", "isEnabled", "isChecked", "count"]);
const LOCATOR_FACTORIES = new Set([
  "locator", "getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByAltText", "getByTitle",
  "first", "last", "nth", "filter", "and", "or",
]);
const MAX_FAILURES = 30;
const MAX_RECENT = 8;
const MAX_TARGET = 160;

/** Replace anything run-specific or personal in a selector or URL fragment. */
export function sanitizeTarget(value) {
  return String(value ?? "")
    .replace(/[^\s'"]+@[^\s'"]+/gu, "<email>")
    .replace(/CDFS [0-9a-f]{8}/giu, "CDFS <run>")
    .replace(/cdfs-[a-z]+-[0-9a-z]+/giu, "<slug>")
    .replace(/\b[0-9a-f]{10,}\b/giu, "<hex>")
    .replace(/\b[A-Za-z0-9._~-]{24,}\b/gu, "<token>")
    .replace(/\s+/gu, " ")
    .slice(0, MAX_TARGET);
}

/** Origin-less path with ids and slugs masked; no query string and no hash. */
export function sanitizeUrl(value) {
  let url;
  try { url = new URL(value, "https://placeholder.invalid"); } catch { return "<invalid-url>"; }
  const segments = url.pathname.split("/").map((segment, index, all) => {
    if (segment === "") return segment;
    if ((all[1] === "form" || all[1] === "live") && index === 2) return ":slug";
    return /^[a-z0-9]{16,}$/u.test(segment) ? ":id" : sanitizeTarget(segment);
  });
  const path = segments.join("/") || "/";
  const hasQuery = url.search !== "";
  return `${path}${hasQuery ? "?<query>" : ""}`;
}

function errorKind(error) {
  if (error?.name === "TimeoutError" || /\bTimeout\b/u.test(String(error?.message ?? "").slice(0, 80))) return "TIMEOUT";
  if (error?.name === "ConditionNotMet") return "CONDITION_NOT_MET";
  return "ERROR";
}

function describeLocator(locator) {
  try { return sanitizeTarget(typeof locator?.toString === "function" ? locator.toString() : "locator"); } catch { return "locator"; }
}

/**
 * @param {{ now?: () => number }} options
 */
export function createActionTrace({ now = () => Date.now() } = {}) {
  let stepName = "UNKNOWN";
  const currentStep = () => stepName;
  const failures = [];
  const recent = [];
  let actions = 0;
  let droppedFailures = 0;
  let page = null;

  const pageUrl = () => { try { return page ? sanitizeUrl(page.url()) : "<no-page>"; } catch { return "<unreadable>"; } };

  function record(action, target, startedAt, error) {
    actions += 1;
    const entry = {
      step: currentStep(), action, target, durationMs: Math.max(0, now() - startedAt),
      outcome: error ? "FAIL" : "OK", pageUrl: pageUrl(),
    };
    if (error) {
      entry.errorKind = errorKind(error);
      if (failures.length < MAX_FAILURES) failures.push(entry); else droppedFailures += 1;
    }
    if (error || MAIN_ACTIONS.has(action)) {
      recent.push(entry);
      if (recent.length > MAX_RECENT) recent.shift();
    }
  }

  function wrap(target, kind, describe) {
    return new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property, object);
        if (typeof value !== "function" || typeof property !== "string") return value;
        if (kind === "locator" && LOCATOR_FACTORIES.has(property)) return (...args) => wrap(value.apply(object, args), "locator", describeLocator);
        if (kind === "page" && ["locator", "getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByAltText", "getByTitle"].includes(property)) {
          return (...args) => wrap(value.apply(object, args), "locator", describeLocator);
        }
        if (MAIN_ACTIONS.has(property) || PROBE_ACTIONS.has(property)) {
          return async (...args) => {
            const startedAt = now();
            const label = property === "goto" ? sanitizeUrl(args[0]) : property === "waitForURL" ? "<url-predicate>" : describe(object);
            try {
              const outcome = await value.apply(object, args);
              record(property, label, startedAt, null);
              return outcome;
            } catch (error) {
              record(property, label, startedAt, error);
              throw error;
            }
          };
        }
        return value.bind(object);
      },
    });
  }

  return {
    /** The runner names the fixed journey step before running it. */
    setStep(name) { stepName = name; },
    /** Returns a page whose actions are recorded; use it in place of the original page. */
    instrumentPage(original) {
      page = original;
      return wrap(original, "page", () => "page");
    },
    /** Diagnostics for the artifact: de-identified, bounded, no verdict of its own. */
    summary(receipt) {
      const failedStep = receipt?.failureStep && receipt.failureStep !== "NONE" ? receipt.failureStep : null;
      const failedAction = failedStep ? [...failures].reverse().find((entry) => entry.step === failedStep) ?? null : null;
      return {
        schemaVersion: "celebratedeal-staging-first-success-trace/v1",
        result: receipt?.result ?? "UNKNOWN",
        failureStep: receipt?.failureStep ?? "NONE",
        failureCategory: receipt?.failureCategory ?? "NONE",
        failedAction,
        actions,
        failures: [...failures],
        droppedFailures,
        recentActions: [...recent],
      };
    },
  };
}

/** One grep-able line for the job log. */
export function formatTraceLine(summary) {
  const failed = summary.failedAction;
  if (!failed) return `staging_first_success_failed_action=NONE failures=${summary.failures.length} actions=${summary.actions}`;
  return `staging_first_success_failed_action=${failed.step}/${failed.action}/${failed.errorKind}/${failed.durationMs}ms target=${JSON.stringify(failed.target)} page=${JSON.stringify(failed.pageUrl)}`;
}
