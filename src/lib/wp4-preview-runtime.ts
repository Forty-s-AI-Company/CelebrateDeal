import { timingSafeEqual } from "node:crypto";

export const WP4_SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/i;

/**
 * Resolve the server-owned source identity for an exact Preview deployment.
 * Vercel's system SHA is preferred; an explicitly bound public commit SHA is
 * accepted only when the system value is absent. Conflicting values fail closed.
 */
export function resolveWp4ExpectedSourceSha() {
  const systemSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const boundSha = process.env.WP4_EXPECTED_SOURCE_SHA?.trim();
  if (systemSha && !WP4_SOURCE_SHA_PATTERN.test(systemSha)) return null;
  if (boundSha && !WP4_SOURCE_SHA_PATTERN.test(boundSha)) return null;
  if (systemSha && boundSha && systemSha !== boundSha) return null;
  return systemSha ?? boundSha ?? null;
}

export function wp4SourceMatchesRequest(request: Request, expectedSha: string) {
  const sourceSha = request.headers.get("x-celebratedeal-source-sha");
  if (!sourceSha || !WP4_SOURCE_SHA_PATTERN.test(sourceSha)) return false;
  const source = Buffer.from(sourceSha);
  const expected = Buffer.from(expectedSha);
  return source.length === expected.length && timingSafeEqual(source, expected);
}

