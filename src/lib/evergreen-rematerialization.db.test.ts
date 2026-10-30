import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { rematerializeEvergreenLiveNow } from "@/lib/evergreen-rematerialization";
import { processDueLiveNotifications, supersedeLiveNotificationDeliveriesForLifecycle } from "@/lib/live-notification-delivery";
import { processLiveReminderReconciliationJobs, queueLiveReminderReconciliationForCurrentLive } from "@/lib/live-reminder-reconciliation";

const createdVendorIds: string[] = [];
const now = new Date("2026-10-30T00:00:00.000Z");
const scheduledAt = new Date("2026-12-10T04:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "evergreen-rematerialization-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://evergreen-rematerialization.example.test");
});

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function createFixture(label: string, options: { legacyReminder: boolean }) {
  const db = getDb();
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vendor = await db.vendor.create({
    data: { name: `Evergreen ${suffix}`, slug: `evergreen-remat-${suffix}`, email: `evergreen-remat-${suffix}@example.test`, passwordHash: "disposable-test-only" },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: `Form ${suffix}`, slug: `evergreen-remat-form-${suffix}`, headline: "Disposable form", fields: [] },
  });
  const template = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: `Reminder ${suffix}`, channel: "email", trigger: "live_reminder", subject: "{{live_title}}", body: "Hello {{name}}\n{{unsubscribe_url}}", isActive: true },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: `Video ${suffix}`, videoUrl: "https://media.example.test/evergreen.mp4", durationSec: 600, status: "ready" },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      videoId: video.id,
      title: `Live ${suffix}`,
      slug: `evergreen-remat-live-${suffix}`,
      scheduledAt,
      status: "scheduled",
      streamMode: "vod",
      isEvergreen: true,
      ...(options.legacyReminder ? { liveReminderTemplateId: template.id, liveReminderOffsetMinutes: 60 } : {}),
    },
  });
  const rule = options.legacyReminder
    ? null
    : await db.liveNotificationRule.create({
      data: { vendorId: vendor.id, liveId: live.id, messageTemplateId: template.id, trigger: "before_live", offsetMinutes: 60 },
    });
  await db.formSubmission.create({
    data: {
      formId: form.id,
      liveId: live.id,
      name: "Verified Lead",
      email: `lead-${suffix}@example.test`,
      verificationStatus: "VERIFIED",
      verifiedAt: now,
    },
  });
  return { vendor, live, rule };
}

/** Mirrors the evergreen settings transaction: write the flag, then queue reconciliation. */
async function saveEvergreen(fixture: Awaited<ReturnType<typeof createFixture>>, isEvergreen: boolean) {
  await getDb().$transaction(async (tx) => {
    const updated = await tx.live.updateMany({
      where: { id: fixture.live.id, vendorId: fixture.vendor.id },
      data: { isEvergreen },
    });
    expect(updated.count).toBe(1);
    if (isEvergreen) {
      await supersedeLiveNotificationDeliveriesForLifecycle(tx, {
        vendorId: fixture.vendor.id,
        liveId: fixture.live.id,
        triggers: ["before_live", "during_live"],
      });
    }
    await queueLiveReminderReconciliationForCurrentLive(tx, { vendorId: fixture.vendor.id, liveId: fixture.live.id, now });
  });
}

function reminderCount(fixture: Awaited<ReturnType<typeof createFixture>>, trigger: string, status?: string) {
  return getDb().emailDelivery.count({
    where: { vendorId: fixture.vendor.id, sourceLiveId: fixture.live.id, trigger, ...(status ? { status } : {}) },
  });
}

describe("evergreen settings re-materialization (disposable PostgreSQL)", () => {
  it("schedules the legacy live reminder right after evergreen is turned off, and the scheduled job adds nothing", async () => {
    const fixture = await createFixture("legacy", { legacyReminder: true });
    await saveEvergreen(fixture, true);
    expect(await reminderCount(fixture, "live_reminder")).toBe(0);

    await saveEvergreen(fixture, false);
    // The save only queued the job; nothing is scheduled until it is worked off.
    expect(await reminderCount(fixture, "live_reminder")).toBe(0);

    const outcome = await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now });
    expect(outcome).toMatchObject({ reminderJobs: 1, failed: [] });
    expect(await reminderCount(fixture, "live_reminder", "queued")).toBe(1);
    expect(await getDb().liveReminderReconciliationJob.findMany({
      where: { vendorId: fixture.vendor.id, liveId: fixture.live.id, lifecycle: "pending" },
    })).toHaveLength(0);

    // Idempotency: the scheduled job, and a repeated immediate run, find nothing to do.
    expect(await processLiveReminderReconciliationJobs({ now })).not.toContainEqual(expect.objectContaining({ status: "pending" }));
    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now });
    expect(await reminderCount(fixture, "live_reminder")).toBe(1);
  });

  it("materializes before_live rules right after evergreen is turned off, and is idempotent with the scheduled job", async () => {
    const fixture = await createFixture("rules", { legacyReminder: false });
    await saveEvergreen(fixture, true);
    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now });
    expect(await reminderCount(fixture, "before_live")).toBe(0);

    await saveEvergreen(fixture, false);
    expect(await reminderCount(fixture, "before_live")).toBe(0);

    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now });
    expect(await reminderCount(fixture, "before_live", "queued")).toBe(1);

    // The scheduled materializer and a second immediate run converge on the same row.
    await processDueLiveNotifications({ now, vendorId: fixture.vendor.id, includeFuture: true });
    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now });
    expect(await reminderCount(fixture, "before_live")).toBe(1);
  });

  it("cancels queued before_live emails when evergreen is turned on and does not re-create them", async () => {
    const fixture = await createFixture("enable", { legacyReminder: false });
    await saveEvergreen(fixture, false);
    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now });
    expect(await reminderCount(fixture, "before_live", "queued")).toBe(1);

    await saveEvergreen(fixture, true);
    expect(await reminderCount(fixture, "before_live", "superseded")).toBe(1);

    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now });
    await processDueLiveNotifications({ now, vendorId: fixture.vendor.id, includeFuture: true });
    expect(await reminderCount(fixture, "before_live")).toBe(1);
    expect(await reminderCount(fixture, "before_live", "queued")).toBe(0);
  });

  it("stays inside the tenant: another vendor's pending job and a foreign live id are untouched", async () => {
    const [a, b] = [await createFixture("tenant-a", { legacyReminder: true }), await createFixture("tenant-b", { legacyReminder: true })];
    await saveEvergreen(a, false);
    await saveEvergreen(b, false);

    // Vendor A's id with vendor B's live must do nothing at all.
    await rematerializeEvergreenLiveNow({ vendorId: a.vendor.id, liveId: b.live.id, now });
    expect(await reminderCount(b, "live_reminder")).toBe(0);
    expect(await getDb().liveReminderReconciliationJob.count({ where: { vendorId: b.vendor.id, lifecycle: "pending" } })).toBe(1);

    await rematerializeEvergreenLiveNow({ vendorId: a.vendor.id, liveId: a.live.id, now });
    expect(await reminderCount(a, "live_reminder", "queued")).toBe(1);
    expect(await reminderCount(b, "live_reminder")).toBe(0);
    expect(await getDb().liveReminderReconciliationJob.count({ where: { vendorId: b.vendor.id, lifecycle: "pending" } })).toBe(1);
  });
});
