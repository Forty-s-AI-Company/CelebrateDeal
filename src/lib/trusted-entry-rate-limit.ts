import { NextResponse } from "next/server";
import { checkRateLimit as checkLegacyRateLimit } from "./rate-limit";
import { entryIpTrustConfig, getEntryClientIp, nativeBucketIdentity, type EntryIpTrustConfig } from "./entry-client-ip";
export { entryIpTrustConfig } from "./entry-client-ip";
import { rateLimitRequestWithIdentity } from "./live-chat-request-security";

/** Only WP11 callers opt in. Keep the original body untouched for redemption. */
export async function checkRateLimit(
  request: Request, key: string, limit: number, windowMs: number,
  config: EntryIpTrustConfig = entryIpTrustConfig(),
) {
  const native = config.trustMode === "vercel-native";
  // No fallback: direct Vercel traffic cannot rely on Cloudflare WAF or per-instance memory.
  const resolvedIp = getEntryClientIp(request, config);
  const ip = native ? nativeBucketIdentity(resolvedIp) : resolvedIp;
  if (!ip) {
    return NextResponse.json({ error: "Request source unavailable" }, {
      status: 503,
      headers: { "Retry-After": "30", "Cache-Control": "no-store" },
    });
  }
  return checkLegacyRateLimit(rateLimitRequestWithIdentity(request, ip), native ? `entry-vercel-native:${key}` : key, limit, windowMs);
}
