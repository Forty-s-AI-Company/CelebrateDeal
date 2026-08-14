import { describe, expect, it, vi } from "vitest";
import type { PaymentMethodSetupSessionResult } from "@/lib/payment-providers/types";
import {
  hasPaymentMethodSetupCapability,
  isSafePaymentMethodSetupUrl,
  parsePaymentMethodSetupRequest,
  paymentMethodSetupDisposition,
} from "@/lib/payment-method-setup";

function result(overrides: Partial<PaymentMethodSetupSessionResult> = {}): PaymentMethodSetupSessionResult {
  return {
    provider: "payuni",
    mode: "redirect",
    setupUrl: "https://payuni.example/setup?session=opaque",
    nextAction: "complete provider verification",
    ...overrides,
  };
}

describe("payment method setup contract", () => {
  it("requires a coherent setup session and verified callback capability", () => {
    expect(hasPaymentMethodSetupCapability({
      createPaymentMethodSetupSession: vi.fn(),
      verifyPaymentMethodSetupSignature: vi.fn(),
      normalizePaymentMethodSetupPayload: vi.fn(),
    })).toBe(true);
    expect(hasPaymentMethodSetupCapability({ createPaymentMethodSetupSession: vi.fn() })).toBe(false);
  });

  it("parses vendor and membership scopes without accepting arbitrary identifiers", () => {
    expect(parsePaymentMethodSetupRequest({ scopeType: "VENDOR", teamId: "attacker", membershipId: "attacker" })).toEqual({
      scopeType: "VENDOR",
      teamId: null,
      membershipId: null,
    });
    expect(parsePaymentMethodSetupRequest({ scopeType: "MEMBERSHIP", teamId: "team-1", membershipId: "membership-1" })).toEqual({
      scopeType: "MEMBERSHIP",
      teamId: "team-1",
      membershipId: "membership-1",
    });
    expect(parsePaymentMethodSetupRequest({ scopeType: "MEMBERSHIP", teamId: "", membershipId: "membership-1" })).toBeNull();
    expect(parsePaymentMethodSetupRequest({ scopeType: "UNKNOWN", teamId: "team-1", membershipId: "membership-1" })).toBeNull();
  });

  it("allows only credential-free HTTP(S) provider setup URLs", () => {
    expect(isSafePaymentMethodSetupUrl("https://payuni.example/setup?session=opaque")).toBe(true);
    expect(isSafePaymentMethodSetupUrl("http://localhost:31023/setup")).toBe(true);
    expect(isSafePaymentMethodSetupUrl("javascript:alert(1)")).toBe(false);
    expect(isSafePaymentMethodSetupUrl("https://user:password@payuni.example/setup")).toBe(false);
    expect(isSafePaymentMethodSetupUrl("not-a-url")).toBe(false);
  });

  it("fails closed for provider modes that need an unimplemented persistence boundary", () => {
    expect(paymentMethodSetupDisposition(result())).toBe("redirect");
    expect(paymentMethodSetupDisposition(result({ mode: "form_post", setupUrl: null }))).toBe("provider_form_post_unsupported");
    expect(paymentMethodSetupDisposition(result({ mode: "manual", setupUrl: null }))).toBe("provider_setup_unavailable");
  });
});
