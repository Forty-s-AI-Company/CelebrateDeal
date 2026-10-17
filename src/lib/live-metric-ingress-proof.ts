import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const MetricIngressRunScope = z.object({ vendorId: id, liveId: id, versionId: id, runId: uuid }).strict();
const Kind = z.enum(['form', 'landing', 'landing_step', 'viewer', 'playback']);
const RequestScope = z.object({ kind: Kind, method: z.enum(['GET', 'POST']), target: z.string().min(2).max(600).regex(/^\/[^\r\n]*$/) }).strict();
const Payload = MetricIngressRunScope.extend({ frameId: uuid, kind: Kind, method: z.enum(['GET', 'POST']), target: RequestScope.shape.target, format: z.literal(1) });
export type MetricIngressBinding = z.infer<typeof Payload>;
export const METRIC_INGRESS_HEADER = 'x-celebratedeal-metric-frame';
export class MetricIngressBindingError extends Error {
  constructor() { super('Metric ingress binding unavailable'); this.name = 'MetricIngressBindingError'; }
}

/** Private per-run gateway-to-server attestation, never browser/viewer auth.
 * The DB must additionally enforce existence/scope/kind/single source binding.
 * The key and signed header must never be persisted, logged or returned to a
 * browser. This says nothing about startup, other URLs or source completeness.
 */
export function createMetricIngressAttestor(value: z.infer<typeof MetricIngressRunScope>, key: Uint8Array) {
  const checked = MetricIngressRunScope.safeParse(value);
  if (!checked.success || key.byteLength !== 32) throw new MetricIngressBindingError();
  const run = checked.data, secret = Buffer.from(key);
  const sign = (encoded: string) => createHmac('sha256', secret).update(`metric-ingress-v1.${encoded}`).digest();
  return {
    matchesRun(candidate: z.infer<typeof MetricIngressRunScope>) {
      const other = MetricIngressRunScope.safeParse(candidate);
      return other.success && Object.entries(run).every(([name, expected]) => other.data[name as keyof typeof run] === expected);
    },
    issue(frameId: string, request: z.infer<typeof RequestScope>) {
      const frame = uuid.safeParse(frameId), context = RequestScope.safeParse(request);
      if (!frame.success || !context.success) throw new MetricIngressBindingError();
      const payload = Buffer.from(JSON.stringify({ ...run, ...context.data, frameId: frame.data, format: 1 })).toString('base64url');
      return `${payload}.${sign(payload).toString('base64url')}`;
    },
    verify(header: unknown, expected: z.infer<typeof RequestScope>): MetricIngressBinding {
      const context = RequestScope.safeParse(expected);
      if (!context.success || typeof header !== 'string' || header.length > 2048) throw new MetricIngressBindingError();
      const parts = header.split('.');
      if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw new MetricIngressBindingError();
      const signature = Buffer.from(parts[1], 'base64url');
      if (signature.length !== 32 || signature.toString('base64url') !== parts[1] || !timingSafeEqual(sign(parts[0]), signature)) throw new MetricIngressBindingError();
      let decoded: unknown;
      try { decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new MetricIngressBindingError(); }
      const payload = Payload.safeParse(decoded);
      if (!payload.success || !Object.entries({ ...run, ...context.data }).every(([name, expectedValue]) => payload.data[name as keyof MetricIngressBinding] === expectedValue)) throw new MetricIngressBindingError();
      return payload.data;
    },
  };
}
export type MetricIngressAttestor = ReturnType<typeof createMetricIngressAttestor>;

/** Only the known process variable injected by the owned nonproduction runner.
 * Never discovers env files or secret stores. Fixed errors never reveal input.
 */
export function metricIngressConfigured() { return Boolean(process.env.LIVE_METRIC_INGRESS_PROFILE); }
export function metricIngressFromRequest(headers: Pick<Headers, 'get'>, expected: z.infer<typeof RequestScope>) {
  const raw = process.env.LIVE_METRIC_INGRESS_PROFILE;
  if (!raw) return undefined;
  if (raw.length > 2048) throw new MetricIngressBindingError();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new MetricIngressBindingError(); }
  const profile = MetricIngressRunScope.extend({ key: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).safeParse(value);
  if (!profile.success) throw new MetricIngressBindingError();
  const { key, ...run } = profile.data, bytes = Buffer.from(key, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== key) throw new MetricIngressBindingError();
  return createMetricIngressAttestor(run, bytes).verify(headers.get(METRIC_INGRESS_HEADER), expected);
}

/** Call after resolving the current server-selected version. An attestation
 * never lets a request choose a different version or registration surface.
 */
export function requireMetricIngressSource(binding: MetricIngressBinding | undefined,
  current: { vendorId: string; liveId: string; versionId: string }, kinds: readonly MetricIngressBinding['kind'][]) {
  if (binding && (binding.vendorId !== current.vendorId || binding.liveId !== current.liveId || binding.versionId !== current.versionId || !kinds.includes(binding.kind))) throw new MetricIngressBindingError();
}
