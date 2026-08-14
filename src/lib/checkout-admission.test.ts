import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_ADMISSION_COOKIE,
  checkoutAdmissionCookieOptions,
  checkoutSessionTokenFromRequest,
  issueCheckoutAdmission,
  verifyCheckoutAdmission,
} from "@/lib/checkout-admission";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "checkout-admission-test-secret-longer-than-32-bytes");
});

afterEach(() => vi.unstubAllEnvs());

describe("checkout admission", () => {
  it("binds a server-issued idempotency key to product revision and an HttpOnly session", () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    const issued = issueCheckoutAdmission({
      vendorId: "vendor-1",
      productId: "product-1",
      productRevision: 7,
      now,
    });
    const verified = verifyCheckoutAdmission({
      admissionToken: issued.admissionToken,
      sessionToken: issued.sessionToken,
      now,
    });

    expect(verified).toEqual({
      vendorId: "vendor-1",
      productId: "product-1",
      productRevision: 7,
      idempotencyKey: issued.idempotencyKey,
      expiresAt: issued.expiresAt,
    });
    expect(issued.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(issued.admissionToken).not.toContain(issued.sessionToken);
  });

  it("can re-sign an existing client-persisted checkout identity without accepting malformed UUIDs", () => {
    const idempotencyKey = "11111111-1111-4111-8111-111111111111";
    const issued = issueCheckoutAdmission({
      vendorId: "vendor-1",
      productId: "product-1",
      productRevision: 7,
      idempotencyKey,
    });

    expect(issued.idempotencyKey).toBe(idempotencyKey);
    expect(verifyCheckoutAdmission({
      admissionToken: issued.admissionToken,
      sessionToken: issued.sessionToken,
    })?.idempotencyKey).toBe(idempotencyKey);
    expect(() => issueCheckoutAdmission({
      vendorId: "vendor-1",
      productId: "product-1",
      productRevision: 7,
      idempotencyKey: "forged",
    })).toThrowError("Invalid checkout admission binding.");
  });

  it("rejects tampering, expiry, another session, malformed payloads and another signing key", () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    const issued = issueCheckoutAdmission({
      vendorId: "vendor-1",
      productId: "product-1",
      productRevision: 7,
      now,
    });

    expect(verifyCheckoutAdmission({
      admissionToken: `${issued.admissionToken.slice(0, -1)}x`,
      sessionToken: issued.sessionToken,
      now,
    })).toBeNull();
    expect(verifyCheckoutAdmission({
      admissionToken: issued.admissionToken,
      sessionToken: "z".repeat(43),
      now,
    })).toBeNull();
    expect(verifyCheckoutAdmission({
      admissionToken: issued.admissionToken,
      sessionToken: issued.sessionToken,
      now: issued.expiresAt,
    })).toBeNull();
    expect(verifyCheckoutAdmission({ admissionToken: "invalid", sessionToken: issued.sessionToken, now })).toBeNull();
    vi.stubEnv("CSRF_SECRET", "another-checkout-admission-secret-longer-than-32-bytes");
    expect(verifyCheckoutAdmission({
      admissionToken: issued.admissionToken,
      sessionToken: issued.sessionToken,
      now,
    })).toBeNull();
  });

  it("reads only a bounded session cookie and emits strict HttpOnly options", () => {
    const token = "a".repeat(43);
    const request = new Request("https://app.example.test/api/payments/checkout", {
      headers: { cookie: `${CHECKOUT_ADMISSION_COOKIE}=${token}; unrelated=value` },
    });

    expect(checkoutSessionTokenFromRequest(request)).toBe(token);
    expect(checkoutSessionTokenFromRequest(new Request("https://app.example.test", {
      headers: { cookie: `${CHECKOUT_ADMISSION_COOKIE}=short` },
    }))).toBeNull();
    expect(checkoutAdmissionCookieOptions({ secure: true })).toEqual({
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/api/payments/checkout",
      maxAge: 86_400,
    });
  });
});
