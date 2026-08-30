export const HARD_BLOCKER_PROVENANCE = Object.freeze([
  "EXTERNAL_PROVIDER",
  "LEGAL_REGULATION",
  "TRACKED_PROJECT_REQUIREMENT",
  "ACCEPTED_SECURITY_DECISION",
  "DIRECT_PRODUCTION_RISK",
]);

export const NON_BLOCKING_PROVENANCE = Object.freeze([
  "AI_TEAM_BEST_PRACTICE",
  "ENTERPRISE_BEST_PRACTICE",
  "AUDIT_PREFERENCE",
  "DEFENSE_IN_DEPTH",
]);

const REQUIRED_BLOCKER_FIELDS = Object.freeze(["source", "reason", "risk_if_missing", "provenance"]);

/**
 * Hard blockers are allowed to stop launch only when their provenance is
 * explicit and the explanation is complete enough for a later owner to audit.
 */
export function validateHardBlocker(blocker) {
  const errors = [];
  for (const field of REQUIRED_BLOCKER_FIELDS) {
    if (typeof blocker?.[field] !== "string" || blocker[field].trim() === "") errors.push(`MISSING:${field}`);
  }
  if (!HARD_BLOCKER_PROVENANCE.includes(blocker?.provenance)) errors.push("PROVENANCE_NOT_RELEASE_CRITICAL");
  return { ok: errors.length === 0, errors };
}

/**
 * Enterprise preference cannot silently become a release blocker. When a
 * requirement lacks release-critical provenance, callers must surface it as a
 * warning and retain the original rationale for the migration record.
 */
export function classifyRequirement(requirement) {
  const provenance = requirement?.provenance;
  const requested = requirement?.classification ?? "WARNING";
  if (requested === "HARD_BLOCKER" && !HARD_BLOCKER_PROVENANCE.includes(provenance)) {
    return {
      classification: "WARNING",
      releaseBlocking: false,
      migrationReason: "Hard blocker downgraded because release-critical provenance is absent.",
    };
  }
  return {
    classification: requested,
    releaseBlocking: requested === "HARD_BLOCKER",
    migrationReason: null,
  };
}

