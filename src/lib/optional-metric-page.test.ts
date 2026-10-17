import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { optionalMetricPage } from './optional-metric-page';
import { MetricVisitorError } from './live-metric-visitor';
import { MetricIngressBindingError } from './live-metric-ingress-proof';

beforeEach(()=>{vi.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());

it('withholds a collector nonce when source commit fails', async () => {
  let reject!: (error: unknown) => void;
  const issuing = new Promise<{ eventId: string }>((_, fail) => { reject = fail; });
  let settled = false;
  const result = optionalMetricPage(() => issuing).then(value => { settled = true; return value; });
  expect(settled).toBe(false);
  reject(new MetricVisitorError('PERSISTENCE_UNAVAILABLE'));
  expect(await result).toBeNull();
  expect(console.warn).toHaveBeenCalledExactlyOnceWith('METRIC_PAGE_OPTIONAL_UNAVAILABLE',{code:'PERSISTENCE_UNAVAILABLE'});
});
it.each([
  new MetricVisitorError('PROOF_INVALID'), new MetricVisitorError('PROOF_EXPIRED'),
  new MetricVisitorError('SCOPE_UNAVAILABLE'), new MetricIngressBindingError(),
  new Error('NEXT_NOT_FOUND'), new Error('unexpected failure'),
  { code: 'PERSISTENCE_UNAVAILABLE' },
])('does not disguise authorization, navigation, unexpected or lookalike errors', async error => {
  await expect(optionalMetricPage(async () => { throw error; })).rejects.toBe(error);
  expect(console.warn).not.toHaveBeenCalled();
});
