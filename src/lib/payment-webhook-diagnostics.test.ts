import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPaymentWebhookDiagnostics } from "@/lib/payment-webhook-diagnostics";

type PayUniDiagnostics = Extract<ReturnType<typeof buildPaymentWebhookDiagnostics>, { payuni: unknown }>;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("payment webhook diagnostics", () => {
  it("returns only common safe metadata for non-PayUni providers", () => {
    const result = buildPaymentWebhookDiagnostics("demo", JSON.stringify({ secret: "redacted" }));

    expect(result).toEqual({
      provider: "demo",
      rawPayloadBytes: expect.any(Number),
      rawPayloadStoragePolicy: expect.stringContaining("redacted"),
    });
    expect(result).not.toHaveProperty("secret");
  });

  it("parses form-encoded PayUni fields and reports missing hash configuration safely", () => {
    vi.stubEnv("PAYUNI_HASH_KEY", "");
    vi.stubEnv("PAYUNI_HASH_IV", "");
    const result = buildPaymentWebhookDiagnostics("payuni", "EncryptInfo=payload-123&HashInfo=invalid");

    expect((result as PayUniDiagnostics).payuni).toMatchObject({
      receivedFields: ["EncryptInfo", "HashInfo"],
      encryptInfo: { present: true, length: 11 },
      hashInfo: { present: true, length: 7 },
      hashInfoVerification: "not_checked",
    });
    expect(JSON.stringify(result)).not.toContain("payload-123");
  });

  it.each([
    ["pass", "KEY", "IV", "EncryptInfo", "expected hash"],
    ["fail", "KEY", "IV", "EncryptInfo", "0000"],
  ])("classifies PayUni hash verification as %s", (classification, key, iv, encryptInfo, suppliedHash) => {
    vi.stubEnv("PAYUNI_HASH_KEY", key);
    vi.stubEnv("PAYUNI_HASH_IV", iv);
    const expectedHash = createHash("sha256").update(`${key}${encryptInfo}${iv}`).digest("hex").toUpperCase();
    const hashInfo = suppliedHash === "expected hash" ? expectedHash : suppliedHash;

    const result = buildPaymentWebhookDiagnostics("payuni", JSON.stringify({ EncryptInfo: encryptInfo, HashInfo: hashInfo }));

    expect((result as PayUniDiagnostics).payuni.hashInfoVerification).toBe(classification);
    expect((result as PayUniDiagnostics).payuni.dashboardChecklist).toHaveLength(4);
  });

  it("does not attempt a hash check when PayUni encrypted fields are absent", () => {
    vi.stubEnv("PAYUNI_HASH_KEY", "synthetic-key");
    vi.stubEnv("PAYUNI_HASH_IV", "synthetic-iv");

    const result = buildPaymentWebhookDiagnostics("payuni", "{}");

    expect((result as PayUniDiagnostics).payuni).toMatchObject({
      receivedFields: [],
      encryptInfo: { present: false, length: 0 },
      hashInfo: { present: false, length: 0 },
      hashInfoVerification: "not_checked",
    });
  });
});
