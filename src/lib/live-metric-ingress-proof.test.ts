import { afterEach, expect, it, vi } from 'vitest';
import { createMetricIngressAttestor, METRIC_INGRESS_HEADER, metricIngressConfigured, metricIngressFromRequest, requireMetricIngressSource } from './live-metric-ingress-proof';
const run = { vendorId: 'vendor', liveId: 'live', versionId: 'version', runId: '10000000-0000-4000-8000-000000000001' };
const frameId = '10000000-0000-4000-8000-000000000002';
const request = { kind: 'form' as const, method: 'GET' as const, target: '/form/synthetic' };
const key = new Uint8Array(32).fill(9);
afterEach(() => vi.unstubAllEnvs());
it('verifies exact run, route, method and frame without exposing a key', () => {
  const service = createMetricIngressAttestor(run, key), proof = service.issue(frameId, request);
  expect(service.verify(proof, request)).toMatchObject({ ...run, frameId, ...request, format: 1 });
  expect(service.matchesRun(run)).toBe(true);
  expect(service.matchesRun({ ...run, versionId: 'foreign' })).toBe(false);
});
it.each([
  { kind: 'viewer' }, { method: 'POST' }, { target: '/form/other' }, { target: '/form/synthetic?different=1' },
])('rejects route/method/target substitution', change => {
  const service = createMetricIngressAttestor(run, key);
  expect(() => service.verify(service.issue(frameId, request), { ...request, ...change } as never)).toThrow('binding unavailable');
});
it('rejects different keys and runs even with an otherwise valid signature', () => {
  const service = createMetricIngressAttestor(run, key), proof = service.issue(frameId, request);
  expect(() => createMetricIngressAttestor(run, new Uint8Array(32).fill(10)).verify(proof, request)).toThrow('binding unavailable');
  expect(() => createMetricIngressAttestor({ ...run, vendorId: 'foreign' }, key).verify(proof, request)).toThrow('binding unavailable');
});
it('copies the key rather than retaining a caller-mutable buffer', () => {
  const bytes = new Uint8Array(key), service = createMetricIngressAttestor(run, bytes), proof = service.issue(frameId, request);
  bytes.fill(0); expect(service.verify(proof, request).frameId).toBe(frameId);
});
it.each([null, '', 'invalid', 'x'.repeat(2049), 'a.b.c', 'a.=', 'a.' + 'a'.repeat(42)])('rejects malformed or oversized headers with fixed errors', proof => {
  expect(() => createMetricIngressAttestor(run, key).verify(proof, request)).toThrow('Metric ingress binding unavailable');
});
it('rejects payload or signature tampering', () => {
  const service = createMetricIngressAttestor(run, key), [payload, signature] = service.issue(frameId, request).split('.');
  expect(() => service.verify(`${payload.slice(0, -1)}a.${signature}`, request)).toThrow('binding unavailable');
  expect(() => service.verify(`${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`, request)).toThrow('binding unavailable');
});
it('leaves the inactive profile inactive and rejects all malformed configured profiles', () => {
  vi.stubEnv('LIVE_METRIC_INGRESS_PROFILE', '');
  expect(metricIngressConfigured()).toBe(false); expect(metricIngressFromRequest(new Headers(), request)).toBeUndefined();
  for (const profile of ['invalid-json', '{}', 'x'.repeat(2049), JSON.stringify({ ...run, key: 'invalid' })]) {
    vi.stubEnv('LIVE_METRIC_INGRESS_PROFILE', profile);
    expect(() => metricIngressFromRequest(new Headers(), request)).toThrow('Metric ingress binding unavailable');
  }
});
it('requires a valid signed internal header whenever profile is configured', () => {
  vi.stubEnv('LIVE_METRIC_INGRESS_PROFILE', JSON.stringify({ ...run, key: Buffer.from(key).toString('base64url') }));
  expect(metricIngressConfigured()).toBe(true);
  expect(() => metricIngressFromRequest(new Headers(), request)).toThrow('binding unavailable');
  const service = createMetricIngressAttestor(run, key);
  expect(metricIngressFromRequest(new Headers({ [METRIC_INGRESS_HEADER]: service.issue(frameId, request) }), request)?.frameId).toBe(frameId);
});
it('rejects server-selected source mismatches; no binding retains legacy no-run behavior', () => {
  const binding = createMetricIngressAttestor(run, key).verify(createMetricIngressAttestor(run, key).issue(frameId, request), request);
  requireMetricIngressSource(binding, run, ['form']); requireMetricIngressSource(undefined, run, ['viewer']);
  expect(() => requireMetricIngressSource(binding, { ...run, liveId: 'foreign' }, ['form'])).toThrow('binding unavailable');
  expect(() => requireMetricIngressSource(binding, run, ['playback'])).toThrow('binding unavailable');
});
