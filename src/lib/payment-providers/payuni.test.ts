import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingPlan, PaymentTransaction, Product, Vendor } from "@prisma/client";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import { buildPayUniSandboxWebhookFixture } from "@/lib/payment-providers/payuni-fixtures";

const hashKey = "12345678901234567890123456789012";
const hashIv = "1234567890123456";

function stubPayUniEnv() {
  vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", hashKey);
  vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", hashIv);
  vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
}

function stubPayUniProductionEnv() {
  stubPayUniEnv();
  vi.stubEnv("PAYUNI_ENV", "production");
  vi.stubEnv("PAYUNI_HASH_KEY", hashKey);
  vi.stubEnv("PAYUNI_HASH_IV", hashIv);
  vi.stubEnv("PAYUNI_MERCHANT_ID", "TESTMER");
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
    MerID: "TESTMER",
    Version: "2.0",
    EncryptInfo: encryptInfo,
    HashInfo: createHash("sha256").update(`${hashKey}${encryptInfo}${hashIv}`).digest("hex").toUpperCase(),
  }).toString();
}

/** PayUni repeats the result Status outside the signed EncryptInfo. */
function withOuterStatus(body: string, status = "SUCCESS") {
  const params = new URLSearchParams(body);
  params.set("Status", status);
  return params.toString();
}

const uppPaidFields = { Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeNo: "PAYUNI-IDENTITY-001" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("unreferenced Sandbox order observation", () => {
  const transaction = { providerName: "payuni", providerTradeNo: null, orderNumber: "CD-READONLY-001", grossAmountCents: 100, status: "pending" } as PaymentTransaction;
  function enable() {
    stubPayUniEnv();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  }
  it("queries only the merchant order and authenticates not-found without a write", async () => {
    enable();
    const fetchMock = vi.fn().mockResolvedValue(new Response(payUniEnvelope({ Status: "QUERY03001" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(payUniPaymentProvider.queryUnreferencedSandboxPayment?.({ transaction })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox-api.payuni.com.tw/api/trade/query");
    expect(init.redirect).toBe("error");
    expect(decryptCheckoutPayload(init.body.get("EncryptInfo"))).toEqual({ MerID: "TESTMER", MerTradeNo: "CD-READONLY-001", Timestamp: expect.any(String) });
    // Existing reconciliation still requires a known provider identity.
    await expect(payUniPaymentProvider.queryPayment?.({ transaction })).rejects.toMatchObject({ category: "request_contract" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["PAYUNI_ENV", "production"], ["VERCEL_ENV", "production"], ["WP4_SANDBOX_EXECUTOR_ENABLED", "false"],
  ])("rejects %s=%s before network access", async (name, value) => {
    enable();
    vi.stubEnv(name, value);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(payUniPaymentProvider.queryUnreferencedSandboxPayment?.({ transaction })).rejects.toMatchObject({ category: "request_contract" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { status: "paid" }, { providerTradeNo: "known" }, { providerName: "demo" }, { orderNumber: " invalid " }, { grossAmountCents: 0 },
  ])("rejects invalid transaction identity before network access", async (overrides) => {
    enable();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(payUniPaymentProvider.queryUnreferencedSandboxPayment?.({ transaction: { ...transaction, ...overrides } })).rejects.toMatchObject({ category: "request_contract" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects unsigned not-found and authenticated unknown errors", async () => {
    enable();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ Status: "QUERY03001" })))
      .mockResolvedValueOnce(new Response(payUniEnvelope({ Status: "UNKNOWN" }))));
    await expect(payUniPaymentProvider.queryUnreferencedSandboxPayment?.({ transaction })).rejects.toMatchObject({ category: "authentication" });
    await expect(payUniPaymentProvider.queryUnreferencedSandboxPayment?.({ transaction })).rejects.toMatchObject({ category: "provider_response" });
  });
  it.each([
    ["CD-READONLY-001", "1", true], ["OTHER-ORDER", "1", false], ["CD-READONLY-001", "2", false],
  ])("validates returned order %s and amount %s", async (orderNumber, amount, valid) => {
    enable();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({ Status: "SUCCESS", Result: { MerTradeNo: orderNumber, TradeNo: "provider-reference", TradeAmt: amount, RemainAmt: amount, DataSource: "A", PaymentType: "1", TradeStatus: "1" } }))));
    const result = payUniPaymentProvider.queryUnreferencedSandboxPayment?.({ transaction });
    if (valid) await expect(result).resolves.toMatchObject({ orderNumber, grossAmountCents: 100, status: "paid" });
    else await expect(result).rejects.toMatchObject({ category: "provider_response" });
  });
});

describe("documented CREDIT query v2.0 refund evidence", () => {
  const transaction = { id: "tx-terminal", providerName: "payuni", orderNumber: "CD-TERMINAL-001",
    providerTradeNo: "trade-terminal", grossAmountCents: 100_000 } as PaymentTransaction;
  function query(patch: Record<string, unknown>) {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({ Status: "SUCCESS", Result: {
      MerTradeNo: transaction.orderNumber, TradeNo: transaction.providerTradeNo, TradeAmt: "1000",
      TradeStatus: "1", PaymentType: "1", DataSource: "A", RefundStatus: "2",
      RefundAmt: "200", RemainAmt: "500", ...patch,
    } }))));
    return payUniPaymentProvider.queryPayment!({ transaction });
  }
  it("uses remaining balance for cumulative refunds, not the last refund amount", async () => {
    await expect(query({})).resolves.toMatchObject({ status: "partially_refunded",
      refundedAmountCents: 50_000, remainingRefundableAmountCents: 50_000 });
  });
  it("recognizes full cumulative refund after multiple partial refunds", async () => {
    await expect(query({ RemainAmt: "0" })).resolves.toMatchObject({ status: "refunded",
      refundedAmountCents: 100_000, remainingRefundableAmountCents: 0 });
  });
  it("accepts a complete paid observation with no refund fields", async () => {
    await expect(query({ RefundStatus: "", RefundAmt: "", RemainAmt: "1000" })).resolves.toMatchObject({
      status: "paid", refundedAmountCents: 0, remainingRefundableAmountCents: 100_000 });
  });
  it.each(["0", "1", "3", "8", "9", "future"])("rejects nonterminal or undocumented refund state %s", async (RefundStatus) => {
    await expect(query({ RefundStatus, RemainAmt: "0" })).rejects.toMatchObject({ category: "provider_response" });
  });
  it.each([
    { DataSource: "B" }, { DataSource: "" },
    { TradeStatus: "2" }, { TradeStatus: "4" }, { TradeStatus: "8" }, { TradeStatus: "6" },
    { RemainAmt: "" }, { RemainAmt: "1001" }, { RemainAmt: "-1" }, { RemainAmt: "500junk" },
    { RefundAmt: "0" }, { RefundAmt: "501" }, { RefundAmt: "200junk" },
    { RefundStatus: "", RemainAmt: "500" }, { RefundStatus: "", RemainAmt: "1000", RefundAmt: "1" },
  ])("rejects incomplete or inconsistent evidence %j", async (patch) => {
    await expect(query(patch)).rejects.toMatchObject({ category: "provider_response" });
  });
  it.each([{ PaymentType: "2" }, { PaymentType: "" }])("routes a collected non-card trade %j to manual reconciliation (R448-01)", async (patch) => {
    await expect(query(patch)).rejects.toMatchObject({ category: "manual_reconciliation" });
  });
});

describe("PayUni provider", () => {
  it("reports checkout readiness only when all required runtime configuration is valid", () => {
    vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "");
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("unavailable");

    stubPayUniEnv();
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("ready");

    vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", "too-short");
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("unavailable");

    stubPayUniEnv();
    vi.stubEnv("PAYUNI_ENV", "invalid");
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("unavailable");
  });

  it("blocks ordinary checkout on a Preview connected to the live merchant", async () => {
    stubPayUniEnv();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PAYUNI_ENV", "production");
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("unavailable");
    await expect(payUniPaymentProvider.createCheckoutSession?.({
      transaction: { id: "tx_1", orderNumber: "CD-TEST-001", grossAmountCents: 199000 } as PaymentTransaction,
      vendor: { id: "vendor-1" } as Vendor,
      description: "Ordinary checkout",
      appUrl: "https://staging.example.test",
      returnAppUrl: "https://staging.example.test",
    })).rejects.toThrow("General PayUni checkout is disabled");
  });

  it("allows only the scoped 2 TWD staging plan through the production UPP", async () => {
    stubPayUniProductionEnv();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/prelaunch-engineering-20260929");
    vi.stubEnv("PAYMENT_PROVIDER", "payuni");
    vi.stubEnv("PAYUNI_STAGING_PLAN_TEST_ENABLED", "true");
    vi.stubEnv("PAYUNI_STAGING_PLAN_TEST_VENDOR_ID", "synthetic-vendor");
    vi.stubEnv("VERCEL_URL", "staging-test.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://celebrate-deal-staging.carry-digital-nomad.in.net");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ocbugvgojrunvenozsbx.supabase.co");
    vi.stubEnv("DATABASE_URL", "postgresql:" + "//postgres.ocbugvgojrunvenozsbx:synthetic@aws-0-ap-northeast-1.pooler.supabase.com/postgres");
    vi.stubEnv("DIRECT_URL", "postgresql:" + "//postgres:synthetic@db.ocbugvgojrunvenozsbx.supabase.co/postgres");
    vi.stubEnv("STAGING_DATABASE_URL", "postgresql:" + "//postgres:synthetic@db.ocbugvgojrunvenozsbx.supabase.co/postgres");
    const billingPlan = { id: "growth-id", code: "staging-payuni-growth", name: "Growth", monthlyPriceCents: 200, isActive: false, description: `staging-payuni-plan-v1:${JSON.stringify({ deploymentHost: "staging-test.vercel.app", merchantId: "TESTMER", vendorId: "synthetic-vendor", expiresAt: "2099-01-01T00:00:00.000Z" })}` } as BillingPlan;
    const transaction = {
      id: "tx-growth", vendorId: "synthetic-vendor", orderNumber: "CD-TEST-002",
      providerName: "payuni", paymentMode: "platform", status: "pending", currency: "TWD",
      grossAmountCents: 200,
      metadata: { billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "sub-growth", billingPlanId: "growth-id", billingPlanCode: "staging-payuni-growth", stagingPayUniPlanPermit: billingPlan.description },
    } as unknown as PaymentTransaction;
    const vendor = { id: "synthetic-vendor" } as Vendor;
    expect(payUniPaymentProvider.checkoutReadiness()).toBe("unavailable");
    const session = await payUniPaymentProvider.createCheckoutSession?.({
      transaction, billingPlan, vendor,
      appUrl: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    });
    expect(session?.formAction).toBe("https://api.payuni.com.tw/api/upp");
    expect(decryptCheckoutPayload(session?.formPayload?.EncryptInfo ?? "")).toMatchObject({ TradeAmt: "2" });
    await expect(payUniPaymentProvider.createCheckoutSession?.({
      transaction: { ...transaction, grossAmountCents: 300 }, billingPlan, vendor,
      appUrl: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    })).rejects.toThrow("General PayUni checkout is disabled");
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
      Credit: "1",
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

  it("separates the browser ReturnURL from the canonical NotifyURL", async () => {
    stubPayUniEnv();
    const session = await payUniPaymentProvider.createCheckoutSession?.({
      transaction: { id: "tx_preview_return", orderNumber: "CD-TEST-007", grossAmountCents: 100 } as PaymentTransaction,
      product: { name: "Sandbox Product" } as Product,
      vendor: { id: "vendor_1" } as Vendor,
      appUrl: "https://staging.example.test",
      returnAppUrl: "https://preview.example.test",
    });

    const payload = decryptCheckoutPayload(session?.formPayload?.EncryptInfo ?? "");
    expect(new URL(payload.ReturnURL).origin).toBe("https://preview.example.test");
    expect(new URL(payload.NotifyURL).origin).toBe("https://staging.example.test");
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

  it("accepts PayUni's bracket-encoded refund Result row", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      "Result[0][TradeNo]": "trade-bracket-123",
      "Result[0][CloseType]": "2",
      "Result[0][CloseNo]": "refund-bracket-456",
    }), { status: 200 })));

    await expect(payUniPaymentProvider.refundPayment?.({
      transaction: { id: "tx-bracket", providerTradeNo: "trade-bracket-123", grossAmountCents: 100 } as PaymentTransaction,
      refundAmountCents: 100,
      requestId: "local-request-id",
    })).resolves.toEqual({ providerEventId: "refund-bracket-456" });
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
      CreditTokenType: "2",
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
      Result: JSON.stringify({
        MerTradeNo: "CD-QUERY-001",
        TradeNo: "trade-query-123",
        TradeAmt: "1680",
        TradeStatus: "1",
        RefundStatus: "2", RefundAmt: "1680", RemainAmt: "0", DataSource: "A", PaymentType: "1",
      }),
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

  it("fails closed when a partial query has no provider refund amount", async () => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify({
        MerTradeNo: "CD-QUERY-002",
        TradeNo: "trade-query-234",
        TradeAmt: "1680",
        TradeStatus: "1",
        RefundStatus: "2", RemainAmt: "1500", DataSource: "A", PaymentType: "1",
      }),
    }), { status: 200 })));

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "payuni", orderNumber: "CD-QUERY-002", providerTradeNo: "trade-query-234", grossAmountCents: 168_000 } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
  });

  it.each(["1680junk", "1680.5", "1e3", " 1680"]) ("rejects non-strict PayUni query amount %s", async (tradeAmount) => {
    stubPayUniEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify({
        MerTradeNo: "CD-QUERY-STRICT",
        TradeNo: "trade-query-strict",
        TradeAmt: tradeAmount,
        TradeStatus: "1",
        RefundStatus: "2", RefundAmt: "1680", RemainAmt: "0", DataSource: "A", PaymentType: "1",
      }),
    }), { status: 200 })));

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "payuni", orderNumber: "CD-QUERY-STRICT", providerTradeNo: "trade-query-strict", grossAmountCents: 168_000 } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
  });

  it("queries the fixed Production endpoint exactly once and preserves the read-only request contract", async () => {
    stubPayUniProductionEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify({
        MerTradeNo: "CD-QUERY-003",
        TradeNo: "trade-query-345",
        TradeAmt: "1680",
        TradeStatus: "1",
        RefundStatus: "2", RefundAmt: "1680", RemainAmt: "0", DataSource: "A", PaymentType: "1",
      }),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "payuni", orderNumber: "CD-QUERY-003", providerTradeNo: "trade-query-345", grossAmountCents: 168_000 } as PaymentTransaction,
    })).resolves.toEqual({
      providerTradeNo: "trade-query-345",
      orderNumber: "CD-QUERY-003",
      grossAmountCents: 168_000,
      refundedAmountCents: 168_000,
      remainingRefundableAmountCents: 0,
      status: "refunded",
    });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://api.payuni.com.tw/api/trade/query",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as URLSearchParams;
    expect(form.get("Version")).toBe("2.0");
    expect(decryptCheckoutPayload(form.get("EncryptInfo") ?? "")).toMatchObject({ MerID: "TESTMER", MerTradeNo: "CD-QUERY-003" });
    expect(JSON.stringify(request)).not.toContain(hashKey);
    expect(JSON.stringify(request)).not.toContain(hashIv);
  });

  it.each([
    ["provider reference", { TradeNo: "different-trade", TradeAmt: "1680" }],
    ["gross amount", { TradeNo: "trade-query-346", TradeAmt: "1681" }],
    ["order reference", { MerTradeNo: "different-order", TradeNo: "trade-query-346", TradeAmt: "1680" }],
  ])("fails closed when Production query identity does not match the transaction: %s", async (_label, resultPatch) => {
    stubPayUniProductionEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response(payUniEnvelope({
      Status: "SUCCESS",
      Result: JSON.stringify(Object.assign({
        MerTradeNo: "CD-QUERY-004",
        TradeNo: "trade-query-346",
        TradeAmt: "1680",
        TradeStatus: "1",
        RefundStatus: "2", RefundAmt: "1680", RemainAmt: "0", DataSource: "A", PaymentType: "1",
      }, resultPatch)),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "payuni", orderNumber: "CD-QUERY-004", providerTradeNo: "trade-query-346", grossAmountCents: 168_000 } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed before any provider call for a non-PayUni transaction", async () => {
    stubPayUniProductionEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.queryPayment?.({
      transaction: { id: "tx-query", providerName: "stripe", orderNumber: "CD-QUERY-005", providerTradeNo: "trade-query-347", grossAmountCents: 168_000 } as PaymentTransaction,
    })).rejects.toThrow("Payment provider query failed.");
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(normalized.payload.eventId).toBe("PAYUNI-SANDBOX-TRADE-001:1");
    expect(normalized.payload.orderNumber).toBe("CD-SANDBOX-PAID-001");
    // Real UPP callbacks never carry a referral code or net amount.
    expect(normalized.payload.referralCode).toBeUndefined();
    expect(normalized.payload.netAmountCents).toBeUndefined();
    expect(normalized.payload.metadata).toBeUndefined();
    expect(duplicate.payload.eventId).toBe(normalized.payload.eventId);
  });

  it.each([
    ["missing", undefined],
    ["non-numeric", "garbage"],
    ["zero", "0"],
    ["numeric prefix", "1990junk"],
  ])("rejects a signed paid callback with %s trade amount", async (_label, tradeAmount) => {
    stubPayUniEnv();
    const body = withOuterStatus(payUniEnvelope({
      MerID: "TESTMER",
      Status: "SUCCESS",
      TradeStatus: "1",
      PaymentType: "1",
      TradeNo: "PAYUNI-INVALID-AMOUNT-001",
      MerTradeNo: "CD-INVALID-AMOUNT-001",
      ...(tradeAmount === undefined ? {} : { TradeAmt: tradeAmount }),
    }));

    await expect(payUniPaymentProvider.verifySignature(new Request("https://app.example.test"), body)).resolves.toBe(true);
    await expect(payUniPaymentProvider.normalizePayload(body)).rejects.toThrow("Invalid PayUni trade amount.");
  });

  it.each([1990, "1990", "1990.00"])("keeps signed PayUni trade amount %s compatible", async (tradeAmount) => {
    stubPayUniEnv();
    const body = withOuterStatus(payUniEnvelope({
      MerID: "TESTMER",
      Status: "SUCCESS",
      TradeStatus: "1",
      PaymentType: "1",
      TradeNo: "PAYUNI-VALID-AMOUNT-001",
      MerTradeNo: "CD-VALID-AMOUNT-001",
      TradeAmt: tradeAmount,
    }));

    await expect(payUniPaymentProvider.verifySignature(new Request("https://app.example.test"), body)).resolves.toBe(true);
    const normalized = await payUniPaymentProvider.normalizePayload(body);
    expect(normalized.payload.grossAmountCents).toBe(199_000);
  });

  it("keeps a signed refund callback without an original trade amount compatible", async () => {
    stubPayUniEnv();
    const body = payUniEnvelope({
      MerID: "TESTMER",
      EventId: "payuni-refund-no-trade-amount-001",
      EventType: "refunded",
      MerTradeNo: "CD-REFUND-NO-TRADE-001",
      RefundAmount: "1990",
    });

    await expect(payUniPaymentProvider.verifySignature(new Request("https://app.example.test"), body)).resolves.toBe(true);
    const normalized = await payUniPaymentProvider.normalizePayload(body);
    expect(normalized.payload.grossAmountCents).toBe(0);
    expect(normalized.payload.refundAmountCents).toBe(199_000);
  });

  it("keeps decrypted callback fields out of durable transaction metadata", async () => {
    stubPayUniEnv();
    const privateEmail = "buyer-private@example.test";
    const body = withOuterStatus(payUniEnvelope({
      MerID: "TESTMER",
      Status: "SUCCESS",
      TradeStatus: "1",
      PaymentType: "1",
      MerTradeNo: "CD-PRIVATE-001",
      TradeNo: "trade-private-001",
      TradeAmt: 1990,
      BuyerEmail: privateEmail,
      CardLastFour: "4242",
      Metadata: JSON.stringify({ formSubmissionId: "forged-submission" }),
    }));

    const normalized = await payUniPaymentProvider.normalizePayload(body);

    expect(normalized.payload.metadata).toBeUndefined();
    expect(JSON.stringify(normalized.payload)).not.toContain(privateEmail);
    expect(normalized.rawPayload).toMatchObject({
      TradeStatus: "1",
      PaymentType: "1",
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
    [{ ...uppPaidFields, VendorId: "vendor_1", TradeAmt: 1990 }, "Missing PayUni order number."],
    [{ ...uppPaidFields, VendorId: "vendor_1", TradeAmt: 1990, MerTradeNo: "" }, "Missing PayUni order number."],
    [{ ...uppPaidFields, TradeNo: "", TradeAmt: 1990, MerTradeNo: "CD-NO-TRADE-NO" }, "Missing PayUni trade number."],
  ])("rejects a payload without stable transaction identity", async (payload, error) => {
    stubPayUniEnv();

    await expect(payUniPaymentProvider.normalizePayload(JSON.stringify(payload))).rejects.toThrow(error);
  });
});

// F-037: PayUni UPP 2.0 Notify/Return use the documented fields only. The
// outer Status is unsigned (it passes through the payer's browser on
// ReturnURL); the decision fields live in the signed EncryptInfo. There is no
// EventType, NetAmount, GatewayFee, ReferralCode, VendorId or EventId.
describe("PayUni UPP 2.0 payment callback contract (F-037)", () => {
  const realPaid = {
    MerID: "TESTMER",
    Status: "SUCCESS",
    TradeStatus: "1",
    PaymentType: "1",
    TradeNo: "PAYUNI-REAL-TRADE-001",
    MerTradeNo: "CD-REAL-001",
    TradeAmt: "1990",
  };

  function realCallback(fields: Record<string, string>, outerStatus: string | null = fields.Status ?? null) {
    const params = new URLSearchParams(payUniEnvelope(fields));
    if (outerStatus !== null) params.set("Status", outerStatus);
    return params.toString();
  }

  async function normalizeReal(fields: Record<string, string>, outerStatus?: string | null) {
    stubPayUniEnv();
    const body = realCallback(fields, outerStatus);
    await expect(payUniPaymentProvider.verifySignature(new Request("https://app.example.test"), body)).resolves.toBe(true);
    return payUniPaymentProvider.normalizePayload(body);
  }

  it("records a signed credit-card TradeStatus 1 as paid with one event ID per trade state", async () => {
    const { payload } = await normalizeReal(realPaid);
    expect(payload).toMatchObject({
      provider: "payuni",
      eventType: "paid",
      eventId: "PAYUNI-REAL-TRADE-001:1",
      orderNumber: "CD-REAL-001",
      providerTradeNo: "PAYUNI-REAL-TRADE-001",
      grossAmountCents: 199_000,
    });
    expect(payload.vendorId).toBeUndefined();
    expect(payload.referralCode).toBeUndefined();
  });

  it("leaves absent provider fee and net fields undefined instead of writing zero (F-040)", async () => {
    const { payload } = await normalizeReal(realPaid);
    expect(payload.netAmountCents).toBeUndefined();
    // The schema default keeps the stored fee unless the provider sends one.
    expect(payload.gatewayFeeCents).toBe(0);
    const withFees = await normalizeReal({ ...realPaid, GatewayFee: "56", NetAmount: "1934" });
    expect(withFees.payload).toMatchObject({ gatewayFeeCents: 5_600, netAmountCents: 193_400 });
  });

  it.each(["0", "8"])("never pays a pending TradeStatus %s and leaves the payment unchanged", async (tradeStatus) => {
    await expect(normalizeReal({ ...realPaid, TradeStatus: tradeStatus })).rejects.toMatchObject({
      name: "PaymentWebhookNotActionableError", reason: "trade_pending", requiresManualReconciliation: false,
      identifiers: { orderNumber: "CD-REAL-001", providerTradeNo: "PAYUNI-REAL-TRADE-001", tradeStatus, paymentType: "1" },
    });
  });

  it.each(["2", "3", "4", "9"])("records a terminal unpaid TradeStatus %s as failed, never paid", async (tradeStatus) => {
    const { payload } = await normalizeReal({ ...realPaid, TradeStatus: tradeStatus });
    expect(payload.eventType).toBe("failed");
    expect(payload.eventId).toBe(`PAYUNI-REAL-TRADE-001:${tradeStatus}`);
  });

  it.each(["2", "3", "5", "6", "7", "9", "11", ""])("never pays a signed TradeStatus 1 with non-card PaymentType %j", async (paymentType) => {
    const fields: Record<string, string> = { ...realPaid, PaymentType: paymentType };
    if (!paymentType) delete fields.PaymentType;
    await expect(normalizeReal(fields)).rejects.toMatchObject({
      name: "PaymentWebhookNotActionableError", reason: "payment_type_not_allowed", requiresManualReconciliation: true,
      identifiers: { orderNumber: "CD-REAL-001", providerTradeNo: "PAYUNI-REAL-TRADE-001", tradeStatus: "1",
        ...(paymentType ? { paymentType } : {}) },
      rawSnapshot: expect.objectContaining({ MerTradeNo: "CD-REAL-001", TradeStatus: "1", OuterStatus: "SUCCESS" }),
    });
  });

  it.each([
    ["inner UNKNOWN", { Status: "UNKNOWN" }, "UNKNOWN"],
    ["inner UNAPPROVED", { Status: "UNAPPROVED" }, "UNAPPROVED"],
    ["outer status missing", {}, null],
    ["outer status disagrees", {}, "UNKNOWN"],
  ] as const)("never pays TradeStatus 1 when %s", async (_label, override, outerStatus) => {
    await expect(normalizeReal({ ...realPaid, ...override }, outerStatus)).rejects.toThrow();
  });

  it("separates an unsigned outer Status mismatch from a signed provider status (RR-01)", async () => {
    await expect(normalizeReal(realPaid, null)).rejects.toMatchObject({
      reason: "outer_status_mismatch", requiresManualReconciliation: true,
      identifiers: { orderNumber: "CD-REAL-001", providerTradeNo: "PAYUNI-REAL-TRADE-001", tradeStatus: "1", paymentType: "1" },
    });
    await expect(normalizeReal(realPaid, "UNKNOWN")).rejects.toMatchObject({ reason: "outer_status_mismatch" });
    await expect(normalizeReal({ ...realPaid, Status: "UNKNOWN" }, "SUCCESS")).rejects.toMatchObject({ reason: "provider_status_not_success" });
  });

  it.each(["12abc", "1e3", "-5", "35.5"])("rejects a non-strict provider fee %j (R448-08)", async (fee) => {
    await expect(normalizeReal({ ...realPaid, GatewayFee: fee })).rejects.toThrow("Invalid PayUni amount field.");
  });

  it.each(["5", "10", "x", ""])("fails closed on an undocumented TradeStatus %j", async (tradeStatus) => {
    await expect(normalizeReal({ ...realPaid, TradeStatus: tradeStatus })).rejects.toThrow();
  });

  it("does not accept a signed custom EventType=paid without the PayUni trade status", async () => {
    stubPayUniEnv();
    const body = payUniEnvelope({ MerID: "TESTMER", EventId: "legacy-paid", EventType: "paid", MerTradeNo: "CD-LEGACY-001",
      TradeNo: "PAYUNI-LEGACY-001", TradeAmt: "1990" });
    await expect(payUniPaymentProvider.normalizePayload(body)).rejects.toThrow();
  });

  it("ignores a signed EventId and keys Return and Notify of one trade state to the same event", async () => {
    const notify = await normalizeReal({ ...realPaid, EventId: "attacker-chosen" });
    const payerReturn = await normalizeReal(realPaid);
    expect(notify.payload.eventId).toBe("PAYUNI-REAL-TRADE-001:1");
    expect(payerReturn.payload.eventId).toBe(notify.payload.eventId);
  });

  it("keeps a failed attempt and a later paid result of one trade as separate events", async () => {
    const failed = await normalizeReal({ ...realPaid, TradeStatus: "2" });
    const paid = await normalizeReal(realPaid);
    expect(failed.payload.eventId).not.toBe(paid.payload.eventId);
  });

  it("restricts buyer checkout to credit card payment on the UPP page", async () => {
    stubPayUniEnv();
    const session = await payUniPaymentProvider.createCheckoutSession?.({
      transaction: { id: "tx_credit", orderNumber: "CD-CREDIT-001", grossAmountCents: 199_000 } as PaymentTransaction,
      product: { name: "Credit Only" } as Product,
      vendor: { id: "vendor_1" } as Vendor,
      appUrl: "https://celebratedeal.carry-digital-nomad.in.net",
    });
    const payload = decryptCheckoutPayload(session?.formPayload?.EncryptInfo ?? "");
    expect(payload.Credit).toBe("1");
    for (const method of ["ATM", "CVS", "ICash", "Aftee", "LinePay", "JKoPay", "CreditInst", "CreditUnionPay", "ApplePay", "GooglePay", "SamsungPay", "Ship", "ShipTag"]) {
      expect(payload).not.toHaveProperty(method);
    }
  });
});
