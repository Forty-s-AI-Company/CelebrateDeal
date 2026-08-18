import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  writeAuditLog: vi.fn(),
  captureOperationalError: vi.fn(),
  db: {
    $transaction: vi.fn(),
    emailDelivery: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    emailSuppression: { findUnique: vi.fn() },
    blacklist: { findFirst: vi.fn() },
    liveReminderReconciliationJob: { findFirst: vi.fn() },
    liveNotificationRule: { count: vi.fn(), findMany: vi.fn() },
    live: { findFirst: vi.fn() },
    formSubmission: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendTransactionalEmail: mocks.sendTransactionalEmail,
}));

import { TransactionalEmailError } from "@/lib/email";
import { protectEmailDeliveryPayload, revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import {
  dispatchEmailDelivery,
  ensureFormSubmissionVerificationDelivery,
  ensureLiveReminderDelivery,
  ensurePostLiveFollowupDelivery,
  ensureRegistrationConfirmationDelivery,
  processDueEmailDeliveries,
  processDuePostLiveFollowups,
} from "./email-delivery";

const input = {
  vendorId: "vendor-1",
  vendorName: "測試商家",
  liveId: "live-1",
  liveTitle: "新品直播",
  formSubmissionId: "submission-1",
  recipientName: "王小明",
  recipientEmail: "lead@example.test",
  liveScheduledAt: new Date("2026-08-08T04:00:00.000Z"),
  emailBrand: {
    senderName: "測試品牌",
    supportEmail: "support@example.test",
    contactUrl: "https://example.test/contact",
  },
  template: {
    id: "template-1",
    vendorId: "vendor-1",
    channel: "email",
    trigger: "registration_confirmed",
    subject: "{{name}}，你已報名 {{live_title}}",
    body: "{{vendor_name}} 已收到報名。\n退訂：{{unsubscribe_url}}",
    isActive: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "g7-07-email-delivery-test-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  mocks.db.emailSuppression.findUnique.mockResolvedValue(null);
  mocks.db.blacklist.findFirst.mockResolvedValue(null);
  mocks.db.liveNotificationRule.count.mockResolvedValue(0);
  mocks.db.formSubmission.count.mockResolvedValue(0);
  mocks.db.emailDelivery.findFirst.mockResolvedValue(null);
  mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.$transaction.mockImplementation(async (callback: (db: typeof mocks.db) => unknown) => callback(mocks.db));
  mocks.writeAuditLog.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function candidate(overrides: Record<string, unknown> = {}) {
  const id = "delivery-1";
  return {
    id,
    vendorId: "vendor-1",
    sourceTemplateId: "template-1",
    sourceLiveId: "live-1",
    sourceFormSubmissionId: "submission-1",
    trigger: "registration_confirmed",
    ...protectEmailDeliveryPayload({
      recipientEmail: "lead@example.test",
      subject: "你已報名新品直播",
      body: "報名成功",
      brand: input.emailBrand,
    }, { vendorId: "vendor-1", deliveryId: id }),
    idempotencyKey: "registration-confirmed/delivery-1",
    status: "queued",
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: new Date("2026-08-08T00:00:00.000Z"),
    claimedAt: null,
    sentAt: null,
    failedAt: null,
    providerMessageId: null,
    lastErrorCode: null,
    createdAt: new Date("2026-08-08T00:00:00.000Z"),
    updatedAt: new Date("2026-08-08T00:00:00.000Z"),
    ...overrides,
  };
}

function countUnsubscribeUrls(body: string) {
  return body.match(/https:\/\/app\.example\.test\/unsubscribe\?token=eu1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu)?.length ?? 0;
}

describe("email delivery outbox", () => {
  it("queues one encrypted immutable registration snapshot with an unsubscribe URL", async () => {
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
    }));

    const result = await ensureRegistrationConfirmationDelivery(input);
    expect(result).toMatchObject({ status: "queued", deliveryId: expect.stringMatching(/^email_/u) });
    const create = mocks.db.emailDelivery.create.mock.calls[0]?.[0];
    expect(create.data).toMatchObject({
      vendorId: "vendor-1",
      sourceTemplateId: "template-1",
      sourceFormSubmissionId: "submission-1",
      status: "queued",
      recipientMaskedEmail: "l***@example.test",
      idempotencyKey: expect.stringMatching(/^registration-confirmed\/email_/u),
    });
    const payload = revealEmailDeliveryPayload(create.data.payloadEncryptedEnvelope, {
      vendorId: "vendor-1",
      deliveryId: create.data.id,
    });
    expect(payload).toMatchObject({
      recipientEmail: "lead@example.test",
      subject: "王小明，你已報名 新品直播",
      body: expect.stringContaining("https://app.example.test/unsubscribe?token=eu1."),
      brand: {
        version: 1,
        senderName: "測試品牌",
        replyTo: "support@example.test",
        contactUrl: "https://example.test/contact",
      },
    });
    expect(countUnsubscribeUrls(payload.body)).toBe(1);
    expect(JSON.stringify(create)).not.toContain("lead@example.test");
    expect(JSON.stringify(create)).not.toContain("王小明");
    expect(JSON.stringify(create)).not.toContain("測試品牌");
    expect(JSON.stringify(create)).not.toContain("support@example.test");
    expect(JSON.stringify(create)).not.toContain("https://example.test/contact");
  });

  it("queues an encrypted, idempotent form-submission verification delivery without serializing recipient PII or the token", async () => {
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
    }));
    const verificationInput = {
      vendorId: "vendor-1",
      vendorName: "測試商家",
      liveId: "live-1",
      formSubmissionId: "formsub_0123456789abcdef0123456789abcdef",
      recipientName: "王小明",
      recipientEmail: "lead@example.test",
      verificationVersion: 1,
      verificationExpiresAt: new Date("2026-08-11T00:00:00.000Z"),
      emailBrand: input.emailBrand,
    };

    await expect(ensureFormSubmissionVerificationDelivery(verificationInput)).resolves.toMatchObject({
      status: "queued",
      deliveryId: expect.stringMatching(/^email_[a-f0-9]{32}$/u),
    });

    const create = mocks.db.emailDelivery.create.mock.calls[0]?.[0];
    expect(create.data).toMatchObject({
      vendorId: "vendor-1",
      sourceTemplateId: "system_form_submission_verification_v1",
      sourceLiveId: "live-1",
      sourceFormSubmissionId: verificationInput.formSubmissionId,
      trigger: "form_submission_verification",
      status: "queued",
      idempotencyKey: expect.stringMatching(/^form-submission-verification\/email_[a-f0-9]{32}$/u),
    });
    const payload = revealEmailDeliveryPayload(create.data.payloadEncryptedEnvelope, {
      vendorId: "vendor-1",
      deliveryId: create.data.id,
    });
    const token = payload.body.match(/token=(fsv1\.[^\s]+)/u)?.[1];
    expect(payload).toMatchObject({
      recipientEmail: "lead@example.test",
      subject: "請確認 測試商家 的報名 Email",
      body: expect.stringContaining("https://app.example.test/verify-registration?token=fsv1."),
      brand: expect.objectContaining({
        version: 1,
        senderName: "測試品牌",
        replyTo: "support@example.test",
      }),
    });
    expect(token).toMatch(/^fsv1\.[^.]+\.[^.]+\.[^.]+\.[^.]+$/u);
    const serializedCreate = JSON.stringify(create);
    expect(serializedCreate).not.toContain("lead@example.test");
    expect(serializedCreate).not.toContain("王小明");
    expect(serializedCreate).not.toContain(token!);
  });

  it("adds exactly one unsubscribe URL to queued lifecycle payloads when templates omit the variable", async () => {
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
      nextAttemptAt: data.nextAttemptAt,
    }));

    const templateWithoutUnsubscribe = (id: string, trigger: string, body: string) => ({
      ...input.template,
      id,
      trigger,
      body,
    });

    await expect(ensureRegistrationConfirmationDelivery({
      ...input,
      template: templateWithoutUnsubscribe("registration-without-unsubscribe", "registration_confirmed", "報名內容"),
    })).resolves.toMatchObject({ status: "queued" });
    const registrationCreate = mocks.db.emailDelivery.create.mock.calls[0]?.[0];
    expect(registrationCreate.data.status).toBe("queued");
    const registrationPayload = revealEmailDeliveryPayload(registrationCreate.data.payloadEncryptedEnvelope, {
      vendorId: "vendor-1",
      deliveryId: registrationCreate.data.id,
    });
    expect(countUnsubscribeUrls(registrationPayload.body)).toBe(1);

    const reminderNow = new Date("2026-08-08T00:00:00.000Z");
    await expect(ensureLiveReminderDelivery({
      ...input,
      liveScheduledAt: new Date("2026-08-08T01:00:00.000Z"),
      reminderOffsetMinutes: 60,
      template: templateWithoutUnsubscribe("reminder-without-unsubscribe", "live_reminder", "提醒內容"),
    }, reminderNow)).resolves.toMatchObject({ status: "scheduled" });
    const reminderCreate = mocks.db.emailDelivery.create.mock.calls[1]?.[0];
    expect(reminderCreate.data.status).toBe("queued");
    const reminderPayload = revealEmailDeliveryPayload(reminderCreate.data.payloadEncryptedEnvelope, {
      vendorId: "vendor-1",
      deliveryId: reminderCreate.data.id,
    });
    expect(countUnsubscribeUrls(reminderPayload.body)).toBe(1);

    await expect(ensurePostLiveFollowupDelivery({
      ...input,
      template: templateWithoutUnsubscribe("followup-without-unsubscribe", "post_live_followup", "課後內容"),
      rule: {
        id: "rule-without-unsubscribe",
        vendorId: "vendor-1",
        liveId: "live-1",
        trigger: "post_live_followup",
        offsetMinutes: 30,
        isActive: true,
      },
      streamMode: "vod",
      endedAt: null,
      videoDurationSec: 3_600,
      verificationStatus: "VERIFIED",
    }, new Date("2026-08-08T06:00:00.000Z"))).resolves.toMatchObject({ status: "queued" });
    const followupCreate = mocks.db.emailDelivery.create.mock.calls[2]?.[0];
    expect(followupCreate.data.status).toBe("queued");
    const followupPayload = revealEmailDeliveryPayload(followupCreate.data.payloadEncryptedEnvelope, {
      vendorId: "vendor-1",
      deliveryId: followupCreate.data.id,
    });
    expect(countUnsubscribeUrls(followupPayload.body)).toBe(1);
  });

  it("schedules an encrypted reminder and gives changed template or title content a new delivery identity", async () => {
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
      nextAttemptAt: data.nextAttemptAt,
    }));
    const now = new Date("2026-08-08T00:00:00.000Z");
    const reminderInput = {
      ...input,
      reminderOffsetMinutes: 60,
      template: {
        ...input.template,
        id: "reminder-template-1",
        trigger: "live_reminder",
        subject: "{{live_title}} 將在 {{live_start_at}} 開播",
        body: "{{name}}，{{vendor_name}} 即將開播。\n{{unsubscribe_url}}",
      },
    };

    await expect(ensureLiveReminderDelivery(reminderInput, now)).resolves.toMatchObject({
      status: "scheduled",
      deliveryId: expect.stringMatching(/^email_[a-f0-9]{32}$/u),
      nextAttemptAt: new Date("2026-08-08T03:00:00.000Z"),
    });
    await expect(ensureLiveReminderDelivery({
      ...reminderInput,
      template: {
        ...reminderInput.template,
        body: "{{name}}，直播內容已更新。\n{{unsubscribe_url}}",
      },
    }, now)).resolves.toMatchObject({
      status: "scheduled",
      deliveryId: expect.stringMatching(/^email_[a-f0-9]{32}$/u),
    });
    await expect(ensureLiveReminderDelivery({
      ...reminderInput,
      liveTitle: "新品直播第二場",
    }, now)).resolves.toMatchObject({
      status: "scheduled",
      deliveryId: expect.stringMatching(/^email_[a-f0-9]{32}$/u),
    });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceLiveId: "live-1",
        sourceFormSubmissionId: "submission-1",
        trigger: "live_reminder",
      }),
      data: expect.objectContaining({ status: "superseded", nextAttemptAt: null }),
    }));
    const create = mocks.db.emailDelivery.create.mock.calls[0]?.[0];
    const revisedCreate = mocks.db.emailDelivery.create.mock.calls[1]?.[0];
    const renamedCreate = mocks.db.emailDelivery.create.mock.calls[2]?.[0];
    expect(revisedCreate.data.id).not.toBe(create.data.id);
    expect(renamedCreate.data.id).not.toBe(create.data.id);
    expect(renamedCreate.data.id).not.toBe(revisedCreate.data.id);
    expect(create.data).toMatchObject({
      trigger: "live_reminder",
      sourceTemplateId: "reminder-template-1",
      nextAttemptAt: new Date("2026-08-08T03:00:00.000Z"),
      idempotencyKey: expect.stringMatching(/^live-reminder\/email_/u),
    });
    const payload = revealEmailDeliveryPayload(create.data.payloadEncryptedEnvelope, {
      vendorId: "vendor-1",
      deliveryId: create.data.id,
    });
    expect(payload.subject).toContain("新品直播");
    expect(payload.subject).not.toContain("{{live_start_at}}");
    expect(payload.brand).toEqual({
      version: 1,
      senderName: "測試品牌",
      replyTo: "support@example.test",
      contactUrl: "https://example.test/contact",
    });
    expect(JSON.stringify(create)).not.toContain("lead@example.test");
  });

  it("reactivates the current unsent reminder when configuration returns from B to A", async () => {
    const now = new Date("2026-08-08T00:00:00.000Z");
    const updatedAt = new Date("2026-08-08T00:10:00.000Z");
    mocks.db.emailDelivery.create.mockRejectedValue(Object.assign(new Error("duplicate reminder"), { code: "P2002" }));
    mocks.db.emailDelivery.findUnique.mockResolvedValue({
      id: "email_reverted_a",
      status: "superseded",
      nextAttemptAt: null,
      updatedAt,
    });

    await expect(ensureLiveReminderDelivery({
      ...input,
      reminderOffsetMinutes: 60,
      template: {
        ...input.template,
        id: "reminder-template-1",
        trigger: "live_reminder",
      },
    }, now)).resolves.toMatchObject({
      status: "reactivated",
      deliveryId: "email_reverted_a",
      nextAttemptAt: new Date("2026-08-08T03:00:00.000Z"),
    });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: expect.stringMatching(/^email_[a-f0-9]{32}$/u),
        status: "superseded",
        updatedAt,
      },
      data: {
        status: "queued",
        nextAttemptAt: new Date("2026-08-08T03:00:00.000Z"),
        claimedAt: null,
        failedAt: null,
        lastErrorCode: null,
      },
    });
  });

  it("does not reactivate a reminder that has already been sent", async () => {
    const now = new Date("2026-08-08T00:00:00.000Z");
    mocks.db.emailDelivery.create.mockRejectedValue(Object.assign(new Error("duplicate reminder"), { code: "P2002" }));
    mocks.db.emailDelivery.findUnique.mockResolvedValue({
      id: "email_already_sent",
      status: "sent",
      nextAttemptAt: null,
      updatedAt: new Date("2026-08-08T00:10:00.000Z"),
    });

    await expect(ensureLiveReminderDelivery({
      ...input,
      reminderOffsetMinutes: 60,
      template: {
        ...input.template,
        id: "reminder-template-1",
        trigger: "live_reminder",
      },
    }, now)).resolves.toMatchObject({
      status: "duplicate",
      deliveryStatus: "sent",
    });
    expect(mocks.db.emailDelivery.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: expect.any(String), status: "superseded" }),
    }));
  });

  it("does not create a reminder after its reconciliation job loses the current-config guard", async () => {
    const now = new Date("2026-08-08T00:00:00.000Z");
    mocks.db.liveReminderReconciliationJob.findFirst.mockResolvedValue(null);

    await expect(ensureLiveReminderDelivery({
      ...input,
      reminderOffsetMinutes: 60,
      template: {
        ...input.template,
        id: "reminder-template-1",
        trigger: "live_reminder",
      },
    }, now, {
      reconciliationGuard: { jobId: "job-a", configDigest: "digest-a" },
    })).resolves.toEqual({ status: "config_superseded" });
    expect(mocks.db.liveReminderReconciliationJob.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job-a",
        vendorId: "vendor-1",
        liveId: "live-1",
        configDigest: "digest-a",
        lifecycle: "processing",
      },
      select: { id: true },
    });
    expect(mocks.db.emailDelivery.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("does not schedule a reminder after the live start time", async () => {
    await expect(ensureLiveReminderDelivery({
      ...input,
      reminderOffsetMinutes: 60,
      template: { ...input.template, trigger: "live_reminder" },
    }, new Date("2026-08-08T04:00:00.000Z"))).resolves.toEqual({ status: "not_scheduled" });
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("queues one due post-live follow-up and supersedes only older revisions of the same rule", async () => {
    const template = {
      ...input.template,
      id: "followup-template-1",
      trigger: "post_live_followup",
      subject: "{{name}}，課後資料來了",
    };
    const rule = {
      id: "rule-1",
      vendorId: "vendor-1",
      liveId: "live-1",
      trigger: "post_live_followup",
      offsetMinutes: 30,
      isActive: true,
    };
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
      nextAttemptAt: data.nextAttemptAt,
    }));

    await expect(ensurePostLiveFollowupDelivery({
      ...input,
      template,
      rule,
      streamMode: "vod",
      endedAt: null,
      videoDurationSec: 3_600,
      verificationStatus: "VERIFIED",
    }, new Date("2026-08-08T06:00:00.000Z"))).resolves.toMatchObject({
      status: "queued",
      deliveryId: expect.stringMatching(/^email_[a-f0-9]{32}$/u),
    });
    const create = mocks.db.emailDelivery.create.mock.calls[0]?.[0];
    expect(create.data).toMatchObject({
      trigger: "post_live_followup",
      sourceLiveId: "live-1",
      sourceFormSubmissionId: "submission-1",
      idempotencyKey: expect.stringMatching(/^post-live-followup\/rule-1\/email_/u),
    });
    expect(revealEmailDeliveryPayload(create.data.payloadEncryptedEnvelope, {
      vendorId: "vendor-1",
      deliveryId: create.data.id,
    }).brand).toEqual({
      version: 1,
      senderName: "測試品牌",
      replyTo: "support@example.test",
      contactUrl: "https://example.test/contact",
    });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        vendorId: "vendor-1",
        idempotencyKey: { startsWith: "post-live-followup/rule-1/" },
      }),
      data: expect.objectContaining({ status: "superseded" }),
    }));
  });

  it("fails closed for unverified, cross-vendor, or not-yet-due post-live recipients", async () => {
    const base = {
      ...input,
      template: { ...input.template, trigger: "post_live_followup" },
      rule: {
        id: "rule-1",
        vendorId: "vendor-1",
        liveId: "live-1",
        trigger: "post_live_followup",
        offsetMinutes: 30,
        isActive: true,
      },
      streamMode: "vod",
      endedAt: null,
      videoDurationSec: 3_600,
      verificationStatus: "VERIFIED",
    };
    await expect(ensurePostLiveFollowupDelivery({ ...base, verificationStatus: "UNVERIFIED" }, new Date("2026-08-08T06:00:00.000Z")))
      .resolves.toEqual({ status: "not_configured" });
    await expect(ensurePostLiveFollowupDelivery({ ...base, rule: { ...base.rule, vendorId: "vendor-2" } }, new Date("2026-08-08T06:00:00.000Z")))
      .resolves.toEqual({ status: "not_configured" });
    await expect(ensurePostLiveFollowupDelivery(base, new Date("2026-08-08T05:20:00.000Z")))
      .resolves.toEqual({ status: "not_due" });
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("records an active vendor email blacklist as a suppressed follow-up", async () => {
    mocks.db.blacklist.findFirst.mockResolvedValue({ id: "blacklist-1" });
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
      nextAttemptAt: data.nextAttemptAt,
    }));
    await expect(ensurePostLiveFollowupDelivery({
      ...input,
      template: { ...input.template, trigger: "post_live_followup" },
      rule: {
        id: "rule-1", vendorId: "vendor-1", liveId: "live-1",
        trigger: "post_live_followup", offsetMinutes: 0, isActive: true,
      },
      streamMode: "vod",
      endedAt: null,
      videoDurationSec: 3_600,
      verificationStatus: "VERIFIED",
    }, new Date("2026-08-08T06:00:00.000Z"))).resolves.toMatchObject({ status: "suppressed" });
    expect(mocks.db.blacklist.findFirst).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        identifierType: "email",
        identifier: "lead@example.test",
        isActive: true,
        unblockedAt: null,
      },
      select: { id: true },
    });
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "suppressed",
        nextAttemptAt: null,
        lastErrorCode: "recipient_blacklisted",
      }),
    }));
  });

  it("never creates a second follow-up revision after that rule was sent", async () => {
    mocks.db.emailDelivery.findFirst.mockResolvedValue({ id: "already-sent" });
    await expect(ensurePostLiveFollowupDelivery({
      ...input,
      template: { ...input.template, trigger: "post_live_followup" },
      rule: {
        id: "rule-1",
        vendorId: "vendor-1",
        liveId: "live-1",
        trigger: "post_live_followup",
        offsetMinutes: 0,
        isActive: true,
      },
      streamMode: "vod",
      endedAt: null,
      videoDurationSec: 3_600,
      verificationStatus: "VERIFIED",
    }, new Date("2026-08-08T06:00:00.000Z"))).resolves.toMatchObject({
      status: "already_sent",
      deliveryId: "already-sent",
    });
    expect(mocks.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it("scans only active rules and same-vendor verified registrations with bounded batches", async () => {
    const template = { ...input.template, id: "followup-template-1", trigger: "post_live_followup" };
    mocks.db.liveNotificationRule.findMany.mockResolvedValue([{
      id: "rule-1",
      vendorId: "vendor-1",
      liveId: "live-1",
      trigger: "post_live_followup",
      offsetMinutes: 0,
      isActive: true,
      updatedAt: new Date(0),
      messageTemplate: template,
      live: {
        id: "live-1",
        title: "新品直播",
        scheduledAt: new Date("2026-08-08T04:00:00.000Z"),
        endedAt: null,
        streamMode: "vod",
        video: { durationSec: 3_600 },
        vendor: { name: "測試商家" },
      },
    }]);
    mocks.db.liveNotificationRule.count.mockResolvedValue(21);
    mocks.db.formSubmission.count.mockResolvedValue(11);
    mocks.db.formSubmission.findMany.mockResolvedValue([{
      id: "submission-1",
      name: "王小明",
      email: "lead@example.test",
      verificationStatus: "VERIFIED",
    }]);
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
      nextAttemptAt: data.nextAttemptAt,
    }));

    await expect(processDuePostLiveFollowups({
      now: new Date("2026-08-08T06:00:00.000Z"),
      ruleLimit: 5,
      recipientLimitPerRule: 10,
    })).resolves.toEqual([{ status: "queued" }]);
    expect(mocks.db.liveNotificationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { trigger: "post_live_followup", isActive: true },
      skip: expect.any(Number),
      take: 5,
    }));
    expect(mocks.db.formSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        liveId: "live-1",
        verificationStatus: "VERIFIED",
        form: { vendorId: "vendor-1" },
      },
      skip: expect.any(Number),
      take: 10,
    }));
  });

  it("records an already-suppressed recipient without scheduling provider work", async () => {
    mocks.db.emailSuppression.findUnique.mockResolvedValue({ id: "suppression-1", resubscribedAt: null });
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: data.id, status: data.status }));

    await expect(ensureRegistrationConfirmationDelivery(input)).resolves.toMatchObject({ status: "suppressed" });
    expect(mocks.db.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "suppressed", nextAttemptAt: null, lastErrorCode: "recipient_suppressed" }),
    }));
  });

  it("claims and sends a due delivery with the same provider idempotency key", async () => {
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate());
    mocks.sendTransactionalEmail.mockResolvedValue({ id: "provider-message-1" });

    await expect(dispatchEmailDelivery("delivery-1")).resolves.toEqual({ status: "sent" });
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledWith({
      to: "lead@example.test",
      subject: "你已報名新品直播",
      text: "報名成功",
      idempotencyKey: "registration-confirmed/delivery-1",
      brand: {
        version: 1,
        senderName: "測試品牌",
        replyTo: "support@example.test",
        contactUrl: "https://example.test/contact",
      },
    });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "delivery-1", status: "sending", attemptCount: 1 },
      data: expect.objectContaining({ status: "sent", providerMessageId: "provider-message-1" }),
    }));
  });

  it("dispatches a legacy envelope without rebuilding brand data from the current vendor", async () => {
    const legacyPayload = protectEmailDeliveryPayload({
      recipientEmail: "lead@example.test",
      subject: "舊通知",
      body: "舊內容",
    }, { vendorId: "vendor-1", deliveryId: "delivery-1" });
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate(legacyPayload));
    mocks.sendTransactionalEmail.mockResolvedValue({ id: "provider-legacy-1" });

    await expect(dispatchEmailDelivery("delivery-1")).resolves.toEqual({ status: "sent" });
    const providerInput = mocks.sendTransactionalEmail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(providerInput).toEqual({
      to: "lead@example.test",
      subject: "舊通知",
      text: "舊內容",
      idempotencyKey: "registration-confirmed/delivery-1",
    });
    expect(providerInput).not.toHaveProperty("brand");
  });

  it("keeps an unchanged current live reminder eligible for provider delivery", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const liveScheduledAt = new Date("2026-08-10T04:00:00.000Z");
    const reminderTemplate = {
      ...input.template,
      id: "reminder-template-1",
      trigger: "live_reminder",
      subject: "{{live_title}} 即將開始",
      body: "{{name}}，{{vendor_name}} 即將開播。\n{{unsubscribe_url}}",
    };
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
      nextAttemptAt: data.nextAttemptAt,
    }));
    const scheduled = await ensureLiveReminderDelivery({
      ...input,
      liveScheduledAt,
      reminderOffsetMinutes: 1440,
      template: reminderTemplate,
    }, now);
    if (!("deliveryId" in scheduled)) throw new Error("Expected a scheduled reminder delivery");
    const createData = mocks.db.emailDelivery.create.mock.calls[0]?.[0].data;

    mocks.db.emailDelivery.updateMany.mockClear();
    mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate({ ...createData, status: "queued" }));
    mocks.db.live.findFirst.mockResolvedValue({
      id: "live-1",
      vendorId: "vendor-1",
      title: "新品直播",
      status: "scheduled",
      scheduledAt: liveScheduledAt,
      liveReminderOffsetMinutes: 1440,
      liveReminderTemplate: reminderTemplate,
    });
    mocks.sendTransactionalEmail.mockResolvedValue({ id: "provider-live-reminder-1" });

    if (!scheduled.deliveryId) throw new Error("Expected the reminder scheduler to return a delivery ID.");
    await expect(dispatchEmailDelivery(scheduled.deliveryId)).resolves.toEqual({ status: "sent" });
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(mocks.db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "live-1", vendorId: "vendor-1" },
      select: expect.objectContaining({ title: true }),
    }));
  });

  it("supersedes a claimed reminder when the live configuration no longer matches before provider send", async () => {
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate({
      trigger: "live_reminder",
      idempotencyKey: "live-reminder/delivery-1",
    }));
    mocks.db.live.findFirst.mockResolvedValue({
      id: "live-1",
      vendorId: "vendor-1",
      title: "新品直播",
      status: "scheduled",
      scheduledAt: new Date(Date.now() + 3_600_000),
      liveReminderOffsetMinutes: 60,
      liveReminderTemplate: {
        id: "template-1",
        vendorId: "vendor-1",
        channel: "email",
        trigger: "live_reminder",
        subject: "Changed reminder {{live_title}}",
        body: "Changed body {{unsubscribe_url}}",
        isActive: true,
      },
    });

    await expect(dispatchEmailDelivery("delivery-1")).resolves.toEqual({ status: "superseded" });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenLastCalledWith({
      where: { id: "delivery-1", status: "sending", attemptCount: 1 },
      data: {
        status: "superseded",
        nextAttemptAt: null,
        claimedAt: null,
        lastErrorCode: "config_superseded",
      },
    });
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("supersedes a stale post-live snapshot before provider send", async () => {
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate({
      trigger: "post_live_followup",
      idempotencyKey: "post-live-followup/rule-1/delivery-1",
    }));
    mocks.db.live.findFirst.mockResolvedValue({
      id: "live-1",
      vendorId: "vendor-1",
      title: "新品直播",
      scheduledAt: new Date("2026-08-08T04:00:00.000Z"),
      endedAt: null,
      streamMode: "vod",
      video: { durationSec: 3_600 },
      notificationRules: [{
        id: "rule-1",
        vendorId: "vendor-1",
        liveId: "live-1",
        trigger: "post_live_followup",
        offsetMinutes: 0,
        isActive: true,
        messageTemplate: {
          id: "template-1",
          vendorId: "vendor-1",
          channel: "email",
          trigger: "post_live_followup",
          subject: "已修改的課後主旨",
          body: "已修改的內容",
          isActive: true,
        },
      }],
    });
    mocks.db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1", email: "lead@example.test" });

    await expect(dispatchEmailDelivery("delivery-1")).resolves.toEqual({ status: "superseded" });
    expect(mocks.db.formSubmission.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "submission-1",
        liveId: "live-1",
        verificationStatus: "VERIFIED",
        form: { vendorId: "vendor-1" },
      }),
    }));
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("stops a current follow-up when the recipient is blacklisted after it was queued", async () => {
    const now = new Date("2026-08-08T06:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const template = {
      ...input.template,
      id: "followup-template-1",
      trigger: "post_live_followup",
      subject: "{{name}}，課後資料",
    };
    const rule = {
      id: "rule-1", vendorId: "vendor-1", liveId: "live-1",
      trigger: "post_live_followup", offsetMinutes: 0, isActive: true,
    };
    mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      status: data.status,
      nextAttemptAt: data.nextAttemptAt,
    }));
    const queued = await ensurePostLiveFollowupDelivery({
      ...input,
      template,
      rule,
      streamMode: "vod",
      endedAt: null,
      videoDurationSec: 3_600,
      verificationStatus: "VERIFIED",
    }, now);
    if (!("deliveryId" in queued) || !queued.deliveryId) throw new Error("Expected a queued follow-up");
    const createData = mocks.db.emailDelivery.create.mock.calls[0]?.[0].data;

    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate({ ...createData, status: "queued" }));
    mocks.db.live.findFirst.mockResolvedValue({
      id: "live-1",
      vendorId: "vendor-1",
      title: "新品直播",
      scheduledAt: input.liveScheduledAt,
      endedAt: null,
      streamMode: "vod",
      video: { durationSec: 3_600 },
      notificationRules: [{ ...rule, messageTemplate: template }],
    });
    mocks.db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1", email: "lead@example.test" });
    mocks.db.blacklist.findFirst.mockResolvedValue({ id: "blacklist-1" });

    await expect(dispatchEmailDelivery(queued.deliveryId)).resolves.toEqual({ status: "superseded" });
    expect(mocks.db.blacklist.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ identifier: "lead@example.test", vendorId: "vendor-1" }),
    }));
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("supersedes an expired verification delivery before decrypting or calling the provider", async () => {
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate({
      trigger: "form_submission_verification",
      id: "email_0123456789abcdef0123456789abcdef",
      sourceLiveId: null,
      sourceFormSubmissionId: "submission-1",
      idempotencyKey: "form-submission-verification/email_0123456789abcdef0123456789abcdef",
    }));
    mocks.db.formSubmission.findFirst.mockResolvedValue({
      id: "submission-1",
      verificationStatus: "UNVERIFIED",
      verificationVersion: 1,
      verificationExpiresAt: new Date(Date.now() - 1_000),
    });

    await expect(dispatchEmailDelivery("email_0123456789abcdef0123456789abcdef")).resolves.toEqual({ status: "superseded" });
    expect(mocks.db.formSubmission.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "submission-1", form: { vendorId: "vendor-1" } },
    }));
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "superseded", lastErrorCode: "verification_superseded" }),
    }));
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("retries a bounded network failure but exhausts a permanent provider rejection", async () => {
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate());
    mocks.sendTransactionalEmail.mockRejectedValueOnce(new TransactionalEmailError("network"));
    await expect(dispatchEmailDelivery("delivery-1")).resolves.toEqual({ status: "failed", errorCode: "network" });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", nextAttemptAt: expect.any(Date), lastErrorCode: "network" }),
    }));

    vi.clearAllMocks();
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate());
    mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.emailSuppression.findUnique.mockResolvedValue(null);
    mocks.sendTransactionalEmail.mockRejectedValueOnce(new TransactionalEmailError("provider_rejected", 422));
    await expect(dispatchEmailDelivery("delivery-1")).resolves.toEqual({ status: "exhausted", errorCode: "provider_rejected" });
    expect(mocks.db.emailDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "exhausted", nextAttemptAt: null, lastErrorCode: "provider_rejected" }),
    }));
  });

  it("rechecks suppression after claiming and never calls the provider", async () => {
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate());
    mocks.db.emailSuppression.findUnique.mockResolvedValue({ resubscribedAt: null });

    await expect(dispatchEmailDelivery("delivery-1")).resolves.toEqual({ status: "suppressed" });
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("keeps a sent delivery successful when audit persistence is unavailable", async () => {
    mocks.db.emailDelivery.findUnique.mockResolvedValue(candidate());
    mocks.sendTransactionalEmail.mockResolvedValue({ id: "provider-message-1" });
    mocks.writeAuditLog.mockRejectedValue(new Error("audit unavailable"));

    await expect(dispatchEmailDelivery("delivery-1")).resolves.toEqual({ status: "sent" });
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "email_delivery",
      operation: "audit",
      status: "sent",
    });
  });

  it("recovers a stale lease without retrying the same in-flight claim", async () => {
    mocks.db.emailDelivery.findMany
      .mockResolvedValueOnce([candidate({ status: "sending", attemptCount: 1, claimedAt: new Date(0) })])
      .mockResolvedValueOnce([]);

    await expect(processDueEmailDeliveries()).resolves.toEqual([{ deliveryId: "delivery-1", status: "recovered" }]);
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
