import { getCanonicalAppUrl } from "@/lib/app-url";

/** Builds the canonical public viewer URL without accepting a request Host. */
export function createLiveViewerUrl(liveSlug: string, env: NodeJS.ProcessEnv = process.env) {
  const slug = liveSlug.trim();
  if (!slug) throw new Error("Live slug is required for a viewer URL.");
  return new URL(`/live/${encodeURIComponent(slug)}`, getCanonicalAppUrl(env)).toString();
}
