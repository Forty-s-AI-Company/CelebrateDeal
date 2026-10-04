/** Keep MFA return navigation on this application, including after URL normalization. */
export function safeMfaReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return undefined;
  if (/[\\\u0000-\u0020\u007f]/u.test(value)) return undefined;
  try {
    const base = "https://mfa-return.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

/** Add a validated return path without replacing an existing status query. */
export function withMfaReturnPath(destination: string, value: unknown): string {
  const next = safeMfaReturnPath(value);
  if (!next) return destination;
  const url = new URL(destination, "https://mfa-return.invalid");
  url.searchParams.set("next", next);
  return `${url.pathname}${url.search}${url.hash}`;
}
