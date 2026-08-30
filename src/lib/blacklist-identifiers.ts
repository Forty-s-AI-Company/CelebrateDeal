import { isIP } from "node:net";
import { z } from "zod";

export const BlacklistIdentifierType = z.enum(["email", "phone", "ip", "visitor_id", "keyword"]);
export type BlacklistIdentifierTypeValue = z.infer<typeof BlacklistIdentifierType>;

const emailAddress = z.string().email().max(320);
const visitorId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const zeroWidthCharacters = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Normalize a vendor keyword for literal, case-insensitive substring matching. */
export function normalizeBlacklistKeyword(input: string) {
  const normalized = input
    .normalize("NFKC")
    .replace(zeroWidthCharacters, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");

  return normalized.length > 0 && Array.from(normalized).length <= 80 ? normalized : null;
}

/** Match a message against a valid keyword as a normalized literal substring. */
export function matchesBlacklistKeyword(message: string, keyword: string) {
  const normalizedMessage = normalizeBlacklistKeyword(message);
  const normalizedKeyword = normalizeBlacklistKeyword(keyword);
  return normalizedMessage !== null && normalizedKeyword !== null && normalizedMessage.includes(normalizedKeyword);
}

/** Keep stored blacklist values in the same representation used by public routes. */
export function normalizeBlacklistIdentifier(type: BlacklistIdentifierTypeValue, input: string) {
  const value = input.trim();
  if (type === "email") {
    const normalized = value.toLowerCase();
    return emailAddress.safeParse(normalized).success ? normalized : null;
  }
  if (type === "phone") {
    const normalized = value.replace(/[\s().-]/g, "");
    return /^\+?[0-9]{8,20}$/.test(normalized) ? normalized : null;
  }
  if (type === "ip") {
    const version = isIP(value);
    if (version === 4) return value;
    // URL parsing gives equivalent IPv6 spellings one canonical compressed form.
    if (version === 6) return new URL(`http://[${value}]/`).hostname.slice(1, -1);
    return null;
  }
  if (type === "keyword") return normalizeBlacklistKeyword(input);
  return visitorId.safeParse(value).success ? value : null;
}
