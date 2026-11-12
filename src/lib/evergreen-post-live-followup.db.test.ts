import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import {
  EVERGREEN_FOLLOWUP_LOOKBACK_MS,
  isCurrentEmailDeliverySnapshot,
  processDuePostLiveFollowups,
} from "@/lib/email-delivery";
import { recordEvergreenSessionAssignment } from "@/lib/evergreen-session-assignment";
import { createEmailRecipientHash, revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { supersedeFixedTimeNotificationsForActiveEvergreen } from "@/lib/live-notification-delivery";

/**
 * An active evergreen Live gives every visitor their own session, so the
 * shared `scheduledAt` says nothing about when a registrant's webinar ends.
 * post_live_followup is never anchored on it while evergreen is active; a
 * registrant whose session was recorded (EvergreenSessionAssignment) is
 * followed up after that session instead (F-2, second describe block).
 *
 * Every job call is scoped to this test's vendor, so the global rule paging
 * and other vendors' rows cannot change what these assertions see.
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
    select: {
      id: true,
      vendorId: true,
      sourceLiveId: true,
      sourceFormSubmissionId: true,
      trigger: true,
      idempotencyKey: true,
      status: true,
      lastErrorCode: true,
      attemptCount: true,
      nextAttemptAt: true,
      payloadEncryptedEnvelope: true,
    },
  });
}

function setEvergreen(vendorId: string, liveId: string, isEvergreen: boolean) {
  return getDb().live.updateMany({ where: { id: liveId, vendorId }, data: { isEvergreen } });
}

describe("evergreen post_live_followup disposable database integration", () => {
  it("does not queue a follow-up from the shared scheduledAt while evergreen is active", async () => {
    const { vendor, live } = await createFixture({ isEvergreen: true });

    // The registrant never opened the viewer page: no recorded session, no follow-up.
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([]);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([]);
  });

  it("still queues the follow-up for the same fixed-time Live (control)", async () => {
    const { vendor, live, submission } = await createFixture({ isEvergreen: false });

    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id }))
      .resolves.toEqual([{ status: "queued" }]);

    const deliveries = await followupDeliveries(vendor.id, live.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: "queued", sourceFormSubmissionId: submission.id });
    await expect(isCurrentEmailDeliverySnapshot(deliveries[0]!, now)).resolves.toBe(true);
  });

  it("rejects at send time, and supersedes on enabling, a follow-up queued before evergreen was enabled", async () => {
    const { vendor, live } = await createFixture({ isEvergreen: false });
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    expect(queued).toMatchObject({ status: "queued" });

    await setEvergreen(vendor.id, live.id, true);

    // Send-time guard: the stale row is no longer a current snapshot.
    await expect(isCurrentEmailDeliverySnapshot(queued!, now)).resolves.toBe(false);

    // Post-commit pass after enabling cancels it outright.
    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: vendor.id, liveId: live.id }, now))
      .resolves.toBe(1);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([
      expect.objectContaining({ id: queued!.id, status: "superseded", lastErrorCode: "lifecycle_superseded" }),
    ]);
  });

  it("reactivates the superseded follow-up once evergreen is turned off again, ready to send", async () => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: false });
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    expect(queued).toMatchObject({ status: "queued" });

    // On: the queued row is cancelled and nothing new is scheduled.
    await setEvergreen(vendor.id, live.id, true);
    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: vendor.id, liveId: live.id }, now))
      .resolves.toBe(1);
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([]);

    // Off: the next run brings the same deterministic row back. The name is
    // not part of the revision id, so this proves the payload is rebuilt.
    await setEvergreen(vendor.id, live.id, false);
    await db.formSubmission.update({ where: { id: submission.id }, data: { name: "Renamed Lead" } });
    const later = new Date(now.getTime() + 60_000);
    await expect(processDuePostLiveFollowups({ now: later, vendorId: vendor.id }))
      .resolves.toEqual([{ status: "reactivated" }]);

    const deliveries = await followupDeliveries(vendor.id, live.id);
    expect(deliveries).toEqual([
      expect.objectContaining({
        id: queued!.id,
        sourceFormSubmissionId: submission.id,
        status: "queued",
        lastErrorCode: null,
        attemptCount: 0,
        nextAttemptAt: later,
      }),
    ]);
    // The payload was rebuilt from current data, and the row passes the send-time guard.
    const before = revealEmailDeliveryPayload(queued!.payloadEncryptedEnvelope, { vendorId: vendor.id, deliveryId: queued!.id });
    const after = revealEmailDeliveryPayload(deliveries[0]!.payloadEncryptedEnvelope, { vendorId: vendor.id, deliveryId: queued!.id });
    expect(before.body).toContain("謝謝 Evergreen Lead 參加。");
    expect(after.body).toContain("謝謝 Renamed Lead 參加。");
    expect(after.body).not.toContain("Evergreen Lead");
    await expect(isCurrentEmailDeliverySnapshot(deliveries[0]!, later)).resolves.toBe(true);

    // A further run is a plain duplicate, not another reactivation.
    await expect(processDuePostLiveFollowups({ now: later, vendorId: vendor.id }))
      .resolves.toEqual([{ status: "duplicate" }]);
  });

  // The next two cases stop in the create path's already_sent check, before
  // the unique conflict that leads to reactivation; the reactivation path's
  // own check is covered by the unit tests in email-delivery.test.ts.
  it("returns already_sent from the create path for a follow-up sent before the on/off round trip", async () => {
    const db = getDb();
    const { vendor, live } = await createFixture({ isEvergreen: false });
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    await db.emailDelivery.updateMany({
      where: { id: queued!.id, vendorId: vendor.id },
      data: { status: "sent", sentAt: now, nextAttemptAt: null },
    });

    await setEvergreen(vendor.id, live.id, true);
    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: vendor.id, liveId: live.id }, now))
      .resolves.toBe(0);
    await setEvergreen(vendor.id, live.id, false);

    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id }))
      .resolves.toEqual([{ status: "already_sent" }]);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([
      expect.objectContaining({ id: queued!.id, status: "sent" }),
    ]);
  });

  it("returns already_sent from the create path, leaving a superseded revision alone, when another revision of the same rule was sent", async () => {
    const db = getDb();
    const { vendor, live } = await createFixture({ isEvergreen: false });
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    // The current revision was superseded; an older revision of the same rule
    // (same idempotency prefix, different id) already reached the recipient.
    await db.emailDelivery.updateMany({
      where: { id: queued!.id, vendorId: vendor.id },
      data: { status: "superseded", nextAttemptAt: null, lastErrorCode: "lifecycle_superseded" },
    });
    const prefix = queued!.idempotencyKey.slice(0, queued!.idempotencyKey.length - queued!.id.length);
    const full = await db.emailDelivery.findUniqueOrThrow({ where: { id: queued!.id } });
    await db.emailDelivery.create({
      data: {
        id: `${queued!.id}-older`,
        vendorId: vendor.id,
        sourceTemplateId: full.sourceTemplateId,
        sourceLiveId: live.id,
        sourceFormSubmissionId: full.sourceFormSubmissionId,
        trigger: "post_live_followup",
        payloadEncryptedEnvelope: "disposable-not-dispatched",
        recipientHash: full.recipientHash,
        recipientMaskedEmail: full.recipientMaskedEmail,
        idempotencyKey: `${prefix}${queued!.id}-older`,
        status: "sent",
        sentAt: now,
      },
    });

    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id }))
      .resolves.toEqual([{ status: "already_sent" }]);
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: queued!.id }, select: { status: true } }))
      .resolves.toEqual({ status: "superseded" });
  });

  it("reactivates revision A and supersedes revision B when a template edit A -> B -> A is reverted, leaving one sendable row", async () => {
    const db = getDb();
    const { vendor, live } = await createFixture({ isEvergreen: false });
    const template = await db.messageTemplate.findFirstOrThrow({ where: { vendorId: vendor.id, trigger: "post_live_followup" } });
    const originalSubject = template.subject!;

    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const [revisionA] = await followupDeliveries(vendor.id, live.id);

    // A -> B: B is a new revision of the same rule; A is superseded.
    await db.messageTemplate.updateMany({ where: { id: template.id, vendorId: vendor.id }, data: { subject: `${originalSubject}（更新）` } });
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const afterB = await followupDeliveries(vendor.id, live.id);
    const revisionB = afterB.find((delivery) => delivery.id !== revisionA!.id)!;
    expect(revisionB.idempotencyKey.slice(0, -revisionB.id.length)).toBe(revisionA!.idempotencyKey.slice(0, -revisionA!.id.length));
    expect(afterB).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: revisionA!.id, status: "superseded" }),
      expect.objectContaining({ id: revisionB.id, status: "queued" }),
    ]));

    // B -> A: A comes back and B is superseded, so exactly one row can be sent.
    await db.messageTemplate.updateMany({ where: { id: template.id, vendorId: vendor.id }, data: { subject: originalSubject } });
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "reactivated" }]);
    const afterRevert = await followupDeliveries(vendor.id, live.id);
    expect(afterRevert).toHaveLength(2);
    expect(afterRevert).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: revisionA!.id, status: "queued" }),
      expect.objectContaining({ id: revisionB.id, status: "superseded", lastErrorCode: "config_superseded" }),
    ]));
    const sendable = [];
    for (const delivery of afterRevert) {
      if (delivery.status === "queued" && await isCurrentEmailDeliverySnapshot(delivery, now)) sendable.push(delivery.id);
    }
    expect(sendable).toEqual([revisionA!.id]);
  });

  it.each([
    ["an unsubscribe", "recipient_suppressed"],
    ["a vendor blacklist entry", "recipient_blacklisted"],
  ] as const)("reactivates as suppressed when the recipient now has %s", async (_label, lastErrorCode) => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: false });
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    await setEvergreen(vendor.id, live.id, true);
    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: vendor.id, liveId: live.id }, now))
      .resolves.toBe(1);

    if (lastErrorCode === "recipient_suppressed") {
      await db.emailSuppression.create({
        data: {
          vendorId: vendor.id,
          recipientHash: createEmailRecipientHash(submission.email, vendor.id),
          recipientMaskedEmail: "l***@example.test",
          reason: "unsubscribe",
          source: "disposable-test",
        },
      });
    } else {
      await db.blacklist.create({
        data: { vendorId: vendor.id, identifier: submission.email.toLowerCase(), identifierType: "email", reason: "disposable-test" },
      });
    }
    await setEvergreen(vendor.id, live.id, false);

    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "suppressed" }]);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([
      expect.objectContaining({ id: queued!.id, status: "suppressed", lastErrorCode, nextAttemptAt: null }),
    ]);
  });

  it("treats a revision that is being sent right now as sent: no new revision and no reactivation", async () => {
    const db = getDb();
    const { vendor, live } = await createFixture({ isEvergreen: false });
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    // The current revision was superseded while an older revision of the same
    // rule is claimed by the dispatcher (status "sending").
    await db.emailDelivery.updateMany({
      where: { id: queued!.id, vendorId: vendor.id },
      data: { status: "superseded", nextAttemptAt: null, lastErrorCode: "lifecycle_superseded" },
    });
    const prefix = queued!.idempotencyKey.slice(0, -queued!.id.length);
    const full = await db.emailDelivery.findUniqueOrThrow({ where: { id: queued!.id } });
    await db.emailDelivery.create({
      data: {
        id: `${queued!.id}-sending`,
        vendorId: vendor.id,
        sourceTemplateId: full.sourceTemplateId,
        sourceLiveId: live.id,
        sourceFormSubmissionId: full.sourceFormSubmissionId,
        trigger: "post_live_followup",
        payloadEncryptedEnvelope: "disposable-not-dispatched",
        recipientHash: full.recipientHash,
        recipientMaskedEmail: full.recipientMaskedEmail,
        idempotencyKey: `${prefix}${queued!.id}-sending`,
        status: "sending",
        claimedAt: now,
        attemptCount: 1,
      },
    });

    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id }))
      .resolves.toEqual([{ status: "already_sent" }]);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: queued!.id, status: "superseded" }),
      expect.objectContaining({ id: `${queued!.id}-sending`, status: "sending" }),
    ]));
    expect(await db.emailDelivery.count({ where: { vendorId: vendor.id, sourceLiveId: live.id, trigger: "post_live_followup" } })).toBe(2);
  });

  it("does not queue a follow-up for an address the send-time guard can never accept", async () => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: false });
    await db.formSubmission.update({ where: { id: submission.id }, data: { email: "not-an-email-address" } });

    // Queuing it would only be superseded at send time and come back every
    // minute; the job reports it as not configured and writes nothing.
    for (const at of [now, new Date(now.getTime() + 60_000)]) {
      await expect(processDuePostLiveFollowups({ now: at, vendorId: vendor.id }))
        .resolves.toEqual([{ status: "not_configured" }]);
    }
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([]);
  });

  it("keeps an ended Live's follow-up when the evergreen flag is set on it (evergreen is not active)", async () => {
    const db = getDb();
    const { vendor, live } = await createFixture({ isEvergreen: false });
    await db.live.updateMany({
      where: { id: live.id, vendorId: vendor.id },
      data: { status: "ended", endedAt: new Date("2026-09-01T02:10:00.000Z") },
    });
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    expect(queued).toMatchObject({ status: "queued" });

    await setEvergreen(vendor.id, live.id, true);

    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: vendor.id, liveId: live.id }, now))
      .resolves.toBe(0);
    await expect(isCurrentEmailDeliverySnapshot(queued!, now)).resolves.toBe(true);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([
      expect.objectContaining({ id: queued!.id, status: "queued" }),
    ]);
  });
});

/**
 * F-2: per-registrant evergreen follow-ups. The fixture's video is 600 s and
 * the rule offset 30 min, so a session is due once start + 40 min <= now.
 */
describe("evergreen per-registrant post_live_followup", () => {
  const FINGERPRINT = "c".repeat(32);
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const before = (ms: number) => new Date(now.getTime() - ms);
  // Latest start whose follow-up is due at `now`.
  const cutoff = before(10 * MINUTE + 30 * MINUTE);

  function assign(vendorId: string, liveId: string, formSubmissionId: string, sessionStartAt: Date, scheduleFingerprint = FINGERPRINT) {
    return recordEvergreenSessionAssignment({ vendorId, liveId, formSubmissionId, sessionStartAt, scheduleFingerprint, now });
  }

  async function addRegistrant(vendorId: string, liveId: string, label: string) {
    const db = getDb();
    const form = await db.registrationForm.findFirstOrThrow({ where: { vendorId } });
    return db.formSubmission.create({
      data: { formId: form.id, liveId, name: `Lead ${label}`, email: `lead-${label}-${randomUUID()}@example.test`, verificationStatus: "VERIFIED" },
    });
  }

  const taipei = (value: Date) => new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(value);

  it("queues the follow-up only after the registrant's own session, with their own start time", async () => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await db.messageTemplate.updateMany({ where: { vendorId: vendor.id }, data: { body: "謝謝 {{name}} 參加 {{live_start_at}} 場。\n{{unsubscribe_url}}" } });
    const start = before(30 * MINUTE);
    await expect(assign(vendor.id, live.id, submission.id, start)).resolves.toBe("recorded");

    // Session ended 20 minutes ago; the 30-minute offset has not passed.
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([]);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([]);

    const due = new Date(now.getTime() + 10 * MINUTE);
    await expect(processDuePostLiveFollowups({ now: due, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const [queued] = await followupDeliveries(vendor.id, live.id);
    expect(queued).toMatchObject({ status: "queued", sourceFormSubmissionId: submission.id, nextAttemptAt: due });
    const payload = revealEmailDeliveryPayload(queued!.payloadEncryptedEnvelope, { vendorId: vendor.id, deliveryId: queued!.id });
    expect(payload.body).toContain(`參加 ${taipei(start)} 場。`);
    expect(payload.body).not.toContain(taipei(scheduledAt));
    // Send-time guard: current while evergreen is active and the session matches.
    await expect(isCurrentEmailDeliverySnapshot(queued!, due)).resolves.toBe(true);
    // A further run is a duplicate, not a second email.
    await expect(processDuePostLiveFollowups({ now: due, vendorId: vendor.id })).resolves.toEqual([{ status: "duplicate" }]);
  });

  it("follows up only registrants with a recorded session", async () => {
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    const viewer = await addRegistrant(vendor.id, live.id, "viewer");
    await assign(vendor.id, live.id, viewer.id, before(2 * HOUR));

    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const deliveries = await followupDeliveries(vendor.id, live.id);
    expect(deliveries.map((delivery) => delivery.sourceFormSubmissionId)).toEqual([viewer.id]);
    expect(deliveries.map((delivery) => delivery.sourceFormSubmissionId)).not.toContain(submission.id);
  });

  it("does not send a follow-up more than 72 hours overdue", async () => {
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    const inside = await addRegistrant(vendor.id, live.id, "inside");
    const edge = await addRegistrant(vendor.id, live.id, "edge");
    expect(EVERGREEN_FOLLOWUP_LOOKBACK_MS).toBe(72 * HOUR);
    await assign(vendor.id, live.id, submission.id, new Date(cutoff.getTime() - 72 * HOUR - MINUTE));
    await assign(vendor.id, live.id, edge.id, new Date(cutoff.getTime() - 72 * HOUR));
    await assign(vendor.id, live.id, inside.id, new Date(cutoff.getTime() - 72 * HOUR + MINUTE));

    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const deliveries = await followupDeliveries(vendor.id, live.id);
    expect(deliveries.map((delivery) => delivery.sourceFormSubmissionId)).toEqual([inside.id]);
  });

  it("supersedes the earlier session's unsent follow-up when a rejoin moves the registrant to a later session", async () => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await assign(vendor.id, live.id, submission.id, before(3 * HOUR));
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [first] = await followupDeliveries(vendor.id, live.id);
    expect(first).toMatchObject({ status: "queued" });

    // Rejoin to a session that has not ended yet: the first email is no
    // longer current, and nothing new is queued until the new session is due.
    const later = before(10 * MINUTE);
    await expect(assign(vendor.id, live.id, submission.id, later)).resolves.toBe("recorded");
    await expect(isCurrentEmailDeliverySnapshot(first!, now)).resolves.toBe(false);
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([]);

    const due = new Date(later.getTime() + 41 * MINUTE);
    await expect(processDuePostLiveFollowups({ now: due, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const deliveries = await followupDeliveries(vendor.id, live.id);
    expect(deliveries).toHaveLength(2);
    const second = deliveries.find((delivery) => delivery.id !== first!.id)!;
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first!.id, status: "superseded", lastErrorCode: "config_superseded" }),
      expect.objectContaining({ id: second.id, status: "queued" }),
    ]));
    await expect(isCurrentEmailDeliverySnapshot(second, due)).resolves.toBe(true);
    expect(await db.emailDelivery.count({ where: { vendorId: vendor.id, sourceLiveId: live.id, status: "queued" } })).toBe(1);
  });

  it("never sends a second follow-up after a rejoin once the first one was sent", async () => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await assign(vendor.id, live.id, submission.id, before(3 * HOUR));
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [first] = await followupDeliveries(vendor.id, live.id);
    await db.emailDelivery.updateMany({ where: { id: first!.id, vendorId: vendor.id }, data: { status: "sent", sentAt: now, nextAttemptAt: null } });

    await assign(vendor.id, live.id, submission.id, before(2 * HOUR));
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "already_sent" }]);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([expect.objectContaining({ id: first!.id, status: "sent" })]);
  });

  it("supersedes the old revision when the template changes, leaving one sendable row", async () => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await assign(vendor.id, live.id, submission.id, before(2 * HOUR));
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const [revisionA] = await followupDeliveries(vendor.id, live.id);

    await db.messageTemplate.updateMany({ where: { vendorId: vendor.id }, data: { subject: "{{live_title}} 課後通知 v2" } });
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const deliveries = await followupDeliveries(vendor.id, live.id);
    const revisionB = deliveries.find((delivery) => delivery.id !== revisionA!.id)!;
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: revisionA!.id, status: "superseded" }),
      expect.objectContaining({ id: revisionB.id, status: "queued" }),
    ]));
    await expect(isCurrentEmailDeliverySnapshot(revisionA!, now)).resolves.toBe(false);
    await expect(isCurrentEmailDeliverySnapshot(revisionB, now)).resolves.toBe(true);
  });

  it("keeps tenants apart: a run for one vendor never touches another vendor's sessions", async () => {
    const first = await createFixture({ isEvergreen: true });
    const second = await createFixture({ isEvergreen: true });
    await assign(first.vendor.id, first.live.id, first.submission.id, before(2 * HOUR));
    await assign(second.vendor.id, second.live.id, second.submission.id, before(2 * HOUR));
    // A registration id of the other tenant cannot be recorded on this Live.
    await expect(assign(first.vendor.id, first.live.id, second.submission.id, before(2 * HOUR))).resolves.toBe("skipped");

    await expect(processDuePostLiveFollowups({ now, vendorId: first.vendor.id })).resolves.toEqual([{ status: "queued" }]);
    await expect(followupDeliveries(first.vendor.id, first.live.id)).resolves.toEqual([
      expect.objectContaining({ vendorId: first.vendor.id, sourceFormSubmissionId: first.submission.id }),
    ]);
    await expect(getDb().emailDelivery.count({ where: { vendorId: second.vendor.id } })).resolves.toBe(0);
  });

  it("does not send again after evergreen is switched off when the evergreen follow-up was already sent", async () => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await assign(vendor.id, live.id, submission.id, before(2 * HOUR));
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [evergreenRow] = await followupDeliveries(vendor.id, live.id);
    await db.emailDelivery.updateMany({ where: { id: evergreenRow!.id, vendorId: vendor.id }, data: { status: "sent", sentAt: now, nextAttemptAt: null } });

    // Off: #582 falls back to the original scheduledAt for verified registrants.
    await setEvergreen(vendor.id, live.id, false);
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "already_sent" }]);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([expect.objectContaining({ id: evergreenRow!.id, status: "sent" })]);
  });

  it("replaces an unsent evergreen follow-up with the scheduledAt one after evergreen is switched off", async () => {
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await assign(vendor.id, live.id, submission.id, before(2 * HOUR));
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [evergreenRow] = await followupDeliveries(vendor.id, live.id);

    await setEvergreen(vendor.id, live.id, false);
    // The evergreen revision is no longer current once evergreen is off.
    await expect(isCurrentEmailDeliverySnapshot(evergreenRow!, now)).resolves.toBe(false);
    await expect(processDuePostLiveFollowups({ now, vendorId: vendor.id })).resolves.toEqual([{ status: "queued" }]);
    const deliveries = await followupDeliveries(vendor.id, live.id);
    const fallback = deliveries.find((delivery) => delivery.id !== evergreenRow!.id)!;
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: evergreenRow!.id, status: "superseded" }),
      expect.objectContaining({ id: fallback.id, status: "queued" }),
    ]));
    await expect(isCurrentEmailDeliverySnapshot(fallback, now)).resolves.toBe(true);
  });

  it("rejects at send time when the registrant has no recorded session", async () => {
    const db = getDb();
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await assign(vendor.id, live.id, submission.id, before(2 * HOUR));
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    await expect(isCurrentEmailDeliverySnapshot(queued!, now)).resolves.toBe(true);

    await db.evergreenSessionAssignment.deleteMany({ where: { vendorId: vendor.id, formSubmissionId: submission.id } });
    await expect(isCurrentEmailDeliverySnapshot(queued!, now)).resolves.toBe(false);
  });

  it("rejects at send time a follow-up whose recorded session is not due yet", async () => {
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await assign(vendor.id, live.id, submission.id, before(2 * HOUR));
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);
    // Same session, checked before it was due (start + 40 min).
    await expect(isCurrentEmailDeliverySnapshot(queued!, before(90 * MINUTE))).resolves.toBe(false);
  });

  it("recovers a follow-up cancelled by re-saving evergreen settings on the next run", async () => {
    const { vendor, live, submission } = await createFixture({ isEvergreen: true });
    await assign(vendor.id, live.id, submission.id, before(2 * HOUR));
    await processDuePostLiveFollowups({ now, vendorId: vendor.id });
    const [queued] = await followupDeliveries(vendor.id, live.id);

    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: vendor.id, liveId: live.id }, now)).resolves.toBe(1);
    const later = new Date(now.getTime() + MINUTE);
    await expect(processDuePostLiveFollowups({ now: later, vendorId: vendor.id })).resolves.toEqual([{ status: "reactivated" }]);
    await expect(followupDeliveries(vendor.id, live.id)).resolves.toEqual([
      expect.objectContaining({ id: queued!.id, status: "queued", nextAttemptAt: later }),
    ]);
    await expect(isCurrentEmailDeliverySnapshot(queued!, later)).resolves.toBe(true);
  });
});
