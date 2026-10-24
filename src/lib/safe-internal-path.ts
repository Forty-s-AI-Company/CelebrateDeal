import { safeInternalRedirectPath } from "@/lib/safe-url";

/**
 * Validator for every user-supplied post-action destination (`next` and
 * similar). The rules live in `@/lib/safe-url` (`safeInternalRedirectPath`);
 * this module keeps the established import path for redirect call sites.
 */
export function safeInternalPath(value: unknown): string | undefined {
  return safeInternalRedirectPath(value);
}

export function safeInternalPathOr(value: unknown, fallback: string): string {
  return safeInternalPath(value) ?? fallback;
}
