/**
 * F-156: CSP violation reports, reduced to fields that cannot identify a
 * visitor or carry a secret. Accepted formats:
 * - `application/csp-report` (report-uri): `{ "csp-report": { ... } }`
 * - `application/reports+json` (report-to): `[{ type: "csp-violation", body: { ... } }]`
 *
 * Kept: disposition, the violated directive, the blocked resource reduced to a
 * keyword, scheme or origin, the script source reduced the same way, and the
 * document path without query, fragment or ID-like segments. Never kept: the
 * full URLs, referrer, script sample, original policy, user agent, line numbers.
 */

export type CspViolation = {
  disposition: "enforce" | "report" | "unknown";
  directive: string;
  blocked: string;
  source: string | null;
  documentPath: string;
};

/** Reports beyond this many in one request are ignored. */
export const MAX_CSP_REPORTS_PER_REQUEST = 20;

const KEYWORD = /^[a-z][a-z-]{0,31}$/u;
const DIRECTIVE = /^[a-z][a-z-]{1,39}$/u;
const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length <= 4096 ? value.trim() : null;
}

/** Keyword (`inline`, `eval`, ...), bare scheme (`data`, `blob`, `chrome-extension`) or origin. */
export function reduceResource(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (KEYWORD.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid";
  }
  if (NETWORK_SCHEMES.has(url.protocol)) return url.host ? `${url.protocol}//${url.host}` : url.protocol.slice(0, -1);
  const scheme = url.protocol.slice(0, -1);
  return KEYWORD.test(scheme) ? scheme : "other";
}

/** Path segments that look like identifiers or tokens become `:id`. */
function redactSegment(segment: string): string {
  if (!segment) return segment;
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { return ":id"; }
  if (decoded.length >= 20) return ":id";
  if (/^\d{4,}$/u.test(decoded)) return ":id";
  if (decoded.length >= 8 && /\d/u.test(decoded) && /[A-Za-z]/u.test(decoded) && !decoded.includes("-")) return ":id";
  return /^[A-Za-z0-9._~-]+$/u.test(decoded) ? decoded : ":id";
}

export function reduceDocumentPath(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!NETWORK_SCHEMES.has(url.protocol)) return null;
  const path = url.pathname.split("/").map(redactSegment).join("/");
  return path.length > 200 ? `${path.slice(0, 200)}…` : path;
}

function reduceDirective(value: unknown): string | null {
  const raw = text(value)?.split(/\s+/u)[0]?.toLowerCase();
  return raw && DIRECTIVE.test(raw) ? raw : null;
}

function violationFrom(body: Record<string, unknown>, legacy: boolean): CspViolation | null {
  const pick = (legacyKey: string, modernKey: string) => body[legacy ? legacyKey : modernKey];
  const directive = reduceDirective(pick("effective-directive", "effectiveDirective")) ?? reduceDirective(pick("violated-directive", "violatedDirective"));
  const documentPath = reduceDocumentPath(pick("document-uri", "documentURL"));
  if (!directive || !documentPath) return null;
  const disposition = text(pick("disposition", "disposition"));
  return {
    disposition: disposition === "enforce" || disposition === "report" ? disposition : "unknown",
    directive,
    blocked: reduceResource(pick("blocked-uri", "blockedURL")) ?? "none",
    source: reduceResource(pick("source-file", "sourceFile")),
    documentPath,
  };
}

/** Parses one request body; unknown shapes yield no violations. */
export function parseCspReports(body: string, contentType: string | null): CspViolation[] {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/csp-report" && type !== "application/reports+json" && type !== "application/json") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const legacy = record(record(parsed)?.["csp-report"]);
  if (legacy) {
    const violation = violationFrom(legacy, true);
    return violation ? [violation] : [];
  }
  if (!Array.isArray(parsed)) return [];
  const violations: CspViolation[] = [];
  for (const entry of parsed.slice(0, MAX_CSP_REPORTS_PER_REQUEST)) {
    const report = record(entry);
    const reportBody = record(report?.body);
    if (report?.type !== "csp-violation" || !reportBody) continue;
    const violation = violationFrom(reportBody, false);
    if (violation) violations.push(violation);
  }
  return violations;
}

/** Collapses identical violations in one request into one entry with a count. */
export function aggregateCspViolations(violations: CspViolation[]): Array<CspViolation & { count: number }> {
  const groups = new Map<string, CspViolation & { count: number }>();
  for (const violation of violations) {
    const key = JSON.stringify([violation.disposition, violation.directive, violation.blocked, violation.source, violation.documentPath]);
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { ...violation, count: 1 });
  }
  return [...groups.values()];
}
