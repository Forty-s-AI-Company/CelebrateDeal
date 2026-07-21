import { describe, expect, it } from "vitest";
import { BlacklistIdentifierType, normalizeBlacklistIdentifier } from "./blacklist-identifiers";

describe("blacklist identifier normalization", () => {
  it("normalizes email and phone values to the public-route representation", () => {
    expect(normalizeBlacklistIdentifier("email", " Blocked@Example.Test ")).toBe("blocked@example.test");
    expect(normalizeBlacklistIdentifier("phone", " +886 (912) 345-678 ")).toBe("+886912345678");
    expect(normalizeBlacklistIdentifier("ip", "2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
  });

  it("validates the closed identifier-type set and rejects malformed values", () => {
    expect(BlacklistIdentifierType.safeParse("token").success).toBe(false);
    expect(normalizeBlacklistIdentifier("email", "not-an-email")).toBeNull();
    expect(normalizeBlacklistIdentifier("phone", "phone-number")).toBeNull();
    expect(normalizeBlacklistIdentifier("ip", "999.1.1.1")).toBeNull();
    expect(normalizeBlacklistIdentifier("visitor_id", "visitor id with spaces")).toBeNull();
  });
});
