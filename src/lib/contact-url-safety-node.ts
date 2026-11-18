import { isIP } from "node:net";

import { normalizeContactHost, isUnsafeContactHost, parseSafeContactUrl, type ContactHostKind } from "@/lib/contact-url-rules";

/**
 * Server contact URL check: the shared rules in `contact-url-rules.ts` with IP
 * literals detected by `node:net`. Application code imports it through
 * `contact-url-safety.ts` (`server-only`). This module carries no
 * `server-only` import because `email-delivery-pii.ts` uses it and is also
 * loaded by plain Node harnesses (Playwright specs, tsx fixtures) where the
 * `server-only` package cannot be resolved; `node:net` already keeps it out
 * of client bundles.
 */
function detectContactHostKind(host: string): ContactHostKind {
  const version = isIP(host);
  if (version === 4) return "ipv4";
  if (version === 6) return "ipv6";
  return "name";
}

export function isUnsafeContactHostname(hostname: string) {
  const host = normalizeContactHost(hostname);
  return isUnsafeContactHost(host, detectContactHostKind(host));
}

export function parseSafeBrandContactUrl(value: string | null | undefined) {
  return parseSafeContactUrl(value, detectContactHostKind);
}
