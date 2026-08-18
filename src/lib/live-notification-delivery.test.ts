import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureOperationalError: vi.fn(),
  db: {
    $transaction: vi.fn(),
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
      vendorId: "vendor-1", liveId: "live-1", liveTitle: "新品直播", formSubmissionId: "submission-1",
      ruleId: "rule-1", trigger: "before_live" as const, offsetMinutes: 60, anchor: scheduledAt,
      template: { id: "template-1", subject: "Subject", body: "Body" },
    };
    const id = stableLiveNotificationDeliveryId(base);
    expect(stableLiveNotificationDeliveryId(base)).toBe(id);
    expect(stableLiveNotificationDeliveryId({ ...base, ruleId: "rule-2" })).not.toBe(id);
    expect(stableLiveNotificationDeliveryId({ ...base, offsetMinutes: 30 })).not.toBe(id);
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

  it("does not backfill before after start or during after end", async () => {
    mockCurrent(current("before_live", { status: "live", startedAt: now }));
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toEqual({ status: "not_due" });
    mockCurrent(current("during_live", { status: "ended", endedAt: now }));
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toEqual({ status: "not_due" });
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("fails a stale delivery snapshot when rule content changes", async () => {
    const value = current("before_live");
    mockCurrent(value);
    const oldId = stableLiveNotificationDeliveryId({
      vendorId: "vendor-1", liveId: "live-1", liveTitle: "新品直播", formSubmissionId: "submission-1",
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
    mocks.db.emailDelivery.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      status: "queued",
      updatedAt: now,
    }));

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
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const submissionNumber = Number(String(data.sourceFormSubmissionId).match(/submission-(\d+)/u)?.[1]);
      if (submissionNumber <= 100) throw { code: "P2002" };
      newWrites += 1;
      return { id: data.id, status: data.status, nextAttemptAt: data.nextAttemptAt };
    });
    mocks.db.emailDelivery.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, status: "queued", updatedAt: now }));

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
    mocks.db.emailDelivery.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, status: "queued", updatedAt: now }));

    await expect(processDueLiveNotifications({ now, vendorId: "vendor-1", writeBudget: 10, scanBudget: 3 }))
      .resolves.toEqual([{ status: "duplicate" }, { status: "duplicate" }, { status: "duplicate" }]);
  });

  it("reactivates a superseded stable row with CAS while sent remains one-shot", async () => {
    mockCurrent(current("before_live"));
    mocks.db.$transaction
      .mockRejectedValueOnce({ code: "P2002" })
      .mockImplementationOnce(async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
    mocks.db.emailDelivery.findUnique.mockResolvedValue({ id: "existing", status: "superseded", updatedAt: now });
    mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toMatchObject({ status: "reactivated" });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "superseded", updatedAt: now }),
      data: expect.objectContaining({ status: "queued", attemptCount: 0, claimedAt: null, failedAt: null, nextAttemptAt: now }),
    }));

    mocks.db.$transaction
      .mockRejectedValueOnce({ code: "P2002" })
      .mockImplementationOnce(async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
    mocks.db.emailDelivery.findUnique.mockResolvedValue({ id: "existing", status: "sent", updatedAt: now });
    await expect(ensureLiveNotificationDelivery({ vendorId: "vendor-1", liveId: "live-1", ruleId: "rule-1", submissionId: "submission-1" }, now))
      .resolves.toMatchObject({ status: "already_sent" });
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
});
