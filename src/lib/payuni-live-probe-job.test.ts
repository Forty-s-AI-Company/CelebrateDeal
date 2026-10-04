import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  probeFindUnique: vi.fn(),
  referenceFindUnique: vi.fn(),
  probeUpdateMany: vi.fn(),
  charge: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://staging.example.test" }));
vi.mock("@/lib/payment-providers/payuni", () => ({ chargePayUniLiveProbe: mocks.charge }));

import { runPayUniLiveProbeJob } from "@/lib/payuni-live-probe-job";
import { PAYUNI_LIVE_PROBE_CONSENT_TEXT, PAYUNI_LIVE_PROBE_CONSENT_VERSION } from "@/lib/payuni-live-probe";

const now = new Date("2026-09-30T02:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "production");
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("PAYUNI_LIVE_PROBE_ENABLED", "true");
  vi.stubEnv("PAYUNI_LIVE_PROBE_VENDOR_ID", "vendor-1");
  vi.stubEnv("PAYUNI_LIVE_PROBE_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_HASH_KEY", "12345678901234567890123456789012");
  vi.stubEnv("PAYUNI_HASH_IV", "1234567890123456");
  mocks.probeFindUnique.mockResolvedValue({
    id: "probe-1", vendorId: "vendor-1", status: "scheduled",
    dueAt: new Date(now.getTime() - 60_000),
    firstAmountCents: 100, secondAmountCents: 100,
    consentActorId: "member-1", consentVersion: PAYUNI_LIVE_PROBE_CONSENT_VERSION,
    consentText: PAYUNI_LIVE_PROBE_CONSENT_TEXT,
    consentedAt: new Date(now.getTime() - 11 * 60_000),
    paymentMethodReferenceId: "reference-1", secondOrderNumber: "pcABCDEFGHIJKLMNOPQRSTUV",
  });
  mocks.referenceFindUnique.mockResolvedValue({
    id: "reference-1", vendorId: "vendor-1", scopeType: "VENDOR", providerName: "payuni",
    providerPaymentMethodRef: "opaque-credit-hash", status: "verified",
    verifiedAt: new Date(now.getTime() - 11 * 60_000), expiresAt: null,
  });
  mocks.probeUpdateMany.mockResolvedValue({ count: 1 });
  mocks.charge.mockResolvedValue({ status: "confirmed", providerTradeNo: "TRADE-2" });
  mocks.getDb.mockReturnValue({
    payUniLiveProbe: { findUnique: mocks.probeFindUnique, updateMany: mocks.probeUpdateMany },
    paymentMethodReference: { findUnique: mocks.referenceFindUnique },
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("one-time PAYUNi live probe", () => {
  it("claims the due charge once before network I/O and records confirmation", async () => {
    await expect(runPayUniLiveProbeJob(now)).resolves.toEqual({ outcome: "confirmed" });
    expect(mocks.probeUpdateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: "probe-1", status: "scheduled" }),
      data: { status: "dispatched", attemptedAt: now },
    }));
    expect(mocks.charge).toHaveBeenCalledOnce();
    expect(mocks.charge).toHaveBeenCalledWith({
      orderNumber: "pcABCDEFGHIJKLMNOPQRSTUV",
      creditHash: "opaque-credit-hash",
      appUrl: "https://staging.example.test",
    });
    expect(mocks.probeUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: "confirmed", providerTradeNo: "TRADE-2" }),
    }));
    mocks.probeFindUnique.mockResolvedValue({ status: "confirmed" });
    await expect(runPayUniLiveProbeJob(now)).resolves.toEqual({ outcome: "not_due" });
    expect(mocks.charge).toHaveBeenCalledOnce();
  });

  it("never sends when the card was revoked or the live merchant differs", async () => {
    mocks.referenceFindUnique.mockResolvedValue({ status: "revoked" });
    await expect(runPayUniLiveProbeJob(now)).resolves.toEqual({ outcome: "invalid" });
    expect(mocks.charge).not.toHaveBeenCalled();
    vi.stubEnv("PAYUNI_LIVE_PROBE_MERCHANT_ID", "OTHER");
    await expect(runPayUniLiveProbeJob(now)).resolves.toEqual({ outcome: "disabled" });
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("leaves an uncertain provider result closed to automatic retry", async () => {
    mocks.charge.mockResolvedValue({ status: "ambiguous" });
    await expect(runPayUniLiveProbeJob(now)).resolves.toEqual({ outcome: "ambiguous" });
    expect(mocks.probeUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: "ambiguous", failureCode: "provider_result_ambiguous" }),
    }));
    expect(mocks.charge).toHaveBeenCalledOnce();
  });

  it("rejects a probe without the recorded second-charge consent", async () => {
    mocks.probeFindUnique.mockResolvedValue({
      id: "probe-1", vendorId: "vendor-1", status: "scheduled",
      dueAt: new Date(now.getTime() - 60_000), firstAmountCents: 100, secondAmountCents: 100,
      consentActorId: "member-1", consentVersion: "obsolete", consentedAt: now,
      paymentMethodReferenceId: "reference-1",
    });
    await expect(runPayUniLiveProbeJob(now)).resolves.toEqual({ outcome: "invalid" });
    expect(mocks.charge).not.toHaveBeenCalled();
  });
});
