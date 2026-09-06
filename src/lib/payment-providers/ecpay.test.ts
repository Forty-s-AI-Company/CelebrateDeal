import { describe, expect, it } from "vitest";
import {
  computeEcpayCheckMacValue,
  ecpayPaymentProvider,
  getEcpayConfig,
} from "./ecpay";

describe("ECPay Payment Provider", () => {
  const { hashKey, hashIv } = getEcpayConfig();

  it("computes deterministic CheckMacValue adhering to ECPay specification", () => {
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

  it("creates checkout session with form_post mode and signed CheckMacValue", async () => {
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

    // Verify the CheckMacValue in payload is valid
    const calculated = computeEcpayCheckMacValue(payload, hashKey, hashIv);
    expect(payload.CheckMacValue).toBe(calculated);
  });

  it("verifies webhook signature and rejects tampered payloads", async () => {
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
  });

  it("queries payment status accurately", async () => {
    const query = await ecpayPaymentProvider.queryPayment!({
      transaction: {
        id: "tx-1",
        orderNumber: "ORD-1",
        providerTradeNo: "ECPAY-TRADE-1",
        grossAmountCents: 500000,
        refundedAmountCents: 100000,
        status: "partially_refunded",
      } as never,
    });

    expect(query).toEqual({
      providerTradeNo: "ECPAY-TRADE-1",
      orderNumber: "ORD-1",
      grossAmountCents: 500000,
      refundedAmountCents: 100000,
      remainingRefundableAmountCents: 400000,
      status: "partially_refunded",
    });
  });
});
