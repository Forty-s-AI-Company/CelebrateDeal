import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentTransaction, Product, Vendor } from "@prisma/client";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import { buildPayUniSandboxWebhookFixture } from "@/lib/payment-providers/payuni-fixtures";
import { PaymentQueryProviderError } from "@/lib/payment-providers/types";

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

function completedCreditRefundQueryRow(overrides: Record<string, string> = {}) {
  return {
    MerTradeNo: "CD-QUERY-001",
    TradeNo: "trade-query-123",
    TradeAmt: "1680",
    PaymentType: "1",
    TradeStatus: "1",
    DataSource: "A",
    RefundType: "2",
    RefundStatus: "2",
    RefundAmt: "1680",
    RemainAmt: "0",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PayUni provider", () => {
  it("reports checkout readiness only when all required runtime configuration is valid", () => {
    vi.stubEnv("PAYUNI_MERCHANT_ID", "");
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("unavailable");

    stubPayUniEnv();
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("ready");

    vi.stubEnv("PAYUNI_HASH_KEY", "too-short");
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("unavailable");

    stubPayUniEnv();
    vi.stubEnv("PAYUNI_ENV", "invalid");
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("unavailable");
  });

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

  it("keeps notification canonical while using the server-selected payer return origin", async () => {
    stubPayUniEnv();
    const session = await payUniPaymentProvider.createCheckoutSession?.({
      transaction: { id: "tx_return", orderNumber: "CD-RETURN", grossAmountCents: 100 } as PaymentTransaction,
      product: { name: "Sandbox Product" } as Product,
      vendor: { id: "vendor_1" } as Vendor,
      appUrl: "https://canonical.example.test",
      returnAppUrl: "https://exact-preview.vercel.app",
    });
    const payload = decryptCheckoutPayload(session?.formPayload?.EncryptInfo ?? "");
    expect(payload.ReturnURL).toBe("https://exact-preview.vercel.app/api/webhooks/payments?provider=payuni&source=return");
    expect(payload.NotifyURL).toBe("https://canonical.example.test/api/webhooks/payments?provider=payuni&source=notify");
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

  it("submits the documented token cancellation envelope", async () => {
    stubPayUniEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      BindVal: "bind-token-001",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.revokePaymentMethodReference?.({
      providerPaymentMethodRef: "bind-token-001",
    })).resolves.toEqual({});

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox-api.payuni.com.tw/api/credit_bind/cancel",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as URLSearchParams;
    expect(form.get("Version")).toBe("1.0");
    expect(decryptCheckoutPayload(form.get("EncryptInfo") ?? "")).toMatchObject({
      MerID: "TESTMER",
      UseTokenType: "1",
      BindVal: "bind-token-001",
    });
    expect(JSON.stringify(request)).not.toContain(hashKey);
    expect(JSON.stringify(request)).not.toContain(hashIv);
  });

  it("fails closed when the token cancellation response is not successful", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "ERROR",
    }), { status: 200 })));

    await expect(payUniPaymentProvider.revokePaymentMethodReference?.({
      providerPaymentMethodRef: "bind-token-002",
    })).rejects.toThrow("PayUni payment method revocation failed.");
  });

  it("queries the allowlisted Sandbox endpoint and normalizes a terminal refund", async () => {
    stubPayUniEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(completedCreditRefundQueryRow()),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: {
        id: "tx-query",
        providerName: "payuni",
        orderNumber: "CD-QUERY-001",
        providerTradeNo: "trade-query-123",
        grossAmountCents: 168_000,
      } as PaymentTransaction,
    })).resolves.toEqual({
      providerTradeNo: "trade-query-123",
      orderNumber: "CD-QUERY-001",
      grossAmountCents: 168_000,
      refundedAmountCents: 168_000,
      remainingRefundableAmountCents: 0,
      status: "refunded",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox-api.payuni.com.tw/api/trade/query",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as URLSearchParams;
    expect(form.get("Version")).toBe("2.0");
    expect(decryptCheckoutPayload(form.get("EncryptInfo") ?? "")).toMatchObject({ MerID: "TESTMER", MerTradeNo: "CD-QUERY-001" });
    expect(JSON.stringify(request)).not.toContain(hashKey);
    expect(JSON.stringify(request)).not.toContain(hashIv);
  });

  it.each([
    { TradeNo: "different-trade", TradeAmt: "1680" },
    { TradeNo: "trade-query-123", TradeAmt: "1681" },
  ])("rejects a signed query with mismatched local identity or amount: %j", async (mismatch) => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(completedCreditRefundQueryRow(mismatch)),
    }), { status: 200 })));
    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: {
        id: "tx-query",
        providerName: "payuni",
        orderNumber: "CD-QUERY-001",
        providerTradeNo: "trade-query-123",
        grossAmountCents: 168_000,
      } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
  });

  it("accepts a bound PayUni bracket-encoded query Result row", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      "Result[0][MerTradeNo]": "CD-QUERY-BRACKET",
      "Result[0][TradeNo]": "trade-query-bracket",
      "Result[0][TradeAmt]": "1680",
      "Result[0][PaymentType]": "1",
      "Result[0][TradeStatus]": "1",
      "Result[0][DataSource]": "A",
      "Result[0][RefundType]": "2",
      "Result[0][RefundStatus]": "2",
      "Result[0][RefundAmt]": "1680",
      "Result[0][RemainAmt]": "0",
    }), { status: 200 })));

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: {
        id: "tx-query-bracket",
        providerName: "payuni",
        orderNumber: "CD-QUERY-BRACKET",
        providerTradeNo: "trade-query-bracket",
        grossAmountCents: 168_000,
      } as PaymentTransaction,
    })).resolves.toMatchObject({
      providerTradeNo: "trade-query-bracket",
      orderNumber: "CD-QUERY-BRACKET",
      status: "refunded",
    });
  });

  it("rejects a bracket-encoded query Result row for another transaction", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      "Result[0][MerTradeNo]": "CD-QUERY-BRACKET",
      "Result[0][TradeNo]": "other-trade",
      "Result[0][TradeAmt]": "1680",
      "Result[0][PaymentType]": "1",
      "Result[0][TradeStatus]": "1",
      "Result[0][DataSource]": "A",
      "Result[0][RefundType]": "2",
      "Result[0][RefundStatus]": "2",
      "Result[0][RefundAmt]": "1680",
      "Result[0][RemainAmt]": "0",
    }), { status: 200 })));

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: {
        id: "tx-query-bracket",
        providerName: "payuni",
        orderNumber: "CD-QUERY-BRACKET",
        providerTradeNo: "trade-query-bracket",
        grossAmountCents: 168_000,
      } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
  });

  it("fails closed when a partial query has no provider refund amount", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(completedCreditRefundQueryRow({
        MerTradeNo: "CD-QUERY-002",
        TradeNo: "trade-query-234",
        RemainAmt: "840",
        RefundAmt: "",
      })),
    }), { status: 200 })));

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "payuni", orderNumber: "CD-QUERY-002", providerTradeNo: "trade-query-234", grossAmountCents: 168_000 } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
  });

  it.each(["1680junk", "1680.5", "1e3", " 1680"]) ("rejects non-strict PayUni query amount %s", async (tradeAmount) => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(completedCreditRefundQueryRow({
        MerTradeNo: "CD-QUERY-STRICT",
        TradeNo: "trade-query-strict",
        TradeAmt: tradeAmount,
      })),
    }), { status: 200 })));

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "payuni", orderNumber: "CD-QUERY-STRICT", providerTradeNo: "trade-query-strict", grossAmountCents: 168_000 } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
  });

  it("does not permit the Sandbox reconciliation query to use Production", async () => {
    stubPayUniEnv();
    vi.stubEnv("PAYUNI_ENV", "production");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "payuni", orderNumber: "CD-QUERY-003", providerTradeNo: "trade-query-345", grossAmountCents: 168_000 } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["provider", { providerName: "stripe" }],
    ["amount", { grossAmountCents: 168_001 }],
    ["order reference", { orderNumber: "CD QUERY 004" }],
    ["provider reference", { providerTradeNo: " trade-query-456" }],
  ])("fails closed before any Sandbox query for an invalid %s contract field", async (_label, patch) => {
    stubPayUniEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: {
        id: "tx-query-invalid",
        providerName: "payuni",
        orderNumber: "CD-QUERY-004",
        providerTradeNo: "trade-query-456",
        grossAmountCents: 168_000,
        ...patch,
      } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not interpret PayUni RefundStatus 8 as a successful query", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(completedCreditRefundQueryRow({
        MerTradeNo: "CD-QUERY-STATUS-8",
        TradeNo: "trade-query-status-8",
        RefundStatus: "8",
      })),
    }), { status: 200 })));

    const query = payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "payuni", orderNumber: "CD-QUERY-STATUS-8", providerTradeNo: "trade-query-status-8", grossAmountCents: 168_000 } as PaymentTransaction,
    });
    await expect(query).rejects.toBeInstanceOf(PaymentQueryProviderError);
    await expect(query).rejects.toMatchObject({ category: "pending" });
  });

  it.each([
    ["partial", { MerTradeNo: "CD-QUERY-PARTIAL", TradeNo: "trade-query-partial", RefundAmt: "600", RemainAmt: "1080" }, {
      refundedAmountCents: 60_000,
      remainingRefundableAmountCents: 108_000,
      status: "partially_refunded",
    }],
    ["multiple refunds where the final RefundAmt is not cumulative", { MerTradeNo: "CD-QUERY-MULTI", TradeNo: "trade-query-multi", RefundAmt: "300", RemainAmt: "480" }, {
      refundedAmountCents: 120_000,
      remainingRefundableAmountCents: 48_000,
      status: "partially_refunded",
    }],
  ])("normalizes a %s credit-card refund from cumulative gross minus RemainAmt", async (_label, row, expected) => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(completedCreditRefundQueryRow(row)),
    }), { status: 200 })));

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: {
        id: "tx-query-refund",
        providerName: "payuni",
        orderNumber: row.MerTradeNo,
        providerTradeNo: row.TradeNo,
        grossAmountCents: 168_000,
      } as PaymentTransaction,
    })).resolves.toMatchObject(expected);
  });

  it.each([
    ["RefundStatus 1 application", { RefundStatus: "1" }],
    ["RefundStatus 8 processing", { RefundStatus: "8" }],
    ["DataSource B processing", { DataSource: "B" }],
    ["RefundType 3 scheduled", { RefundType: "3" }],
  ])("treats %s as pending and never as a refund success", async (_label, patch) => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(completedCreditRefundQueryRow({
        MerTradeNo: "CD-QUERY-PENDING",
        TradeNo: "trade-query-pending",
        ...patch,
      })),
    }), { status: 200 })));

    const query = payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query-pending", providerName: "payuni", orderNumber: "CD-QUERY-PENDING", providerTradeNo: "trade-query-pending", grossAmountCents: 168_000 } as PaymentTransaction,
    });
    await expect(query).rejects.toBeInstanceOf(PaymentQueryProviderError);
    await expect(query).rejects.toMatchObject({ category: "pending" });
  });

  it.each([
    ["missing PaymentType", { PaymentType: "" }],
    ["non-credit PaymentType", { PaymentType: "2" }],
    ["cancelled refund", { RefundStatus: "3" }],
    ["unknown refund status", { RefundStatus: "99" }],
    ["missing final RefundAmt", { RefundAmt: "" }],
    ["CloseAmt cannot replace RefundAmt", { RefundAmt: "", CloseAmt: "1680" }],
    ["missing RemainAmt", { RemainAmt: "" }],
    ["remaining balance above gross", { RemainAmt: "1681" }],
    ["final refund greater than cumulative refund", { RefundAmt: "1200", RemainAmt: "600" }],
    ["zero final refund", { RefundAmt: "0", RemainAmt: "840" }],
  ])("fails closed for unsupported or inconsistent credit query result: %s", async (_label, patch) => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(completedCreditRefundQueryRow({
        MerTradeNo: "CD-QUERY-INVALID-REFUND",
        TradeNo: "trade-query-invalid-refund",
        ...patch,
      })),
    }), { status: 200 })));

    const query = payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query-invalid-refund", providerName: "payuni", orderNumber: "CD-QUERY-INVALID-REFUND", providerTradeNo: "trade-query-invalid-refund", grossAmountCents: 168_000 } as PaymentTransaction,
    });
    await expect(query).rejects.toBeInstanceOf(PaymentQueryProviderError);
    await expect(query).rejects.toMatchObject({ category: "provider_response" });
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
    expect(normalized.payload.metadata).toBeUndefined();
    expect(duplicate.payload.eventId).toBe(normalized.payload.eventId);
  });

  it("keeps decrypted callback fields out of durable transaction metadata", async () => {
    stubPayUniEnv();
    const privateEmail = "buyer-private@example.test";
    const body = payUniEnvelope({
      MerID: "TESTMER",
      EventId: "payuni-private-fields-001",
      EventType: "paid",
      MerTradeNo: "CD-PRIVATE-001",
      TradeNo: "trade-private-001",
      TradeAmt: 1990,
      BuyerEmail: privateEmail,
      CardLastFour: "4242",
      Metadata: JSON.stringify({ formSubmissionId: "forged-submission" }),
    });

    const normalized = await payUniPaymentProvider.normalizePayload(body);

    expect(normalized.payload.metadata).toBeUndefined();
    expect(JSON.stringify(normalized.payload)).not.toContain(privateEmail);
    expect(normalized.rawPayload).toMatchObject({
      EventId: "payuni-private-fields-001",
      MerTradeNo: "CD-PRIVATE-001",
      TradeNo: "trade-private-001",
      omittedFieldCount: 3,
    });
    expect(JSON.stringify(normalized.rawPayload)).not.toContain(privateEmail);
    expect(normalized.rawPayload).not.toHaveProperty("BuyerEmail");
    expect(normalized.rawPayload).not.toHaveProperty("CardLastFour");
    expect(normalized.rawPayload).not.toHaveProperty("Metadata");
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
