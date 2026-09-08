import { createHash } from "node:crypto";

export type AbVariant = "A" | "B";

export type AbExperiment = {
  id: string;
  variantAWeight?: number;
  enabled?: boolean;
};

export type AbMetric = {
  variant: AbVariant;
  exposures: number;
  conversions: number;
  conversionRate: number;
};

const VISITOR_ID = /^[A-Za-z0-9_-]{8,128}$/u;

/** Produces a stable 0..9,999 bucket without retaining the visitor identifier. */
export function deterministicBucket(experimentId: string, visitorId: string): number {
  if (!experimentId.trim() || !VISITOR_ID.test(visitorId)) throw new Error("Invalid A/B assignment identity.");
  const digest = createHash("sha256").update(`${experimentId.trim()}:${visitorId}`).digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function assignAbVariant(experiment: AbExperiment, visitorId: string, existing?: string | null): AbVariant {
  if (existing === "A" || existing === "B") return existing;
  if (experiment.enabled === false) return "A";
  const weight = experiment.variantAWeight ?? 0.5;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("Invalid Variant A weight.");
  return deterministicBucket(experiment.id, visitorId) < Math.round(weight * 10_000) ? "A" : "B";
}

export function abVariantCookieName(experimentId: string) {
  const digest = createHash("sha256").update(experimentId).digest("hex").slice(0, 20);
  return `cd_ab_${digest}`;
}

export function calculateAbMetrics(input: Array<{ variant: AbVariant; exposures: number; conversions: number }>): AbMetric[] {
  return input.map((item) => {
    if (!Number.isSafeInteger(item.exposures) || item.exposures < 0 || !Number.isSafeInteger(item.conversions) || item.conversions < 0 || item.conversions > item.exposures) {
      throw new Error("Invalid A/B metric counters.");
    }
    return { ...item, conversionRate: item.exposures === 0 ? 0 : Number(((item.conversions / item.exposures) * 100).toFixed(2)) };
  });
}

export function variantContent<T>(variant: AbVariant, content: { A: T; B: T }): T {
  return content[variant];
}

type AbAnalyticsStore = {
  analyticsEvent: {
    create(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<Array<{ eventType: string; payload: unknown }>>;
  };
};

export async function recordAbEvent(store: AbAnalyticsStore, input: { vendorId: string; experimentId: string; visitorId: string; variant: AbVariant; type: "exposure" | "conversion" }) {
  if (!input.vendorId || input.vendorId.length > 128 || !input.experimentId || input.experimentId.length > 128 || !VISITOR_ID.test(input.visitorId)) throw new Error("Invalid A/B event identity.");
  return store.analyticsEvent.create({ data: { vendorId: input.vendorId, visitorId: input.visitorId, eventType: `ab_${input.type}`, payload: { experimentId: input.experimentId, variant: input.variant } } });
}

export async function loadAbMetrics(store: AbAnalyticsStore, input: { vendorId: string; experimentId: string }): Promise<AbMetric[]> {
  if (!input.vendorId || !input.experimentId) throw new Error("Invalid A/B metric scope.");
  const rows = await store.analyticsEvent.findMany({ where: { vendorId: input.vendorId, eventType: { in: ["ab_exposure", "ab_conversion"] }, payload: { path: ["experimentId"], equals: input.experimentId } }, select: { eventType: true, payload: true }, take: 100_000 });
  const counts: Record<AbVariant, { exposures: number; conversions: number }> = { A: { exposures: 0, conversions: 0 }, B: { exposures: 0, conversions: 0 } };
  for (const row of rows) {
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) continue;
    const variant = (row.payload as { variant?: unknown }).variant;
    if (variant !== "A" && variant !== "B") continue;
    if (row.eventType === "ab_exposure") counts[variant].exposures += 1;
    if (row.eventType === "ab_conversion") counts[variant].conversions += 1;
  }
  return calculateAbMetrics((["A", "B"] as const).map((variant) => ({ variant, ...counts[variant] })));
}
