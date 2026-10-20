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
 * charged on the fee). For TWD the fee is rounded half up to a whole NT$
 * (a multiple of 100 cents) because PayUni charges and pays out in whole
 * dollars; other currencies round to the cent. Rate, tax treatment, rounding
 * unit and direction are all pending the accountant's confirmation (D-30);
 * change rate and tax through the environment, not code.
 *
 * Precedence (PR #455 review m-1): a fee the provider reports always wins.
 * The contract rate is written only by the first paid event that finds no
 * stored fee source; later paid events without fees (notify resend, admin
 * retry, a changed env rate) keep the stored fee and net amount. The stored
 * metadata records which source produced the numbers (`feeSource`).
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

/** Rounding unit in cents: whole NT$ for TWD (待會計師確認 D-30), cents otherwise. */
export function feeRoundingUnitCents(currency: string | null | undefined) {
  return (currency ?? "TWD").toUpperCase() === "TWD" ? 100 : 1;
}

/** Fee including tax, rounded half up to `unitCents` with exact integer arithmetic. */
export function contractGatewayFeeCents(
  grossAmountCents: number,
  policy: PayUniFeePolicy = payUniFeePolicy(),
  unitCents = 100,
) {
  if (!Number.isSafeInteger(grossAmountCents) || grossAmountCents <= 0) return 0;
  const numerator = BigInt(grossAmountCents) * BigInt(policy.feeBps) * BigInt(10_000 + policy.taxBps);
  const denominator = BigInt(100_000_000) * BigInt(unitCents);
  const two = BigInt(2);
  return Number((numerator * two + denominator) / (denominator * two)) * unitCents;
}

type StoredAmounts = {
  gatewayFeeCents: number;
  platformFeeCents: number;
  netAmountCents: number;
  /** Transaction metadata; its `feeSource` marks a fee already on record. */
  metadata?: unknown;
} | null | undefined;

/**
 * Amounts written by a payment webhook. Non-paid events and non-PayUni
 * providers keep the previous behaviour exactly; a paid PayUni event without
 * provider-reported fees gets the contract-rate fee.
 */
export function storedFeeSource(metadata: unknown): GatewayFeeSource | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).feeSource;
  return value === "provider" || value === "contract_rate" ? value : null;
}

export function resolveWebhookPaymentAmounts(input: {
  provider: string;
  eventType: string;
  grossAmountCents: number;
  currency?: string | null;
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
  if (!providerReported && stored && storedFeeSource(stored.metadata)) {
    // A fee is already on record: a later paid event without fees never rewrites it.
    return {
      gatewayFeeCents: stored.gatewayFeeCents,
      platformFeeCents: stored.platformFeeCents,
      netAmountCents: stored.netAmountCents,
      feeMetadata: null,
    };
  }
  if (!providerReported && input.provider === "payuni") {
    const policy = input.policy ?? payUniFeePolicy();
    const unitCents = feeRoundingUnitCents(input.currency);
    const gatewayFeeCents = contractGatewayFeeCents(grossAmountCents, policy, unitCents);
    return {
      gatewayFeeCents,
      platformFeeCents,
      netAmountCents: derivedNet(gatewayFeeCents, platformFeeCents),
      feeMetadata: {
        feeSource: "contract_rate" as GatewayFeeSource,
        gatewayFeePolicy: {
          feeBps: policy.feeBps, taxBps: policy.taxBps, roundingUnitCents: unitCents, rounding: "half_up",
          basis: "payuni_credit", decision: GATEWAY_FEE_DECISION,
        },
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
