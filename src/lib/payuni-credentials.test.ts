import { describe, expect, it } from "vitest";
import { activePayUniCredentials, payUniCredentialKeys } from "@/lib/payuni-credentials";

const sandbox = {
  PAYUNI_SANDBOX_MERCHANT_ID: "SANDBOX_MERCHANT",
  PAYUNI_SANDBOX_HASH_KEY: "s".repeat(32),
  PAYUNI_SANDBOX_HASH_IV: "s".repeat(16),
};
const production = {
  PAYUNI_MERCHANT_ID: "PRODUCTION_MERCHANT",
  PAYUNI_HASH_KEY: "p".repeat(32),
  PAYUNI_HASH_IV: "p".repeat(16),
};

describe("PAYUNi credential selection", () => {
  it("switches all three credentials with PAYUNI_ENV", () => {
    const env = { ...sandbox, ...production, PAYUNI_ENV: "sandbox" };
    expect(activePayUniCredentials(env)).toEqual({ merchantId: "SANDBOX_MERCHANT", key: "s".repeat(32), iv: "s".repeat(16) });
    env.PAYUNI_ENV = "production";
    expect(activePayUniCredentials(env)).toEqual({ merchantId: "PRODUCTION_MERCHANT", key: "p".repeat(32), iv: "p".repeat(16) });
  });

  it("never falls back to Sandbox credentials for production", () => {
    const env = { ...sandbox, PAYUNI_ENV: "production" };
    expect(() => activePayUniCredentials(env)).toThrow("missing or invalid");
  });

  it("never falls back to Production credentials for Sandbox", () => {
    const env = { ...production, PAYUNI_ENV: "sandbox" };
    expect(payUniCredentialKeys(env).merchantId).toBe("PAYUNI_SANDBOX_MERCHANT_ID");
    expect(() => activePayUniCredentials(env)).toThrow("missing or invalid");
  });
});
