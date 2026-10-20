import { describe, expect, it } from "vitest";

import { getPaymentProvider } from "@/lib/payment-providers";
import {
  isProductionDeployment,
  PaymentProviderNotAllowedError,
  paymentProviderAllowedInRuntime,
} from "@/lib/payment-providers/runtime-policy";

describe("F-003 production payment provider policy", () => {
  const production = { VERCEL_ENV: "production", NODE_ENV: "production" };

  it("treats the Vercel production deployment as production and Vercel previews as not", () => {
    expect(isProductionDeployment(production)).toBe(true);
    expect(isProductionDeployment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(isProductionDeployment({ VERCEL_ENV: "development", NODE_ENV: "production" })).toBe(false);
  });

  it("treats a production server outside Vercel as production unless it is loopback or opted out (review m-5)", () => {
    expect(isProductionDeployment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://shop.example.test" })).toBe(true);
    expect(isProductionDeployment({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "not-a-url" })).toBe(true);
    // Local e2e and the disposable QA runners serve a loopback URL.
    for (const url of ["http://127.0.0.1:31023", "http://localhost:3000", "http://[::1]:3000", "http://app.localhost:3000"]) {
      expect(isProductionDeployment({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: url })).toBe(false);
    }
    expect(isProductionDeployment({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://ci.example.test", ALLOW_NON_PAYUNI_PROVIDERS: "1" })).toBe(false);
    // The opt-out never applies on Vercel production.
    expect(isProductionDeployment({ ...production, ALLOW_NON_PAYUNI_PROVIDERS: "1" })).toBe(true);
    expect(isProductionDeployment({ NODE_ENV: "test" })).toBe(false);
    expect(paymentProviderAllowedInRuntime("demo", { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://shop.example.test" })).toBe(false);
  });

  it.each(["demo", "ecpay-like", "platform-ecpay", null, undefined])("refuses provider %j in production", (providerId) => {
    expect(paymentProviderAllowedInRuntime(providerId, production)).toBe(false);
  });

  it("allows PayUni everywhere and other providers outside production", () => {
    expect(paymentProviderAllowedInRuntime("payuni", production)).toBe(true);
    expect(paymentProviderAllowedInRuntime("demo", { VERCEL_ENV: "preview" })).toBe(true);
    expect(paymentProviderAllowedInRuntime("demo", { NODE_ENV: "test" })).toBe(true);
  });

  it("resolves only PayUni from getPaymentProvider in production", () => {
    expect(() => getPaymentProvider("demo", production)).toThrow(PaymentProviderNotAllowedError);
    expect(() => getPaymentProvider("platform-ecpay", production)).toThrow(PaymentProviderNotAllowedError);
    expect(getPaymentProvider("payuni", production).id).toBe("payuni");
    expect(getPaymentProvider("demo", { VERCEL_ENV: "preview" }).id).toBe("demo");
    expect(() => getPaymentProvider("unknown", { NODE_ENV: "test" })).toThrow("Unsupported payment provider");
  });
});
