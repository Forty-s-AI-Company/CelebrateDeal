import type { MetricScope } from "./live-core-metrics-read-model";

export type MetricEvidenceKind = "visits" | "registrations" | "viewing" | "orders";
export type MetricCoverageRange = { scope: MetricScope; kind: MetricEvidenceKind; startMs: number; endMs: number };
export type MetricCoverage = { status: "complete" } | { status: "unavailable";
  reason: "unknown_history" | "uncovered_window" | "evidence_gap" | "invalid_evidence" | "limit_exceeded" };
type Input = MetricCoverageRange & { covered: readonly MetricCoverageRange[] | null; gaps: readonly MetricCoverageRange[] | null };
const timestamp = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 8_640_000_000_000_000;
const scopeValid = (s: MetricScope) => s && [s.vendorId, s.liveId, s.contentVersionId].every(v => typeof v === "string" && v.length > 0 && v.length <= 128)
  && (s.mode === "live" || s.mode === "replay");
const rangeValid = (r: MetricCoverageRange) => r && scopeValid(r.scope) && ["visits", "registrations", "viewing", "orders"].includes(r.kind)
  && timestamp(r.startMs) && timestamp(r.endMs) && r.startMs < r.endMs;

/** Evaluate durable, server-verified coverage evidence, never mere collection
 * enablement or the presence of rows. The adapter must load covered ranges AND
 * known losses in the same snapshot as facts. null means that audit is missing;
 * [] for gaps means an audited empty loss history, not an assumed default.
 * [S,T) gaps touching a boundary outside the requested window do not invalidate it.
 */
export function assessMetricCoverage(input: Input): MetricCoverage {
  if (!rangeValid(input)) return { status: "unavailable", reason: "invalid_evidence" };
  if (input.covered === null || input.gaps === null) return { status: "unavailable", reason: "unknown_history" };
  if (!Array.isArray(input.covered) || !Array.isArray(input.gaps)) return { status: "unavailable", reason: "invalid_evidence" };
  if (input.covered.length + input.gaps.length > 10000) return { status: "unavailable", reason: "limit_exceeded" };
  for (const rows of [input.covered, input.gaps]) for (const row of rows) {
    if (!rangeValid(row) || row.kind !== input.kind || row.scope.vendorId !== input.scope.vendorId
      || row.scope.liveId !== input.scope.liveId || row.scope.contentVersionId !== input.scope.contentVersionId
      || row.scope.mode !== input.scope.mode) return { status: "unavailable", reason: "invalid_evidence" };
  }
  if (input.gaps.some(row => row.startMs < input.endMs && row.endMs > input.startMs)) return { status: "unavailable", reason: "evidence_gap" };
  let end = input.startMs;
  for (const row of [...input.covered].sort((a, b) => a.startMs - b.startMs)) {
    if (row.endMs <= end) continue;
    if (row.startMs > end) break;
    end = row.endMs;
    if (end >= input.endMs) return { status: "complete" };
  }
  return { status: "unavailable", reason: "uncovered_window" };
}
