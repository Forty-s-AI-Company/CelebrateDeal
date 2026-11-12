import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { isCurrentEmailDeliverySnapshot, processDuePostLiveFollowups } from "@/lib/email-delivery";
import { supersedeFixedTimeNotificationsForActiveEvergreen } from "@/lib/live-notification-delivery";

/**
 * An active evergreen Live gives every visitor their own session, so the
 * shared `scheduledAt` says nothing about when a registrant's webinar ends.
 * Until per-visitor follow-ups exist, post_live_followup must not be queued
 * or sent for it (same rule as live_reminder / before_live / during_live).
 */

const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "evergreen-post-live-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://evergreen-followup.example.test");
});

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

// The shared scheduledAt (and video end + offset) is well in the past.
const scheduledAt = new Date("2026-09-01T02:00:00.000Z");
const now = new Date("2026-09-02T02:00:00.000Z");

async function createFixture(options: { isEvergreen: boolean }) {
  const db = getDb();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vendor = await db.vendor.create({
    data: {
      name: `Evergreen Followup ${suffix}`,
      slug: `evergreen-followup-${suffix}`,
      email: `merchant-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "Evergreen registration",
      slug: `evergreen-followup-form-${suffix}`,
      headline: "Evergreen webinar",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    },
  });
  const template = await db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name: "Evergreen followup",
      trigger: "post_live_followup",
      subject: "{{live_title}} 課後通知",
      body: "謝謝 {{name}} 參加。\n{{unsubscribe_url}}",
    },
  });
  const video = await db.video.create({
    data: {
      vendorId: vendor.id,
      title: "Evergreen video",
      videoUrl: "https://media.example.test/evergreen.mp4",
      durationSec: 600,
      status: "ready",
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      videoId: video.id,
      title: "Evergreen webinar",
      slug: `evergreen-followup-live-${suffix}`,
      scheduledAt,
      status: "scheduled",
      streamMode: "vod",
      isEvergreen: options.isEvergreen,
      evergreenScheduleMode: "just_in_time",
      evergreenIntervalMinutes: 15,
    },
  });
  await db.liveNotificationRule.create({
    data: {
      vendorId: vendor.id,
      liveId: live.id,
      messageTemplateId: template.id,
      trigger: "post_live_followup",
      offsetMinutes: 30,
    },
  });
  const submission = await db.formSubmission.create({
    data: {
      formId: form.id,
      liveId: live.id,
      name: "Evergreen Lead",
      email: `lead-${suffix}@example.test`,
      verificationStatus: "VERIFIED",
    },
  });
  return { vendor, live, submission };
}

function followupDeliveries(vendorId: string, liveId: string) {
  return getDb().emailDelivery.findMany({
    where: { vendorId, sourceLiveId: liveId, trigger: "post_live_followup" },
    select: { id: true, vendorId: true, sourceLiveId: true, sourceFormSubmissionId: true, trigger: true, idempotencyKey: true, status: true, lastErrorCode: true },
  });
}

describe("evergreen post_live_followup disposable database integration", () => {
  it("does not queue a follow-up from the shared scheduledAt while evergreen is active", async () => {
    const { vendor, live } = await createFixture({ isEvergreen: true });

    const results = await processDuePostLiveFollowups({ now, ruleLimit: 50 });

    expect(results).toEqual(expect.arrayContaining([{ status: "not_scheduled" }]));
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([]);
  });

  it("still queues the follow-up for the same fixed-time Live (control)", async () => {
    const { vendor, live } = await createFixture({ isEvergreen: false });

    await processDuePostLiveFollowups({ now, ruleLimit: 50 });

    const deliveries = await followupDeliveries(vendor.id, live.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: "queued" });
    await expect(isCurrentEmailDeliverySnapshot(deliveries[0], now)).resolves.toBe(true);
  });

  it("rejects at send time, and supersedes on enabling, a follow-up queued before evergreen was enabled", async () => {
    const db = getDb();
    const { vendor, live } = await createFixture({ isEvergreen: false });
    await processDuePostLiveFollowups({ now, ruleLimit: 50 });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    expect(queued).toMatchObject({ status: "queued" });

    await db.live.updateMany({ where: { id: live.id, vendorId: vendor.id }, data: { isEvergreen: true } });

    // Send-time guard: the stale row is no longer a current snapshot.
    await expect(isCurrentEmailDeliverySnapshot(queued, now)).resolves.toBe(false);

    // Post-commit pass after enabling cancels it outright.
    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: vendor.id, liveId: live.id }, now))
      .resolves.toBeGreaterThanOrEqual(1);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([
      expect.objectContaining({ id: queued.id, status: "superseded", lastErrorCode: "lifecycle_superseded" }),
    ]);
  });

  it("keeps an ended Live's follow-up when the evergreen flag is set on it (evergreen is not active)", async () => {
    const db = getDb();
    const { vendor, live } = await createFixture({ isEvergreen: false });
    await db.live.updateMany({
      where: { id: live.id, vendorId: vendor.id },
      data: { status: "ended", endedAt: new Date("2026-09-01T02:10:00.000Z") },
    });
    await processDuePostLiveFollowups({ now, ruleLimit: 50 });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    expect(queued).toMatchObject({ status: "queued" });

    await db.live.updateMany({ where: { id: live.id, vendorId: vendor.id }, data: { isEvergreen: true } });

    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: vendor.id, liveId: live.id }, now))
      .resolves.toBe(0);
    await expect(isCurrentEmailDeliverySnapshot(queued, now)).resolves.toBe(true);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([
      expect.objectContaining({ id: queued.id, status: "queued" }),
    ]);
  });
});
