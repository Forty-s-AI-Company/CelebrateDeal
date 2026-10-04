import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Vendor } from "@prisma/client";

const dbMocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ paymentMethodSetupIntent: { findUnique: dbMocks.findUnique } }),
}));

import { chargePayUniLiveProbe, normalizePayUniLiveProbeCallback, payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import { payUniSetupNonce } from "@/lib/payuni-setup-correlation";

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

function signedCallback(payload: Record<string, string>, version = "2.0", signingKey = hashKey, signingIv = hashIv) {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(signingKey), Buffer.from(signingIv));
  const encrypted = Buffer.concat([
    cipher.update(new URLSearchParams(payload).toString(), "utf8"), cipher.final(),
  ]).toString("base64");
  const encryptInfo = Buffer.from(`${encrypted}:::${cipher.getAuthTag().toString("base64")}`).toString("hex");
  return new URLSearchParams({
    MerID: "TESTMER", Version: version, Status: "SUCCESS", EncryptInfo: encryptInfo,
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
});
