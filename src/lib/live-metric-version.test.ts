import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { resolveLiveRuntimeWindow } from "./live-runtime-state";
import { metricVideoFingerprint, resolveMetricPlaybackContext, resolveMetricRegistrationVisitor, resolveMetricSessionContext } from "./live-metric-version";
const video = { id: "video", vendorId: "vendor", sourceType: "url", videoUrl: "https://example.test/a.mp4", durationSec: 100, cloudflareStreamUid: null, cloudflareLiveInputUid: null, cloudflarePlaybackId: null };
describe("stored video configuration fingerprint", () => {
  it("is stable across object property order and returns only a hash", () => {
    const reversed = Object.fromEntries(Object.entries(video).reverse()) as typeof video;
    expect(metricVideoFingerprint(reversed)).toBe(metricVideoFingerprint(video));
    expect(metricVideoFingerprint(video)).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    { id: "other" }, { vendorId: "other" }, { sourceType: "cloudflare_stream" },
    { videoUrl: "https://example.test/b.mp4" }, { durationSec: 101 },
    { cloudflareStreamUid: "asset" }, { cloudflareLiveInputUid: "input" }, { cloudflarePlaybackId: "playback" },
  ])("distinguishes changed source configuration %j", (change) => {
    expect(metricVideoFingerprint({ ...video, ...change })).not.toBe(metricVideoFingerprint(video));
  });
  it("ignores display metadata and never serializes stream credentials", () => {
    const extra = { ...video, title: "different title", liveStreamKey: "synthetic-not-a-real-credential" };
    expect(metricVideoFingerprint(extra)).toBe(metricVideoFingerprint(video));
  });
});


describe("canonical metric session phase deadline", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  const live = { streamMode: "vod", scheduledAt: new Date(+now - 10000), status: "scheduled", startedAt: null, endedAt: null, replayAvailableUntil: new Date(+now + 200000), replayEnabled: true, video: { durationSec: 100 } };
  it("exposes the VOD end from the canonical runtime decision", () => {
    const runtime = resolveLiveRuntimeWindow(live, now);
    expect(runtime.state).toBe("playing"); expect(runtime.endsAt?.getTime()).toBe(+now + 90000);
  });
  it("exposes the replay deadline after scheduled playback finishes", () => {
    const runtime = resolveLiveRuntimeWindow({ ...live, scheduledAt: new Date(+now - 200000) }, now);
    expect(runtime.state).toBe("replay"); expect(runtime.endsAt).toEqual(live.replayAvailableUntil);
  });
  it("does not invent an end for an ongoing live input", () => {
    const runtime = resolveLiveRuntimeWindow({ ...live, streamMode: "live", status: "live", startedAt: new Date(+now - 1000) }, now);
    expect(runtime.state).toBe("playing"); expect(runtime.endsAt).toBeNull();
  });
});

describe("persisted registration visitor attribution", () => {
  const identity = { vendorId: "v", liveId: "l", submissionId: "submission", admissionId: "admission" };
  it("reads only matching first-registration identity and verified epoch", async () => {
    const query = vi.fn().mockResolvedValue([{ visitorId: "first-browser" }]);
    const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    expect(await resolveMetricRegistrationVisitor(tx, identity, "version")).toBe("first-browser");
    expect(query.mock.calls[0][0].values).toEqual(["v", "l", "version", "submission", "v", "l", "version", "submission"]);
    expect(query.mock.calls[0][0].sql).toContain('r."verifiedAt"=f."verifiedAt" AT TIME ZONE');
    expect(query.mock.calls[0][0].sql).toContain('v."versionId"=r."versionId"');
  });
  it.each([{ rows: [] }, { rows: [{ visitorId: "a" }, { visitorId: "b" }] }])("preserves unknown for absent or ambiguous evidence %#", async ({ rows }) => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as Prisma.TransactionClient;
    expect(await resolveMetricRegistrationVisitor(tx, identity, "version")).toBeNull();
  });
});

describe("shared server-selected playback metric context", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  const identity = { vendorId: "vendor", liveId: "live", submissionId: "submission", admissionId: "admission" };
  const readyVideo = { ...video, status: "ready", cloudflareReadyToStream: false, liveInputStatus: null };
  const live = { streamMode: "vod", scheduledAt: new Date(+now - 10000), status: "scheduled", startedAt: null, endedAt: null,
    replayAvailableUntil: new Date(+now + 200000), replayEnabled: true, video: readyVideo };
  function fixture(value: object = live, versions: Array<{ id: string; expiresAt: Date; durationMs: number | null; collectionEnabled?: boolean; collectionStartedAt?: Date | null }>
    = [{ id: "version", expiresAt: new Date(+now + 60000), durationMs: 100000 }]) {
    const query = vi.fn(async (sql: Prisma.Sql) => {
      const text = sql.strings.join("");
      if (text.includes('AS now')) return [{ now }];
      if (text.includes('FROM "LiveMetricVersion"')) return versions.map(row => ({ collectionEnabled: true, collectionStartedAt: new Date(0), ...row }));
      if (text.includes('FROM "LiveMetricRegistration"')) return [{ visitorId: "first-browser" }];
      return [];
    });
    const find = vi.fn().mockResolvedValueOnce({ videoId: "video" }).mockResolvedValue(value);
    const tx = { $queryRaw: query, live: { findFirst: find } } as unknown as Prisma.TransactionClient;
    return { tx, query, find };
  }
  it("uses the same fingerprint, mode and bounded expiry without requiring a submission identity", async () => {
    const { tx, query } = fixture();
    expect(await resolveMetricPlaybackContext(tx, { vendorId: "vendor", liveId: "live" }))
      .toEqual({ versionId: "version", expiresAt: new Date(+now + 60000) });
    const versionQuery = query.mock.calls.find(([sql]) => sql.strings.join("").includes('FROM "LiveMetricVersion"'))![0];
    expect(versionQuery.values).toEqual(["vendor", "live", "video", "live", metricVideoFingerprint(video)]);
    expect(versionQuery.strings.join("")).toContain('FOR SHARE');
    expect(query.mock.calls.some(([sql]) => sql.strings.join("").includes('FROM "LiveMetricRegistration"'))).toBe(false);
  });
  it("preserves the existing session's immutable visitor attribution", async () => {
    const { tx } = fixture();
    expect(await resolveMetricSessionContext(tx, identity))
      .toEqual({ versionId: "version", expiresAt: new Date(+now + 60000), visitorId: "first-browser" });
  });
  it("returns untracked for absent collection but still rejects session issuance", async () => {
    expect(await resolveMetricPlaybackContext(fixture(live, []).tx, identity)).toBeNull();
    await expect(resolveMetricSessionContext(fixture(live, []).tx, identity)).rejects.toMatchObject({ code: "not_authorized" });
  });
  it.each([{ collectionEnabled: false }, { collectionStartedAt: null }, { collectionStartedAt: new Date(+now + 1) }, { expiresAt: now }])("locks but refuses inactive collection %#", async change => {
    const { tx, query } = fixture(live, [{ id: "version", expiresAt: new Date(+now + 60000), durationMs: 100000, ...change }]);
    expect(await resolveMetricPlaybackContext(tx, identity)).toBeNull();
    const sql = query.mock.calls.find(([value]) => value.strings.join("").includes('FROM "LiveMetricVersion"'))![0].strings.join("");
    expect(sql).toContain('FOR SHARE'); expect(sql).not.toContain('AND "collectionEnabled"');
  });
  it("clamps the version lifetime to the canonical playing phase deadline", async () => {
    const { tx } = fixture(live, [{ id: "version", expiresAt: new Date(+now + 300000), durationMs: 100000 }]);
    expect(await resolveMetricPlaybackContext(tx, identity)).toEqual({ versionId: "version", expiresAt: new Date(+now + 90000) });
  });
  it("resolves replay mode from the same server runtime and clamps to replay expiry", async () => {
    const replay = { ...live, scheduledAt: new Date(+now - 200000) };
    const { tx, query } = fixture(replay, [{ id: "version", expiresAt: new Date(+now + 300000), durationMs: 100000 }]);
    expect(await resolveMetricPlaybackContext(tx, identity)).toEqual({ versionId: "version", expiresAt: live.replayAvailableUntil });
    expect(query.mock.calls.find(([sql]) => sql.strings.join("").includes('FROM "LiveMetricVersion"'))![0].values[3]).toBe("replay");
  });
  it.each([
    { ...live, video: { ...readyVideo, vendorId: "other" } },
    { ...live, video: { ...readyVideo, status: "processing" } },
    { ...live, scheduledAt: new Date(+now + 1000) },
    { ...live, video: { ...readyVideo, videoUrl: "javascript:invalid" } },
    { ...live, video: { ...readyVideo, durationSec: -1 } },
  ])("rejects unavailable, mismatched or invalid playback configuration %#", async value => {
    await expect(resolveMetricPlaybackContext(fixture(value).tx, identity)).rejects.toMatchObject({ code: "not_authorized" });
  });
  it("rejects ambiguous versions and mismatched duration instead of enabling defaults", async () => {
    const row = { id: "version", expiresAt: new Date(+now + 60000), durationMs: 100000 };
    for (const versions of [[row, { ...row, id: "other" }], [{ ...row, durationMs: 99999 }]])
      await expect(resolveMetricPlaybackContext(fixture(live, versions).tx, identity)).rejects.toMatchObject({ code: "not_authorized" });
  });
});
