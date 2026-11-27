import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { resolveLiveWaitingSource } from "@/lib/live-waiting-source";

// Real PostgreSQL: the composite foreign key of 20261127100000_live_waiting_video
// decides what the unit tests only mock.
const db = getDb();
const vendors: string[] = [];
const NOW = new Date("2026-11-27T10:00:00.000Z");

afterEach(async () => {
  // A Vendor delete cascades to its Lives and Videos in one statement: the
  // NO ACTION key is checked at its end, so the cleanup itself proves it.
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

async function vendorWithLive(label: string) {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Synthetic ${label}`, slug: `waiting-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendors.push(vendor.id);
  const main = await db.video.create({
    data: { vendorId: vendor.id, title: "main", sourceType: "url", videoUrl: "https://video.example.test/main.mp4", status: "ready", durationSec: 1_800 },
  });
  const loop = await db.video.create({
    data: { vendorId: vendor.id, title: "loop", sourceType: "url", videoUrl: `https://video.example.test/loop-${suffix}.mp4`, status: "ready", durationSec: 24 },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id, name: "form", slug: `form-${suffix}`, headline: "form",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    },
  });
  const template = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "confirm", channel: "email", trigger: "registration_confirmed", subject: "報名成功", body: "{{name}} {{unsubscribe_url}}" },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id, videoId: main.id, formId: form.id, messageTemplateId: template.id,
      title: "live", slug: `live-${suffix}`, status: "scheduled", streamMode: "vod",
      scheduledAt: new Date(NOW.getTime() + 30 * 60_000),
    },
  });
  return { vendor, live, main, loop };
}

describe("Live.waitingVideoId on PostgreSQL", () => {
  it("refuses another vendor's video through the composite foreign key", async () => {
    const a = await vendorWithLive("a");
    const b = await vendorWithLive("b");

    await expect(db.live.update({ where: { id: a.live.id }, data: { waitingVideoId: b.loop.id } }))
      .rejects.toMatchObject({ code: "P2003" });
    await expect(db.$executeRaw`UPDATE "Live" SET "waitingVideoId" = ${b.loop.id} WHERE "id" = ${a.live.id}`)
      .rejects.toThrow(/Live_vendorId_waitingVideoId_fkey/);
    await expect(db.live.findUnique({ where: { id: a.live.id }, select: { waitingVideoId: true } }))
      .resolves.toEqual({ waitingVideoId: null });

    await db.live.update({ where: { id: a.live.id }, data: { waitingVideoId: a.loop.id } });
    await expect(db.live.findUnique({ where: { id: a.live.id }, select: { waitingVideoId: true } }))
      .resolves.toEqual({ waitingVideoId: a.loop.id });
  });

  it("refuses deleting a bound video and leaves the Live untouched", async () => {
    const { live, loop } = await vendorWithLive("delete");
    await db.live.update({ where: { id: live.id }, data: { waitingVideoId: loop.id } });

    await expect(db.video.delete({ where: { id: loop.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.live.findUnique({ where: { id: live.id }, select: { waitingVideoId: true, status: true } }))
      .resolves.toEqual({ waitingVideoId: loop.id, status: "scheduled" });
  });

  it("serves only the Live's own bound loop, only before the start", async () => {
    const a = await vendorWithLive("serve-a");
    const b = await vendorWithLive("serve-b");
    await db.live.update({ where: { id: a.live.id }, data: { waitingVideoId: a.loop.id } });
    await db.live.update({ where: { id: b.live.id }, data: { waitingVideoId: b.loop.id } });

    await expect(resolveLiveWaitingSource(db, { vendorId: a.vendor.id, liveId: a.live.id, now: NOW }))
      .resolves.toEqual({ playbackUrl: a.loop.videoUrl });
    // A vendor id paired with another vendor's Live finds nothing.
    await expect(resolveLiveWaitingSource(db, { vendorId: a.vendor.id, liveId: b.live.id, now: NOW })).resolves.toBeNull();
    await expect(resolveLiveWaitingSource(db, { vendorId: b.vendor.id, liveId: a.live.id, now: NOW })).resolves.toBeNull();
    // After the start the main video takes over.
    await expect(resolveLiveWaitingSource(db, { vendorId: a.vendor.id, liveId: a.live.id, now: new Date(NOW.getTime() + 31 * 60_000) }))
      .resolves.toBeNull();
    // A draft Live is not public.
    await db.live.update({ where: { id: a.live.id }, data: { status: "draft" } });
    await expect(resolveLiveWaitingSource(db, { vendorId: a.vendor.id, liveId: a.live.id, now: NOW })).resolves.toBeNull();
  });

  it("refuses binding the main video or a loop longer than 5 minutes at playback time", async () => {
    const { vendor, live, main, loop } = await vendorWithLive("guards");
    // The database only binds the vendor; length and the main video are checked by the application.
    await db.live.update({ where: { id: live.id }, data: { waitingVideoId: main.id } });
    await expect(resolveLiveWaitingSource(db, { vendorId: vendor.id, liveId: live.id, now: NOW })).resolves.toBeNull();
    await db.live.update({ where: { id: live.id }, data: { waitingVideoId: loop.id } });
    await db.video.update({ where: { id: loop.id }, data: { durationSec: 301 } });
    await expect(resolveLiveWaitingSource(db, { vendorId: vendor.id, liveId: live.id, now: NOW })).resolves.toBeNull();
    await db.video.update({ where: { id: loop.id }, data: { durationSec: 300 } });
    await expect(resolveLiveWaitingSource(db, { vendorId: vendor.id, liveId: live.id, now: NOW }))
      .resolves.toEqual({ playbackUrl: loop.videoUrl });
    // More than 60 minutes before the start: poster only.
    await expect(resolveLiveWaitingSource(db, { vendorId: vendor.id, liveId: live.id, now: new Date(NOW.getTime() - 31 * 60_000) }))
      .resolves.toBeNull();
  });

  it("serves nothing when the vendor's included Stream minutes are used up", async () => {
    const { vendor, live, loop } = await vendorWithLive("quota");
    await db.live.update({ where: { id: live.id }, data: { waitingVideoId: loop.id } });
    // resetAt in the past: only the ledger counter decides, not the legacy aggregate.
    await db.vendorUsageLimit.create({ data: { vendorId: vendor.id, streamMinutesLimit: 1, resetAt: new Date("2026-11-01T00:00:00.000Z") } });
    await db.streamUsageMonthlyCounter.create({ data: { vendorId: vendor.id, monthKey: "2026-11", watchSeconds: 60 } });

    await expect(resolveLiveWaitingSource(db, { vendorId: vendor.id, liveId: live.id, now: NOW })).resolves.toBeNull();
    await db.streamUsageMonthlyCounter.update({
      where: { vendorId_monthKey: { vendorId: vendor.id, monthKey: "2026-11" } },
      data: { watchSeconds: 59 },
    });
    await expect(resolveLiveWaitingSource(db, { vendorId: vendor.id, liveId: live.id, now: NOW }))
      .resolves.toEqual({ playbackUrl: loop.videoUrl });
  });
});
