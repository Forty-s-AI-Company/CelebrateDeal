import { expect, it, vi } from 'vitest';
import { admitMetricIngress, openMetricIngressRun, settleMetricIngress, stopMetricIngressRun } from './live-metric-ingress';

const scope = { vendorId: 'vendor', liveId: 'live', versionId: 'version' };
const run = { ...scope, runId: '10000000-0000-4000-8000-000000000001' };
const frame = { ...run, frameId: '10000000-0000-4000-8000-000000000002' };
function database() {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ admittedAt: new Date(1000) }]) };
  return { tx, db: { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) } };
}
it('does not expose admission to the forwarding caller until commit succeeds', async () => {
  const { tx, db } = database();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  db.$transaction.mockImplementation(async callback => { const result = await callback(tx); await gate; return result; });
  let forwarded = false;
  const result = admitMetricIngress(db as never, run, 'form').then(value => { forwarded = true; return value; });
  await vi.waitFor(() => expect(tx.$queryRaw).toHaveBeenCalledTimes(2));
  expect(forwarded).toBe(false); release();
  expect(await result).toMatchObject({ ...run, frameId: expect.any(String), admittedAt: new Date(1000) });
});
it('does not let the caller forward after a transaction commit fails', async () => {
  const { tx, db } = database();
  db.$transaction.mockImplementation(async callback => { await callback(tx); throw new Error('synthetic commit failure'); });
  const forward = vi.fn();
  await expect(admitMetricIngress(db as never, run, 'viewer').then(forward)).rejects.toThrow('synthetic commit failure');
  expect(forward).not.toHaveBeenCalled();
});
it.each([
  (db: never) => openMetricIngressRun(db, scope, 'invalid'),
  (db: never) => openMetricIngressRun(db, scope, 'a'.repeat(64), 10001),
  (db: never) => admitMetricIngress(db, { ...run, url: '/private' } as never, 'form'),
  (db: never) => admitMetricIngress(db, run, 'arbitrary' as never),
  (db: never) => settleMetricIngress(db, frame, { outcome: 'responded', httpStatus: 199 }),
  (db: never) => settleMetricIngress(db, frame, { outcome: 'interrupted', httpStatus: 500 } as never),
])('rejects unbounded or unrecognized census inputs before persistence', async action => {
  const { db } = database();
  await expect(action(db as never)).rejects.toThrow();
  expect(db.$transaction).not.toHaveBeenCalled();
});
it('does not silently settle a missing, already settled or foreign frame', async () => {
  const { tx, db } = database(); tx.$queryRaw.mockResolvedValue([]);
  await expect(settleMetricIngress(db as never, frame, { outcome: 'interrupted' })).rejects.toThrow('settlement unavailable');
});
it('returns the original stop timestamp on retry and never reopens the run', async () => {
  const { tx, db } = database(); tx.$queryRaw.mockResolvedValue([{ stoppedAt: new Date(2000) }]);
  expect(await stopMetricIngressRun(db as never, run)).toEqual({ stoppedAt: new Date(2000) });
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
});
