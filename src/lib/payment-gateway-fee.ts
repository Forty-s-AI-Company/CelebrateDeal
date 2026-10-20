/**
 * F-040 (B03-04): PayUni gateway fee when the provider does not report one.
 *
 * Real PayUni UPP callbacks carry no NetAmount or GatewayFee, so a paid
 * transaction used to keep `netAmountCents = grossAmountCents` and a gateway
 * fee of 0: settlement never deducted the fee and commission net references
 * were wrong.
 *
 * Owner decision D-30 (default, 待會計師確認): the merchant bears the fee, and
 * the server computes it from the platform's contract rate:
 *
 *   gatewayFeeCents = round_half_up(gross × PAYUNI_CREDIT_FEE_BPS / 10,000
 *                                         × (10,000 + PAYUNI_FEE_TAX_BPS) / 10,000)
 *
 * with defaults 280 bps (2.8%, credit card) and 500 bps (5% business tax
 * charged on the fee). Rate, tax treatment and rounding are pending the
 * accountant's confirmation (D-30); change them through the environment, not
 * code. A fee the provider does report always wins, and the stored metadata
 * records which source produced the numbers (`feeSource`).
 */
export const DEFAULT_PAYUNI_CREDIT_FEE_BPS = 280;
export const DEFAULT_PAYUNI_FEE_TAX_BPS = 500;
export const GATEWAY_FEE_DECISION = "D-30 pending accountant confirmation";

export type PayUniFeePolicy = { feeBps: number; taxBps: number };
export type GatewayFeeSource = "provider" | "contract_rate";

function boundedBps(raw: string | undefined, fallback: number, max: number) {
  const value = raw?.trim();
  if (!value || !/^\d{1,5}$/.test(value)) return fallback;
  const parsed = Number(value);
  return parsed <= max ? parsed : fallback;
}

/** Malformed or implausible overrides (fee > 10%, tax > 20%) fall back to the defaults. */
export function payUniFeePolicy(env: Record<string, string | undefined> = process.env): PayUniFeePolicy {
  return {
    feeBps: boundedBps(env.PAYUNI_CREDIT_FEE_BPS, DEFAULT_PAYUNI_CREDIT_FEE_BPS, 1_000),
    taxBps: boundedBps(env.PAYUNI_FEE_TAX_BPS, DEFAULT_PAYUNI_FEE_TAX_BPS, 2_000),
  };
}

/** Fee including tax, rounded half up to the cent with exact integer arithmetic. */
export function contractGatewayFeeCents(grossAmountCents: number, policy: PayUniFeePolicy = payUniFeePolicy()) {
  if (!Number.isSafeInteger(grossAmountCents) || grossAmountCents <= 0) return 0;
  const numerator = BigInt(grossAmountCents) * BigInt(policy.feeBps) * BigInt(10_000 + policy.taxBps);
  const denominator = BigInt(100_000_000);
  const two = BigInt(2);
  return Number((numerator * two + denominator) / (denominator * two));
}

type StoredAmounts = { gatewayFeeCents: number; platformFeeCents: number; netAmountCents: number } | null | undefined;

/**
 * Amounts written by a payment webhook. Non-paid events and non-PayUni
 * providers keep the previous behaviour exactly; a paid PayUni event without
 * provider-reported fees gets the contract-rate fee.
 */
export function resolveWebhookPaymentAmounts(input: {
  provider: string;
  eventType: string;
  grossAmountCents: number;
  reported: { gatewayFeeCents?: number; platformFeeCents?: number; netAmountCents?: number };
  stored: StoredAmounts;
  policy?: PayUniFeePolicy;
}) {
  const { grossAmountCents, reported, stored } = input;
  const derivedNet = (gatewayFeeCents: number, platformFeeCents: number) =>
    Math.max(0, grossAmountCents - gatewayFeeCents - platformFeeCents);
  if (input.eventType !== "paid") {
    const gatewayFeeCents = stored?.gatewayFeeCents || 0;
    const platformFeeCents = stored?.platformFeeCents || 0;
    return { gatewayFeeCents, platformFeeCents, netAmountCents: stored?.netAmountCents ?? derivedNet(gatewayFeeCents, platformFeeCents), feeMetadata: null };
  }

  const platformFeeCents = reported.platformFeeCents || stored?.platformFeeCents || 0;
  const providerReported = reported.netAmountCents !== undefined || (reported.gatewayFeeCents ?? 0) > 0;
  if (!providerReported && input.provider === "payuni") {
    const policy = input.policy ?? payUniFeePolicy();
    const gatewayFeeCents = contractGatewayFeeCents(grossAmountCents, policy);
    return {
      gatewayFeeCents,
      platformFeeCents,
      netAmountCents: derivedNet(gatewayFeeCents, platformFeeCents),
      feeMetadata: {
        feeSource: "contract_rate" as GatewayFeeSource,
        gatewayFeePolicy: { feeBps: policy.feeBps, taxBps: policy.taxBps, basis: "payuni_credit", decision: GATEWAY_FEE_DECISION },
      },
    };
  }

  const gatewayFeeCents = reported.gatewayFeeCents || stored?.gatewayFeeCents || 0;
  return {
    gatewayFeeCents,
    platformFeeCents,
    netAmountCents: reported.netAmountCents ?? stored?.netAmountCents ?? derivedNet(gatewayFeeCents, platformFeeCents),
    feeMetadata: providerReported ? { feeSource: "provider" as GatewayFeeSource } : null,
  };
}
