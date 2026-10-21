import { safeInternalPath } from "@/lib/safe-internal-path";

/** Keep MFA return navigation on this application (shared validator, see safe-internal-path). */
export function safeMfaReturnPath(value: unknown): string | undefined {
  return safeInternalPath(value);
}

/** Add a validated return path without replacing an existing status query. */
export function withMfaReturnPath(destination: string, value: unknown): string {
  const next = safeMfaReturnPath(value);
  if (!next) return destination;
  const url = new URL(destination, "https://mfa-return.invalid");
  url.searchParams.set("next", next);
  return `${url.pathname}${url.search}${url.hash}`;
}
