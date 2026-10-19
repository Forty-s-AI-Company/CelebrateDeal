import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Vendor } from "@prisma/client";

const dbMocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ paymentMethodSetupIntent: { findUnique: dbMocks.findUnique } }),
}));

import { chargePayUniLiveProbe, normalizePayUniLiveProbeCallback, payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import { payUniSetupNonce } from "@/lib/payuni-setup-correlation";
import { PaymentMethodSetupMalformedPayloadError, PaymentMethodSetupProviderResultError } from "@/lib/payment-providers/types";

const hashKey = "12345678901234567890123456789012";
const hashIv = "1234567890123456";
const orderNumber = "pmABCDEFGHIJKLMNOPQRSTUV";

function environment() {
  vi.stubEnv("PAYUNI_HASH_KEY", hashKey);
  vi.stubEnv("PAYUNI_HASH_IV", hashIv);
  vi.stubEnv("PAYUNI_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_ENV", "production");
}

function decrypt(encryptInfo: string) {
  const [encrypted, tag] = Buffer.from(encryptInfo, "hex").toString("utf8").split(":::");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(hashKey), Buffer.from(hashIv));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Object.fromEntries(new URLSearchParams(Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")), decipher.final(),
  ]).toString("utf8")));
}

function signedCallback(payload: Record<string, string>, version = "2.0", signingKey = hashKey, signingIv = hashIv, outerStatus = "SUCCESS") {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(signingKey), Buffer.from(signingIv));
  const encrypted = Buffer.concat([
    cipher.update(new URLSearchParams(payload).toString(), "utf8"), cipher.final(),
  ]).toString("base64");
  const encryptInfo = Buffer.from(`${encrypted}:::${cipher.getAuthTag().toString("base64")}`).toString("hex");
  return new URLSearchParams({
    MerID: "TESTMER", Version: version, Status: outerStatus, EncryptInfo: encryptInfo,
    HashInfo: createHash("sha256").update(`${signingKey}${encryptInfo}${signingIv}`).digest("hex").toUpperCase(),
  }).toString();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  dbMocks.findUnique.mockReset();
});

describe("PAYUNi one-time CreditHash charge", () => {
  it("posts one dollar to the official production Credit API and checks the signed result", async () => {
    environment();
    const secondOrder = "pcABCDEFGHIJKLMNOPQRSTUV";
    const callback = signedCallback({
      MerID: "TESTMER", MerTradeNo: secondOrder, TradeNo: "TRADE-2",
      Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "1",
    }, "1.3");
    const fetchMock = vi.fn().mockResolvedValue(new Response(callback));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chargePayUniLiveProbe({
      orderNumber: secondOrder, creditHash: "opaque-credit-hash", appUrl: "https://staging.example.test",
    })).resolves.toEqual({ status: "confirmed", providerTradeNo: "TRADE-2" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.payuni.com.tw/api/credit");
    expect(init.redirect).toBe("error");
    expect(decrypt(init.body.get("EncryptInfo"))).toMatchObject({
      MerID: "TESTMER", MerTradeNo: secondOrder, TradeAmt: "1",
      CreditHash: "opaque-credit-hash",
      NotifyURL: "https://staging.example.test/api/webhooks/payuni-live-probe",
    });
    expect(normalizePayUniLiveProbeCallback(callback)).toEqual({
      orderNumber: secondOrder, status: "confirmed", providerTradeNo: "TRADE-2",
    });
  });

  it("does not retry a timeout or accept a mismatched signed order", async () => {
    environment();
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chargePayUniLiveProbe({
      orderNumber: "pcABCDEFGHIJKLMNOPQRSTUV", creditHash: "opaque-credit-hash",
      appUrl: "https://staging.example.test",
    })).resolves.toEqual({ status: "ambiguous" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const mismatched = signedCallback({
      MerID: "TESTMER", MerTradeNo: "pcOTHERORDERABCDEFGHIJ", TradeNo: "TRADE-2",
      Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "1",
    }, "1.3");
    fetchMock.mockResolvedValue(new Response(mismatched));
    await expect(chargePayUniLiveProbe({
      orderNumber: "pcABCDEFGHIJKLMNOPQRSTUV", creditHash: "opaque-credit-hash",
      appUrl: "https://staging.example.test",
    })).resolves.toEqual({ status: "ambiguous" });
  });
});

describe("PAYUNi official UPP setup contract", () => {
  it("rejects a Sandbox signed callback while Production credentials are selected", async () => {
    environment();
    const body = signedCallback({
      MerID: "SANDBOXMER", MerTradeNo: orderNumber, TradeNo: "SANDBOX-TRADE",
      Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "1",
      CreditHash: "sandbox-credit-hash",
    }, "2.0", "s".repeat(32), "s".repeat(16));
    expect(await payUniPaymentProvider.verifyPaymentMethodSetupSignature?.(new Request("https://app.test"), body)).toBe(false);
    expect(dbMocks.findUnique).not.toHaveBeenCalled();
  });

  it("requires an explicit one-dollar, merchant-scoped, cancelable Token setup", async () => {
    environment();
    const session = await payUniPaymentProvider.createPaymentMethodSetupSession?.({
      intentId: orderNumber,
      setupNonce: payUniSetupNonce(orderNumber),
      vendor: { id: "vendor-1" } as Vendor,
      scopeType: "VENDOR",
      appUrl: "https://staging.example.test",
      returnPath: "/billing/payment-methods",
    });
    expect(session?.formAction).toBe("https://api.payuni.com.tw/api/upp");
    const payload = decrypt(session!.formPayload!.EncryptInfo);
    expect(payload).toMatchObject({
      MerID: "TESTMER", MerTradeNo: orderNumber, TradeAmt: "1", Credit: "1",
      CreditToken: payUniSetupNonce(orderNumber), UseTokenType: "1", CreditTokenType: "2",
      ReturnURL: "https://staging.example.test/api/webhooks/payment-methods?provider=payuni&source=return",
      NotifyURL: "https://staging.example.test/api/webhooks/payment-methods?provider=payuni&source=notify",
    });
    expect(dbMocks.findUnique).not.toHaveBeenCalled();
  });

  it("cancels the same single-merchant token scope selected during setup", async () => {
    environment();
    const session = await payUniPaymentProvider.createPaymentMethodSetupSession?.({
      intentId: orderNumber,
      setupNonce: payUniSetupNonce(orderNumber),
      vendor: { id: "vendor-1" } as Vendor,
      scopeType: "VENDOR",
      appUrl: "https://staging.example.test",
      returnPath: "/billing/payment-methods",
    });
    const setupPayload = decrypt(session!.formPayload!.EncryptInfo);
    const fetchMock = vi.fn().mockResolvedValue(new Response(signedCallback({
      MerID: "TESTMER", Status: "SUCCESS", BindVal: "opaque-credit-hash",
    }, "1.0")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(payUniPaymentProvider.revokePaymentMethodReference?.({
      providerPaymentMethodRef: "opaque-credit-hash",
    })).resolves.toEqual({});

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.payuni.com.tw/api/credit_bind/cancel");
    const cancellationPayload = decrypt(init.body.get("EncryptInfo"));
    expect(setupPayload.CreditTokenType).toBe("2");
    expect(cancellationPayload).toMatchObject({
      CreditTokenType: setupPayload.CreditTokenType,
      UseTokenType: "1", BindVal: "opaque-credit-hash",
    });
  });

  it("accepts only a signed paid card result with CreditHash", async () => {
    environment();
    dbMocks.findUnique.mockResolvedValue({
      id: orderNumber, vendorId: "vendor-1", providerName: "payuni",
      scopeType: "VENDOR", teamId: null, membershipId: null,
    });
    const body = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, TradeNo: "TRADE-1",
      Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "1",
      CreditHash: "opaque-credit-hash",
    });
    expect(await payUniPaymentProvider.verifyPaymentMethodSetupSignature?.(new Request("https://app.test"), body)).toBe(true);
    await expect(payUniPaymentProvider.normalizePaymentMethodSetupPayload?.(body)).resolves.toMatchObject({
      setupIntentId: orderNumber, setupNonce: payUniSetupNonce(orderNumber),
      vendorId: "vendor-1", providerPaymentMethodRef: "opaque-credit-hash",
      eventId: "setup:TRADE-1",
    });
    const withoutHash = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, TradeNo: "TRADE-1",
      Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "1",
    });
    await expect(payUniPaymentProvider.normalizePaymentMethodSetupPayload?.(withoutHash)).rejects.toThrow();
    const wrongAmount = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, TradeNo: "TRADE-1",
      Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "2",
      CreditHash: "opaque-credit-hash",
    });
    await expect(payUniPaymentProvider.normalizePaymentMethodSetupPayload?.(wrongAmount)).rejects.toThrow();
  });
  function pendingIntent() {
    return {
      id: orderNumber, vendorId: "vendor-1", providerName: "payuni",
      status: "pending", expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  async function normalizeError(body: string) {
    return payUniPaymentProvider.normalizePaymentMethodSetupPayload?.(body).catch((caught: unknown) => caught);
  }

  it("classifies a signed UPP rejection as a provider decline with codes only", async () => {
    environment();
    dbMocks.findUnique.mockResolvedValue(pendingIntent());
    const body = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, Status: "UPP02086", Message: "商店未提供約定信用卡幕後交易",
      CreditHash: "opaque-credit-hash", Card6No: "414763", Card4No: "0001", UsrMail: "buyer@example.test",
    }, "2.0", hashKey, hashIv, "UPP02086");
    expect(await payUniPaymentProvider.verifyPaymentMethodSetupSignature?.(new Request("https://app.test"), body)).toBe(true);

    const error = await normalizeError(body);

    expect(error).toBeInstanceOf(PaymentMethodSetupProviderResultError);
    const result = error as PaymentMethodSetupProviderResultError;
    expect(result.outcome).toBe("declined");
    expect(result.diagnostics).toEqual({ status: "UPP02086" });
    expect(result.resultKey).toMatch(/^[0-9a-f]{32}$/u);
    expect(result.scope).toEqual({ setupIntentId: orderNumber, vendorId: "vendor-1" });
    expect(JSON.stringify(result)).not.toMatch(/opaque-credit-hash|414763|0001|buyer@example|商店未提供/u);
    expect(dbMocks.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: orderNumber }, select: { id: true, vendorId: true, providerName: true, status: true, expiresAt: true },
    });
  });

  it.each([
    ["consumed", { status: "verified" }],
    ["expired", { expiresAt: new Date(Date.now() - 1000) }],
    ["other provider", { providerName: "demo" }],
  ])("does not attribute a decline to a %s intent", async (_label, override) => {
    environment();
    dbMocks.findUnique.mockResolvedValue({ ...pendingIntent(), ...override });
    const body = signedCallback({ MerID: "TESTMER", MerTradeNo: orderNumber, Status: "UPP02086" }, "2.0", hashKey, hashIv, "UPP02086");
    const error = await normalizeError(body) as PaymentMethodSetupProviderResultError;
    expect(error).toBeInstanceOf(PaymentMethodSetupProviderResultError);
    expect(error.scope).toBeNull();
  });

  it("keeps bounded card result codes and a code-shaped message from a declined authorization", async () => {
    environment();
    dbMocks.findUnique.mockResolvedValue(null);
    const body = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, TradeNo: "TRADE-1", Status: "CREDIT05001", Message: "CREDIT05001",
      TradeStatus: "2", PaymentType: "1", TradeAmt: "1", ResCode: "05", ResCodeMsg: "拒絕交易",
    }, "2.0", hashKey, hashIv, "CREDIT05001");

    const error = await normalizeError(body) as PaymentMethodSetupProviderResultError;

    expect(error).toBeInstanceOf(PaymentMethodSetupProviderResultError);
    expect(error.diagnostics).toEqual({ status: "CREDIT05001", messageCode: "CREDIT05001", tradeStatus: "2", resCode: "05" });
    expect(error.scope).toBeNull();
  });

  it("classifies signed UNKNOWN and awaiting-confirmation results as pending", async () => {
    environment();
    dbMocks.findUnique.mockResolvedValue(null);
    const unknown = signedCallback({ MerID: "TESTMER", MerTradeNo: orderNumber, Status: "UNKNOWN" }, "2.0", hashKey, hashIv, "UNKNOWN");
    await expect(payUniPaymentProvider.normalizePaymentMethodSetupPayload?.(unknown)).rejects.toMatchObject({ outcome: "pending" });
    const awaiting = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, Status: "SUCCESS", TradeStatus: "8", PaymentType: "1", TradeAmt: "1",
    });
    await expect(payUniPaymentProvider.normalizePaymentMethodSetupPayload?.(awaiting)).rejects.toMatchObject({
      outcome: "pending", diagnostics: { status: "SUCCESS", tradeStatus: "8" },
    });
  });

  it("classifies only from signed fields when the payer edits the unsigned outer Status", async () => {
    environment();
    dbMocks.findUnique.mockResolvedValue(null);
    const signedDecline = { MerID: "TESTMER", MerTradeNo: orderNumber, Status: "UPP02086" };
    const original = await normalizeError(signedCallback(signedDecline, "2.0", hashKey, hashIv, "UPP02086")) as PaymentMethodSetupProviderResultError;
    const edited = await normalizeError(signedCallback(signedDecline, "2.0", hashKey, hashIv, "UNKNOWN")) as PaymentMethodSetupProviderResultError;
    const editedToSuccess = await normalizeError(signedCallback(signedDecline, "2.0", hashKey, hashIv, "SUCCESS")) as PaymentMethodSetupProviderResultError;

    for (const result of [edited, editedToSuccess]) {
      expect(result).toBeInstanceOf(PaymentMethodSetupProviderResultError);
      expect(result.outcome).toBe("declined");
      expect(result.diagnostics).toEqual({ status: "UPP02086", outerStatusMismatch: true });
      expect(result.resultKey).toBe(original.resultKey);
      expect(JSON.stringify(result)).not.toContain("UNKNOWN");
    }

    // A signed hard-invalid result cannot be relabelled as declined or pending.
    for (const outer of ["UPP02086", "UNKNOWN"]) {
      const hardInvalid = signedCallback({
        MerID: "TESTMER", MerTradeNo: orderNumber, TradeNo: "TRADE-1",
        Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "2", CreditHash: "opaque-credit-hash",
      }, "2.0", hashKey, hashIv, outer);
      const error = await normalizeError(hardInvalid);
      expect(error).toBeInstanceOf(PaymentMethodSetupMalformedPayloadError);
    }
    // Signed SUCCESS with an edited outer Status stays malformed, not a decline.
    const successEdited = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, TradeNo: "TRADE-1",
      Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "1", CreditHash: "opaque-credit-hash",
    }, "2.0", hashKey, hashIv, "UPP02086");
    expect(await normalizeError(successEdited)).toBeInstanceOf(PaymentMethodSetupMalformedPayloadError);
  });

  it("treats signed SUCCESS with TradeStatus 0 as malformed rather than declined", async () => {
    environment();
    const issued = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, TradeNo: "TRADE-1",
      Status: "SUCCESS", TradeStatus: "0", PaymentType: "2", TradeAmt: "1",
    });
    expect(await normalizeError(issued)).toBeInstanceOf(PaymentMethodSetupMalformedPayloadError);
  });

  it("separates replay keys by signed order and status", async () => {
    environment();
    dbMocks.findUnique.mockResolvedValue(null);
    const first = await normalizeError(signedCallback({ MerID: "TESTMER", MerTradeNo: orderNumber, Status: "UPP02086" }, "2.0", hashKey, hashIv, "UPP02086")) as PaymentMethodSetupProviderResultError;
    const otherOrder = await normalizeError(signedCallback({ MerID: "TESTMER", MerTradeNo: "pmZYXWVUTSRQPONMLKJIHGFE", Status: "UPP02086" }, "2.0", hashKey, hashIv, "UPP02086")) as PaymentMethodSetupProviderResultError;
    const otherStatus = await normalizeError(signedCallback({ MerID: "TESTMER", MerTradeNo: orderNumber, Status: "UPP02087" }, "2.0", hashKey, hashIv, "UPP02087")) as PaymentMethodSetupProviderResultError;
    expect(new Set([first.resultKey, otherOrder.resultKey, otherStatus.resultKey]).size).toBe(3);

    // Without a setup order number, distinct signed results must not share one key.
    const noOrderA = await normalizeError(signedCallback({ MerID: "TESTMER", Status: "UPP02086", ResCode: "A1" }, "2.0", hashKey, hashIv, "UPP02086")) as PaymentMethodSetupProviderResultError;
    const noOrderB = await normalizeError(signedCallback({ MerID: "TESTMER", Status: "UPP02086", ResCode: "B2" }, "2.0", hashKey, hashIv, "UPP02086")) as PaymentMethodSetupProviderResultError;
    const noOrderReplay = await normalizeError(signedCallback({ MerID: "TESTMER", Status: "UPP02086", ResCode: "A1" }, "2.0", hashKey, hashIv, "EDITED")) as PaymentMethodSetupProviderResultError;
    expect(noOrderA.resultKey).not.toBe(noOrderB.resultKey);
    expect(noOrderReplay.resultKey).toBe(noOrderA.resultKey);
    // A second, differently coded decline for the same order is kept apart too.
    const sameOrderOtherCode = await normalizeError(signedCallback({ MerID: "TESTMER", MerTradeNo: orderNumber, Status: "UPP02086", ResCode: "Z9" }, "2.0", hashKey, hashIv, "UPP02086")) as PaymentMethodSetupProviderResultError;
    expect(sameOrderOtherCode.resultKey).not.toBe(first.resultKey);

    const malformedPayload = { MerID: "TESTMER", MerTradeNo: orderNumber, Status: "SUCCESS", TradeStatus: "1" };
    const malformedA = await normalizeError(signedCallback(malformedPayload, "2.0", hashKey, hashIv, "SUCCESS")) as PaymentMethodSetupMalformedPayloadError;
    const malformedB = await normalizeError(signedCallback(malformedPayload, "2.0", hashKey, hashIv, "EDITED")) as PaymentMethodSetupMalformedPayloadError;
    expect(malformedA).toBeInstanceOf(PaymentMethodSetupMalformedPayloadError);
    expect(malformedA.resultKey).toMatch(/^[0-9a-f]{32}$/u);
    expect(malformedB.resultKey).toBe(malformedA.resultKey);
  });

  it("does not attribute a decline to a non-setup order number or record card-like or unbounded codes", async () => {
    environment();
    const body = signedCallback({
      MerID: "TESTMER", MerTradeNo: "../../other-tenant", Status: "card 4147631000000001 declined",
    }, "2.0", hashKey, hashIv, "FAILED");
    const error = await normalizeError(body) as PaymentMethodSetupProviderResultError;
    expect(error).toBeInstanceOf(PaymentMethodSetupProviderResultError);
    expect(error.diagnostics).toEqual({ status: "unrecognized", outerStatusMismatch: true });
    expect(error.scope).toBeNull();
    expect(dbMocks.findUnique).not.toHaveBeenCalled();

    const digitRun = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, Status: "UPP414763100000", Message: "AB4147631000000001",
      TradeStatus: "2", ResCode: "05",
    }, "2.0", hashKey, hashIv, "UPP414763100000");
    dbMocks.findUnique.mockResolvedValue(null);
    const digitError = await normalizeError(digitRun) as PaymentMethodSetupProviderResultError;
    expect(digitError.diagnostics).toEqual({ status: "unrecognized", tradeStatus: "2", resCode: "05" });
    expect(JSON.stringify(digitError)).not.toMatch(/414763100000|4147631000000001/u);
  });

  it("treats a result that breaks the setup contract as malformed, not a provider decline", async () => {
    environment();
    const wrongMerchant = signedCallback({
      MerID: "OTHERMER", MerTradeNo: orderNumber, Status: "UPP02086",
    }, "2.0", hashKey, hashIv, "UPP02086");
    expect(await normalizeError(wrongMerchant)).toBeInstanceOf(PaymentMethodSetupMalformedPayloadError);

    const noStatus = signedCallback({ MerID: "TESTMER", MerTradeNo: orderNumber }, "2.0", hashKey, hashIv, "UPP02086");
    expect(await normalizeError(noStatus)).toBeInstanceOf(PaymentMethodSetupMalformedPayloadError);

    const wrongAmount = signedCallback({
      MerID: "TESTMER", MerTradeNo: orderNumber, TradeNo: "TRADE-1",
      Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", TradeAmt: "2", CreditHash: "opaque-credit-hash",
    });
    expect(await normalizeError(wrongAmount)).toBeInstanceOf(PaymentMethodSetupMalformedPayloadError);
  });

  it("keeps the documented UPP 2.0 card-binding parameters unchanged", async () => {
    vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", hashKey);
    vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", hashIv);
    vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "TESTMER");
    vi.stubEnv("PAYUNI_ENV", "sandbox");
    const session = await payUniPaymentProvider.createPaymentMethodSetupSession?.({
      intentId: orderNumber,
      setupNonce: payUniSetupNonce(orderNumber),
      vendor: { id: "vendor-1" } as Vendor,
      scopeType: "VENDOR",
      appUrl: "https://staging.example.test",
      returnPath: "/billing/payment-methods",
    });
    expect(session?.formAction).toBe("https://sandbox-api.payuni.com.tw/api/upp");
    expect(session?.formPayload).toMatchObject({ MerID: "TESTMER", Version: "2.0" });
    const payload = decrypt(session!.formPayload!.EncryptInfo);
    // docs.payuni.com.tw/web/#/7/34: MerTradeNo <= 25 [A-Za-z0-9_-]; CreditToken <= 200
    // [A-Za-z0-9@.#$%_-+]; TradeLExpireSec 60-600; credit card TradeAmt 1-199,999 (#/7/170).
    expect(payload.MerTradeNo).toMatch(/^[A-Za-z0-9_-]{1,25}$/);
    expect(payload.CreditToken).toMatch(/^[A-Za-z0-9@.#$%_+-]{1,200}$/);
    expect(Number(payload.TradeLExpireSec)).toBeGreaterThanOrEqual(60);
    expect(Number(payload.TradeLExpireSec)).toBeLessThanOrEqual(600);
    expect(payload).toMatchObject({ TradeAmt: "1", Credit: "1", UseTokenType: "1", CreditTokenType: "2" });
    expect(payload.ProdDesc.length).toBeGreaterThan(0);
  });
});
