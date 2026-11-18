/**
 * Brand contact URL rules (#655 review): one rule set for the server check
 * (`contact-url-safety-node.ts`, which detects IP literals with `node:net`)
 * and the brand settings preview in the browser (`parseSafeContactUrlInBrowser`
 * below). Both run the shared case table in `contact-url-safety.cases.ts`.
 *
 * This file must stay importable in the browser: no Node built-ins and no
 * `server-only`.
 *
 * A contact URL is accepted only when it is https, carries no credentials and
 * its host is not localhost, a private or special IPv4 address (0/8, 10/8,
 * 127/8, 169.254/16, 172.16/12, 192.168/16), or an IPv6 unspecified, loopback,
 * unique-local (fc00::/7), link-local (fe80::/10) or IPv4-mapped private
 * address. The host is always read from `new URL(...).hostname`, which already
 * rewrites IPv4 shorthand (`127.1`, `2130706433`, `0x7f.0.0.1`) to dotted
 * decimal and IPv6 to its compressed hex form.
 */

export type ContactHostKind = "ipv4" | "ipv6" | "name";

/** Lowercase, without IPv6 brackets or trailing dots. */
export function normalizeContactHost(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.+$/u, "");
}

function isPrivateOrSpecialIpv4(value: string) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first = Number.NaN, second = Number.NaN] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

/** Eight 16-bit segments, or null when the text is not a usable IPv6 address. */
function parseIpv6Segments(value: string) {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => half ? half.split(":") : [];
  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  const rawSegments = [...left, ...right];
  if (rawSegments.some((segment) => segment === "")) return null;

  const segments = rawSegments.flatMap((segment, index) => {
    if (!segment.includes(".")) return [/^[0-9a-f]{1,4}$/iu.test(segment) ? Number.parseInt(segment, 16) : Number.NaN];
    // An embedded dotted IPv4 must be the last part and must itself be public.
    if (index !== rawSegments.length - 1 || isPrivateOrSpecialIpv4(segment)) return [Number.NaN, Number.NaN];
    const octets = segment.split(".").map(Number);
    const [
      firstOctet = Number.NaN,
      secondOctet = Number.NaN,
      thirdOctet = Number.NaN,
      fourthOctet = Number.NaN,
    ] = octets;
    return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
      ? [(firstOctet << 8) | secondOctet, (thirdOctet << 8) | fourthOctet]
      : [Number.NaN, Number.NaN];
  });
  const zeroCount = halves.length === 2 ? 8 - segments.length : 0;
  if (zeroCount < (halves.length === 2 ? 1 : 0) || segments.length + zeroCount !== 8) return null;
  const expanded = halves.length === 2
    ? [...segments.slice(0, left.length), ...Array.from({ length: zeroCount }, () => 0), ...segments.slice(left.length)]
    : segments;
  return expanded.every((segment) => Number.isInteger(segment) && segment >= 0 && segment <= 0xffff) ? expanded : null;
}

function isUnsafeIpv6(host: string) {
  const segments = parseIpv6Segments(host);
  // Fail closed: an address that looked like IPv6 but cannot be parsed is unsafe.
  if (!segments) return true;
  const [
    firstSegment = Number.NaN,
    secondSegment = Number.NaN,
    thirdSegment = Number.NaN,
    fourthSegment = Number.NaN,
    fifthSegment = Number.NaN,
    sixthSegment = Number.NaN,
    seventhSegment = Number.NaN,
    eighthSegment = Number.NaN,
  ] = segments;
  const isAllZero = segments.every((segment) => segment === 0);
  const isLoopback = !isAllZero && [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment, sixthSegment, seventhSegment].every((segment) => segment === 0) && eighthSegment === 1;
  const isUniqueLocal = (firstSegment & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstSegment & 0xffc0) === 0xfe80;
  const isIpv4Mapped = [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment].every((segment) => segment === 0) && sixthSegment === 0xffff;
  if (!isIpv4Mapped) return isAllZero || isLoopback || isUniqueLocal || isLinkLocal;

  const mappedIpv4 = [seventhSegment >> 8, seventhSegment & 0xff, eighthSegment >> 8, eighthSegment & 0xff].join(".");
  return isPrivateOrSpecialIpv4(mappedIpv4);
}

/** `host` must already be normalized with `normalizeContactHost`. */
export function isUnsafeContactHost(host: string, kind: ContactHostKind) {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (kind === "ipv4") return isPrivateOrSpecialIpv4(host);
  if (kind === "ipv6") return isUnsafeIpv6(host);
  return false;
}

/**
 * Returns the normalized URL, or null when the value is empty, not a URL, not
 * https, carries credentials or points at an unsafe host. `detectHostKind`
 * tells IP literals apart from names; it is the only part that differs
 * between the server and the browser.
 */
export function parseSafeContactUrl(value: string | null | undefined, detectHostKind: (host: string) => ContactHostKind) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = normalizeContactHost(url.hostname);
    if (isUnsafeContactHost(host, detectHostKind(host))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

/**
 * Browser detection without `node:net`. For every hostname `new URL()` can
 * produce it agrees with `node:net` `isIP`: IPv4 hosts are canonical dotted
 * decimal and IPv6 hosts are the only ones that contain ":".
 */
export function detectContactHostKindInBrowser(host: string): ContactHostKind {
  if (IPV4_LITERAL.test(host)) return "ipv4";
  if (host.includes(":")) return "ipv6";
  return "name";
}

/** Client-side check for the brand settings preview; the server re-checks on save. */
export function parseSafeContactUrlInBrowser(value: string | null | undefined) {
  return parseSafeContactUrl(value, detectContactHostKindInBrowser);
}
