import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureOperationalError: vi.fn(),
  db: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    live: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    liveNotificationRule: { count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    formSubmission: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    emailDelivery: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    emailSuppression: { findUnique: vi.fn() },
    blacklist: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));

import {
  ensureLiveNotificationDelivery,
  isCurrentLiveNotificationDeliverySnapshot,
  materializeLiveNotificationRules,
  materializeLiveNotificationsForSubmission,
  processDueLiveNotifications,
  processLegacyReminderCutovers,
  resolveLiveNotificationDueAt,
  stableLiveNotificationDeliveryId,
  supersedeFixedTimeNotificationsForActiveEvergreen,
  supersedeLiveNotificationDeliveriesForTemplate,
} from "./live-notification-delivery";
import { liveNotificationIdempotencyPrefix, liveNotificationIdentityFromKey } from "./live-notification-identity";

const now = new Date("2026-08-18T04:00:00.000Z");
const scheduledAt = new Date("2026-08-18T05:00:00.000Z");
const startedAt = new Date("2026-08-18T03:30:00.000Z");

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: "template-1",
    vendorId: "vendor-1",
    channel: "email",
    trigger: "live_reminder",
    subject: "{{name}}，直播通知",
    body: "{{live_title}} {{unsubscribe_url}}",
    isActive: true,
    ...overrides,
  };
}

function current(trigger: "before_live" | "during_live", overrides: Record<string, unknown> = {}) {
  const live = {
    id: "live-1",
    vendorId: "vendor-1",
    slug: "new-product-live",
    title: "新品直播",
    status: trigger === "before_live" ? "scheduled" : "live",
    scheduledAt,
    startedAt: trigger === "before_live" ? null : startedAt,
    endedAt: null,
    liveReminderTemplateId: null,
    vendor: { name: "商家", senderName: null, supportEmail: null, contactUrl: null },
    ...overrides,
  };
  return {
    live,
    rule: {
      id: "rule-1",
      vendorId: "vendor-1",
      liveId: "live-1",
      trigger,
      offsetMinutes: trigger === "before_live" ? 60 : 30,
      isActive: true,
      messageTemplate: template(),
    },
    submission: {
      id: "submission-1",
      name: "王小明",
      email: "lead@example.test",
      verificationStatus: "VERIFIED",
    },
  };
}

function mockCurrent(value: ReturnType<typeof current>) {
  mocks.db.live.findFirst.mockResolvedValue(value.live);
  mocks.db.liveNotificationRule.findFirst.mockResolvedValue(value.rule);
  mocks.db.formSubmission.findFirst.mockResolvedValue(value.submission);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "live-notification-test-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  mocks.db.$transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
  mocks.db.$queryRaw.mockResolvedValue([{ id: "locked" }]);
  mocks.db.$executeRaw.mockResolvedValue(1);
  mocks.db.emailSuppression.findUnique.mockResolvedValue(null);
  mocks.db.blacklist.findFirst.mockResolvedValue(null);
  mocks.db.emailDelivery.findFirst.mockResolvedValue(null);
  mocks.db.emailDelivery.findUnique.mockResolvedValue(null);
  mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 0 });
  mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: data.id, status: data.status, nextAttemptAt: data.nextAttemptAt }));
});

describe("canonical live notification identity and due time", () => {
  it("uses rule-scoped canonical prefixes", () => {
    expect(liveNotificationIdempotencyPrefix("before_live", "rule-a")).toBe("live-notification/before-live/rule-a/");
    expect(liveNotificationIdempotencyPrefix("during_live", "rule-b")).toBe("live-notification/during-live/rule-b/");
    expect(liveNotificationIdentityFromKey("live-notification/before-live/rule-a/email_0123456789abcdef0123456789abcdef"))
      .toEqual({ trigger: "before_live", ruleId: "rule-a" });
    expect(liveNotificationIdentityFromKey("live-notification/before-live/rule/a/email_1")).toBeNull();
  });

  it("resolves before and during anchors and rejects invalid offsets", () => {
    expect(resolveLiveNotificationDueAt({ trigger: "before_live", scheduledAt, startedAt: null, offsetMinutes: 60 }))
      .toEqual(new Date("2026-08-18T04:00:00.000Z"));
    expect(resolveLiveNotificationDueAt({ trigger: "during_live", scheduledAt, startedAt, offsetMinutes: 30 }))
      .toEqual(new Date("2026-08-18T04:00:00.000Z"));
    expect(resolveLiveNotificationDueAt({ trigger: "before_live", scheduledAt, startedAt: null, offsetMinutes: 0 })).toBeNull();
    expect(resolveLiveNotificationDueAt({ trigger: "during_live", scheduledAt, startedAt: null, offsetMinutes: 10 })).toBeNull();
  });

  it("includes rule, trigger, offset, template content and anchor in the stable id", () => {
    const base = {
      vendorId: "vendor-1", liveId: "live-1", liveSlug: "new-product-live", liveTitle: "新品直播", formSubmissionId: "submission-1",
      ruleId: "rule-1", trigger: "before_live" as const, offsetMinutes: 60, anchor: scheduledAt,
      template: { id: "template-1", subject: "Subject", body: "Body" },
    };
    const id = stableLiveNotificationDeliveryId(base);
    expect(stableLiveNotificationDeliveryId(base)).toBe(id);
    expect(stableLiveNotificationDeliveryId({ ...base, ruleId: "rule-2" })).not.toBe(id);
    expect(stableLiveNotificationDeliveryId({ ...base, offsetMinutes: 30 })).not.toBe(id);
    expect(stableLiveNotificationDeliveryId({ ...base, liveSlug: "renamed-live" })).not.toBe(id);
    expect(stableLiveNotificationDeliveryId({ ...base, template: { ...base.template, body: "Changed" } })).not.toBe(id);
    expect(stableLiveNotificationDeliveryId({ ...base, anchor: new Date(scheduledAt.getTime() + 1) })).not.toBe(id);
  });
});

describe("canonical materialization and send-time snapshot", () => {
  it("queues a due before notification once and scopes supersede to the same rule", async () => {
    mockCurrent(current("before_live"));
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toMatchObject({ status: "queued", deliveryId: expect.stringMatching(/^email_/u) });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceFormSubmissionId: "submission-1",
        idempotencyKey: { startsWith: "live-notification/before-live/rule-1/" },
      }),
    }));
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledTimes(1);
  });

  it("retries a transient conflict (P2034, e.g. a deadlock with a writer) on the idempotent materialization and then queues once", async () => {
    mockCurrent(current("before_live"));
    mocks.db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "test" }));

    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toMatchObject({ status: "queued" });
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledTimes(1);
  });

  it("gives up after bounded retries on a persistent conflict instead of looping", async () => {
    mockCurrent(current("before_live"));
    mocks.db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "test" }));

    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .rejects.toMatchObject({ code: "P2034" });
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(3);
  });

  it("contains a conflict that outlives the retries so one recipient cannot stop the whole round", async () => {
    const value = current("before_live", { scheduledAt: new Date("2026-08-18T04:05:00.000Z") });
    mocks.db.liveNotificationRule.count.mockResolvedValue(1);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 1 }]);
    mocks.db.live.findFirst.mockResolvedValue(value.live);
    mocks.db.formSubmission.count.mockResolvedValue(2);
    mocks.db.formSubmission.findMany.mockImplementation(async ({ skip }: { skip: number }) => [{ id: skip === 0 ? "submission-1" : "submission-2" }]);
    mocks.db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "test" }));

    await expect(processDueLiveNotifications({ now, vendorId: "vendor-1", recipientLimitPerRule: 1 }))
      .resolves.toEqual([{ status: "error" }, { status: "error" }]);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.anything(), { source: "live_notification", operation: "materialize", status: "failed" });
  });

  it("does not backfill before after start or during after end", async () => {
    mockCurrent(current("before_live", { status: "live", startedAt: now }));
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toEqual({ status: "not_due" });
    mockCurrent(current("during_live", { status: "ended", endedAt: now }));
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toEqual({ status: "not_due" });
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("creates no before/during rows for an active evergreen live and supersedes queued ones at send time", async () => {
    const evergreen = {
      isEvergreen: true, streamMode: "vod", evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15,
      evergreenDailyTimes: [], evergreenSessionStartAt: null, video: { durationSec: 1_800 },
    };
    for (const trigger of ["before_live", "during_live"] as const) {
      mockCurrent(current(trigger, evergreen));
      await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now, { scheduleFuture: true }))
        .resolves.toEqual({ status: "not_due" });
    }
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
    expect(mocks.db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ isEvergreen: true, evergreenScheduleMode: true, video: { select: { durationSec: true } } }),
    }));

    // A row queued before evergreen was enabled is no longer current.
    const queuedId = stableLiveNotificationDeliveryId({
      vendorId: "vendor-1", liveId: "live-1", liveSlug: "new-product-live", liveTitle: "新品直播", formSubmissionId: "submission-1",
      ruleId: "rule-1", trigger: "before_live", offsetMinutes: 60, anchor: scheduledAt,
      template: { id: "template-1", subject: template().subject, body: template().body },
    });
    const delivery = {
      id: queuedId, vendorId: "vendor-1", sourceLiveId: "live-1", sourceFormSubmissionId: "submission-1",
      trigger: "before_live", idempotencyKey: `live-notification/before-live/rule-1/${queuedId}`,
    };
    const dueNow = new Date(scheduledAt.getTime() - 30 * 60_000);
    mockCurrent(current("before_live"));
    await expect(isCurrentLiveNotificationDeliverySnapshot(delivery, dueNow, mocks.db as never)).resolves.toBe(true);
    mockCurrent(current("before_live", evergreen));
    await expect(isCurrentLiveNotificationDeliverySnapshot(delivery, dueNow, mocks.db as never)).resolves.toBe(false);
  });

  it("skips an active evergreen live when scanning due rules", async () => {
    mocks.db.liveNotificationRule.count.mockResolvedValue(1);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 60 }]);
    mocks.db.live.findFirst.mockResolvedValue({
      ...current("before_live").live,
      isEvergreen: true, streamMode: "vod", evergreenScheduleMode: "on_demand", evergreenIntervalMinutes: 15,
      evergreenDailyTimes: [], evergreenSessionStartAt: null, video: { durationSec: 1_800 },
    });
    await expect(processDueLiveNotifications({ now, vendorId: "vendor-1" })).resolves.toEqual([]);
    expect(mocks.db.formSubmission.count).not.toHaveBeenCalled();
  });

  it("fails a stale delivery snapshot when rule content changes", async () => {
    const value = current("before_live");
    mockCurrent(value);
    const oldId = stableLiveNotificationDeliveryId({
      vendorId: "vendor-1", liveId: "live-1", liveSlug: "new-product-live", liveTitle: "新品直播", formSubmissionId: "submission-1",
      ruleId: "rule-1", trigger: "before_live", offsetMinutes: 60, anchor: scheduledAt,
      template: { id: "template-1", subject: "old", body: "old" },
    });
    await expect(isCurrentLiveNotificationDeliverySnapshot({
      id: oldId,
      vendorId: "vendor-1",
      sourceLiveId: "live-1",
      sourceFormSubmissionId: "submission-1",
      trigger: "before_live",
      idempotencyKey: `live-notification/before-live/rule-1/${oldId}`,
    }, now, mocks.db as never)).resolves.toBe(false);
  });

  it("supersedes only before/during rule prefixes that reference the edited template", async () => {
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([
      { id: "before-a", liveId: "live-1", trigger: "before_live" },
      { id: "during-a", liveId: "live-1", trigger: "during_live" },
    ]);
    mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
    await expect(supersedeLiveNotificationDeliveriesForTemplate(mocks.db as never, { vendorId: "vendor-1", templateId: "template-1" })).resolves.toBe(2);
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ idempotencyKey: { startsWith: "live-notification/before-live/before-a/" } }),
    }));
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ idempotencyKey: { startsWith: "live-notification/during-live/during-a/" } }),
    }));
  });

  it("materializes future before rows across recipientLimit + 1 batches", async () => {
    const value = current("before_live", { scheduledAt: new Date("2026-08-18T04:05:00.000Z") });
    mocks.db.liveNotificationRule.count.mockResolvedValue(1);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 1 }]);
    mocks.db.liveNotificationRule.findFirst.mockResolvedValue({ ...value.rule, offsetMinutes: 1 });
    mocks.db.live.findFirst.mockResolvedValue(value.live);
    mocks.db.formSubmission.count.mockResolvedValue(2);
    mocks.db.formSubmission.findMany.mockImplementation(async ({ skip }: { skip: number }) => [
      { id: skip === 0 ? "submission-1" : "submission-2" },
    ]);
    mocks.db.formSubmission.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.submission,
      id: where.id,
      email: `${where.id}@example.test`,
    }));

    await expect(processDueLiveNotifications({ now, vendorId: "vendor-1", recipientLimitPerRule: 1 }))
      .resolves.toEqual([{ status: "queued" }, { status: "queued" }]);
    expect(mocks.db.formSubmission.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledTimes(2);
    for (const [call] of mocks.db.emailDelivery.create.mock.calls) {
      expect(call.data.nextAttemptAt).toEqual(new Date("2026-08-18T04:04:00.000Z"));
    }
  });

  it("targets a newly changed short-offset rule directly even beyond the cron rule page", async () => {
    const value = current("before_live", { scheduledAt: new Date("2026-08-18T04:05:00.000Z") });
    mocks.db.liveNotificationRule.count.mockResolvedValue(1);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "new-rule-51", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 1 }]);
    mocks.db.liveNotificationRule.findFirst.mockResolvedValue({ ...value.rule, id: "new-rule-51", offsetMinutes: 1 });
    mocks.db.live.findFirst.mockResolvedValue(value.live);
    mocks.db.formSubmission.count.mockResolvedValue(1);
    mocks.db.formSubmission.findMany.mockResolvedValue([{ id: "submission-1" }]);
    mocks.db.formSubmission.findFirst.mockResolvedValue(value.submission);

    await expect(materializeLiveNotificationRules({ vendorId: "vendor-1", liveId: "live-1", ruleIds: ["new-rule-51"], now }))
      .resolves.toEqual([{ status: "queued" }]);
    expect(mocks.db.liveNotificationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["new-rule-51"] } }),
    }));
    expect(mocks.db.emailDelivery.create.mock.calls[0]?.[0]?.data.nextAttemptAt)
      .toEqual(new Date("2026-08-18T04:04:00.000Z"));
  });

  it("materializes all active before rules immediately for one newly verified recipient", async () => {
    const value = current("before_live");
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "rule-1" }, { id: "rule-2" }]);
    mocks.db.liveNotificationRule.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.rule,
      id: where.id,
    }));
    mocks.db.live.findFirst.mockResolvedValue(value.live);
    mocks.db.formSubmission.findFirst.mockResolvedValue(value.submission);

    await expect(materializeLiveNotificationsForSubmission({ vendorId: "vendor-1", liveId: "live-1", submissionId: "submission-1", now }))
      .resolves.toEqual([{ status: "queued" }, { status: "queued" }]);
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledTimes(2);
  });

  it("enforces one global repair write budget across recipient batches", async () => {
    const value = current("before_live");
    mocks.db.liveNotificationRule.count.mockResolvedValue(1);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 60 }]);
    mocks.db.liveNotificationRule.findFirst.mockResolvedValue(value.rule);
    mocks.db.live.findFirst.mockResolvedValue(value.live);
    mocks.db.formSubmission.count.mockResolvedValue(3);
    mocks.db.formSubmission.findMany.mockResolvedValue([{ id: "submission-1" }, { id: "submission-2" }]);
    mocks.db.formSubmission.findFirst.mockResolvedValue(value.submission);

    await processDueLiveNotifications({ now, vendorId: "vendor-1", recipientLimitPerRule: 2, writeBudget: 1 });
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledTimes(1);
  });

  it("materializes 500 recipients across repeated write-budgeted repair passes", async () => {
    const value = current("before_live");
    const created = new Set<string>();
    mocks.db.liveNotificationRule.count.mockResolvedValue(1);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 60 }]);
    mocks.db.liveNotificationRule.findFirst.mockResolvedValue(value.rule);
    mocks.db.live.findFirst.mockResolvedValue(value.live);
    mocks.db.formSubmission.count.mockResolvedValue(500);
    mocks.db.formSubmission.findMany.mockImplementation(async ({ skip, take }: { skip: number; take: number }) =>
      Array.from({ length: take }, (_, index) => ({ id: `submission-${skip + index + 1}` })),
    );
    mocks.db.formSubmission.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.submission,
      id: where.id,
      email: `${where.id}@example.test`,
    }));
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const id = String(data.id);
      if (created.has(id)) throw { code: "P2002" };
      created.add(id);
      return { id, status: data.status, nextAttemptAt: data.nextAttemptAt };
    });
    // The stable-id lookup (the only findFirst with an id) sees rows written by earlier passes.
    mocks.db.emailDelivery.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id && created.has(where.id) ? { id: where.id, status: "queued", updatedAt: now } : null);

    for (let pass = 0; pass < 5; pass += 1) {
      await processDueLiveNotifications({ now, vendorId: "vendor-1", writeBudget: 100, scanBudget: 500 });
    }

    expect(created.size).toBe(500);
  });

  it("continues past the first 100 duplicate recipients to write the next candidate", async () => {
    const value = current("before_live");
    let newWrites = 0;
    mocks.db.liveNotificationRule.count.mockResolvedValue(1);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 60 }]);
    mocks.db.liveNotificationRule.findFirst.mockResolvedValue(value.rule);
    mocks.db.live.findFirst.mockResolvedValue(value.live);
    mocks.db.formSubmission.count.mockResolvedValue(101);
    mocks.db.formSubmission.findMany.mockImplementation(async ({ skip, take }: { skip: number; take: number }) =>
      Array.from({ length: take }, (_, index) => ({ id: `submission-${skip + index + 1}` })),
    );
    mocks.db.formSubmission.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.submission,
      id: where.id,
      email: `${where.id}@example.test`,
    }));
    // Recipients 1-100 already have a row that another writer inserted: the
    // insert hits P2002 and the re-run finds that row.
    const insertedElsewhere = new Set<string>();
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const submissionNumber = Number(String(data.sourceFormSubmissionId).match(/submission-(\d+)/u)?.[1]);
      if (submissionNumber <= 100) {
        insertedElsewhere.add(String(data.id));
        throw { code: "P2002" };
      }
      newWrites += 1;
      return { id: data.id, status: data.status, nextAttemptAt: data.nextAttemptAt };
    });
    mocks.db.emailDelivery.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id && insertedElsewhere.has(where.id) ? { id: where.id, status: "queued", updatedAt: now } : null);

    const results = await processDueLiveNotifications({ now, vendorId: "vendor-1", writeBudget: 1, scanBudget: 101 });

    expect(results).toHaveLength(101);
    expect(results.slice(0, 100)).toEqual(Array.from({ length: 100 }, () => ({ status: "duplicate" })));
    expect(results[100]).toEqual({ status: "queued" });
    expect(newWrites).toBe(1);
  });

  it("shares the write budget fairly across active rules", async () => {
    const value = current("before_live");
    mocks.db.liveNotificationRule.count.mockResolvedValue(2);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([
      { id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 60 },
      { id: "rule-2", vendorId: "vendor-1", liveId: "live-2", trigger: "before_live", offsetMinutes: 60 },
    ]);
    mocks.db.liveNotificationRule.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ ...value.rule, id: where.id, liveId: where.id === "rule-1" ? "live-1" : "live-2" }));
    mocks.db.live.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ ...value.live, id: where.id }));
    mocks.db.formSubmission.count.mockResolvedValue(2);
    mocks.db.formSubmission.findMany.mockImplementation(async ({ where, skip }: { where: { liveId: string }; skip: number }) => [{ id: `${where.liveId}-submission-${skip + 1}` }]);
    mocks.db.formSubmission.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ ...value.submission, id: where.id, email: `${where.id}@example.test` }));

    await processDueLiveNotifications({ now, vendorId: "vendor-1", recipientLimitPerRule: 1, writeBudget: 2, scanBudget: 4 });

    const keys = mocks.db.emailDelivery.create.mock.calls.map(([call]) => String(call.data.idempotencyKey));
    expect(keys.some((key) => key.startsWith("live-notification/before-live/rule-1/"))).toBe(true);
    expect(keys.some((key) => key.startsWith("live-notification/before-live/rule-2/"))).toBe(true);
  });

  it("rotates the first rule so two rules both progress with writeBudget one across consecutive minutes", async () => {
    const value = current("before_live");
    mocks.db.liveNotificationRule.count.mockResolvedValue(2);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([
      { id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 60 },
      { id: "rule-2", vendorId: "vendor-1", liveId: "live-2", trigger: "before_live", offsetMinutes: 60 },
    ]);
    mocks.db.liveNotificationRule.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.rule,
      id: where.id,
      liveId: where.id === "rule-1" ? "live-1" : "live-2",
    }));
    mocks.db.live.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ ...value.live, id: where.id }));
    mocks.db.formSubmission.count.mockResolvedValue(1);
    mocks.db.formSubmission.findMany.mockImplementation(async ({ where }: { where: { liveId: string } }) => [{ id: `${where.liveId}-submission` }]);
    mocks.db.formSubmission.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.submission,
      id: where.id,
      email: `${where.id}@example.test`,
    }));

    await processDueLiveNotifications({ now, vendorId: "vendor-1", writeBudget: 1, scanBudget: 2 });
    await processDueLiveNotifications({ now: new Date(now.getTime() + 60_000), vendorId: "vendor-1", writeBudget: 1, scanBudget: 2 });

    const keys = mocks.db.emailDelivery.create.mock.calls.map(([call]) => String(call.data.idempotencyKey));
    expect(keys).toHaveLength(2);
    expect(keys.some((key) => key.startsWith("live-notification/before-live/rule-1/"))).toBe(true);
    expect(keys.some((key) => key.startsWith("live-notification/before-live/rule-2/"))).toBe(true);
  });

  it("prioritizes a due rule outside the ordinary future rule page", async () => {
    const value = current("before_live");
    const rules = Array.from({ length: 21 }, (_, index) => ({
      id: index === 20 ? "due-rule" : `future-rule-${index + 1}`,
      vendorId: "vendor-1",
      liveId: index === 20 ? "due-live" : `future-live-${index + 1}`,
      trigger: "before_live",
      offsetMinutes: 60,
    }));
    mocks.db.liveNotificationRule.count.mockResolvedValue(21);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue(rules);
    mocks.db.liveNotificationRule.findFirst.mockResolvedValue({ ...value.rule, id: "due-rule", liveId: "due-live" });
    mocks.db.live.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.live,
      id: where.id,
      scheduledAt: where.id === "due-live" ? scheduledAt : new Date("2026-08-18T06:00:00.000Z"),
    }));
    mocks.db.formSubmission.count.mockResolvedValue(1);
    mocks.db.formSubmission.findMany.mockResolvedValue([{ id: "submission-1" }]);
    mocks.db.formSubmission.findFirst.mockResolvedValue(value.submission);

    await processDueLiveNotifications({ now, vendorId: "vendor-1", includeFuture: false, ruleLimit: 20, writeBudget: 1 });

    expect(mocks.db.liveNotificationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 250 }));
    expect(mocks.db.emailDelivery.create.mock.calls[0]?.[0]?.data.idempotencyKey)
      .toMatch(/^live-notification\/before-live\/due-rule\//u);
  });

  it("rotates a bounded due candidate scan across 251 rules", async () => {
    const value = current("before_live");
    const observedSkips: number[] = [];
    mocks.db.liveNotificationRule.count.mockResolvedValue(251);
    mocks.db.liveNotificationRule.findMany.mockImplementation(async ({ skip, take }: { skip: number; take: number }) => {
      observedSkips.push(skip);
      return Array.from({ length: Math.min(take, 251 - skip) }, (_, index) => {
        const number = skip + index + 1;
        return { id: `rule-${number}`, vendorId: "vendor-1", liveId: `live-${number}`, trigger: "before_live", offsetMinutes: 60 };
      });
    });
    mocks.db.liveNotificationRule.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.rule,
      id: where.id,
      liveId: `live-${String(where.id).replace("rule-", "")}`,
    }));
    mocks.db.live.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ ...value.live, id: where.id }));
    mocks.db.formSubmission.count.mockResolvedValue(1);
    mocks.db.formSubmission.findMany.mockImplementation(async ({ where }: { where: { liveId: string } }) => [{ id: `${where.liveId}-submission` }]);
    mocks.db.formSubmission.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...value.submission,
      id: where.id,
      email: `${where.id}@example.test`,
    }));

    await processDueLiveNotifications({ now, vendorId: "vendor-1", includeFuture: false, writeBudget: 1, scanBudget: 1 });
    await processDueLiveNotifications({ now: new Date(now.getTime() + 60_000), vendorId: "vendor-1", includeFuture: false, writeBudget: 1, scanBudget: 1 });

    expect(new Set(observedSkips)).toEqual(new Set([0, 250]));
    const keys = mocks.db.emailDelivery.create.mock.calls.map(([call]) => String(call.data.idempotencyKey));
    expect(keys.some((key) => key.startsWith("live-notification/before-live/rule-251/"))).toBe(true);
  });

  it("stops duplicate scanning at the independent scan budget", async () => {
    const value = current("before_live");
    mocks.db.liveNotificationRule.count.mockResolvedValue(1);
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{ id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "before_live", offsetMinutes: 60 }]);
    mocks.db.liveNotificationRule.findFirst.mockResolvedValue(value.rule);
    mocks.db.live.findFirst.mockResolvedValue(value.live);
    mocks.db.formSubmission.count.mockResolvedValue(10);
    mocks.db.formSubmission.findMany.mockImplementation(async ({ skip, take }: { skip: number; take: number }) =>
      Array.from({ length: take }, (_, index) => ({ id: `submission-${skip + index + 1}` })),
    );
    mocks.db.formSubmission.findFirst.mockResolvedValue(value.submission);
    mocks.db.emailDelivery.create.mockRejectedValue({ code: "P2002" });
    mocks.db.emailDelivery.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? { id: where.id, status: "queued", updatedAt: now } : null);

    await expect(processDueLiveNotifications({ now, vendorId: "vendor-1", writeBudget: 10, scanBudget: 3 }))
      .resolves.toEqual([{ status: "duplicate" }, { status: "duplicate" }, { status: "duplicate" }]);
  });

  it("reactivates a superseded stable row with CAS while sent remains one-shot", async () => {
    mockCurrent(current("before_live"));
    mocks.db.emailDelivery.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? { id: "existing", status: "superseded", updatedAt: now } : null);
    mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toMatchObject({ status: "reactivated" });
    expect(mocks.db.emailDelivery.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: expect.stringMatching(/^email_/u), vendorId: "vendor-1" },
    }));
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "existing", vendorId: "vendor-1", status: "superseded", updatedAt: now }),
      data: expect.objectContaining({ status: "queued", attemptCount: 0, claimedAt: null, failedAt: null, nextAttemptAt: now }),
    }));
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();

    mocks.db.emailDelivery.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? { id: "existing", status: "sent", updatedAt: now } : null);
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toMatchObject({ status: "already_sent" });
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("supersedes stale rows of the recipient and rule before reporting the current row as a duplicate", async () => {
    mockCurrent(current("before_live"));
    mocks.db.emailDelivery.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? { id: where.id, status: "queued", updatedAt: now } : null);
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toMatchObject({ status: "duplicate" });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        vendorId: "vendor-1", sourceLiveId: "live-1", sourceFormSubmissionId: "submission-1",
        id: { not: expect.stringMatching(/^email_/u) },
        idempotencyKey: { startsWith: "live-notification/before-live/rule-1/" },
        status: { in: ["queued", "failed"] },
      }),
    }));
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });
});

describe("B-3 contention: READ COMMITTED with vendor-bound row locks", () => {
  const input = { vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" };
  const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?").replace(/\s+/gu, " ").trim();

  it("locks the live, the rule with its template and the registration, vendor-bound, before reading anything", async () => {
    mockCurrent(current("before_live"));
    await expect(ensureLiveNotificationDelivery(input, now)).resolves.toMatchObject({ status: "queued" });

    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    const calls = mocks.db.$queryRaw.mock.calls;
    expect(calls).toHaveLength(1);
    const sql = sqlOf(calls[0]!);
    expect(sql).toMatch(/^SELECT l\."id" FROM "Live" l JOIN "LiveNotificationRule" r ON r\."id" = \? AND r\."liveId" = l\."id" AND r\."vendorId" = l\."vendorId" /u);
    expect(sql).toContain(`JOIN "MessageTemplate" t ON t."id" = r."messageTemplateId" AND t."vendorId" = l."vendorId"`);
    expect(sql).toContain(`JOIN "FormSubmission" s ON s."id" = ? AND s."liveId" = l."id"`);
    expect(sql).toContain(`JOIN "RegistrationForm" f ON f."id" = s."formId" AND f."vendorId" = l."vendorId"`);
    expect(sql).toMatch(/WHERE l\."id" = \? AND l\."vendorId" = \? FOR SHARE OF l, r, t FOR NO KEY UPDATE OF s$/u);
    expect(calls[0]!.slice(1)).toEqual(["rule-1", "submission-1", "live-1", "vendor-1"]);

    const lock = mocks.db.$queryRaw.mock.invocationCallOrder[0]!;
    for (const read of [mocks.db.live.findFirst, mocks.db.liveNotificationRule.findFirst, mocks.db.formSubmission.findFirst, mocks.db.emailDelivery.findFirst]) {
      expect(Math.min(...read.mock.invocationCallOrder)).toBeGreaterThan(lock);
    }
  });

  it("returns not_configured and writes nothing when the lock finds no row of this vendor", async () => {
    mockCurrent(current("before_live"));
    mocks.db.$queryRaw.mockResolvedValue([]);
    await expect(ensureLiveNotificationDelivery({ ...input, vendorId: "vendor-2" }, now)).resolves.toEqual({ status: "not_configured" });
    expect(mocks.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.db.$queryRaw.mock.calls[0]!.slice(1)).toEqual(["rule-1", "submission-1", "live-1", "vendor-2"]);
    expect(mocks.db.live.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.emailDelivery.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("re-runs the step after a P2002 from a writer without the lock and reports that writer's row", async () => {
    mockCurrent(current("before_live"));
    const insertedElsewhere = new Set<string>();
    mocks.db.emailDelivery.create.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => {
      insertedElsewhere.add(String(data.id));
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    });
    mocks.db.emailDelivery.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id && insertedElsewhere.has(where.id) ? { id: where.id, status: "queued", updatedAt: now } : null);

    await expect(ensureLiveNotificationDelivery(input, now)).resolves.toMatchObject({ status: "duplicate" });
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledTimes(1);
  });

  it("does not retry an application error", async () => {
    mockCurrent(current("before_live"));
    mocks.db.emailDelivery.create.mockRejectedValueOnce(new Error("private database detail"));
    await expect(ensureLiveNotificationDelivery(input, now)).rejects.toThrow("private database detail");
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("evergreen in-flight sweep", () => {
  const evergreen = {
    isEvergreen: true, streamMode: "vod", status: "scheduled", evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15,
    evergreenDailyTimes: [], evergreenSessionStartAt: null, video: { durationSec: 1_800 },
  };

  it("supersedes queued and failed before/during rows of an active evergreen live under a vendor-bound Live lock", async () => {
    mocks.db.live.findFirst.mockResolvedValue(evergreen);
    mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 2 });
    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: "vendor-1", liveId: "live-1" }, now)).resolves.toBe(2);

    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    const [lock] = mocks.db.$queryRaw.mock.calls;
    expect((lock![0] as TemplateStringsArray).join("?").replace(/\s+/gu, " ").trim()).toMatch(/FROM "Live" WHERE "id" = \? AND "vendorId" = \? FOR NO KEY UPDATE$/u);
    expect(lock!.slice(1)).toEqual(["live-1", "vendor-1"]);
    expect(mocks.db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "live-1", vendorId: "vendor-1" } }));
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", sourceLiveId: "live-1", trigger: { in: ["before_live", "during_live"] }, status: { in: ["queued", "failed"] } },
      data: { status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "lifecycle_superseded" },
    });
  });

  it("touches nothing when the live is no longer an active evergreen one or is not this vendor's", async () => {
    mocks.db.live.findFirst.mockResolvedValue({ ...evergreen, isEvergreen: false });
    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: "vendor-1", liveId: "live-1" }, now)).resolves.toBe(0);

    mocks.db.$queryRaw.mockResolvedValue([]);
    await expect(supersedeFixedTimeNotificationsForActiveEvergreen({ vendorId: "vendor-2", liveId: "live-1" }, now)).resolves.toBe(0);
    expect(mocks.db.emailDelivery.updateMany).not.toHaveBeenCalled();
  });
});

describe("legacy cutover safety", () => {
  function cutoverLive(overrides: Record<string, unknown> = {}) {
    const value = current("before_live");
    return {
      ...value.live,
      liveReminderTemplateId: "template-1",
      liveReminderOffsetMinutes: 60,
      notificationRules: [{ ...value.rule, messageTemplateId: value.rule.messageTemplate.id }],
      ...overrides,
    };
  }

  function prepareCandidate(live = cutoverLive()) {
    mocks.db.live.count.mockResolvedValue(1);
    mocks.db.live.findMany.mockResolvedValue([{ id: "live-1", vendorId: "vendor-1" }]);
    mocks.db.live.findFirst.mockResolvedValue(live);
    mocks.db.formSubmission.findMany.mockResolvedValue([]);
    mocks.db.live.updateMany.mockResolvedValue({ count: 1 });
  }

  it.each(["sent", "sending"])("keeps the legacy binding when any legacy delivery is %s", async () => {
    prepareCandidate();
    mocks.db.emailDelivery.count.mockResolvedValue(1);
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-1" }))
      .resolves.toEqual([{ status: "legacy_sent_or_sending" }]);
    expect(mocks.db.emailDelivery.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["sent", "sending"] } }),
    }));
    expect(mocks.db.live.updateMany).not.toHaveBeenCalled();
  });

  it("never selects evergreen-flagged lives as cutover candidates", async () => {
    prepareCandidate();
    mocks.db.emailDelivery.count.mockResolvedValue(0);
    await processLegacyReminderCutovers({ now, vendorId: "vendor-1" });
    for (const method of [mocks.db.live.count, mocks.db.live.findMany]) {
      expect(method).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isEvergreen: false }) }));
    }
  });

  it("atomically replaces queued/failed legacy work before clearing the binding", async () => {
    prepareCandidate();
    mocks.db.emailDelivery.count.mockResolvedValue(0);
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-1" })).resolves.toEqual([{ status: "cutover" }]);
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ trigger: "live_reminder", status: { in: ["queued", "failed"] } }),
      data: expect.objectContaining({ status: "superseded" }),
    }));
    expect(mocks.db.live.updateMany.mock.invocationCallOrder[0])
      .toBeGreaterThan(mocks.db.emailDelivery.updateMany.mock.invocationCallOrder[0]);
  });

  it("accepts 250 recipients but keeps legacy safely at 251", async () => {
    prepareCandidate();
    mocks.db.emailDelivery.count.mockResolvedValue(0);
    const recipients = Array.from({ length: 250 }, (_, index) => ({
      id: `submission-${index}`,
      name: `Lead ${index}`,
      email: `lead-${index}@example.test`,
      verificationStatus: "VERIFIED",
    }));
    mocks.db.formSubmission.findMany.mockResolvedValue(recipients);
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-1" })).resolves.toEqual([{ status: "cutover" }]);
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledTimes(250);

    vi.clearAllMocks();
    prepareCandidate();
    mocks.db.emailDelivery.count.mockResolvedValue(0);
    mocks.db.formSubmission.findMany.mockResolvedValue([...recipients, { ...recipients[0], id: "submission-250" }]);
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-1" })).resolves.toEqual([{ status: "capacity" }]);
    expect(mocks.db.live.updateMany).not.toHaveBeenCalled();
  });

  it("rotates past five failing candidates and leaves a no-equivalent live untouched", async () => {
    mocks.db.live.count.mockResolvedValue(6);
    mocks.db.live.findMany.mockResolvedValue([{ id: "live-6", vendorId: "vendor-1" }]);
    mocks.db.live.findFirst.mockResolvedValue(cutoverLive({ notificationRules: [] }));
    const oddMinute = new Date("2026-08-18T04:01:00.000Z");
    await expect(processLegacyReminderCutovers({ now: oddMinute, vendorId: "vendor-1", limit: 5 }))
      .resolves.toEqual([{ status: "no_equivalent_rule" }]);
    expect(mocks.db.live.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 5, take: 5 }));
    expect(mocks.db.live.updateMany).not.toHaveBeenCalled();
  });

  it("reports unknown cutover failures with sanitized monitoring context", async () => {
    mocks.db.live.count.mockResolvedValue(1);
    mocks.db.live.findMany.mockResolvedValue([{ id: "live-private", vendorId: "vendor-private" }]);
    mocks.db.$transaction.mockRejectedValueOnce(new Error("private database detail"));
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-private" })).resolves.toEqual([{ status: "failed" }]);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "live_notification_cutover",
      operation: "cutover",
      status: "failed",
    });
    expect(JSON.stringify(mocks.captureOperationalError.mock.calls[0]?.[1])).not.toContain("live-private");
  });

  it("locks the Live, then the rule with its template, vendor-bound, before reading or writing anything", async () => {
    prepareCandidate();
    mocks.db.emailDelivery.count.mockResolvedValue(0);
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-1" })).resolves.toEqual([{ status: "cutover" }]);

    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const [liveLock, ruleLock] = mocks.db.$queryRaw.mock.calls;
    const sql = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?").replace(/\s+/gu, " ").trim();
    expect(sql(liveLock!)).toBe(`SELECT "id" FROM "Live" WHERE "id" = ? AND "vendorId" = ? FOR NO KEY UPDATE`);
    expect(liveLock!.slice(1)).toEqual(["live-1", "vendor-1"]);
    expect(sql(ruleLock!)).toMatch(/JOIN "MessageTemplate" t ON t\."id" = r\."messageTemplateId" AND t\."vendorId" = r\."vendorId" .*FOR SHARE OF r, t$/u);
    expect(ruleLock!.slice(1)).toEqual(["rule-1", "vendor-1", "live-1"]);
    const [liveLockOrder, ruleLockOrder] = mocks.db.$queryRaw.mock.invocationCallOrder;
    expect(liveLockOrder!).toBeLessThan(mocks.db.live.findFirst.mock.invocationCallOrder[0]!);
    expect(ruleLockOrder!).toBeLessThan(mocks.db.emailDelivery.count.mock.invocationCallOrder[0]!);
  });

  it("writes nothing when the Live lock finds no row of this vendor", async () => {
    prepareCandidate();
    mocks.db.$queryRaw.mockResolvedValueOnce([]);
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-1" })).resolves.toEqual([{ status: "precondition" }]);
    expect(mocks.db.live.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("re-runs a deadlock or serialization failure and reports one that persists as a conflict, not a failure", async () => {
    prepareCandidate();
    mocks.db.emailDelivery.count.mockResolvedValue(0);
    const deadlock = new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict or a deadlock", { code: "P2034", clientVersion: "test" });
    mocks.db.$transaction.mockRejectedValueOnce(deadlock);
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-1" })).resolves.toEqual([{ status: "cutover" }]);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    prepareCandidate();
    mocks.db.$transaction.mockRejectedValue(deadlock);
    await expect(processLegacyReminderCutovers({ now, vendorId: "vendor-1" })).resolves.toEqual([{ status: "conflict" }]);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(3);
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });
});

describe("B-3 lock timeout", () => {
  const input = { vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" };
  const lockTimeout = () => new Prisma.PrismaClientKnownRequestError(
    "Raw query failed. Code: `55P03`. Message: `canceling statement due to lock timeout`",
    { code: "P2010", clientVersion: "test", meta: { code: "55P03", message: "canceling statement due to lock timeout" } },
  );

  it("bounds every lock wait of the materialization before taking the first lock", async () => {
    mockCurrent(current("before_live"));
    await expect(ensureLiveNotificationDelivery(input, now)).resolves.toMatchObject({ status: "queued" });
    const [setting] = mocks.db.$executeRaw.mock.calls;
    expect((setting![0] as TemplateStringsArray).join("?")).toBe("SELECT pg_catalog.set_config('lock_timeout', ?, true)");
    expect(setting!.slice(1)).toEqual(["2s"]);
    expect(mocks.db.$executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(mocks.db.$queryRaw.mock.invocationCallOrder[0]!);
  });

  it("re-runs the idempotent step after a lock timeout and gives up after the bounded attempts", async () => {
    mockCurrent(current("before_live"));
    mocks.db.$queryRaw.mockRejectedValueOnce(lockTimeout());
    await expect(ensureLiveNotificationDelivery(input, now)).resolves.toMatchObject({ status: "queued" });
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
    mocks.db.$queryRaw.mockRejectedValue(lockTimeout());
    await expect(ensureLiveNotificationDelivery(input, now)).rejects.toMatchObject({ code: "P2010" });
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(3);
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });
});
