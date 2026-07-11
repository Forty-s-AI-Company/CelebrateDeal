import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_WINDOW_SECONDS,
  attributionPolicyVersion,
  normalizeAttributionPolicy,
  normalizeAttributionWindowDays,
  signAttributionToken,
  verifyAttributionToken,
} from "@/lib/attribution";

const secret = "test-attribution-secret-123456";
const input = { vendorId: "vendor-a", clickId: "click-a", affiliateId: "affiliate-a" };

describe("signed attribution token", () => {
  it("round trips a valid vendor-scoped attribution", () => {
    const token = signAttributionToken(input, { secret, now: 1000 });
    expect(verifyAttributionToken(token, input.vendorId, { secret, now: 1001 })).toMatchObject(input);
  });

  it("rejects tampering and cross-vendor replay", () => {
    const token = signAttributionToken(input, { secret, now: 1000 });
    expect(verifyAttributionToken(`${token}x`, input.vendorId, { secret, now: 1001 })).toBeNull();
    expect(verifyAttributionToken(token, "vendor-b", { secret, now: 1001 })).toBeNull();
  });

  it("rejects an expired attribution", () => {
    const token = signAttributionToken(input, { secret, now: 1000 });
    expect(verifyAttributionToken(token, input.vendorId, { secret, now: 1000 + ATTRIBUTION_WINDOW_SECONDS })).toBeNull();
  });

  it("normalizes supported policy settings and bounds the attribution window", () => {
    expect(normalizeAttributionPolicy("first_touch")).toBe("first_touch");
    expect(normalizeAttributionPolicy("unknown")).toBe("last_touch");
    expect(normalizeAttributionWindowDays(0)).toBe(1);
    expect(normalizeAttributionWindowDays(120)).toBe(90);
    expect(attributionPolicyVersion("first_touch", 14)).toBe("first-touch-14d-v1");
  });
});
