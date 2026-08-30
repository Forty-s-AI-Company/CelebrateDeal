import { describe, expect, it } from "vitest";
import { BlacklistIdentifierType, matchesBlacklistKeyword, normalizeBlacklistIdentifier, normalizeBlacklistKeyword } from "./blacklist-identifiers";

describe("blacklist identifier normalization", () => {
  it("normalizes email and phone values to the public-route representation", () => {
    expect(normalizeBlacklistIdentifier("email", " Blocked@Example.Test ")).toBe("blocked@example.test");
    expect(normalizeBlacklistIdentifier("phone", " +886 (912) 345-678 ")).toBe("+886912345678");
    expect(normalizeBlacklistIdentifier("ip", "2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
  });

  it("validates the closed identifier-type set and rejects malformed values", () => {
    expect(BlacklistIdentifierType.safeParse("keyword").success).toBe(true);
    expect(BlacklistIdentifierType.safeParse("token").success).toBe(false);
    expect(normalizeBlacklistIdentifier("email", "not-an-email")).toBeNull();
    expect(normalizeBlacklistIdentifier("phone", "phone-number")).toBeNull();
    expect(normalizeBlacklistIdentifier("ip", "999.1.1.1")).toBeNull();
    expect(normalizeBlacklistIdentifier("visitor_id", "visitor id with spaces")).toBeNull();
  });

  it("normalizes keywords with NFKC, zero-width removal, casing, and whitespace compression", () => {
    expect(normalizeBlacklistKeyword("  ＦＯＯ　ＢＡＲ\u200B\tBaz\uFEFF  ")).toBe("foo bar baz");
    expect(normalizeBlacklistIdentifier("keyword", "  Buy\u200C  NOW  ")).toBe("buy now");
    expect(normalizeBlacklistKeyword("  foo.*  ")).toBe("foo.*");
  });

  it("enforces the keyword length boundary after normalization", () => {
    expect(normalizeBlacklistKeyword("a".repeat(80))).toHaveLength(80);
    expect(normalizeBlacklistKeyword("a".repeat(81))).toBeNull();
    expect(normalizeBlacklistKeyword("\u200B \uFEFF ")).toBeNull();
  });

  it("matches only literal normalized keyword substrings", () => {
    expect(matchesBlacklistKeyword("Limited offer: FＯＯ\u200B.* now", " foo.* ")).toBe(true);
    expect(matchesBlacklistKeyword("fooZZ", "foo.*")).toBe(false);
    expect(matchesBlacklistKeyword("BUY\u200C　NOW", "buy now")).toBe(true);
    expect(matchesBlacklistKeyword("anything", "")).toBe(false);
    expect(matchesBlacklistKeyword("anything", "a".repeat(81))).toBe(false);
  });
});
