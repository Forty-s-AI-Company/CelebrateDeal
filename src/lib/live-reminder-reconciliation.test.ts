import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  ensureLiveReminderDelivery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/email-delivery", () => ({ ensureLiveReminderDelivery: mocks.ensureLiveReminderDelivery }));

import {
  createLiveReminderReconciliationSnapshot,
  processLiveReminderReconciliationJobs,
  queueLiveReminderReconciliation,
} from "./live-reminder-reconciliation";

const now = new Date("2026-08-09T04:00:00.000Z");
const scheduledAt = new Date("2026-08-10T04:00:00.000Z");

function template(overrides = {}) {
  return {
    id: "template-1",
    vendorId: "vendor-1",
    channel: "email",
    trigger: "live_reminder",
    subject: "{{live_title}} 即將開始",
    body: "Hi {{name}}",
    isActive: true,
    updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return createLiveReminderReconciliationSnapshot({
    vendorId: "vendor-1",
    liveId: "live-1",
    liveTitle: "Live",
    liveStatus: "scheduled",
    scheduledAt,
    reminderOffsetMinutes: 60,
    template: template(),
    ...overrides,
  }, now);
}

function job(overrides = {}) {
  return {
    id: "job-1",
    vendorId: "vendor-1",
    liveId: "live-1",
    configDigest: snapshot().configDigest,
    lifecycle: "pending",
    attemptCount: 0,
    maxAttempts: 5,
    updatedAt: new Date("2026-08-09T03:00:00.000Z"),
    cursorCreatedAt: null,
    cursorId: null,
    createdAt: new Date("2026-08-09T03:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = null;
});

describe("live reminder reconciliation snapshots and queue", () => {
  it("uses content/activity in the deterministic configuration digest", () => {
    const original = snapshot();
    expect(snapshot()).toMatchObject({ configDigest: original.configDigest, templateId: "template-1" });
    expect(snapshot({ template: template({ body: "changed" }) }).configDigest).not.toBe(original.configDigest);
    expect(snapshot({ liveTitle: "Renamed live" }).configDigest).not.toBe(original.configDigest);
    expect(snapshot({ template: template({ isActive: false }) }).isDeliverable).toBe(false);
    expect(snapshot({ scheduledAt: new Date("2026-08-08T04:00:00.000Z") }).isDeliverable).toBe(false);
    expect(snapshot({ liveStatus: "live" }).configDigest).toBe(original.configDigest);
    expect(snapshot({ liveStatus: "ended" }).configDigest).not.toBe(original.configDigest);
    expect(snapshot({ liveStatus: "draft" }).isDeliverable).toBe(false);
    expect(snapshot({ liveStatus: "ended" }).isDeliverable).toBe(false);
  });

  it("supersedes stale pending work and creates only one deterministic job", async () => {
    const db = {
      liveReminderReconciliationJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "job-1" }),
      },
      emailDelivery: { updateMany: vi.fn() },
    };
    const result = await queueLiveReminderReconciliation(db as unknown as Prisma.TransactionClient, snapshot(), now);
    expect(result).toEqual({ status: "queued", jobId: "job-1" });
    expect(db.liveReminderReconciliationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ lifecycle: { in: ["pending", "processing"] } }),
      data: expect.objectContaining({ lifecycle: "superseded", lastErrorCode: "config_superseded" }),
    }));
    expect(db.liveReminderReconciliationJob.create).toHaveBeenCalledTimes(1);

    db.liveReminderReconciliationJob.findUnique.mockResolvedValueOnce({ id: "job-1", lifecycle: "pending" });
    const duplicate = await queueLiveReminderReconciliation(db as unknown as Prisma.TransactionClient, snapshot(), now);
    expect(duplicate).toEqual({ status: "reused", jobId: "job-1" });
    expect(db.liveReminderReconciliationJob.create).toHaveBeenCalledTimes(1);
  });

  it("cancels queued and failed reminders for disabled or past config without replacement", async () => {
    const db = {
      liveReminderReconciliationJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "disabled-job" }),
      },
      emailDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    const result = await queueLiveReminderReconciliation(
      db as unknown as Prisma.TransactionClient,
      snapshot({ template: null }),
      now,
    );
    expect(result).toEqual({ status: "cancelled", jobId: "disabled-job", cancelledCount: 2 });
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["queued", "failed"] } }),
      data: expect.objectContaining({ status: "superseded", lastErrorCode: "reconciliation_cancelled" }),
    }));
    expect(db.liveReminderReconciliationJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lifecycle: "completed", lastErrorCode: "config_not_deliverable" }),
    }));
  });

  it.each(["draft", "ended"])("cancels queued reminders when the live is %s", async (liveStatus) => {
    const db = {
      liveReminderReconciliationJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: `${liveStatus}-job` }),
      },
      emailDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    await expect(queueLiveReminderReconciliation(
      db as unknown as Prisma.TransactionClient,
      snapshot({ liveStatus }),
      now,
    )).resolves.toEqual({ status: "cancelled", jobId: `${liveStatus}-job`, cancelledCount: 1 });
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["queued", "failed"] } }),
    }));
  });

  it("reactivates a terminal matching digest so A→B→A schedules again", async () => {
    const configA = snapshot();
    const configB = snapshot({ reminderOffsetMinutes: 30 });
    expect(configB.configDigest).not.toBe(configA.configDigest);
    const db = {
      liveReminderReconciliationJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ id: "job-a", lifecycle: "completed" }),
        update: vi.fn().mockResolvedValue({ id: "job-a" }),
        create: vi.fn(),
      },
      emailDelivery: { updateMany: vi.fn() },
    };
    await expect(queueLiveReminderReconciliation(db as unknown as Prisma.TransactionClient, configA, now))
      .resolves.toEqual({ status: "reactivated", jobId: "job-a" });
    expect(db.liveReminderReconciliationJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-a" },
      data: expect.objectContaining({ lifecycle: "pending", cursorCreatedAt: null, cursorId: null, attemptCount: 0, nextAttemptAt: now }),
    }));
    expect(db.liveReminderReconciliationJob.create).not.toHaveBeenCalled();
  });
});

describe("processLiveReminderReconciliationJobs", () => {
  function processingDb(options: {
    stale?: boolean;
    claimCount?: number;
    submissions?: Array<{ id: string; name: string; email: string; createdAt: Date }>;
  } = {}) {
    const candidate = job(options.stale ? {
      lifecycle: "failed",
      attemptCount: 1,
      updatedAt: new Date("2026-08-09T03:59:00.000Z"),
    } : {});
    const claimed = { ...candidate, lifecycle: "processing", attemptCount: candidate.attemptCount + 1 };
    const submissions = options.submissions ?? [
      { id: "verified-a", name: "A", email: "a@example.test", createdAt: new Date("2026-08-09T01:00:00.000Z") },
      { id: "verified-b", name: "B", email: "b@example.test", createdAt: new Date("2026-08-09T02:00:00.000Z") },
    ];
    const currentLive = {
      id: "live-1", vendorId: "vendor-1", title: "Live", status: "scheduled", scheduledAt, liveReminderOffsetMinutes: 60, liveReminderTemplate: template(), vendor: {
        name: "Tenant One",
        senderName: "Tenant Sender",
        supportEmail: "support@example.test",
        contactUrl: "https://example.test/contact",
      },
    };
    const db = {
      liveReminderReconciliationJob: {
        updateMany: vi.fn().mockImplementation(async (args) => {
          if (args.data.lifecycle === "processing") return { count: options.claimCount ?? 1 };
          return { count: 1 };
        }),
        findMany: vi.fn().mockResolvedValue([candidate]),
        findUnique: vi.fn().mockResolvedValue(claimed),
      },
      live: { findFirst: vi.fn().mockResolvedValue(currentLive) },
      formSubmission: { findMany: vi.fn().mockResolvedValue(submissions) },
      emailDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    return db;
  }

  it("uses a stable verified-only cursor and advances it after a bounded batch", async () => {
    const db = processingDb();
    mocks.db = db;
    mocks.ensureLiveReminderDelivery.mockResolvedValue({ status: "scheduled" });

    await expect(processLiveReminderReconciliationJobs({ limit: 1, batchSize: 2, now })).resolves.toEqual([
      { jobId: "job-1", status: "pending" },
    ]);
    expect(db.formSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ liveId: "live-1", verificationStatus: "VERIFIED", form: { vendorId: "vendor-1" } }),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 2,
    }));
    expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledTimes(2);
    expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorName: "Tenant One",
        emailBrand: {
          senderName: "Tenant Sender",
          supportEmail: "support@example.test",
          contactUrl: "https://example.test/contact",
        },
      }),
      now,
      { reconciliationGuard: { jobId: "job-1", configDigest: snapshot().configDigest } },
    );
    expect(db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "live-1", vendorId: "vendor-1" },
      select: expect.objectContaining({
        vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
      }),
    }));
    const cursorWrite = db.liveReminderReconciliationJob.updateMany.mock.calls.at(-1)?.[0];
    expect(cursorWrite.data).toMatchObject({ cursorId: "verified-b", scannedCount: { increment: 2 }, scheduledCount: { increment: 2 } });
  });

  it("stops the claimed batch when the transactional config guard is no longer current", async () => {
    const db = processingDb();
    mocks.db = db;
    mocks.ensureLiveReminderDelivery.mockResolvedValue({ status: "config_superseded" });

    await expect(processLiveReminderReconciliationJobs({ limit: 1, batchSize: 2, now })).resolves.toEqual([
      { jobId: "job-1", status: "superseded" },
    ]);
    expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledTimes(1);
    expect(db.liveReminderReconciliationJob.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cursorId: expect.any(String), scheduledCount: expect.any(Object) }),
    }));
  });

  it("recovers a stale lease and allows exactly one concurrent claimant to write", async () => {
    const db = processingDb({ stale: true, claimCount: 0 });
    mocks.db = db;
    await expect(processLiveReminderReconciliationJobs({ now })).resolves.toEqual([
      { jobId: "job-1", status: "claimed_elsewhere" },
    ]);
    expect(db.liveReminderReconciliationJob.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { lifecycle: "processing", claimedAt: { lte: new Date(now.getTime() - 10 * 60 * 1_000) } },
      data: expect.objectContaining({ lifecycle: "failed", lastErrorCode: "stale_lease_recovered" }),
    });
    expect(mocks.ensureLiveReminderDelivery).not.toHaveBeenCalled();
  });
});
