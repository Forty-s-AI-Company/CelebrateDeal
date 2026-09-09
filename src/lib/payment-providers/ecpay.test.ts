import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeEcpayCheckMacValue,
  ecpayPaymentProvider,
  getEcpayConfig,
} from "./ecpay";
import { PaymentQueryProviderError } from "./types";

describe("ECPay Payment Provider", () => {
  it("never retains free-form callback PII or verification material", async () => {
    const normalized = await ecpayPaymentProvider.normalizePayload(new URLSearchParams({
      RtnCode: "1", RtnMsg: "Fixture Buyer learner@example.test", TradeAmt: "100",
      TradeNo: "ECPAY123", MerchantTradeNo: "ORDER123", CustomField3: "0912345678",
      CheckMacValue: "synthetic-mac", PaymentDate: "2026/09/09 12:00:00",
    }).toString());
    expect(normalized.payload.metadata).toBeUndefined();
    expect(normalized.rawPayload).toEqual({ eventId: "ECPAY123:1", eventType: "paid",
      orderNumber: "ORDER123", providerTradeNo: "ECPAY123", grossAmountCents: 10000,
      occurredAt: expect.any(String) });
  });
  beforeEach(() => {
    // Keep provider tests deterministic without depending on workstation config.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ECPAY_ENV", "sandbox");
    vi.stubEnv("ECPAY_MERCHANT_ID", "");
    vi.stubEnv("ECPAY_HASH_KEY", "");
    vi.stubEnv("ECPAY_HASH_IV", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function sandboxConfig() {
    const config = getEcpayConfig();
    expect(config.configured).toBe(true);
    return config;
  }

  function queryTransaction(overrides: Record<string, unknown> = {}) {
    return {
      id: "tx-ecpay-query-identity",
      providerName: "ecpay",
      orderNumber: "CD-20260907000000-ABC123",
      providerTradeNo: "ECPAY-TRADE-1",
      grossAmountCents: 298_000,
      refundedAmountCents: 0,
      status: "paid",
      ...overrides,
    } as never;
  }

  async function merchantTradeNoFor(transaction: ReturnType<typeof queryTransaction>) {
    const session = await ecpayPaymentProvider.createCheckoutSession!({
      transaction,
      product: { name: "ECPay query test" } as never,
      vendor: { id: "vendor-1", slug: "test-shop" } as never,
      appUrl: "https://shop.celebratedeal.test",
    });
    return session.formPayload!.MerchantTradeNo;
  }

  it("computes deterministic CheckMacValue adhering to ECPay specification", () => {
    const { hashKey, hashIv } = sandboxConfig();
    const params = {
      MerchantID: "2000132",
      MerchantTradeNo: "Test20260907001",
      MerchantTradeDate: "2026/09/07 10:00:00",
      PaymentType: "aio",
      TotalAmount: 1000,
      TradeDesc: "測試訂單",
      ItemName: "CelebrateDeal服務",
      ReturnURL: "https://example.test/return",
      ChoosePayment: "ALL",
      EncryptType: 1,
    };

    const mac = computeEcpayCheckMacValue(params, hashKey, hashIv);
    expect(mac).toMatch(/^[A-F0-9]{64}$/);

    // Verify determinism
    const mac2 = computeEcpayCheckMacValue(params, hashKey, hashIv);
    expect(mac2).toBe(mac);

    // Verify tamper detection (altering any parameter changes the hash)
    const tampered = { ...params, TotalAmount: 1001 };
    const tamperedMac = computeEcpayCheckMacValue(tampered, hashKey, hashIv);
    expect(tamperedMac).not.toBe(mac);
  });

  it("reports ready checkout readiness in test/local environment", () => {
    expect(ecpayPaymentProvider.checkoutReadiness()).toBe("ready");
  });

  it("fails closed in production when formal ECPay credentials are absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ECPAY_ENV", "production");
    vi.stubEnv("ECPAY_MERCHANT_ID", "");
    vi.stubEnv("ECPAY_HASH_KEY", "");
    vi.stubEnv("ECPAY_HASH_IV", "");

    expect(getEcpayConfig()).toMatchObject({ env: "production", configured: false });
    expect(ecpayPaymentProvider.checkoutReadiness()).toBe("unavailable");
    await expect(ecpayPaymentProvider.createCheckoutSession!({
      transaction: { id: "tx-production-missing", grossAmountCents: 100 } as never,
      vendor: { id: "vendor-1", slug: "test-shop" } as never,
      appUrl: "https://shop.celebratedeal.test",
    })).rejects.toThrow("ECPay payment provider is unavailable.");
    await expect(ecpayPaymentProvider.verifySignature(new Request("https://example.test"), "CheckMacValue=invalid"))
      .resolves.toBe(false);
  });

  it("creates checkout session with form_post mode and signed CheckMacValue", async () => {
    const { hashKey, hashIv } = sandboxConfig();
    const session = await ecpayPaymentProvider.createCheckoutSession!({
      transaction: {
        id: "tx-12345",
        orderNumber: "ORDER-ECPAY-001",
        grossAmountCents: 298000,
      } as never,
      product: { name: "高級線上直播課程" } as never,
      vendor: { id: "vendor-1", slug: "test-shop" } as never,
      appUrl: "https://shop.celebratedeal.test",
    });

    expect(session.mode).toBe("form_post");
    expect(session.formAction).toContain("ecpay.com.tw");
    expect(session.formMethod).toBe("POST");
    expect(session.formPayload).toBeDefined();

    const payload = session.formPayload!;
    expect(payload.MerchantID).toBe("2000132");
    expect(payload.TotalAmount).toBe("2980");
    expect(payload.ItemName).toContain("高級線上直播課程");
    expect(payload.CheckMacValue).toBeDefined();
    expect(payload.CustomField1).toBe("test-shop");
    expect(payload.MerchantTradeNo).toMatch(/^[A-F0-9]{20}$/);
    expect(payload.CustomField2).toBe("tx-12345|ORDER-ECPAY-001");

    // Verify the CheckMacValue in payload is valid
    const calculated = computeEcpayCheckMacValue(payload, hashKey, hashIv);
    expect(payload.CheckMacValue).toBe(calculated);
  });

  it("uses a stable opaque MerchantTradeNo and normalizes the complete order identity from CustomField2", async () => {
    const { hashKey, hashIv } = sandboxConfig();
    const createSession = (id: string, orderNumber: string) => ecpayPaymentProvider.createCheckoutSession!({
      transaction: { id, orderNumber, grossAmountCents: 298_000 } as never,
      product: { name: "Identity-bound course" } as never,
      vendor: { id: "vendor-1", slug: "test-shop" } as never,
      appUrl: "https://shop.celebratedeal.test",
    });
    const first = await createSession("tx-identity-one", "CD-20260907000000-ABC123");
    const firstRepeat = await createSession("tx-identity-one", "CD-20260907000000-ABC123");
    const second = await createSession("tx-identity-two", "CD-20260907000000-ABC124");

    expect(first.formPayload!.MerchantTradeNo).toBe(firstRepeat.formPayload!.MerchantTradeNo);
    expect(first.formPayload!.MerchantTradeNo).not.toBe(second.formPayload!.MerchantTradeNo);
    expect(first.formPayload!.MerchantTradeNo).toMatch(/^[A-Z0-9]{1,20}$/);
    expect(first.formPayload!.CustomField2).toBe("tx-identity-one|CD-20260907000000-ABC123");
    expect(second.formPayload!.CustomField2).toBe("tx-identity-two|CD-20260907000000-ABC124");

    const callback = {
      MerchantID: "2000132",
      MerchantTradeNo: first.formPayload!.MerchantTradeNo,
      CustomField2: first.formPayload!.CustomField2,
      TradeNo: "2026090700001",
      RtnCode: "1",
      RtnMsg: "Succeeded",
      TradeAmt: "2980",
      PaymentDate: "2026/09/07 10:15:30",
    };
    const body = new URLSearchParams({
      ...callback,
      CheckMacValue: computeEcpayCheckMacValue(callback, hashKey, hashIv),
    }).toString();

    await expect(ecpayPaymentProvider.normalizePayload(body)).resolves.toMatchObject({
      payload: { orderNumber: "CD-20260907000000-ABC123" },
    });
  });

  it("verifies webhook signature and rejects tampered payloads", async () => {
    const { hashKey, hashIv } = sandboxConfig();
    const rawData = {
      MerchantID: "2000132",
      MerchantTradeNo: "ORDER-ECPAY-001",
      TradeNo: "2026090700001",
      RtnCode: "1",
      RtnMsg: "Succeeded",
      TradeAmt: "2980",
      PaymentDate: "2026/09/07 10:15:30",
      PaymentType: "Credit_CreditCard",
    };

    const validMac = computeEcpayCheckMacValue(rawData, hashKey, hashIv);
    const validBody = new URLSearchParams({
      ...rawData,
      CheckMacValue: validMac,
    }).toString();

    const validReq = new Request("https://example.test/api/webhooks/payments?provider=ecpay", {
      method: "POST",
      body: validBody,
    });

    const isVerified = await ecpayPaymentProvider.verifySignature(validReq, validBody);
    expect(isVerified).toBe(true);

    // Tampered payload
    const tamperedBody = new URLSearchParams({
      ...rawData,
      TradeAmt: "100", // Altered amount
      CheckMacValue: validMac,
    }).toString();

    const tamperedReq = new Request("https://example.test/api/webhooks/payments?provider=ecpay", {
      method: "POST",
      body: tamperedBody,
    });

    const isTamperedVerified = await ecpayPaymentProvider.verifySignature(tamperedReq, tamperedBody);
    expect(isTamperedVerified).toBe(false);
  });

  it("normalizes paid, failed and refund webhook notifications", async () => {
    const { hashKey, hashIv } = sandboxConfig();
    const rawData = {
      MerchantID: "2000132",
      MerchantTradeNo: "ORDER-ECPAY-001",
      TradeNo: "2026090700001",
      RtnCode: "1",
      RtnMsg: "Succeeded",
      TradeAmt: "2980",
      PaymentDate: "2026/09/07 10:15:30",
      CustomField1: "shop-slug",
    };

    const mac = computeEcpayCheckMacValue(rawData, hashKey, hashIv);
    const body = new URLSearchParams({
      ...rawData,
      CheckMacValue: mac,
    }).toString();

    const normalized = await ecpayPaymentProvider.normalizePayload(body);
    expect(normalized.payload).toMatchObject({
      provider: "ecpay",
      eventType: "paid",
      orderNumber: "ORDER-ECPAY-001",
      providerTradeNo: "2026090700001",
      grossAmountCents: 298000,
      netAmountCents: 298000,
      vendorSlug: "shop-slug",
    });

    // Failed payment
    const failedData = { ...rawData, RtnCode: "10100058", RtnMsg: "Card declined" };
    const failedMac = computeEcpayCheckMacValue(failedData, hashKey, hashIv);
    const failedBody = new URLSearchParams({ ...failedData, CheckMacValue: failedMac }).toString();
    const failedNormalized = await ecpayPaymentProvider.normalizePayload(failedBody);
    expect(failedNormalized.payload.eventType).toBe("failed");
    expect(normalized.payload.eventId).toBe("2026090700001:1");
    expect(failedNormalized.payload.eventId).toBe("2026090700001:10100058");

    const repeatedNormalized = await ecpayPaymentProvider.normalizePayload(body);
    expect(repeatedNormalized.payload.eventId).toBe(normalized.payload.eventId);
  });

  it("rejects invalid or oversized CustomField2 identities before callback normalization", async () => {
    const { hashKey, hashIv } = sandboxConfig();
    const invalidCallback = {
      MerchantID: "2000132",
      MerchantTradeNo: "D50A7A58B0A9B2E71234",
      CustomField2: "missing-reversible-separator",
      TradeNo: "2026090700001",
      RtnCode: "1",
      TradeAmt: "2980",
    };
    const invalidBody = new URLSearchParams({
      ...invalidCallback,
      CheckMacValue: computeEcpayCheckMacValue(invalidCallback, hashKey, hashIv),
    }).toString();
    await expect(ecpayPaymentProvider.normalizePayload(invalidBody)).rejects.toThrow("Invalid ECPay callback identity.");

    await expect(ecpayPaymentProvider.createCheckoutSession!({
      transaction: {
        id: "transaction-id-that-is-intentionally-too-long",
        orderNumber: "order-number-that-is-intentionally-too-long",
        grossAmountCents: 100,
      } as never,
      vendor: { id: "vendor-1", slug: "test-shop" } as never,
      appUrl: "https://shop.celebratedeal.test",
    })).rejects.toThrow("ECPay payment provider request is invalid.");
  });

  it("queries QueryTradeInfo/V5 with a signed POST and strict identity binding", async () => {
    const { hashKey, hashIv, urls } = sandboxConfig();
    const transaction = queryTransaction();
    const merchantTradeNo = await merchantTradeNoFor(transaction);
    const responsePayload = {
      MerchantID: "2000132",
      MerchantTradeNo: merchantTradeNo,
      TradeNo: "ECPAY-TRADE-1",
      TradeAmt: "2980",
      TradeStatus: "1",
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(new URLSearchParams({
      ...responsePayload,
      CheckMacValue: computeEcpayCheckMacValue(responsePayload, hashKey, hashIv),
    }).toString(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ecpayPaymentProvider.queryPayment!({ transaction })).resolves.toEqual({
      providerTradeNo: "ECPAY-TRADE-1",
      orderNumber: "CD-20260907000000-ABC123",
      grossAmountCents: 298_000,
      refundedAmountCents: 0,
      remainingRefundableAmountCents: 298_000,
      status: "paid",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(urls.query);
    expect(options).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "error",
    });
    const requestPayload = new URLSearchParams(String(options.body));
    expect(requestPayload.get("MerchantID")).toBe("2000132");
    expect(requestPayload.get("MerchantTradeNo")).toBe(merchantTradeNo);
    expect(requestPayload.get("TimeStamp")).toMatch(/^\d+$/);
    expect(requestPayload.get("CheckMacValue")).toBe(computeEcpayCheckMacValue({
      MerchantID: "2000132",
      MerchantTradeNo: merchantTradeNo,
      TimeStamp: requestPayload.get("TimeStamp")!,
    }, hashKey, hashIv));
  });

  it.each([
    ["a merchant mismatch", { MerchantID: "other-merchant" }, "provider_response"],
    ["a MerchantTradeNo mismatch", { MerchantTradeNo: "OTHERTRADE00000000001" }, "provider_response"],
    ["a provider trade reference mismatch", { TradeNo: "ECPAY-TRADE-OTHER" }, "provider_response"],
    ["an amount mismatch", { TradeAmt: "2981" }, "provider_response"],
    ["a pending trade", { TradeStatus: "0" }, "pending"],
    ["an unsupported trade status", { TradeStatus: "2" }, "provider_response"],
  ])("fails closed for %s in a signed provider response", async (_label, patch, category) => {
    const { hashKey, hashIv } = sandboxConfig();
    const transaction = queryTransaction();
    const merchantTradeNo = await merchantTradeNoFor(transaction);
    const responsePayload = {
      MerchantID: "2000132",
      MerchantTradeNo: merchantTradeNo,
      TradeNo: "ECPAY-TRADE-1",
      TradeAmt: "2980",
      TradeStatus: "1",
      ...patch,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new URLSearchParams({
      ...responsePayload,
      CheckMacValue: computeEcpayCheckMacValue(responsePayload, hashKey, hashIv),
    }).toString(), { status: 200 })));

    await expect(ecpayPaymentProvider.queryPayment!({ transaction })).rejects.toMatchObject({
      category,
      message: "Payment provider query failed.",
    });
  });

  it("rejects an unauthenticated QueryTradeInfo response without exposing its contents", async () => {
    const transaction = queryTransaction();
    const merchantTradeNo = await merchantTradeNoFor(transaction);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new URLSearchParams({
      MerchantID: "2000132",
      MerchantTradeNo: merchantTradeNo,
      TradeNo: "ECPAY-TRADE-1",
      TradeAmt: "2980",
      TradeStatus: "1",
      CheckMacValue: "invalid",
    }).toString(), { status: 200 })));

    await expect(ecpayPaymentProvider.queryPayment!({ transaction })).rejects.toMatchObject({
      category: "authentication",
      message: "Payment provider query failed.",
    });
  });

  it.each([
    ["a timeout", new DOMException("The operation timed out", "TimeoutError")],
    ["a redirect rejection", new TypeError("redirect disallowed")],
  ])("maps %s to a safe network query error", async (_label, failure) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));

    await expect(ecpayPaymentProvider.queryPayment!({ transaction: queryTransaction() })).rejects.toMatchObject({
      category: "network",
      message: "Payment provider query failed.",
    });
  });

  it("does not use QueryTradeInfo to synthesize refund reconciliation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(ecpayPaymentProvider.queryPayment!({
      transaction: queryTransaction({ refundedAmountCents: 10_000, status: "partially_refunded" }),
    })).rejects.toBeInstanceOf(PaymentQueryProviderError);
    await expect(ecpayPaymentProvider.queryPayment!({
      transaction: queryTransaction({ refundedAmountCents: 10_000, status: "partially_refunded" }),
    })).rejects.toMatchObject({ category: "request_contract" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-provider query attempts before calling ECPay", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(ecpayPaymentProvider.queryPayment!({
      transaction: queryTransaction({ providerName: "payuni" }),
    })).rejects.toMatchObject({ category: "request_contract" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
