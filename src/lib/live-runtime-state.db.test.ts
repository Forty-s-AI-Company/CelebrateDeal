import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { reconcileLiveRuntimeState } from "@/lib/live-runtime-state";

const createdVendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

async function createVendor(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vendor = await getDb().vendor.create({
    data: {
      name: `WP1A ${label} ${suffix}`,
      slug: `wp1a-${label}-${suffix}`,
      email: `wp1a-${label}-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  return vendor;
}

describe("live runtime reconciliation disposable PostgreSQL invariants", () => {
  it.each([
    ["replay disabled", false, null],
    ["replay deadline expired", true, new Date("2026-08-18T10:01:00.000Z")],
  ])("durably marks a naturally completed VOD ended when %s", async (_label, replayEnabled, replayAvailableUntil) => {
    const db = getDb();
    const vendor = await createVendor("replay-gate");
    const video = await db.video.create({
      data: {
        vendorId: vendor.id,
        title: "WP1A replay gate VOD",
        videoUrl: "https://video.example.test/wp1a-replay-gate.m3u8",
        sourceType: "url",
        status: "ready",
        durationSec: 60,
      },
    });
    const live = await db.live.create({
      data: {
        vendorId: vendor.id,
        videoId: video.id,
        title: "WP1A replay gate",
        slug: `wp1a-replay-gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        scheduledAt: new Date("2026-08-18T10:00:00.000Z"),
        status: "live",
        streamMode: "vod",
        replayEnabled,
        replayAvailableUntil,
      },
    });

    const result = await reconcileLiveRuntimeState(db, {
      vendorId: vendor.id,
      liveId: live.id,
      now: new Date("2026-08-18T10:02:00.000Z"),
    });

    expect(result).toMatchObject({ state: "unavailable", updated: true, updateCount: 1 });
    expect(await db.live.findUniqueOrThrow({
      where: { id: live.id },
      select: { status: true, endedAt: true },
    })).toEqual({
      status: "ended",
      endedAt: new Date("2026-08-18T10:01:00.000Z"),
    });
  });

  it("uses tenant and lifecycle predicates, converges once, and preserves a foreign live", async () => {
    const db = getDb();
    const [vendor, foreignVendor] = await Promise.all([
      createVendor("owner"),
      createVendor("foreign"),
    ]);
    const video = await db.video.create({
      data: {
        vendorId: vendor.id,
        title: "WP1A VOD",
        videoUrl: "https://video.example.test/wp1a.m3u8",
        sourceType: "url",
        status: "ready",
        durationSec: 60,
      },
    });
    const live = await db.live.create({
      data: {
        vendorId: vendor.id,
        videoId: video.id,
        title: "WP1A replay",
        slug: `wp1a-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        scheduledAt: new Date("2026-08-18T10:00:00.000Z"),
        status: "live",
        streamMode: "vod",
        replayEnabled: true,
      },
    });
    const now = new Date("2026-08-18T10:02:00.000Z");

    const first = await reconcileLiveRuntimeState(db, {
      vendorId: vendor.id,
      liveId: live.id,
      now,
    });
    expect(first).toMatchObject({ state: "replay", updated: true, updateCount: 1 });
    expect(await db.live.findUniqueOrThrow({
      where: { id: live.id },
      select: { vendorId: true, status: true, endedAt: true },
    })).toEqual({
      vendorId: vendor.id,
      status: "ended",
      endedAt: new Date("2026-08-18T10:01:00.000Z"),
    });

    const second = await reconcileLiveRuntimeState(db, {
      vendorId: vendor.id,
      liveId: live.id,
      now,
    });
    expect(second).toMatchObject({ state: "replay", updated: false, updateCount: 0 });

    const foreign = await reconcileLiveRuntimeState(db, {
      vendorId: foreignVendor.id,
      liveId: live.id,
      now,
    });
    expect(foreign).toMatchObject({ state: "unavailable", updated: false, updateCount: 0 });
    expect(await db.live.findUniqueOrThrow({ where: { id: live.id }, select: { status: true } }))
      .toEqual({ status: "ended" });
  });

  it("does not reconcile a Live Input even when both lifecycle markers exist", async () => {
    const db = getDb();
    const vendor = await createVendor("live-input");
    const video = await db.video.create({
      data: {
        vendorId: vendor.id,
        title: "WP1A Live Input",
        videoUrl: "https://video.example.test/wp1a-live.m3u8",
        sourceType: "cloudflare_live",
        status: "processing",
        durationSec: 0,
        cloudflareLiveInputUid: "wp1a-live-input",
        liveInputStatus: "created",
      },
    });
    const live = await db.live.create({
      data: {
        vendorId: vendor.id,
        videoId: video.id,
        title: "WP1A live input replay",
        slug: `wp1a-live-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        scheduledAt: new Date("2026-08-18T10:00:00.000Z"),
        status: "live",
        startedAt: new Date("2026-08-18T10:01:00.000Z"),
        endedAt: new Date("2026-08-18T10:02:00.000Z"),
        streamMode: "live",
        replayEnabled: true,
      },
    });

    const result = await reconcileLiveRuntimeState(db, {
      vendorId: vendor.id,
      liveId: live.id,
      now: new Date("2026-08-18T10:02:00.000Z"),
    });
    expect(result).toMatchObject({ state: "replay", updated: false, updateCount: 0 });
    expect(await db.live.findUniqueOrThrow({
      where: { id: live.id },
      select: { status: true, startedAt: true, endedAt: true },
    })).toEqual({
      status: "live",
      startedAt: new Date("2026-08-18T10:01:00.000Z"),
      endedAt: new Date("2026-08-18T10:02:00.000Z"),
    });
  });

  it("does not rewrite VOD lifecycle states or a persisted endedAt marker", async () => {
    const db = getDb();
    const vendor = await createVendor("no-rewrite");
    const video = await db.video.create({
      data: {
        vendorId: vendor.id,
        title: "WP1A no rewrite VOD",
        videoUrl: "https://video.example.test/wp1a-no-rewrite.m3u8",
        sourceType: "url",
        status: "ready",
        durationSec: 60,
      },
    });
    const live = await db.live.create({
      data: {
        vendorId: vendor.id,
        videoId: video.id,
        title: "WP1A no rewrite",
        slug: `wp1a-no-rewrite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        scheduledAt: new Date("2026-08-18T10:00:00.000Z"),
        status: "scheduled",
        streamMode: "vod",
        replayEnabled: true,
      },
    });

    const waiting = await reconcileLiveRuntimeState(db, {
      vendorId: vendor.id,
      liveId: live.id,
      now: new Date("2026-08-18T09:59:00.000Z"),
    });
    expect(waiting).toMatchObject({ state: "waiting", updated: false, updateCount: 0 });
    expect(await db.live.findUniqueOrThrow({ where: { id: live.id }, select: { status: true } }))
      .toEqual({ status: "scheduled" });

    await db.live.update({ where: { id: live.id }, data: { status: "live" } });
    const playing = await reconcileLiveRuntimeState(db, {
      vendorId: vendor.id,
      liveId: live.id,
      now: new Date("2026-08-18T10:00:30.000Z"),
    });
    expect(playing).toMatchObject({ state: "playing", updated: false, updateCount: 0 });
    expect(await db.live.findUniqueOrThrow({ where: { id: live.id }, select: { status: true } }))
      .toEqual({ status: "live" });

    const persistedEndedAt = new Date("2026-08-18T10:02:00.000Z");
    await db.live.update({
      where: { id: live.id },
      data: { status: "ended", endedAt: persistedEndedAt },
    });
    const replay = await reconcileLiveRuntimeState(db, {
      vendorId: vendor.id,
      liveId: live.id,
      now: new Date("2026-08-18T10:03:00.000Z"),
    });
    expect(replay).toMatchObject({ state: "replay", updated: false, updateCount: 0 });
    expect(await db.live.findUniqueOrThrow({ where: { id: live.id }, select: { status: true, endedAt: true } }))
      .toEqual({ status: "ended", endedAt: persistedEndedAt });
  });
});
