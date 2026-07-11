import { afterEach, describe, expect, it, vi } from "vitest";
import { getPaymentProvider, UnsupportedPaymentProviderError } from "@/lib/payment-providers";
import { demoPaymentProvider } from "@/lib/payment-providers/demo";

describe("getPaymentProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a missing or unknown provider instead of falling back to demo", () => {
    expect(() => getPaymentProvider(null)).toThrow(UnsupportedPaymentProviderError);
    expect(() => getPaymentProvider("unknown-provider")).toThrow(UnsupportedPaymentProviderError);
  });

  it("allows an explicitly selected demo provider outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(getPaymentProvider("demo").id).toBe("demo");
  });

  it("rejects the demo provider in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getPaymentProvider("demo")).toThrow("demo_disabled_in_production");
  });

  it("does not let a demo payload override the normalized provider identity", async () => {
    const normalized = await demoPaymentProvider.normalizePayload(JSON.stringify({
      provider: "payuni",
      eventId: "evt-demo-provider-override",
      eventType: "paid",
      orderNumber: "ORDER-DEMO-OVERRIDE",
      grossAmountCents: 100,
    }));
    expect(normalized.payload.provider).toBe("demo");
  });
});
