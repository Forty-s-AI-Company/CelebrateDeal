import { performance } from "node:perf_hooks";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const ports = vi.hoisted(() => ({ job: vi.fn() }));
vi.mock("./live-metric-report-job", () => ({ runMetricReportJob: ports.job }));
import { runMetricReportSchedulerTick } from "./live-metric-report-scheduler";
type SchedulerDatabase = Parameters<typeof runMetricReportSchedulerTick>[0];
const scope = { vendorId: "v", liveId: "l", versionId: "version" };
function client(rows: { id: string }[] = []) {
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: vi.fn(async (query: Prisma.Sql) =>
    query.strings.join("").includes('SELECT r.id') ? rows : []) };
  return { tx, db: { $queryRaw: vi.fn(), $transaction: vi.fn(async (read: (transaction: typeof tx) => Promise<unknown>) => read(tx)) } };
}
const execute = vi.fn();
beforeEach(() => { vi.resetAllMocks(); ports.job.mockResolvedValue({ status: "recorded" }); });
afterEach(() => vi.restoreAllMocks());
it("starts no selection when the process is already stopping",async()=>{
  const {db}=client();const abort=new AbortController();abort.abort();
  expect(await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase,scope,execute,undefined,{},abort.signal))
    .toMatchObject({selected:0,attempted:0});expect(db.$transaction).not.toHaveBeenCalled();
});
it("awaits the active job then stops before another selected candidate",async()=>{
  const {db}=client([{id:'a'},{id:'b'}]),abort=new AbortController();
  ports.job.mockImplementationOnce(async()=>{abort.abort();return {status:'recorded'};});
  expect(await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase,scope,execute,undefined,{jobs:2},abort.signal))
    .toMatchObject({attempted:1,deferred:1,outcomes:{recorded:1}});expect(ports.job).toHaveBeenCalledTimes(1);
});

it("selects only the explicit scope with DB-clock eligibility and a hard row limit", async () => {
  const { db, tx } = client();
  const result = await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute);
  expect(result).toMatchObject({ status: "processed", selected: 0, attempted: 0 });
  const query = tx.$queryRaw.mock.calls[1][0];
  expect(query.values).toEqual(["v", "l", "version", 1]);
  expect(query.strings.join("")).toContain('r."leaseExpiresAt"<=clock_timestamp()');
  expect(query.strings.join("")).toContain('ORDER BY r."createdAt",r.id LIMIT');
  expect(tx.$executeRaw.mock.calls[0][0].strings.join("")).toBe("SET TRANSACTION READ ONLY");
  expect(ports.job).not.toHaveBeenCalled();
});
it("runs sequentially with distinct server-owned lease identities and forwards workers", async () => {
  const { db } = client([{ id: "one" }, { id: "two" }]);
  const project = vi.fn(); let active = false;
  ports.job.mockImplementation(async () => { expect(active).toBe(false); active = true; await Promise.resolve(); active = false; return { status: "recorded" }; });
  const result = await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute, project, { jobs: 2 });
  expect(result).toMatchObject({ attempted: 2, deferred: 0, outcomes: { recorded: 2 } });
  const leases = ports.job.mock.calls.map(call => call[1]);
  expect(leases[0]).toMatchObject({ ...scope, reportId: "one" });
  expect(leases[0].workerId).toMatch(/^[a-f0-9-]{36}$/);
  expect(leases[0].workerId).not.toBe(leases[1].workerId);
  expect(ports.job.mock.calls[0].slice(2)).toEqual([execute, project]);
  expect(JSON.stringify(result)).not.toContain(leases[0].workerId);
});
it("preserves lost claims and failure categories without retrying in the tick", async () => {
  const { db } = client([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
  for (const status of ["not_claimed", "lease_lost", "execution_unavailable", "failed"]) ports.job.mockResolvedValueOnce({ status });
  const result = await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute, undefined, { jobs: 4 });
  expect(result).toMatchObject({ attempted: 4, outcomes: { recorded: 0, not_claimed: 1, lease_lost: 1, execution_unavailable: 1, failed: 1 } });
  expect(ports.job).toHaveBeenCalledTimes(4);
});
it("charges selection time to admission and starts no work after exhaustion", async () => {
  const { db } = client([{ id: "a" }]);
  vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(100);
  expect(await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute, undefined, { admissionMilliseconds: 10 }))
    .toMatchObject({ attempted: 0, deferred: 1 });
  expect(ports.job).not.toHaveBeenCalled();
});
it("awaits the running job and defers later candidates when the admission budget ends", async () => {
  const { db } = client([{ id: "a" }, { id: "b" }]);
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  ports.job.mockImplementation(async () => { clock.mockReturnValue(100); return { status: "snapshot_unavailable" }; });
  expect(await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute, undefined, { jobs: 2, admissionMilliseconds: 10 }))
    .toMatchObject({ selected: 2, attempted: 1, deferred: 1, outcomes: { snapshot_unavailable: 1 } });
});
it("sanitizes selection failures and never claims on selection error", async () => {
  const { db } = client(); db.$transaction.mockRejectedValue(new Error("private query details"));
  expect(await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute)).toEqual({ status: "unavailable", reason: "selection_failed" });
  expect(ports.job).not.toHaveBeenCalled();
});
it("keeps partial counts and defers remaining jobs after an unexpected rejection", async () => {
  const { db } = client([{ id: "one" }, { id: "private-report" }, { id: "later" }]);
  ports.job.mockResolvedValueOnce({ status: "recorded" }).mockRejectedValueOnce(new Error("private report details"));
  const result = await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute, undefined, { jobs: 3 });
  expect(result).toMatchObject({ attempted: 2, deferred: 1, outcomes: { recorded: 1, failed: 1 } });
  expect(ports.job).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain("private");
});
it("freezes the scope before the selection await", async () => {
  const mutable = { ...scope }, { db } = client([{ id: "r" }]);
  const original = db.$transaction.getMockImplementation()!;
  db.$transaction.mockImplementation(async read => { mutable.vendorId = "other"; return original(read); });
  await runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, mutable, execute);
  expect(ports.job.mock.calls[0][1]).toMatchObject(scope);
});
it("rejects unbounded or malformed inputs before touching the database", async () => {
  const { db } = client();
  await expect(runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, { ...scope, vendorId: "" }, execute)).rejects.toThrow();
  await expect(runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute, undefined, { jobs: 5 })).rejects.toThrow();
  await expect(runMetricReportSchedulerTick(db as unknown as SchedulerDatabase, scope, execute, undefined, { admissionMilliseconds: 60001 })).rejects.toThrow();
  expect(db.$transaction).not.toHaveBeenCalled();
});
