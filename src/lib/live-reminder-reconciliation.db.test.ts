import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { ensureLiveReminderDelivery } from "./email-delivery";
import {
  createLiveReminderReconciliationSnapshot,
  processLiveReminderReconciliationJobs,
  queueLiveReminderReconciliation,
} from "./live-reminder-reconciliation";
import type { LiveReminderTemplateSnapshot } from "./live-reminder-reconciliation";

const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "g7-23-disposable-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://g7-23.example.test");
});

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function createVendor(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vendor = await getDb().vendor.create({
    data: { name: `${label} ${suffix}`, slug: `g7-23-${label}-${suffix}`, email: `g7-23-${label}-${suffix}@example.test`, passwordHash: "disposable-test-only" },
  });
  createdVendorIds.push(vendor.id);
  return vendor;
}

async function createLiveFixture(vendor: { id: string; name: string }, suffix: string) {
  const db = getDb();
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: `Form ${suffix}`, slug: `g7-23-form-${suffix}`, headline: "Disposable form", fields: [] },
  });
  const reminderTemplate = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: `Reminder ${suffix}`, channel: "email", trigger: "live_reminder", subject: "{{live_title}}", body: "Hello {{name}}", isActive: true },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      title: `Live ${suffix}`,
      slug: `g7-23-live-${suffix}`,
      scheduledAt: new Date("2026-08-10T04:00:00.000Z"),
      liveReminderTemplateId: reminderTemplate.id,
      liveReminderOffsetMinutes: 60,
      status: "scheduled",
    },
    include: { liveReminderTemplate: true },
  });
  return { form, reminderTemplate, live };
}

function snapshotFor(live: { id: string; vendorId: string; title: string; status: string; scheduledAt: Date; liveReminderOffsetMinutes: number; liveReminderTemplate: LiveReminderTemplateSnapshot | null }, now: Date) {
  return createLiveReminderReconciliationSnapshot({
    vendorId: live.vendorId,
    liveId: live.id,
    liveTitle: live.title,
    liveStatus: live.status,
    scheduledAt: live.scheduledAt,
    reminderOffsetMinutes: live.liveReminderOffsetMinutes,
    template: live.liveReminderTemplate,
  }, now);
}

type ReconciliationJobClient = {
  liveReminderReconciliationJob: {
    count(args: unknown): Promise<number>;
    findUnique(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

function reconciliationDb() {
  return getDb() as unknown as ReconciliationJobClient;
}

async function queue(snapshot: ReturnType<typeof createLiveReminderReconciliationSnapshot>, now: Date) {
  return getDb().$transaction((tx) => queueLiveReminderReconciliation(tx, snapshot, now));
}

describe("live reminder reconciliation disposable PostgreSQL invariants", () => {
  it("keeps jobs tenant-scoped and reuses the deterministic duplicate queue identity", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const [vendorA, vendorB] = await Promise.all([createVendor("tenant-a"), createVendor("tenant-b")]);
    const [fixtureA, fixtureB] = await Promise.all([createLiveFixture(vendorA, "a"), createLiveFixture(vendorB, "b")]);
    const first = await queue(snapshotFor(fixtureA.live, now), now);
    const duplicate = await queue(snapshotFor(fixtureA.live, now), now);
    await queue(snapshotFor(fixtureB.live, now), now);

    expect(first).toMatchObject({ status: "queued" });
    expect(duplicate).toEqual({ status: "reused", jobId: first.jobId });
    expect(await reconciliationDb().liveReminderReconciliationJob.count({ where: { vendorId: vendorA.id } })).toBe(1);
    expect(await reconciliationDb().liveReminderReconciliationJob.count({ where: { vendorId: vendorB.id } })).toBe(1);
  });

  it("supersedes an older pending job when the live schedule configuration changes", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const vendor = await createVendor("supersede");
    const fixture = await createLiveFixture(vendor, "supersede");
    const first = await queue(snapshotFor(fixture.live, now), now);
    const revised = createLiveReminderReconciliationSnapshot({
      vendorId: vendor.id,
      liveId: fixture.live.id,
      liveTitle: fixture.live.title,
      liveStatus: "scheduled",
      scheduledAt: new Date("2026-08-10T05:00:00.000Z"),
      reminderOffsetMinutes: 60,
      template: fixture.live.liveReminderTemplate,
    }, now);
    await queue(revised, now);

    expect(await reconciliationDb().liveReminderReconciliationJob.findUnique({ where: { id: first.jobId }, select: { lifecycle: true, lastErrorCode: true } }))
      .toEqual({ lifecycle: "superseded", lastErrorCode: "config_superseded" });
  });

  it("reactivates the unsent A reminder after an A to B to A configuration reversal", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const vendor = await createVendor("delivery-reversal");
    const fixture = await createLiveFixture(vendor, "delivery-reversal");
    const submission = await getDb().formSubmission.create({
      data: {
        formId: fixture.form.id,
        liveId: fixture.live.id,
        name: "Verified reversal",
        email: "verified-reversal@example.test",
        verificationStatus: "VERIFIED",
        verifiedAt: now,
      },
    });
    const baseInput = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      liveId: fixture.live.id,
      liveTitle: fixture.live.title,
      formSubmissionId: submission.id,
      recipientName: submission.name,
      recipientEmail: submission.email,
      liveScheduledAt: fixture.live.scheduledAt,
      reminderOffsetMinutes: fixture.live.liveReminderOffsetMinutes,
    };
    const templateA = fixture.reminderTemplate;
    const templateB = { ...templateA, body: "Updated B {{name}}" };

    const firstA = await ensureLiveReminderDelivery({ ...baseInput, template: templateA }, now);
    const revisionB = await ensureLiveReminderDelivery({ ...baseInput, template: templateB }, now);
    const revertedA = await ensureLiveReminderDelivery({ ...baseInput, template: templateA }, now);

    expect(firstA).toMatchObject({ status: "scheduled" });
    expect(revisionB).toMatchObject({ status: "scheduled" });
    if (!("deliveryId" in firstA) || !("deliveryId" in revisionB)) {
      throw new Error("Expected both reminder revisions to create delivery ledger rows");
    }
    expect(revertedA).toMatchObject({ status: "reactivated", deliveryId: firstA.deliveryId });
    expect(await getDb().emailDelivery.findUnique({
      where: { id: firstA.deliveryId },
      select: { status: true, nextAttemptAt: true, lastErrorCode: true },
    })).toEqual({
      status: "queued",
      nextAttemptAt: new Date("2026-08-10T03:00:00.000Z"),
      lastErrorCode: null,
    });
    expect(await getDb().emailDelivery.findUnique({
      where: { id: revisionB.deliveryId },
      select: { status: true, nextAttemptAt: true, lastErrorCode: true },
    })).toEqual({ status: "superseded", nextAttemptAt: null, lastErrorCode: "schedule_superseded" });
    expect(await getDb().emailDelivery.count({
      where: {
        vendorId: vendor.id,
        sourceLiveId: fixture.live.id,
        sourceFormSubmissionId: submission.id,
        trigger: "live_reminder",
        status: { in: ["queued", "failed"] },
      },
    })).toBe(1);
  });

  it("rejects a stale A worker after the live transaction commits configuration B", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const vendor = await createVendor("stale-worker");
    const fixture = await createLiveFixture(vendor, "stale-worker");
    const submission = await getDb().formSubmission.create({
      data: {
        formId: fixture.form.id,
        liveId: fixture.live.id,
        name: "Verified stale worker",
        email: "verified-stale-worker@example.test",
        verificationStatus: "VERIFIED",
        verifiedAt: now,
      },
    });
    const snapshotA = snapshotFor(fixture.live, now);
    const jobA = await queue(snapshotA, now);
    await reconciliationDb().liveReminderReconciliationJob.update({
      where: { id: jobA.jobId },
      data: { lifecycle: "processing", claimedAt: now, nextAttemptAt: null, attemptCount: 1 },
    });
    const scheduledAtB = new Date("2026-08-10T06:00:00.000Z");
    await getDb().$transaction(async (tx) => {
      await tx.live.update({ where: { id: fixture.live.id }, data: { scheduledAt: scheduledAtB } });
      await queueLiveReminderReconciliation(tx, createLiveReminderReconciliationSnapshot({
        vendorId: vendor.id,
        liveId: fixture.live.id,
        liveTitle: fixture.live.title,
        liveStatus: "scheduled",
        scheduledAt: scheduledAtB,
        reminderOffsetMinutes: fixture.live.liveReminderOffsetMinutes,
        template: fixture.live.liveReminderTemplate,
      }, now), now);
    });

    await expect(ensureLiveReminderDelivery({
      vendorId: vendor.id,
      vendorName: vendor.name,
      liveId: fixture.live.id,
      liveTitle: fixture.live.title,
      formSubmissionId: submission.id,
      recipientName: submission.name,
      recipientEmail: submission.email,
      liveScheduledAt: fixture.live.scheduledAt,
      reminderOffsetMinutes: fixture.live.liveReminderOffsetMinutes,
      template: fixture.live.liveReminderTemplate,
    }, now, {
      reconciliationGuard: { jobId: jobA.jobId, configDigest: snapshotA.configDigest },
    })).resolves.toEqual({ status: "config_superseded" });
    expect(await getDb().emailDelivery.count({
      where: { vendorId: vendor.id, sourceLiveId: fixture.live.id, trigger: "live_reminder" },
    })).toBe(0);
    expect(await reconciliationDb().liveReminderReconciliationJob.findUnique({
      where: { id: jobA.jobId },
      select: { lifecycle: true, lastErrorCode: true },
    })).toEqual({ lifecycle: "superseded", lastErrorCode: "config_superseded" });
  });

  it("rejects a stale title A worker after the live transaction commits title B", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const vendor = await createVendor("stale-title-worker");
    const fixture = await createLiveFixture(vendor, "stale-title-worker");
    const submission = await getDb().formSubmission.create({
      data: {
        formId: fixture.form.id,
        liveId: fixture.live.id,
        name: "Verified stale title worker",
        email: "verified-stale-title-worker@example.test",
        verificationStatus: "VERIFIED",
        verifiedAt: now,
      },
    });
    const snapshotA = snapshotFor(fixture.live, now);
    const jobA = await queue(snapshotA, now);
    await reconciliationDb().liveReminderReconciliationJob.update({
      where: { id: jobA.jobId },
      data: { lifecycle: "processing", claimedAt: now, nextAttemptAt: null, attemptCount: 1 },
    });
    const titleB = "Renamed title B";
    await getDb().$transaction(async (tx) => {
      await tx.live.update({ where: { id: fixture.live.id }, data: { title: titleB } });
      await queueLiveReminderReconciliation(tx, createLiveReminderReconciliationSnapshot({
        vendorId: vendor.id,
        liveId: fixture.live.id,
        liveTitle: titleB,
        liveStatus: "scheduled",
        scheduledAt: fixture.live.scheduledAt,
        reminderOffsetMinutes: fixture.live.liveReminderOffsetMinutes,
        template: fixture.live.liveReminderTemplate,
      }, now), now);
    });

    await expect(ensureLiveReminderDelivery({
      vendorId: vendor.id,
      vendorName: vendor.name,
      liveId: fixture.live.id,
      liveTitle: fixture.live.title,
      formSubmissionId: submission.id,
      recipientName: submission.name,
      recipientEmail: submission.email,
      liveScheduledAt: fixture.live.scheduledAt,
      reminderOffsetMinutes: fixture.live.liveReminderOffsetMinutes,
      template: fixture.live.liveReminderTemplate,
    }, now, {
      reconciliationGuard: { jobId: jobA.jobId, configDigest: snapshotA.configDigest },
    })).resolves.toEqual({ status: "config_superseded" });
    expect(await getDb().emailDelivery.count({
      where: { vendorId: vendor.id, sourceLiveId: fixture.live.id, trigger: "live_reminder" },
    })).toBe(0);
  });

  it("processes only VERIFIED submissions in stable createdAt/id batches and persists the cursor", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const vendor = await createVendor("cursor");
    const fixture = await createLiveFixture(vendor, "cursor");
    const first = await getDb().formSubmission.create({ data: { formId: fixture.form.id, liveId: fixture.live.id, name: "Verified A", email: "verified-a@example.test", verificationStatus: "VERIFIED", verifiedAt: now } });
    await getDb().formSubmission.create({ data: { formId: fixture.form.id, liveId: fixture.live.id, name: "Unverified", email: "unverified@example.test", verificationStatus: "UNVERIFIED" } });
    const second = await getDb().formSubmission.create({ data: { formId: fixture.form.id, liveId: fixture.live.id, name: "Verified B", email: "verified-b@example.test", verificationStatus: "VERIFIED", verifiedAt: now } });
    const queued = await queue(snapshotFor(fixture.live, now), now);

    await processLiveReminderReconciliationJobs({ limit: 1, batchSize: 1, now });
    expect(await reconciliationDb().liveReminderReconciliationJob.findUnique({ where: { id: queued.jobId }, select: { lifecycle: true, cursorId: true, scannedCount: true } }))
      .toEqual({ lifecycle: "pending", cursorId: first.id, scannedCount: 1 });
    await processLiveReminderReconciliationJobs({ limit: 1, batchSize: 1, now });
    await processLiveReminderReconciliationJobs({ limit: 1, batchSize: 1, now });
    expect(await getDb().emailDelivery.count({ where: { vendorId: vendor.id, trigger: "live_reminder" } })).toBe(2);
    expect(await reconciliationDb().liveReminderReconciliationJob.findUnique({ where: { id: queued.jobId }, select: { lifecycle: true, cursorId: true, scannedCount: true } }))
      .toEqual({ lifecycle: "completed", cursorId: second.id, scannedCount: 2 });
  });

  it("cancels queued or failed reminder deliveries for a disabled configuration", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const vendor = await createVendor("cancel");
    const fixture = await createLiveFixture(vendor, "cancel");
    await getDb().emailDelivery.create({
      data: {
        id: "g7-23-cancel-delivery", vendorId: vendor.id, sourceTemplateId: fixture.reminderTemplate.id, sourceLiveId: fixture.live.id,
        sourceFormSubmissionId: null, trigger: "live_reminder", payloadEncryptedEnvelope: "disposable", recipientHash: "disposable", recipientMaskedEmail: "d***@example.test",
        idempotencyKey: "g7-23-cancel", status: "queued", maxAttempts: 5, nextAttemptAt: now,
      },
    });
    const disabled = createLiveReminderReconciliationSnapshot({
      vendorId: vendor.id, liveId: fixture.live.id, liveTitle: fixture.live.title, liveStatus: "scheduled", scheduledAt: fixture.live.scheduledAt, reminderOffsetMinutes: 60, template: null,
    }, now);
    await queue(disabled, now);

    expect(await getDb().emailDelivery.findUnique({ where: { id: "g7-23-cancel-delivery" }, select: { status: true, nextAttemptAt: true, lastErrorCode: true } }))
      .toEqual({ status: "superseded", nextAttemptAt: null, lastErrorCode: "reconciliation_cancelled" });
  });

  it("recovers a stale lease and permits only one concurrent claim", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const vendor = await createVendor("lease");
    const fixture = await createLiveFixture(vendor, "lease");
    const queued = await queue(snapshotFor(fixture.live, now), now);
    await reconciliationDb().liveReminderReconciliationJob.update({
      where: { id: queued.jobId },
      data: { lifecycle: "processing", claimedAt: new Date(now.getTime() - 11 * 60 * 1_000), nextAttemptAt: null, attemptCount: 1 },
    });
    const results = (await Promise.all([
      processLiveReminderReconciliationJobs({ limit: 1, batchSize: 1, now }),
      processLiveReminderReconciliationJobs({ limit: 1, batchSize: 1, now }),
    ])).flat();

    expect(results.filter((result) => result.status === "completed")).toHaveLength(1);
    expect(await reconciliationDb().liveReminderReconciliationJob.findUnique({ where: { id: queued.jobId }, select: { lifecycle: true, claimedAt: true, lastErrorCode: true } }))
      .toEqual({ lifecycle: "completed", claimedAt: null, lastErrorCode: null });
  });
});
