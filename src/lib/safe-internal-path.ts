/**
 * Single validator for every user-supplied post-action destination (`next`
 * and similar). Only an in-app relative path survives:
 *
 * - starts with exactly one "/" and contains no "//" anywhere,
 * - no backslash, whitespace or control character (the WHATWG URL parser
 *   silently drops tab/newline, so "/<TAB>/evil.example" would otherwise
 *   become "//evil.example"),
 * - still same-origin after URL normalization.
 *
 * Anything else, including "javascript:" and absolute URLs, is rejected.
 */
const BASE = "https://internal-path.invalid";
const MAX_LENGTH = 2048;
// Backslash, C0/C1 controls, space, NBSP and the Unicode spaces / line
// separators / BOM, built from code points to keep this file ASCII-only.
const FORBIDDEN_CODE_POINTS: Array<[number, number]> = [
  [0x00, 0x20], [0x5c, 0x5c], [0x7f, 0xa0], [0x1680, 0x1680], [0x2000, 0x200f],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff],
];
function hasForbiddenCharacter(value: string) {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (FORBIDDEN_CODE_POINTS.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

export function safeInternalPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return undefined;
  if (!value.startsWith("/") || value.includes("//") || hasForbiddenCharacter(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return undefined;
  }
  if (url.origin !== BASE) return undefined;
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  return normalized.startsWith("/") && !normalized.startsWith("//") ? normalized : undefined;
}

export function safeInternalPathOr(value: unknown, fallback: string): string {
  return safeInternalPath(value) ?? fallback;
}
