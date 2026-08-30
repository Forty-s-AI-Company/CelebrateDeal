import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  protectCommerceEntitlementAccess,
  revealCommerceEntitlementAccess,
} from "@/lib/commerce-entitlement-access";

const binding = { vendorId: "vendor-1", entitlementId: "entitlement-1", orderItemId: "item-1" };

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "entitlement-access-test-secret-at-least-thirty-two-bytes");
});

afterEach(() => vi.unstubAllEnvs());

describe("commerce entitlement access", () => {
  it("encrypts a purpose-bound capability and exposes only a safe mask", () => {
    const protectedAccess = protectCommerceEntitlementAccess(binding);
    expect(protectedAccess.accessEncryptedEnvelope).toMatch(/^v1\./u);
    expect(protectedAccess.accessMaskedSummary).toContain("安全授權");
    expect(revealCommerceEntitlementAccess(protectedAccess.accessEncryptedEnvelope, binding)).toMatchObject({
      version: 1,
      entitlementId: "entitlement-1",
      orderItemId: "item-1",
    });
    expect(() => revealCommerceEntitlementAccess(protectedAccess.accessEncryptedEnvelope, {
      ...binding,
      vendorId: "another-vendor",
    })).toThrow();
  });
});
