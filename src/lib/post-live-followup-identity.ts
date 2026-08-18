/**
 * Client-safe identity prefix shared by rule editing and server delivery code.
 * Keep this module free of Node-only imports so browser bundles never pull in
 * the hashing implementation from post-live-followup.ts.
 */
export function postLiveFollowupIdempotencyPrefix(ruleId: string) {
  return `post-live-followup/${ruleId}/`;
}
