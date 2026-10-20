import { describe, expect, it } from "vitest";

import {
  contractGatewayFeeCents,
  payUniFeePolicy,
  resolveWebhookPaymentAmounts,
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

  it.each([
    [100, 3], // 2.94
    [1_000, 29], // 29.4
    [10_000, 294],
    [120_000, 3_528],
    [99_900, 2_937], // 2936.06
    [50, 1], // 1.47
    [17, 0], // 0.4998
    [0, 0],
    [-100, 0],
  ])("rounds the taxed fee on %i cents half up to %i cents", (gross, fee) => {
    expect(contractGatewayFeeCents(gross, policy)).toBe(fee);
  });

  it("rounds an exact half up and stays exact for large amounts", () => {
    // 2.8% x 1.05 = 2.94%; 2,500 cents -> 73.5 -> 74.
    expect(contractGatewayFeeCents(2_500, policy)).toBe(74);
    expect(contractGatewayFeeCents(2_000_000_000, policy)).toBe(58_800_000);
  });

  it("computes fee and net for a paid PayUni callback without provider amounts", () => {
    expect(resolveWebhookPaymentAmounts({
      provider: "payuni", eventType: "paid", grossAmountCents: 120_000, reported: { gatewayFeeCents: 0 },
      stored: { gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: 120_000 }, policy,
    })).toEqual({
      gatewayFeeCents: 3_528,
      platformFeeCents: 0,
      netAmountCents: 116_472,
      feeMetadata: {
        feeSource: "contract_rate",
        gatewayFeePolicy: { feeBps: 280, taxBps: 500, basis: "payuni_credit", decision: "D-30 pending accountant confirmation" },
      },
    });
  });

  it("prefers provider-reported amounts and labels them", () => {
    expect(resolveWebhookPaymentAmounts({
      provider: "payuni", eventType: "paid", grossAmountCents: 10_000, reported: { gatewayFeeCents: 250, netAmountCents: 9_750 },
      stored: null, policy,
    })).toMatchObject({ gatewayFeeCents: 250, netAmountCents: 9_750, feeMetadata: { feeSource: "provider" } });
    expect(resolveWebhookPaymentAmounts({
      provider: "payuni", eventType: "paid", grossAmountCents: 10_000, reported: { netAmountCents: 9_700 }, stored: null, policy,
    })).toMatchObject({ gatewayFeeCents: 0, netAmountCents: 9_700, feeMetadata: { feeSource: "provider" } });
  });

  it("keeps non-paid events and other providers unchanged", () => {
    const stored = { gatewayFeeCents: 294, platformFeeCents: 0, netAmountCents: 9_706 };
    expect(resolveWebhookPaymentAmounts({ provider: "payuni", eventType: "refunded", grossAmountCents: 10_000, reported: {}, stored, policy }))
      .toEqual({ ...stored, feeMetadata: null });
    expect(resolveWebhookPaymentAmounts({ provider: "demo", eventType: "paid", grossAmountCents: 10_000, reported: {}, stored: { gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: 10_000 }, policy }))
      .toEqual({ gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: 10_000, feeMetadata: null });
  });
});
