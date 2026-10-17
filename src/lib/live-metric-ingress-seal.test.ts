import { expect, it, vi } from 'vitest';
import { sealMetricIngressSources } from './live-metric-ingress-seal';

const run = { vendorId: 'vendor', liveId: 'live', versionId: 'version', runId: '10000000-0000-4000-8000-000000000001' };
it.each([{ ...run, runId: 'invalid' }, { ...run, vendorId: '' }, { ...run, proof: 'not-accepted' }])('rejects invalid or extra scope input before persistence', async value => {
  const db = { $transaction: vi.fn() };
  await expect(sealMetricIngressSources(db as never, value)).rejects.toThrow();
  expect(db.$transaction).not.toHaveBeenCalled();
});
it('does not silently treat an active run as sealed', async () => {
  const tx = { $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: run.versionId }]).mockResolvedValueOnce([{ stoppedAt: null }]) };
  const db = { $transaction: vi.fn(async callback => callback(tx)) };
  await expect(sealMetricIngressSources(db as never, run)).rejects.toThrow('stopped run');
  expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
});
it('never exposes a seal receipt before transaction commit, and propagates commit failure', async () => {
  const frozen = { sealedAt: new Date(2000), frameCount: 2, pageCount: 1, playbackCount: 0 };
  const tx = { $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: run.versionId }]).mockResolvedValueOnce([{ stoppedAt: new Date(1000) }]).mockResolvedValueOnce([]).mockResolvedValueOnce([frozen]) };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const db = { $transaction: vi.fn(async callback => { await callback(tx); await gate; throw new Error('synthetic commit failure'); }) };
  const exposed = vi.fn();
  const result = sealMetricIngressSources(db as never, run).then(exposed);
  const failed = expect(result).rejects.toThrow('synthetic commit failure');
  await vi.waitFor(() => expect(tx.$queryRaw).toHaveBeenCalledTimes(5));
  expect(exposed).not.toHaveBeenCalled(); release(); await failed;
  expect(exposed).not.toHaveBeenCalled();
});
