import { isIP } from "node:net";

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

export function isUnsafeContactHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.+$/u, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateOrSpecialIpv4(host);
  if (ipVersion !== 6) return false;

  const segments = parseIpv6Segments(host);
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
  const isLoopback = isAllZero === false && [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment, sixthSegment, seventhSegment].every((segment) => segment === 0) && eighthSegment === 1;
  const isUniqueLocal = (firstSegment & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstSegment & 0xffc0) === 0xfe80;
  const isIpv4Mapped = [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment].every((segment) => segment === 0) && sixthSegment === 0xffff;
  if (!isIpv4Mapped) return isAllZero || isLoopback || isUniqueLocal || isLinkLocal;

  const mappedIpv4 = [seventhSegment >> 8, seventhSegment & 0xff, eighthSegment >> 8, eighthSegment & 0xff].join(".");
  return isPrivateOrSpecialIpv4(mappedIpv4);
}

export function parseSafeBrandContactUrl(value: string | null) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || isUnsafeContactHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
