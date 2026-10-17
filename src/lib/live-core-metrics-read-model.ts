import { evaluatePostCompletionOrder, POST_COMPLETION_ORDER_WINDOW_MS } from "./live-metric-contract";
import { firstCompletionTime } from "./live-viewing-evidence";

// A normal 100-viewer, one-hour event at five-second samples has 72,000
// distinct rows. Keep that supported; duplicates never consume this budget.
export const MAX_REPORT_COMPLETION_SEGMENTS = 1000000;

/** Pure reporting contract. The persistence adapter must provide complete,
 * verified facts for one tenant/live/content version and viewing mode.
 * null means unknown history; [] means an audited, complete empty history.
 * IDs are opaque internal references, never email addresses or session counts.
 */
export type MetricScope = Readonly<{
  vendorId: string;
  liveId: string;
  contentVersionId: string;
  mode: "live" | "replay";
}>;
type Scoped = Readonly<{ scope: MetricScope }>;
export type VisitFact = Scoped & Readonly<{ browserId: string; visitedAtMs: number }>;
export type RegistrationFact = Scoped & Readonly<{
  personId: string; browserId: string | null; verifiedAtMs: number;
}>;
/** Each segment has a constant playback rate; seek/pause/buffering split it.
 * Wall timestamps are validated by ingestion, not taken on trust from clients.
 */
export type ViewingFact = Scoped & Readonly<{
  personId: string;
  wallStartMs: number; wallEndMs: number;
  mediaStartMs: number; mediaEndMs: number;
}>;
/** Durable first crossing uses verified-eligible exposure only. A crossing
 * before verification contradicts this contract and invalidates the batch. */
export type CompletionFact = Scoped & Readonly<{ personId: string; firstCompletedAtMs: number }>;
/** Rows are current order snapshots from a read transaction, never historical
 * order events; the adapter must omit stale pre-cancellation states. */
export type OrderFact = Scoped & Readonly<{
  personId: string; establishedAtMs: number; cancelled: boolean;
}>;
export type CoreMetricsInput = Readonly<{
  scope: MetricScope;
  startMs: number; endMs: number; durationMs: number | null;
  visits: readonly VisitFact[] | null;
  registrations: readonly RegistrationFact[] | null;
  viewing: readonly ViewingFact[] | null;
  completions: readonly CompletionFact[] | null;
  orders: readonly OrderFact[] | null;
}>;
export type MetricValue =
  | { status: "unavailable"; reason: "missing_data" | "invalid_data" | "limit_exceeded" }
  | { status: "not_applicable"; reason: "zero_denominator" }
  | { status: "available"; value: number; numerator: number; denominator: number; unit: "percent" | "seconds" };
export type CoreMetrics = {
  registrationRate: MetricValue;
  attendanceRate: MetricValue;
  completionRate: MetricValue;
  averageViewingSeconds: MetricValue;
  postCompletionOrderRate: MetricValue;
  unattributedRegistrations: number | null;
  provisionalConversions: boolean | null;
};

const missing = (): MetricValue => ({ status: "unavailable", reason: "missing_data" });
const invalid = (): MetricValue => ({ status: "unavailable", reason: "invalid_data" });
const timestamp = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const id = (value: string) => typeof value === "string" && value.length > 0;
const scopeValid = (scope: MetricScope) => scope && id(scope.vendorId) && id(scope.liveId) && id(scope.contentVersionId) && (scope.mode === "live" || scope.mode === "replay");
const sameScope = (a: MetricScope, b: MetricScope) => scopeValid(a) && a.vendorId === b.vendorId && a.liveId === b.liveId && a.contentVersionId === b.contentVersionId && a.mode === b.mode;

function ratio(numerator: number, denominator: number, unit: "percent" | "seconds" = "percent"): MetricValue {
  if (!denominator) return { status: "not_applicable", reason: "zero_denominator" };
  const value = numerator / denominator * (unit === "percent" ? 100 : 1);
  return Number.isFinite(value) ? { status: "available", value, numerator, denominator, unit } : invalid();
}

/** Union actual exposure time across sessions/devices. Never fill gaps. */
function unionLength(intervals: readonly (readonly [number, number])[]): number {
  let end = 0;
  let total = 0;
  for (const [start, nextEnd] of [...intervals].sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, nextEnd - Math.max(end, start));
    end = Math.max(end, nextEnd);
  }
  return total;
}

class InvalidMetricFacts extends Error {}
const requireFact = (condition: unknown) => { if (!condition) throw new InvalidMetricFacts(); };
type Cohort = Map<string, RegistrationFact>;

function validateScopeAndWindow(input: CoreMetricsInput) {
  requireFact(input && scopeValid(input.scope) && timestamp(input.startMs) && timestamp(input.endMs) && input.startMs < input.endMs);
  // Fail closed on mixed scopes; silently dropping rows would change denominators.
  for (const rows of [input.visits, input.registrations, input.viewing, input.completions, input.orders]) {
    requireFact(rows === null || (Array.isArray(rows) && Array.from(rows).every((row) => row && sameScope(row.scope, input.scope))));
  }
}

function buildCohort(input: CoreMetricsInput): Cohort {
  const registrations: Cohort = new Map();
  for (const row of input.registrations!) {
    requireFact(id(row.personId) && timestamp(row.verifiedAtMs) && (row.browserId === null || id(row.browserId)));
    const previous = registrations.get(row.personId);
    requireFact(!previous || (previous.verifiedAtMs === row.verifiedAtMs && previous.browserId === row.browserId));
    registrations.set(row.personId, row);
  }
  return new Map([...registrations].filter(([, row]) => row.verifiedAtMs >= input.startMs && row.verifiedAtMs < input.endMs));
}

function registrationMetrics(input: CoreMetricsInput, cohort: Cohort, result: CoreMetrics) {
  if (input.visits === null) return;
  const visits = new Map<string, number>();
  for (const row of input.visits) {
    requireFact(id(row.browserId) && timestamp(row.visitedAtMs));
    if (row.visitedAtMs >= input.startMs && row.visitedAtMs < input.endMs) visits.set(row.browserId, Math.min(visits.get(row.browserId) ?? Infinity, row.visitedAtMs));
  }
  const converted = new Set<string>();
  let unattributed = 0;
  for (const row of cohort.values()) {
    const visit = row.browserId === null ? undefined : visits.get(row.browserId);
    if (visit !== undefined && row.verifiedAtMs >= visit) converted.add(row.browserId!);
    else unattributed++;
  }
  result.registrationRate = ratio(converted.size, visits.size);
  result.unattributedRegistrations = unattributed;
}

function collectSegments(input: CoreMetricsInput, cohort: Cohort): Map<string, ViewingFact[]> {
  const segments = new Map<string, ViewingFact[]>();
  for (const row of input.viewing!) {
    requireFact(id(row.personId) && timestamp(row.wallStartMs) && timestamp(row.wallEndMs) && row.wallEndMs > row.wallStartMs);
    requireFact(Number.isSafeInteger(row.mediaStartMs) && Number.isSafeInteger(row.mediaEndMs) && row.mediaStartMs >= 0 && row.mediaEndMs > row.mediaStartMs);
    if (input.durationMs !== null && input.durationMs > 0) requireFact(row.mediaEndMs <= input.durationMs);
    const registration = cohort.get(row.personId);
    if (!registration || row.wallEndMs <= registration.verifiedAtMs || row.wallStartMs >= input.endMs) continue;
    const rows = segments.get(row.personId) ?? [];
    rows.push(row);
    segments.set(row.personId, rows);
  }
  // Deduplicate each person's references in place instead of retaining a second
  // string representation of every interval across the whole report.
  const compare = (a: ViewingFact, b: ViewingFact) => a.wallStartMs - b.wallStartMs
    || a.wallEndMs - b.wallEndMs || a.mediaStartMs - b.mediaStartMs || a.mediaEndMs - b.mediaEndMs;
  for (const rows of segments.values()) {
    rows.sort(compare);
    let retained = 0;
    for (const row of rows) {
      if (retained === 0 || compare(rows[retained - 1], row) !== 0) rows[retained++] = row;
    }
    rows.length = retained;
  }
  return segments;
}

function viewingMetrics(input: CoreMetricsInput, cohort: Cohort, result: CoreMetrics): Map<string, number> {
  const segments = collectSegments(input, cohort);
  const completed = new Map<string, number>();
  let completionLimit = [...segments.values()].reduce((count, rows) => count + rows.length, 0) > MAX_REPORT_COMPLETION_SEGMENTS;
  let wallMs = 0;
  for (const [person, rows] of segments) {
    const verifiedAt = cohort.get(person)!.verifiedAtMs;
    wallMs += unionLength(rows.map((row) => [Math.max(row.wallStartMs, verifiedAt, input.startMs), Math.min(row.wallEndMs, input.endMs)] as const));
    if (input.durationMs === null || completionLimit) continue;
    const completion = firstCompletionTime(input.durationMs, rows, { startMs: Math.max(verifiedAt, input.startMs), endMs: input.endMs - 1 });
    if (completion.status === "unavailable" && completion.reason === "limit_exceeded") {
      completionLimit = true;
      continue;
    }
    requireFact(completion.status === "available");
    if (completion.status === "available" && completion.firstCompletedAtMs !== null) completed.set(person, completion.firstCompletedAtMs);
  }
  result.attendanceRate = ratio(segments.size, cohort.size);
  result.averageViewingSeconds = ratio(wallMs / 1000, segments.size, "seconds");
  result.completionRate = input.durationMs === null ? missing() : completionLimit ? { status: "unavailable", reason: "limit_exceeded" } : ratio(completed.size, segments.size);
  return completed;
}

function orderMetrics(input: CoreMetricsInput, cohort: Cohort, completed: Map<string, number>, result: CoreMetrics) {
  if (result.completionRate.status === "unavailable") {
    result.postCompletionOrderRate = { ...result.completionRate };
    return;
  }
  if (input.completions === null || input.orders === null || input.durationMs === null) return;
  const firstCompletion = new Map<string, number>();
  for (const row of input.completions) {
    requireFact(id(row.personId) && timestamp(row.firstCompletedAtMs));
    const previous = firstCompletion.get(row.personId);
    requireFact(previous === undefined || previous === row.firstCompletedAtMs);
    firstCompletion.set(row.personId, row.firstCompletedAtMs);
  }
  for (const row of input.orders) requireFact(id(row.personId) && timestamp(row.establishedAtMs) && typeof row.cancelled === "boolean");
  // Reconcile durable first-crossing facts with independently derived viewing
  // evidence. [] is known-empty, so a contradiction is invalid, not missing.
  for (const [person, derivedAt] of completed) {
    requireFact(firstCompletion.get(person) === derivedAt);
  }
  for (const [person, at] of firstCompletion) {
    if (!cohort.has(person) || at >= input.endMs) continue;
    requireFact(at >= cohort.get(person)!.verifiedAtMs && completed.get(person) === at);
  }
  const ordered = new Set<string>();
  for (const row of input.orders) {
    if (!completed.has(row.personId) || row.establishedAtMs >= input.endMs) continue;
    const eligibility = evaluatePostCompletionOrder(firstCompletion.get(row.personId)!, row);
    if (eligibility.status === "available" && eligibility.qualifies) ordered.add(row.personId);
  }
  result.postCompletionOrderRate = ratio(ordered.size, completed.size);
  // The last millisecond of the inclusive seven-day window must be observed.
  result.provisionalConversions = [...completed.keys()].some((person) => input.endMs <= firstCompletion.get(person)! + POST_COMPLETION_ORDER_WINDOW_MS);
}

export function calculateCoreMetrics(input: CoreMetricsInput): CoreMetrics {
  const result: CoreMetrics = {
    registrationRate: missing(), attendanceRate: missing(), completionRate: missing(),
    averageViewingSeconds: missing(), postCompletionOrderRate: missing(),
    unattributedRegistrations: null, provisionalConversions: null,
  };
  try {
    validateScopeAndWindow(input);
    if (input.registrations === null) return result;
    const cohort = buildCohort(input);
    registrationMetrics(input, cohort, result);
    if (input.viewing === null) return result;
    requireFact(input.durationMs === null || (Number.isSafeInteger(input.durationMs) && input.durationMs > 0));
    const completed = viewingMetrics(input, cohort, result);
    orderMetrics(input, cohort, completed, result);
    return result;
  } catch (error) {
    if (!(error instanceof InvalidMetricFacts)) throw error;
    return { registrationRate: invalid(), attendanceRate: invalid(), completionRate: invalid(), averageViewingSeconds: invalid(), postCompletionOrderRate: invalid(), unattributedRegistrations: null, provisionalConversions: null };
  }
}


export type CompletionProjectionInput = Pick<CoreMetricsInput, "scope" | "startMs" | "endMs" | "durationMs" | "registrations" | "viewing">;
export type CompletionProjection = { status: "available"; cohortCount: number; rows: CompletionFact[] }
  | { status: "unavailable"; reason: "missing_data" | "invalid_data" | "limit_exceeded" };

/** Worker-only projection candidate. Availability is not durable provenance:
 * the writer must atomically persist rows plus manifest against the unchanged
 * source revision before any report adapter can use these completion facts.
 */
export function calculateCompletionProjection(value: CompletionProjectionInput): CompletionProjection {
  const input: CoreMetricsInput = { ...value, visits: null, completions: null, orders: null };
  try {
    validateScopeAndWindow(input);
    if (input.registrations === null || input.viewing === null || input.durationMs === null)
      return { status: "unavailable", reason: "missing_data" };
    requireFact(Number.isSafeInteger(input.durationMs) && input.durationMs > 0);
    const cohort = buildCohort(input);
    const result: CoreMetrics = { registrationRate: missing(), attendanceRate: missing(), completionRate: missing(),
      averageViewingSeconds: missing(), postCompletionOrderRate: missing(), unattributedRegistrations: null, provisionalConversions: null };
    const completed = viewingMetrics(input, cohort, result);
    if (result.completionRate.status === "unavailable") return result.completionRate;
    return { status: "available", cohortCount: cohort.size,
      rows: [...completed].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([personId, firstCompletedAtMs]) => ({ scope: input.scope, personId, firstCompletedAtMs })) };
  } catch (error) {
    if (!(error instanceof InvalidMetricFacts)) throw error;
    return { status: "unavailable", reason: "invalid_data" };
  }
}
