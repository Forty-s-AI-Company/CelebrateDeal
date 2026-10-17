import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { resolveMetricVisitContext } from "./live-metric-visit-context";

const scope = { vendorId: "v", liveId: "l" };
const now = new Date("2026-10-14T00:00:00Z");
function candidate() {
  return { vendorId: "v", status: "scheduled", scheduledAt: new Date(+now + 10000), startedAt: null, endedAt: null,
    streamMode: "vod", replayEnabled: true, replayAvailableUntil: new Date(+now + 200000),
    video: { id: "video", vendorId: "v", sourceType: "url", videoUrl: "https://example.test/video.mp4", durationSec: 100,
      cloudflareStreamUid: null, cloudflarePlaybackId: null, cloudflareLiveInputUid: null, status: "ready", cloudflareReadyToStream: false, liveInputStatus: null },
    form: { vendorId: "v", isActive: true, fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] },
    messageTemplate: { vendorId: "v", channel: "email", trigger: "registration_confirmed", isActive: true, subject: "Synthetic confirmation", body: "Synthetic registration confirmation content" },
    interactionScript: null, products: [] };
}
const version = { id: "version", durationMs: 100000, expiresAt: new Date(+now + 300000) };
function database(live: unknown = candidate(), versions = [version]) {
  const db = { live: { findFirst: vi.fn().mockResolvedValueOnce({ videoId: "video" }).mockResolvedValueOnce(live) },
    $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now }]).mockResolvedValueOnce(versions) };
  return { db, tx: db as unknown as Prisma.TransactionClient };
}
describe("public metric visit context", () => {
  it("includes waiting visitors and resolves the server's live version", async () => {
    const { db, tx } = database();
    expect(await resolveMetricVisitContext(tx, scope)).toEqual({ ...scope, versionId: "version", expiresAt: version.expiresAt });
    expect(db.$queryRaw.mock.calls[3][0].values).toContain("live");
    expect(db.$queryRaw.mock.calls[3][0].sql).toContain('"collectionEnabled"');
    expect(db.live.findFirst.mock.calls[1][0].where).toMatchObject({ id: "l", vendorId: "v" });
  });
  it("selects replay and caps expiry at the runtime deadline", async () => {
    const live = { ...candidate(), status: "ended", scheduledAt: new Date(+now - 200000), endedAt: new Date(+now - 1000) };
    const { db, tx } = database(live);
    const result = await resolveMetricVisitContext(tx, scope);
    expect(result.expiresAt).toEqual(live.replayAvailableUntil);
    expect(db.$queryRaw.mock.calls[3][0].values).toContain("replay");
  });
  it.each([null, { ...candidate(), form: { vendorId: "other", isActive: true, fields: [] } },
    { ...candidate(), status: "ended", replayEnabled: false },
    { ...candidate(), video: { ...candidate().video, durationSec: -1 } }])("rejects unavailable content %#", async live => {
    await expect(resolveMetricVisitContext(database(live).tx, scope)).rejects.toMatchObject({ code: "SCOPE_UNAVAILABLE" });
  });
  it.each([[], [version, { ...version, id: "ambiguous" }], [{ ...version, durationMs: 999 }]].map(versions => ({ versions })))("rejects missing ambiguous or mismatched versions %#", async ({ versions }) => {
    await expect(resolveMetricVisitContext(database(candidate(), versions).tx, scope)).rejects.toMatchObject({ code: "SCOPE_UNAVAILABLE" });
  });
  it("does not query for invalid scope", async () => {
    const { tx, db } = database();
    await expect(resolveMetricVisitContext(tx, { ...scope, vendorId: "invalid space" })).rejects.toMatchObject({ code: "SCOPE_UNAVAILABLE" });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
