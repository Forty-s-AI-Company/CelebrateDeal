import { Prisma } from '@prisma/client';
import { MetricIngressBindingError, requireMetricIngressSource, type MetricIngressBinding } from './live-metric-ingress-proof';

/** After canonical Live/admission/Video/version locks. Missing/stale/wrong-kind
 * bindings have a defined no-source outcome, not an authorization exception.
 * A true result only permits a source INSERT, never proves source completeness.
 * DB trigger reuses the same predicate to prevent a caller skipping this check.
 */
export async function canBindMetricIngressSource(tx: Prisma.TransactionClient, binding: MetricIngressBinding | undefined,
  current: { vendorId: string; liveId: string; versionId: string }, source: 'registration' | 'viewer' | 'playback' | 'unknown') {
  try { requireMetricIngressSource(binding, current, source === 'registration' ? ['form', 'landing', 'landing_step'] : source === 'unknown' ? [] : [source]); }
  catch (error) { if (error instanceof MetricIngressBindingError) return false; throw error; }
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
    SELECT public.wp20_metric_ingress_source_allowed(${current.vendorId},${current.liveId},${current.versionId},${binding?.frameId ?? null},${source}) AS allowed`);
  if (!row || typeof row.allowed !== 'boolean') throw new Error('Metric ingress source check unavailable');
  return row.allowed;
}
