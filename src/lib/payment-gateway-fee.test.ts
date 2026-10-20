import { describe, expect, it } from "vitest";

import {
  contractGatewayFeeCents,
  feeRoundingUnitCents,
  payUniFeePolicy,
  resolveWebhookPaymentAmounts,
  storedFeeSource,
} from "@/lib/payment-gateway-fee";

const policy = { feeBps: 280, taxBps: 500 };

describe("PayUni contract-rate gateway fee (F-040, D-30 pending accountant)", () => {
  it("defaults to 2.8% plus 5% tax on the fee and ignores malformed overrides", () => {
    expect(payUniFeePolicy({})).toEqual(policy);
    expect(payUniFeePolicy({ PAYUNI_CREDIT_FEE_BPS: "250", PAYUNI_FEE_TAX_BPS: "0" })).toEqual({ feeBps: 250, taxBps: 0 });
    for (const value of ["2.8", "1e3", "-1", "1001", "abc"]) {
      expect(payUniFeePolicy({ PAYUNI_CREDIT_FEE_BPS: value }).feeBps).toBe(280);
    }
    expect(payUniFeePolicy({ PAYUNI_FEE_TAX_BPS: "2001" }).taxBps).toBe(500);
  });

  it("rounds TWD to whole NT$ and other currencies to the cent", () => {
    expect(feeRoundingUnitCents("TWD")).toBe(100);
    expect(feeRoundingUnitCents("twd")).toBe(100);
    expect(feeRoundingUnitCents(undefined)).toBe(100);
    expect(feeRoundingUnitCents("USD")).toBe(1);
  });

  it.each([
    [100, 0], // NT$0.0294
    [10_000, 300], // NT$2.94
    [120_000, 3_500], // NT$35.28
    [99_900, 2_900], // NT$29.3706
    [5_100, 100], // NT$1.4994
    [5_200, 200], // NT$1.5288
    [0, 0],
    [-100, 0],
  ])("rounds the taxed TWD fee on %i cents half up to %i cents (whole NT$)", (gross, fee) => {
    expect(contractGatewayFeeCents(gross, policy, 100)).toBe(fee);
    expect(fee % 100).toBe(0);
  });

  it("rounds an exact half up and stays exact for large amounts", () => {
    // Tax-free 2.8% of NT$125 is exactly NT$3.50 -> NT$4.
    expect(contractGatewayFeeCents(12_500, { feeBps: 280, taxBps: 0 }, 100)).toBe(400);
    expect(contractGatewayFeeCents(2_000_000_000, policy, 100)).toBe(58_800_000);
    // Cent rounding for non-TWD: 99,900 x 2.94% = 2,937.06 -> 2,937.
    expect(contractGatewayFeeCents(99_900, policy, 1)).toBe(2_937);
  });

  it("computes fee and net once for a paid PayUni callback without provider amounts", () => {
    expect(resolveWebhookPaymentAmounts({
      provider: "payuni", eventType: "paid", grossAmountCents: 120_000, currency: "TWD", reported: { gatewayFeeCents: 0 },
      stored: { gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: 120_000, metadata: {} }, policy,
    })).toEqual({
      gatewayFeeCents: 3_500,
      platformFeeCents: 0,
      netAmountCents: 116_500,
      feeMetadata: {
        feeSource: "contract_rate",
        gatewayFeePolicy: {
          feeBps: 280, taxBps: 500, roundingUnitCents: 100, rounding: "half_up",
          basis: "payuni_credit", decision: "D-30 pending accountant confirmation",
        },
      },
    });
  });

  it("keeps a stored fee when a later paid event carries no fees (review m-1)", () => {
    for (const source of ["contract_rate", "provider"]) {
      const stored = { gatewayFeeCents: 3_000, platformFeeCents: 0, netAmountCents: 117_000, metadata: { feeSource: source } };
      expect(resolveWebhookPaymentAmounts({
        provider: "payuni", eventType: "paid", grossAmountCents: 120_000, currency: "TWD", reported: {}, stored,
        policy: { feeBps: 200, taxBps: 0 },
      })).toEqual({ gatewayFeeCents: 3_000, platformFeeCents: 0, netAmountCents: 117_000, feeMetadata: null });
    }
    expect(storedFeeSource({ feeSource: "contract_rate" })).toBe("contract_rate");
    expect(storedFeeSource({ feeSource: "spoofed" })).toBeNull();
    expect(storedFeeSource(null)).toBeNull();
  });

  it("lets provider-reported amounts replace a stored contract-rate fee", () => {
    expect(resolveWebhookPaymentAmounts({
      provider: "payuni", eventType: "paid", grossAmountCents: 10_000, reported: { gatewayFeeCents: 250, netAmountCents: 9_750 },
      stored: { gatewayFeeCents: 300, platformFeeCents: 0, netAmountCents: 9_700, metadata: { feeSource: "contract_rate" } }, policy,
    })).toMatchObject({ gatewayFeeCents: 250, netAmountCents: 9_750, feeMetadata: { feeSource: "provider" } });
    expect(resolveWebhookPaymentAmounts({
      provider: "payuni", eventType: "paid", grossAmountCents: 10_000, reported: { netAmountCents: 9_700 }, stored: null, policy,
    })).toMatchObject({ gatewayFeeCents: 0, netAmountCents: 9_700, feeMetadata: { feeSource: "provider" } });
  });

  it("keeps non-paid events and other providers unchanged", () => {
    const stored = { gatewayFeeCents: 300, platformFeeCents: 0, netAmountCents: 9_700 };
    expect(resolveWebhookPaymentAmounts({ provider: "payuni", eventType: "refunded", grossAmountCents: 10_000, reported: {}, stored, policy }))
      .toEqual({ ...stored, feeMetadata: null });
    expect(resolveWebhookPaymentAmounts({ provider: "demo", eventType: "paid", grossAmountCents: 10_000, reported: {}, stored: { gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: 10_000 }, policy }))
      .toEqual({ gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: 10_000, feeMetadata: null });
  });
});
