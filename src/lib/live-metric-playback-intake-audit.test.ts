import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { classifyPlaybackIntake, inspectPlaybackIntakes, type PlaybackIntakeFact } from "./live-metric-playback-intake-audit";
const scope = { vendorId: "v", liveId: "l", versionId: "version", startAt: new Date(100), endAt: new Date(1000) };
const context = { asOf: new Date(2000), expectedRevision: BigInt(1), epochStartedAt: new Date(50) };
const row: PlaybackIntakeFact = { id: "a", issuedAt: new Date(200), expiresAt: new Date(3000), lossAt: null, renewalCount: BigInt(0),
  sessionId: "s", verifiedAt: new Date(150), identityCurrent: true, closedAt: new Date(500), complete: true };
const limits = { rows: 20, pages: 20, pageSize: 5, outOfTime: () => false };
function tx(pages: PlaybackIntakeFact[][]) {
  const query = vi.fn().mockImplementation(async () => pages.shift() ?? []);
  return { db: { $queryRaw: query } as unknown as Prisma.TransactionClient, query };
}
describe("playback expectation classification", () => {
  it.each([
    [{}, "closed_session"],
    [{ issuedAt: scope.endAt }, "future_intake"],
    [{ sessionId: null }, "pending_session"],
    [{ sessionId: null, expiresAt: context.asOf }, "missing_session"],
    [{ sessionId: null, expiresAt: scope.startAt }, "pre_window_expired"],
    [{ identityCurrent: false }, "identity_mismatch"],
    [{ verifiedAt: null }, "identity_mismatch"],
    [{ verifiedAt: new Date(99) }, "outside_cohort"],
    [{ verifiedAt: scope.endAt }, "outside_cohort"],
    [{ closedAt: null }, "open_session"],
    [{ complete: false }, "incomplete_session"],
  ] as const)("retains %j as %s", (change, result) => {
    expect(classifyPlaybackIntake({ ...row, ...change }, scope, context.asOf)).toBe(result);
  });
});
describe("same-snapshot intake enumeration", () => {
  it("binds loss, renewal and empty history to authoritative revision without positive coverage", async () => {
    const f = tx([[{ ...row, renewalCount: BigInt(3), lossAt: new Date(250) }]]);
    const result = await inspectPlaybackIntakes(f.db, scope, { ...context, expectedRevision: BigInt(5) }, limits);
    expect(result).toMatchObject({ status: "enumerated", countCompleteness: "recorded_only", count: 1,
      revision: BigInt(5), quotaLosses: 1, earliestLossAt: new Date(250), outcomes: { closed_session: 1 } });
    expect(result).not.toHaveProperty("coverage", "complete");
    expect(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value)).not.toContain('"sessionId"');
  });
  it("retains permanent quota loss from before the window even after its lease expired", async () => {
    const expired = { ...row, issuedAt: new Date(10), expiresAt: new Date(50), lossAt: new Date(40), sessionId: null };
    const result = await inspectPlaybackIntakes(tx([[expired]]).db, scope, { ...context, expectedRevision: BigInt(2) }, limits);
    expect(result).toMatchObject({ status: "enumerated", quotaLosses: 1, earliestLossAt: new Date(40), outcomes: { pre_window_expired: 1 } });
  });
  it("does not let an invisible intake or renewal masquerade as empty or complete", async () => {
    for (const rows of [[], [row]]) {
      expect(await inspectPlaybackIntakes(tx([rows]).db, scope, { ...context, expectedRevision: BigInt(2) }, limits))
        .toEqual({ status: "unavailable", reason: "intake_source_not_visible" });
    }
  });
  it("enumerates known empty recorded history while preserving missing epoch", async () => {
    expect(await inspectPlaybackIntakes(tx([[]]).db, scope, { ...context, expectedRevision: BigInt(0), epochStartedAt: null }, limits))
      .toMatchObject({ status: "enumerated", count: 0, history: "unknown", countCompleteness: "recorded_only" });
  });
  it("changes the digest when a pending receipt expires without a row mutation", async () => {
    const unbound = { ...row, sessionId: null };
    const a = await inspectPlaybackIntakes(tx([[unbound]]).db, scope, context, limits);
    const b = await inspectPlaybackIntakes(tx([[unbound]]).db, scope, { ...context, asOf: row.expiresAt }, limits);
    expect(a.status === "enumerated" && b.status === "enumerated" && a.digest === b.digest
      && a.classificationDigest !== b.classificationDigest && +a.asOf !== +b.asOf).toBe(true);
  });
  it("keeps digest stable across keyset page boundaries and binds per-row facts", async () => {
    const second = { ...row, id: "b", sessionId: null };
    const paged = tx([[row, second], [second]]);
    const a = await inspectPlaybackIntakes(paged.db, scope, { ...context, expectedRevision: BigInt(2) }, { ...limits, pageSize: 1 });
    const b = await inspectPlaybackIntakes(tx([[row, second]]).db, scope, { ...context, expectedRevision: BigInt(2) }, limits);
    expect(a.status === "enumerated" && b.status === "enumerated" && a.digest === b.digest).toBe(true);
    expect(paged.query.mock.calls[1][0].values).toEqual([scope.vendorId, scope.liveId, scope.versionId, "a", 2]);
    const changed = await inspectPlaybackIntakes(tx([[row, { ...second, expiresAt: new Date(2500) }]]).db, scope, { ...context, expectedRevision: BigInt(2) }, limits);
    expect(changed.status === "enumerated" && b.status === "enumerated" && changed.digest !== b.digest).toBe(true);
  });
  it("discards partial prefixes on shared row/page/time exhaustion", async () => {
    const rows = [row, { ...row, id: "b" }];
    for (const options of [{ rows: 1 }, { pageSize: 1, pages: 1 }, { outOfTime: () => true }]) {
      expect(await inspectPlaybackIntakes(tx([rows]).db, scope, { ...context, expectedRevision: BigInt(2) }, { ...limits, ...options }))
        .toEqual({ status: "unavailable", reason: "limit_exceeded" });
    }
  });
});
