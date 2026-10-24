/**
 * The single home for URL / href / src validation. Every check that decides
 * whether a value may become a navigation target, a link or a resource URL
 * goes through one of these helpers; callers must not hand-roll
 * `startsWith("/") && !startsWith("//")` again.
 *
 * Why the naive check is not enough: browsers treat "\" as "/" in http(s)
 * URLs and silently drop tab / CR / LF anywhere in a URL, so "/\evil.example"
 * and "/<TAB>/evil.example" both resolve to the protocol-relative
 * "//evil.example" — another site.
 *
 * Two flavours of internal path:
 * - `safeInternalRedirectPath`: for user-supplied post-action destinations
 *   (`next`, return paths) that end up in a `Location` header. Strictest form:
 *   no "//" anywhere, no whitespace at all, returns the normalized path.
 * - `isSafeInternalPath`: for links and resources authored in page content
 *   (rendered as `href` / `src`, resolved once by the browser). Allows "//"
 *   later in the path or query (e.g. `?ref=https://…`) but never as the
 *   authority, and still rejects backslashes and control characters.
 *
 * This file must stay importable from both server and client code.
 */

const DUMMY_ORIGIN = "https://safe-url.invalid";
export const MAX_SAFE_URL_LENGTH = 2048;

type CodePointRange = readonly [number, number];

// Content links: backslash, C0 controls, DEL + C1 controls, zero-width and
// bidi formatting characters, line / paragraph separators and BOM, as code
// point ranges (invisible characters are unreadable in a regex literal). A
// plain space is allowed: the browser percent-encodes it and it cannot change
// the origin.
const CONTENT_FORBIDDEN: readonly CodePointRange[] = [
  [0x00, 0x1f], [0x5c, 0x5c], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e],
  [0x2060, 0x2069], [0xfeff, 0xfeff],
];

// Redirect targets additionally reject every kind of whitespace.
const REDIRECT_FORBIDDEN: readonly CodePointRange[] = [
  [0x00, 0x20], [0x5c, 0x5c], [0x7f, 0xa0], [0x1680, 0x1680], [0x2000, 0x200f],
  [0x2028, 0x2029], [0x202a, 0x202e], [0x202f, 0x202f], [0x205f, 0x205f], [0x2060, 0x2069],
  [0x3000, 0x3000], [0xfeff, 0xfeff],
];

function containsCodePoint(value: string, ranges: readonly CodePointRange[]) {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (ranges.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

/** True when the value contains a backslash or an invisible / control character. */
export function hasUnsafeUrlCharacter(value: string): boolean {
  return containsCodePoint(value, CONTENT_FORBIDDEN);
}

function parsesSameOrigin(value: string): URL | null {
  try {
    const url = new URL(value, DUMMY_ORIGIN);
    // A normalized "//…" path would become protocol-relative if anything ever
    // re-serializes it into a Location header, so it is rejected as well.
    return url.origin === DUMMY_ORIGIN && !url.pathname.startsWith("//") ? url : null;
  } catch {
    return null;
  }
}

/**
 * A same-origin path for page content: one leading "/", the next character is
 * neither "/" nor "\", no backslash or control character anywhere, and still
 * same-origin after URL parsing. Query and fragment are allowed.
 */
export function isSafeInternalPath(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SAFE_URL_LENGTH) return false;
  if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") return false;
  if (hasUnsafeUrlCharacter(value)) return false;
  return parsesSameOrigin(value) !== null;
}

/**
 * Strict validator for user-supplied post-action destinations (`next` and
 * similar). Only an in-app relative path survives: exactly one leading "/",
 * no "//" anywhere, no backslash, whitespace or control character, and still
 * same-origin after normalization. Returns the normalized path.
 */
export function safeInternalRedirectPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SAFE_URL_LENGTH) return undefined;
  if (!value.startsWith("/") || value.includes("//") || containsCodePoint(value, REDIRECT_FORBIDDEN)) return undefined;
  const url = parsesSameOrigin(value);
  if (!url) return undefined;
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  return normalized.startsWith("/") && !normalized.startsWith("//") ? normalized : undefined;
}

/** An in-page anchor such as `#pricing`. */
export function isSafeFragmentHref(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("#") && value.length <= MAX_SAFE_URL_LENGTH && !hasUnsafeUrlCharacter(value);
}

function parseExternalHttps(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SAFE_URL_LENGTH) return null;
  // Require the literal "https://" followed directly by the host, so parser
  // fix-ups ("https:evil", "https:/evil", "https:///evil") never apply, and no
  // "@" in the authority, which also covers empty credentials ("https://:@evil").
  if (!/^https:\/\/[^/\\@]/iu.test(value) || hasUnsafeUrlCharacter(value)) return null;
  const authority = value.slice("https://".length).split(/[/?#]/u, 1)[0] ?? "";
  if (authority.includes("@")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** An absolute HTTPS URL with a host and without credentials (`https://user@host`). */
export function isSafeExternalHttpsUrl(value: unknown): boolean {
  return parseExternalHttps(value) !== null;
}

/** Canonical form of a safe absolute HTTPS URL, or null. */
export function safeExternalHttpsUrl(value: unknown): string | null {
  return parseExternalHttps(value)?.href ?? null;
}

/** Link targets authored in page content: same-origin path, `#anchor` or HTTPS. */
export function isSafeContentHref(value: unknown): boolean {
  return isSafeInternalPath(value) || isSafeFragmentHref(value) || isSafeExternalHttpsUrl(value);
}

/** Image / media / background sources authored in page content: same-origin path or HTTPS. */
export function isSafeContentAssetUrl(value: unknown): boolean {
  return isSafeInternalPath(value) || isSafeExternalHttpsUrl(value);
}

/**
 * Trimmed content link, or null when unsafe. The value is returned as authored
 * (not re-serialized) so legitimate links render byte-for-byte as before.
 */
export function safeContentHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && isSafeContentHref(trimmed) ? trimmed : null;
}

/** Trimmed content asset URL (no bare `#anchor`), or null when unsafe. */
export function safeContentAssetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && isSafeContentAssetUrl(trimmed) ? trimmed : null;
}

export const UNSAFE_CONTENT_HREF_MESSAGE = "網址只接受 HTTPS 網址、本站路徑（以單一 / 開頭，不可接 / 或 \\）或頁面錨點（#）。";
export const UNSAFE_CONTENT_ASSET_MESSAGE = "網址只接受 HTTPS 網址或本站路徑（以單一 / 開頭，不可接 / 或 \\）。";
