import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
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

function payUniEnvelope(payload: Record<string, unknown>) {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hashKey), Buffer.from(hashIv), { authTagLength: 16 });
  const plaintext = new URLSearchParams(
    Object.entries(payload).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
  ).toString();
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
  const tag = cipher.getAuthTag().toString("base64");
  const encryptInfo = Buffer.from(`${encrypted}:::${tag}`).toString("hex");
  return new URLSearchParams({
    EncryptInfo: encryptInfo,
    HashInfo: createHash("sha256").update(`${hashKey}${encryptInfo}${hashIv}`).digest("hex").toUpperCase(),
  }).toString();
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
      appUrl: "https://celebratedeal.carry-digital-nomad.in.net",
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
      ReturnURL: "https://celebratedeal.carry-digital-nomad.in.net/api/webhooks/payments?provider=payuni&source=return",
      NotifyURL: "https://celebratedeal.carry-digital-nomad.in.net/api/webhooks/payments?provider=payuni&source=notify",
    });
    expect(session?.formPayload?.HashInfo).toBe(
      createHash("sha256").update(`${hashKey}${encrypted}${hashIv}`).digest("hex").toUpperCase(),
    );
    expect(JSON.stringify(session?.formPayload)).not.toContain(hashKey);
    expect(JSON.stringify(session?.formPayload)).not.toContain(hashIv);
  });

  it("never adds a Vercel preview protection bypass to PayUni callbacks", async () => {
    stubPayUniEnv();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "preview-bypass-token");
    const transaction = {
      id: "tx_preview",
      orderNumber: "CD-TEST-006",
      grossAmountCents: 199000,
    } as PaymentTransaction;

    const session = await payUniPaymentProvider.createCheckoutSession?.({
      transaction,
      product: { name: "Sandbox Product" } as Product,
      vendor: { id: "vendor_1" } as Vendor,
      appUrl: "https://preview.example.test",
    });

    const payload = decryptCheckoutPayload(session?.formPayload?.EncryptInfo ?? "");
    const returnUrl = new URL(payload.ReturnURL);
    const notifyUrl = new URL(payload.NotifyURL);

    expect(returnUrl.origin).toBe("https://preview.example.test");
    expect(returnUrl.pathname).toBe("/api/webhooks/payments");
    expect(returnUrl.searchParams.get("provider")).toBe("payuni");
    expect(returnUrl.searchParams.get("source")).toBe("return");
    expect(notifyUrl.searchParams.get("source")).toBe("notify");
    expect(returnUrl.searchParams.has("x-vercel-protection-bypass")).toBe(false);
    expect(notifyUrl.searchParams.has("x-vercel-protection-bypass")).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("preview-bypass-token");
  });

  it("submits a signed close request and accepts only the matching PayUni refund response", async () => {
    stubPayUniEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify({ TradeNo: "trade-123", CloseType: "2", CloseNo: "refund-456" }),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.refundPayment?.({
      transaction: { id: "tx-1", providerTradeNo: "trade-123", grossAmountCents: 199_000 } as PaymentTransaction,
      refundAmountCents: 199_000,
      requestId: "local-request-id",
    })).resolves.toEqual({ providerEventId: "refund-456" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox-api.payuni.com.tw/api/trade/close",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as URLSearchParams;
    expect(form.get("Version")).toBe("1.0");
    expect(request.headers).toMatchObject({ "user-agent": "payuni" });
    const requestPayload = decryptCheckoutPayload(form.get("EncryptInfo") ?? "");
    expect(requestPayload).toMatchObject({ MerID: "TESTMER", TradeNo: "trade-123", CloseType: "2", TradeAmt: "1990" });
    expect(JSON.stringify(request)).not.toContain(hashKey);
    expect(JSON.stringify(request)).not.toContain(hashIv);
  });

  it("accepts PayUni's documented direct encrypted refund response", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      TradeNo: "trade-direct-123",
      CloseType: "2",
    }), { status: 200 })));

    await expect(payUniPaymentProvider.refundPayment?.({
      transaction: { id: "tx-direct", providerTradeNo: "trade-direct-123", grossAmountCents: 199_000 } as PaymentTransaction,
      refundAmountCents: 199_000,
      requestId: "local-request-id",
    })).resolves.toEqual({ providerEventId: "trade-direct-123" });
  });

  it("fails closed when PayUni's close response cannot be authenticated", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new URLSearchParams({
      EncryptInfo: "invalid",
      HashInfo: "invalid",
    }).toString(), { status: 200 })));

    await expect(payUniPaymentProvider.refundPayment?.({
      transaction: { id: "tx-1", providerTradeNo: "trade-123", grossAmountCents: 199_000 } as PaymentTransaction,
      refundAmountCents: 199_000,
      requestId: "local-request-id",
    })).rejects.toThrow("Payment provider refund failed.");
  });

  it.each([
    ["order number too long", { orderNumber: "CD-12345678901234567890123", grossAmountCents: 199000 }],
    ["order number characters", { orderNumber: "CD INVALID", grossAmountCents: 199000 }],
    ["fractional TWD", { orderNumber: "CD-TEST-002", grossAmountCents: 199050 }],
    ["credit amount below range", { orderNumber: "CD-TEST-003", grossAmountCents: 0 }],
    ["credit amount above range", { orderNumber: "CD-TEST-004", grossAmountCents: 20_000_000 }],
  ])("rejects invalid PayUni checkout contract: %s", async (_label, transactionInput) => {
    stubPayUniEnv();

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

  it.each([
    ["missing HashInfo", (params: URLSearchParams) => params.delete("HashInfo")],
    ["tampered HashInfo", (params: URLSearchParams) => params.set("HashInfo", "0".repeat(64))],
    ["wrong merchant", (params: URLSearchParams) => params.set("MerID", "OTHER-MERCHANT")],
    ["wrong version", (params: URLSearchParams) => params.set("Version", "1.0")],
  ])("rejects an official callback with %s", async (_label, mutate) => {
    stubPayUniEnv();
    const body = buildPayUniSandboxWebhookFixture({
      fixture: "paid",
      merchantId: "TESTMER",
      hashKey,
      hashIv,
    });
    const params = new URLSearchParams(body);
    mutate(params);

    await expect(
      payUniPaymentProvider.verifySignature(new Request("https://app.example.test"), params.toString()),
    ).resolves.toBe(false);
  });

  it("rejects the former custom signature-header fallback", async () => {
    stubPayUniEnv();
    const body = JSON.stringify({
      MerID: "TESTMER",
      Version: "2.0",
      MerTradeNo: "CD-UNSIGNED-001",
      Status: "SUCCESS",
    });
    const request = new Request("https://app.example.test", {
      headers: { "x-payuni-signature": "legacy-custom-signature" },
    });

    await expect(payUniPaymentProvider.verifySignature(request, body)).resolves.toBe(false);
  });

  it("rejects a callback whose encrypted merchant does not match the configured shop", async () => {
    stubPayUniEnv();
    const body = buildPayUniSandboxWebhookFixture({
      fixture: "paid",
      merchantId: "TESTMER",
      hashKey,
      hashIv,
      overrides: { MerID: "OTHER-MERCHANT" },
    });

    await expect(
      payUniPaymentProvider.verifySignature(new Request("https://app.example.test"), body),
    ).resolves.toBe(false);
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
