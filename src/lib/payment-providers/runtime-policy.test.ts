import { describe, expect, it } from "vitest";

import { getPaymentProvider } from "@/lib/payment-providers";
import {
  isProductionDeployment,
  PaymentProviderNotAllowedError,
  paymentProviderAllowedInRuntime,
} from "@/lib/payment-providers/runtime-policy";

describe("F-003 production payment provider policy", () => {
  const production = { VERCEL_ENV: "production", NODE_ENV: "production" };

  it("treats only the Vercel production deployment as production", () => {
    expect(isProductionDeployment(production)).toBe(true);
    expect(isProductionDeployment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    // next start for local e2e and controlled CI builds runs NODE_ENV=production.
    expect(isProductionDeployment({ NODE_ENV: "production" })).toBe(false);
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
