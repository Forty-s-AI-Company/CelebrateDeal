import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { auditMetricViewingSources, classifyViewingDelivery, type ViewingSessionFact } from "./live-metric-viewing-source-audit";
const startAt = new Date(0), endAt = new Date(10000);
const scope = { vendorId: "v", liveId: "l", versionId: "version", startAt, endAt };
const session: ViewingSessionFact = { sessionId: "s", verifiedAt: new Date(500), identityCurrent: true,
  anchorAt: new Date(1000), expiresAt: new Date(20000), closedAt: new Date(2000), complete: true,
  lastSequence: 0, finalSequence: 0, lastElapsedMs: 1000 };
const summary = { intervalCount: 1, contiguous: true, lastWallEndMs: 2000 };
const row = { ...session, intervalId: "i", sequence: 0, wallStartAt: new Date(1000), wallEndAt: new Date(2000), mediaStartMs: 0, mediaEndMs: 1000 };
const context = { isolation: "repeatable read", readOnly: "on", sourceRevision: BigInt(0), registrationRevision: BigInt(2), durationMs: 10000,
  viewingRevision: BigInt(1), epochStartedAt: new Date(0), issuedCount: BigInt(1), removedCount: BigInt(0), primary: true,
  intakeRevision: BigInt(0), playbackEpochStartedAt: new Date(0), asOf: endAt };
function client(pages: object[][], state: object | null = context) {
  let index = 0;
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
    if (sql.strings.join("").includes("current_setting")) return state ? [state] : [];
    if (sql.strings.join("").includes('wp20_metric_viewing_page')) return pages[index++] ?? [];
    return [];
  }) };
  return { tx, db: { $transaction: vi.fn(async (read: (value: typeof tx) => Promise<unknown>) => read(tx)) } };
}
describe("viewing delivery classification", () => {
  it("separates delivery from video completion and permits a closed empty session", () => {
    expect(classifyViewingDelivery(session, summary, startAt, endAt)).toBe("closed_contiguous");
    expect(classifyViewingDelivery({ ...session, lastSequence: -1, finalSequence: -1, lastElapsedMs: 0 },
      { intervalCount: 0, contiguous: true, lastWallEndMs: 1000 }, startAt, endAt)).toBe("closed_contiguous");
  });
  it.each([
    [{ identityCurrent: false }, "identity_mismatch"],
    [{ verifiedAt: new Date(-1) }, "outside_cohort"],
    [{ verifiedAt: endAt }, "outside_cohort"],
    [{ closedAt: null }, "open_session"],
    [{ complete: false }, "incomplete_session"],
    [{ finalSequence: null }, "final_sequence_mismatch"],
    [{ finalSequence: 1 }, "final_sequence_mismatch"],
    [{ lastElapsedMs: 999 }, "progress_mismatch"],
    [{ closedAt: new Date(1999) }, "progress_mismatch"],
    [{ closedAt: new Date(20001) }, "progress_mismatch"],
  ] as const)("keeps deficient session %j visible as %s", (change, outcome) => {
    expect(classifyViewingDelivery({ ...session, ...change }, summary, startAt, endAt)).toBe(outcome);
  });
  it("rejects sequence gaps and count mismatches", () => {
    for (const changed of [{ ...summary, contiguous: false }, { ...summary, intervalCount: 0 }]) {
      expect(classifyViewingDelivery(session, changed, startAt, endAt)).toBe("interval_gap");
    }
  });
});
describe("bounded viewing source inspection", () => {
  it("never turns absent or closed delivery into a complete collection certificate", async () => {
    for (const rows of [[], [row]]) {
      const { db } = client([rows]);
      const result = await auditMetricViewingSources(db as never, scope);
      expect(result).toMatchObject({ status: "enumerated", coverage: "unknown", sessionCount: rows.length, intervalCount: rows.length });
      expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 30000, maxWait: 5000 });
    }
  });
  it("carries session sequence state across page boundaries with a stable digest", async () => {
    const first = { ...row, lastSequence: 1, finalSequence: 1, lastElapsedMs: 2000, closedAt: new Date(3000) };
    const second = { ...first, intervalId: "i2", sequence: 1, wallStartAt: new Date(2000), wallEndAt: new Date(3000), mediaStartMs: 1000, mediaEndMs: 2000 };
    const pagedClient = client([[first, second], [second], []]);
    const paged = await auditMetricViewingSources(pagedClient.db as never, scope, { pageSize: 1 });
    const queries = pagedClient.tx.$queryRaw.mock.calls.filter(([query]) => query.strings.join("").includes('wp20_metric_viewing_page'));
    expect(queries).toHaveLength(2);
    expect(queries[1][0].values.slice(-3)).toEqual(["s", 0, 2]);
    const single = await auditMetricViewingSources(client([[first, second]]).db as never, scope);
    expect(paged).toEqual(single);
    expect(paged).toMatchObject({ sessionCount: 1, intervalCount: 2, outcomes: { closed_contiguous: 1 } });
  });
  it("discards partial prefixes when the row or page budget runs out", async () => {
    const limited = await auditMetricViewingSources(client([[row]]).db as never, scope, { rows: 1 });
    expect(limited).toEqual({ status: "unavailable", reason: "limit_exceeded" });
    const pageLimited = await auditMetricViewingSources(client([[row, { ...row, sessionId: "s2" }]]).db as never, scope, { pages: 1, pageSize: 1 });
    expect(pageLimited).toEqual({ status: "unavailable", reason: "limit_exceeded" });
  });
  it("refuses wrong isolation and missing scope, with no source reads", async () => {
    const wrong = client([], { ...context, isolation: "read committed" });
    await expect(auditMetricViewingSources(wrong.db as never, scope)).rejects.toThrow("read-only repeatable-read");
    expect(await auditMetricViewingSources(client([], null).db as never, scope)).toEqual({ status: "unavailable", reason: "scope_or_window_unavailable" });
  });
  it.each([
    { sequence: 1 }, { wallStartAt: null }, { wallEndAt: null }, { wallEndAt: new Date(1000) },
    { expiresAt: new Date(1500) }, { mediaStartMs: null }, { mediaEndMs: null },
    { mediaStartMs: -1 }, { mediaEndMs: 0 }, { mediaEndMs: 10001 },
  ])("routes malformed interval %j through the real audit classifier", async change => {
    const result = await auditMetricViewingSources(client([[{ ...row, ...change }]]).db as never, scope);
    expect(result).toMatchObject({ status: "enumerated", coverage: "unknown", outcomes: { interval_gap: 1 } });
  });
  it("rejects overlapping wall intervals and permits an unknown content duration", async () => {
    const first = { ...row, lastSequence: 1, finalSequence: 1, lastElapsedMs: 1500, closedAt: new Date(3000) };
    const overlap = { ...first, intervalId: "i2", sequence: 1, wallStartAt: new Date(1500), wallEndAt: new Date(2500), mediaStartMs: 1000, mediaEndMs: 2000 };
    expect(await auditMetricViewingSources(client([[first, overlap]]).db as never, scope)).toMatchObject({ outcomes: { interval_gap: 1 } });
    expect(await auditMetricViewingSources(client([[row]], { ...context, durationMs: null }).db as never, scope)).toMatchObject({ outcomes: { closed_contiguous: 1 } });
  });
  it("charges context query time before starting a page", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(20001);
    try {
      const { db, tx } = client([[row]]);
      expect(await auditMetricViewingSources(db as never, scope)).toEqual({ status: "unavailable", reason: "limit_exceeded" });
      expect(tx.$queryRaw.mock.calls.some(([query]) => query.strings.join("").includes('FROM "LiveMetricSession"'))).toBe(false);
    } finally { clock.mockRestore(); }
  });
  it("discards cancelled and expired transactions without hiding unrelated transaction errors", async () => {
    for (const [error, reason] of [
      [new Prisma.PrismaClientKnownRequestError("synthetic", { code: "P2010", clientVersion: "synthetic", meta: { code: "57014" } }), "query_cancelled"],
      [new Prisma.PrismaClientKnownRequestError("synthetic", { code: "P2028", clientVersion: "synthetic", meta: { error: "expired transaction" } }), "transaction_expired"],
    ] as const) {
      const { db, tx } = client([]);tx.$executeRaw.mockRejectedValueOnce(error);
      expect(await auditMetricViewingSources(db as never, scope)).toEqual({ status: "unavailable", reason });
    }
    const { db, tx } = client([]);
    const other = new Prisma.PrismaClientKnownRequestError("synthetic", { code: "P2028", clientVersion: "synthetic", meta: { error: "synthetic unrelated" } });
    tx.$executeRaw.mockRejectedValueOnce(other);
    await expect(auditMetricViewingSources(db as never, scope)).rejects.toBe(other);
  });
  it("validates resource bounds and propagates unrelated storage failures", async () => {
    const { db, tx } = client([]);
    await expect(auditMetricViewingSources(db as never, scope, { pageSize: 501 })).rejects.toThrow("limits");
    tx.$executeRaw.mockRejectedValueOnce(new Error("synthetic-storage"));
    await expect(auditMetricViewingSources(db as never, scope)).rejects.toThrow("synthetic-storage");
  });
  it("never upgrades missing or late ledger epochs to complete history", async () => {
    for (const epochStartedAt of [null, new Date(1)]) {
      const result = await auditMetricViewingSources(client([], { ...context, epochStartedAt }).db as never, scope);
      expect(result).toMatchObject({ coverage: "unknown", issuance: { history: "unknown", epochStartedAt } });
    }
    expect(await auditMetricViewingSources(client([]).db as never, scope))
      .toMatchObject({ coverage: "unknown", issuance: { history: "ledger_enabled" } });
  });
  it("rejects replica provenance instead of comparing counts from a different visibility timeline", async () => {
    expect(await auditMetricViewingSources(client([], { ...context, primary: false }).db as never, scope))
      .toEqual({ status: "unavailable", reason: "replica_not_supported" });
  });
  it("binds content duration even for an empty current session set", async () => {
    const a = await auditMetricViewingSources(client([]).db as never, scope);
    const b = await auditMetricViewingSources(client([], { ...context, durationMs: 9999 }).db as never, scope);
    expect(a.status === "enumerated" && b.status === "enumerated" && a.digest !== b.digest).toBe(true);
  });
  it("preserves removed issuance evidence even when no current session remains", async () => {
    const before = await auditMetricViewingSources(client([]).db as never, scope);
    const after = await auditMetricViewingSources(client([], { ...context, viewingRevision: BigInt(2), removedCount: BigInt(1) }).db as never, scope);
    expect(after).toMatchObject({ coverage: "unknown", sessionCount: 0, viewingRevision: BigInt(2),
      issuance: { issuedCount: BigInt(1), removedCount: BigInt(1) } });
    expect(after.status === "enumerated" && before.status === "enumerated" && after.digest !== before.digest).toBe(true);
  });
});
