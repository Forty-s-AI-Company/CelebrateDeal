import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentTransaction, Product, Vendor } from "@prisma/client";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import { buildPayUniSandboxWebhookFixture } from "@/lib/payment-providers/payuni-fixtures";

const hashKey = "12345678901234567890123456789012";
const hashIv = "1234567890123456";

function stubPayUniEnv() {
  vi.stubEnv("PAYUNI_HASH_KEY", hashKey);
  vi.stubEnv("PAYUNI_HASH_IV", hashIv);
  vi.stubEnv("PAYUNI_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PayUni provider", () => {
  it("builds a server-side checkout form payload with PayUni fields", async () => {
    stubPayUniEnv();
    const transaction = {
      id: "tx_1",
      orderNumber: "CD-TEST-001",
      grossAmountCents: 199000,
    } as PaymentTransaction;
    const product = { name: "Sandbox Product" } as Product;
    const vendor = { id: "vendor_1" } as Vendor;

    const session = await payUniPaymentProvider.createCheckoutSession?.({
      transaction,
      product,
      vendor,
      appUrl: "https://app.example.test",
      referralCode: "DEMOREF",
    });

    expect(session?.mode).toBe("form_post");
    expect(session?.formAction).toContain("/upp");
    expect(session?.formPayload).toMatchObject({
      MerID: "TESTMER",
      Version: "1.0",
    });
    expect(session?.formPayload?.EncryptInfo).toEqual(expect.any(String));
    expect(session?.formPayload?.HashInfo).toEqual(expect.any(String));
    expect(JSON.stringify(session?.formPayload)).not.toContain(hashKey);
    expect(JSON.stringify(session?.formPayload)).not.toContain(hashIv);
  });

  it("normalizes PayUni sandbox paid and duplicate fixtures", async () => {
    stubPayUniEnv();
    const body = buildPayUniSandboxWebhookFixture({
      fixture: "paid",
      merchantId: "TESTMER",
      hashKey,
      hashIv,
    });
    const duplicateBody = buildPayUniSandboxWebhookFixture({
      fixture: "duplicate_paid",
      merchantId: "TESTMER",
      hashKey,
      hashIv,
    });

    await expect(payUniPaymentProvider.verifySignature(new Request("https://app.example.test"), body)).resolves.toBe(true);
    const normalized = await payUniPaymentProvider.normalizePayload(body);
    const duplicate = await payUniPaymentProvider.normalizePayload(duplicateBody);

    expect(normalized.payload.eventType).toBe("paid");
    expect(normalized.payload.orderNumber).toBe("CD-SANDBOX-PAID-001");
    expect(normalized.payload.referralCode).toBe("DEMOREF");
    expect(duplicate.payload.eventId).toBe(normalized.payload.eventId);
  });

  it("normalizes PayUni sandbox refund fixtures", async () => {
    stubPayUniEnv();
    const body = buildPayUniSandboxWebhookFixture({
      fixture: "refunded",
      merchantId: "TESTMER",
      hashKey,
      hashIv,
    });

    const normalized = await payUniPaymentProvider.normalizePayload(body);

    expect(normalized.payload.eventType).toBe("refunded");
    expect(normalized.payload.refundAmountCents).toBe(199000);
    expect(normalized.payload.gatewayFeeRefundCents).toBe(3500);
  });
});
