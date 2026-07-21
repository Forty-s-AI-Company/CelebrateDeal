import { createDecipheriv, createHash } from "node:crypto";
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

function decryptCheckoutPayload(encryptInfo: string) {
  const [encrypted, tag] = Buffer.from(encryptInfo, "hex").toString("utf8").split(":::");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(hashKey), Buffer.from(hashIv));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return Object.fromEntries(new URLSearchParams(plaintext));
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
    expect(session?.formAction).toBe("https://sandbox-api.payuni.com.tw/api/upp");
    expect(session?.formPayload).toEqual({
      MerID: "TESTMER",
      Version: "2.0",
      EncryptInfo: expect.any(String),
      HashInfo: expect.any(String),
    });
    const encrypted = session?.formPayload?.EncryptInfo ?? "";
    const payload = decryptCheckoutPayload(encrypted);
    expect(payload).toEqual({
      MerID: "TESTMER",
      MerTradeNo: "CD-TEST-001",
      TradeAmt: "1990",
      Timestamp: expect.stringMatching(/^\d+$/),
      ProdDesc: "Sandbox Product",
      ReturnURL: "https://app.example.test/api/webhooks/payments?provider=payuni&source=return",
      NotifyURL: "https://app.example.test/api/webhooks/payments?provider=payuni&source=notify",
    });
    expect(session?.formPayload?.HashInfo).toBe(
      createHash("sha256").update(`${hashKey}${encrypted}${hashIv}`).digest("hex").toUpperCase(),
    );
    expect(JSON.stringify(session?.formPayload)).not.toContain(hashKey);
    expect(JSON.stringify(session?.formPayload)).not.toContain(hashIv);
  });

  it.each([
    ["order number too long", { orderNumber: "CD-12345678901234567890123", grossAmountCents: 199000 }, undefined],
    ["order number characters", { orderNumber: "CD INVALID", grossAmountCents: 199000 }, undefined],
    ["fractional TWD", { orderNumber: "CD-TEST-002", grossAmountCents: 199050 }, undefined],
    ["credit amount below range", { orderNumber: "CD-TEST-003", grossAmountCents: 0 }, undefined],
    ["credit amount above range", { orderNumber: "CD-TEST-004", grossAmountCents: 20_000_000 }, undefined],
    ["environment endpoint mismatch", { orderNumber: "CD-TEST-005", grossAmountCents: 199000 }, "https://api.payuni.com.tw/api"],
  ])("rejects invalid PayUni checkout contract: %s", async (_label, transactionInput, apiBaseUrl) => {
    stubPayUniEnv();
    if (apiBaseUrl) vi.stubEnv("PAYUNI_API_BASE_URL", apiBaseUrl);

    await expect(payUniPaymentProvider.createCheckoutSession?.({
      transaction: { id: "tx_invalid", ...transactionInput } as PaymentTransaction,
      product: { name: "Sandbox Product" } as Product,
      vendor: { id: "vendor_1" } as Vendor,
      appUrl: "https://app.example.test",
    })).rejects.toThrow();
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

  it.each(["processing", "pending", "unknown", ""])(
    "rejects unsupported payment status %j instead of treating it as paid",
    async (status) => {
      stubPayUniEnv();
      const body = JSON.stringify({
        EventId: "payuni-unknown-status-001",
        EventType: status,
        MerTradeNo: "CD-UNKNOWN-001",
        VendorId: "vendor_1",
        TradeAmt: 1990,
      });

      await expect(payUniPaymentProvider.normalizePayload(body)).rejects.toThrow(
        "Unsupported PayUni payment status.",
      );
    },
  );

  it.each([
    [{ EventType: "paid", VendorId: "vendor_1", TradeAmt: 1990 }, "Missing PayUni order number."],
    [{ EventType: "paid", VendorId: "vendor_1", TradeAmt: 1990, MerTradeNo: "" }, "Missing PayUni order number."],
  ])("rejects a payload without stable transaction identity", async (payload, error) => {
    stubPayUniEnv();

    await expect(payUniPaymentProvider.normalizePayload(JSON.stringify(payload))).rejects.toThrow(error);
  });
});
