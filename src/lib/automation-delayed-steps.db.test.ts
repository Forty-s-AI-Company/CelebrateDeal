import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F-4 PR 2 (docs/product/delayed-steps-design.md §8): delayed steps of
// automation rules on the disposable PostgreSQL database. The registration and
// booking events go through the real dispatchAutomationEvent, the steps
// through the real worker (processDueDelayedStepRuns) and the merchant changes
// through the real Server Actions; only the session, CSRF, Next.js, e-mail
// provider and monitoring boundaries are synthetic.
const runtime = vi.hoisted(() => ({ actor: null as null | { user: { id: string }; vendor: { id: string }; member: { role: string } } }));
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
const provider = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: monitoring.captureOperationalError }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/email")>()), sendTransactionalEmail: provider.send }));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerMember: async () => {
    if (!runtime.actor) throw new Error("redirect:/login");
    return { auth: {}, ...runtime.actor };
  },
}));

import {
  createAutomationRuleStepAction,
  deleteAutomationRuleAction,
  deleteAutomationRuleStepAction,
  toggleAutomationRuleAction,
  updateAutomationRuleStepAction,
} from "@/app/actions/automation-actions";
import { POST as unsubscribe } from "@/app/api/email/unsubscribe/route";
import {
  AUTOMATION_STEP_MAX_DELAY_MINUTES,
  AUTOMATION_STEP_MIN_DELAY_MINUTES,
  createAutomationRuleStep,
  deleteAutomationRuleStep,
  MAX_AUTOMATION_RULE_STEPS,
  runDelayedStepWorker as processDueDelayedStepRuns,
  updateAutomationRuleStep,
} from "@/lib/automation-delayed-steps";
import { processDueDelayedStepRuns as sequenceOnlyWorker } from "@/lib/delayed-step-runs";
import { AUTOMATION_STEP_EMAIL_TRIGGER } from "@/lib/automation-email-trigger";
import {
  automationCustomerKeyHash,
  automationStepExecutionLogId,
  dispatchAutomationEvent,
  type AutomationEvent,
} from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import {
  DELAYED_STEP_LEASE_MS,
  DELAYED_STEP_MAX_ATTEMPTS,
  DELAYED_STEP_STALE_AFTER_MS,
  isCurrentAutomationStepEmailDelivery,
  SEQUENCE_EMAIL_DISPATCH_LIMIT,
  SEQUENCE_EMAIL_SEND_STALE_MS,
} from "@/lib/delayed-step-runs";
import { dispatchEmailDelivery, isCurrentEmailDeliverySnapshot, processDueSequenceEmailDeliveries } from "@/lib/email-delivery";
import { createEmailRecipientHash, createEmailUnsubscribeToken, protectEmailDeliveryPayload, revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { protectLineOfficialAccountCredentials } from "@/lib/line-credentials";

const db = getDb();
const APP_URL = "https://automation-steps.example.test";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "automation-steps-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  // Synthetic provider settings: the worker only checks that they exist.
  vi.stubEnv("RESEND_API_KEY", "re_synthetic_automation_steps");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal <no-reply@example.test>");
  provider.send.mockReset();
  provider.send.mockResolvedValue({ id: "synthetic-provider-message" });
  monitoring.captureOperationalError.mockClear();
  runtime.actor = null;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

const TAG_ACTION = { type: "add_customer_tag", tag: "第二天" };
const EMAIL_ACTION = { type: "send_email_notification", template: "repurchase_followup" };

async function tenant(options: { line?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: { name: `延遲步驟商家 ${suffix}`, slug: `automation-steps-${suffix}`, email: `merchant-${suffix}@example.test`, passwordHash: "disposable-test-only" },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `steps-form-${suffix}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: "回購商品", slug: `steps-product-${suffix}`, priceCents: 100_000, isActive: true },
  });
  const consultation = await db.consultationEvent.create({
    data: { vendorId: vendor.id, title: "1 對 1 諮詢", weeklySchedule: {}, intakeFormFields: [] },
  });
  if (options.line) {
    await db.lineOfficialAccount.create({
      data: {
        vendorId: vendor.id,
        ...protectLineOfficialAccountCredentials(vendor.id, {
          messagingChannelId: "2000123456",
          messagingChannelSecret: "synthetic-messaging-secret-1234567890",
          messagingAccessToken: "synthetic-access-token-with-at-least-thirty-two-chars",
          loginChannelId: null,
          loginChannelSecret: null,
        }),
      },
    });
  }
  return { vendor, form, product, consultation };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

async function rule(t: Tenant, options: { trigger?: string; actions?: unknown[]; isActive?: boolean } = {}) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `規則 ${randomUUID().slice(0, 6)}`,
      trigger: options.trigger ?? "form_registered",
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: (options.actions ?? [{ type: "add_customer_tag", tag: "報名" }]) as Prisma.InputJsonArray,
      isActive: options.isActive ?? true,
    },
  });
}

async function step(t: Tenant, ruleId: string, delayMinutes: number, actions: unknown[] = [TAG_ACTION], isActive = true) {
  return db.automationRuleStep.create({
    data: {
      vendorId: t.vendor.id,
      ruleId,
      delayMinutes,
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: actions as Prisma.InputJsonArray,
      isActive,
    },
  });
}

async function registration(t: Tenant, options: { verified?: boolean; email?: string } = {}) {
  const verified = options.verified ?? true;
  return db.formSubmission.create({
    data: {
      formId: t.form.id,
      name: "王小明",
      email: options.email ?? `lead-${randomUUID().slice(0, 8)}@example.test`,
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      verifiedAt: verified ? new Date() : null,
    },
  });
}

async function booking(t: Tenant, email = `client-${randomUUID().slice(0, 8)}@example.test`) {
  const start = new Date(Date.now() + 3 * DAY);
  return db.consultationBooking.create({
    data: {
      vendorId: t.vendor.id,
      eventId: t.consultation.id,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * MINUTE),
      clientName: "林小姐",
      clientEmail: email,
      clientPhone: "0912000000",
      meetingUrl: "https://meet.example.test/room",
    },
  });
}

function registered(t: Tenant, submission: { id: string; email: string }, vendorId = t.vendor.id): Promise<Array<{ ruleId: string; status: string }>> {
  const event: AutomationEvent = {
    vendorId,
    eventId: `form-registered:${submission.id}`,
    trigger: "form_registered",
    subjectType: "buyer_registration",
    subjectId: submission.id,
    subjectKeyHash: automationCustomerKeyHash(vendorId, submission.email),
    recipientEmail: submission.email,
  };
  return dispatchAutomationEvent(db, event);
}

function booked(t: Tenant, row: { id: string; clientEmail: string }, trigger: "consultation_booked" | "consultation_no_show" = "consultation_booked") {
  return dispatchAutomationEvent(db, {
    vendorId: t.vendor.id,
    eventId: `${trigger}:${row.id}`,
    trigger,
    subjectType: "buyer_registration",
    subjectId: row.id,
    subjectKeyHash: automationCustomerKeyHash(t.vendor.id, row.clientEmail),
    recipientEmail: row.clientEmail,
    consultationUrl: "https://meet.example.test/room",
  });
}

function runsOf(t: Tenant) {
  return db.delayedStepRun.findMany({ where: { vendorId: t.vendor.id }, orderBy: { createdAt: "asc" } });
}

async function onlyRun(t: Tenant) {
  const runs = await runsOf(t);
  expect(runs).toHaveLength(1);
  return runs[0]!;
}

function stepMails(t: Tenant) {
  return db.emailDelivery.findMany({ where: { vendorId: t.vendor.id, trigger: AUTOMATION_STEP_EMAIL_TRIGGER }, orderBy: { createdAt: "asc" } });
}

/** One job round for this vendor: the step e-mails already queued count as sent first (as the round's dispatch would). */
async function work(t: Tenant, now: Date) {
  await db.emailDelivery.updateMany({
    where: { vendorId: t.vendor.id, trigger: AUTOMATION_STEP_EMAIL_TRIGGER, status: { in: ["queued", "failed"] } },
    data: { status: "sent", sentAt: new Date(), nextAttemptAt: null },
  });
  return processDueDelayedStepRuns({ now, vendorId: t.vendor.id });
}

const after = (anchor: Date, offsetMs: number) => new Date(anchor.getTime() + offsetMs);

describe("觸發：事件發生時建立 run", () => {
  it("creates one run per rule and event after the immediate actions, with references only", async () => {
    const t = await tenant();
    const r = await rule(t);
    await step(t, r.id, 1_440);
    await step(t, r.id, 60);
    const lead = await registration(t, { email: "Lead.Steps@Example.test" });
    await expect(registered(t, lead)).resolves.toEqual([{ ruleId: r.id, status: "completed" }]);
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: r.id } });
    const run = await onlyRun(t);
    expect(run).toMatchObject({
      automationRuleId: r.id,
      emailSequenceId: null,
      sourceExecutionLogId: log.id,
      formSubmissionId: lead.id,
      consultationBookingId: null,
      subjectKeyHash: automationCustomerKeyHash(t.vendor.id, lead.email),
      recipientHash: null,
      status: "active",
      cursorDelayMinutes: -1,
      anchorAt: log.createdAt,
      nextRunAt: after(log.createdAt, 60 * MINUTE),
    });
    // The immediate tag was written before the run; the run holds no address.
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: "報名" } })).resolves.toBe(1);
    expect(JSON.stringify(run)).not.toContain(lead.email);

    // A replay of the same event (same execution) never creates a second run.
    await expect(registered(t, lead)).resolves.toEqual([{ ruleId: r.id, status: "duplicate" }]);
    await expect(runsOf(t)).resolves.toHaveLength(1);
    // A first attempt whose run could not be written gets it from the replay.
    await db.delayedStepRun.deleteMany({ where: { vendorId: t.vendor.id } });
    await registered(t, lead);
    await expect(onlyRun(t)).resolves.toMatchObject({ sourceExecutionLogId: log.id, anchorAt: log.createdAt });
  });

  it("creates no run for a rule without active steps or with a hidden trigger", async () => {
    const t = await tenant();
    const noSteps = await rule(t);
    const inactiveOnly = await rule(t);
    await step(t, inactiveOnly.id, 60, [TAG_ACTION], false);
    const hidden = await rule(t, { trigger: "form_no_show" });
    await step(t, hidden.id, 60);
    const lead = await registration(t);
    await registered(t, lead);
    await dispatchAutomationEvent(db, {
      vendorId: t.vendor.id,
      eventId: `form-no-show:${lead.id}`,
      trigger: "form_no_show",
      subjectType: "buyer_registration",
      subjectId: lead.id,
      subjectKeyHash: automationCustomerKeyHash(t.vendor.id, lead.email),
      recipientEmail: lead.email,
    });
    await expect(db.automationExecutionLog.count({ where: { vendorId: t.vendor.id, ruleId: { in: [noSteps.id, inactiveOnly.id, hidden.id] } } })).resolves.toBe(3);
    await expect(runsOf(t)).resolves.toEqual([]);
  });

  it("starts a booking's run and keeps the request outcome when writing the run fails", async () => {
    const t = await tenant();
    const r = await rule(t, { trigger: "consultation_booked" });
    await step(t, r.id, 120);
    const row = await booking(t);
    await booked(t, row);
    await expect(onlyRun(t)).resolves.toMatchObject({ automationRuleId: r.id, consultationBookingId: row.id, formSubmissionId: null });

    const other = await booking(t);
    vi.spyOn(db.delayedStepRun, "createMany").mockRejectedValueOnce(new Error("synthetic run write failure"));
    await expect(booked(t, other)).resolves.toEqual([{ ruleId: r.id, status: "completed" }]);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ area: "automation_delayed_steps", operation: "start_run" }));
    await expect(db.delayedStepRun.count({ where: { vendorId: t.vendor.id, consultationBookingId: other.id } })).resolves.toBe(0);
  });

  it("never starts a run for another tenant's registration or booking", async () => {
    const a = await tenant();
    const b = await tenant();
    const r = await rule(a);
    await step(a, r.id, 60);
    const bLead = await registration(b);
    // A's rule with an event that names B's registration: the subject is not A's.
    await registered(a, bLead, a.vendor.id);
    await expect(runsOf(a)).resolves.toEqual([]);
    await expect(runsOf(b)).resolves.toEqual([]);
    const ra = await rule(a, { trigger: "consultation_booked" });
    await step(a, ra.id, 60);
    const bBooking = await booking(b);
    await booked(a, bBooking);
    await expect(runsOf(a)).resolves.toEqual([]);
    // The composite foreign keys refuse a run that mixes tenants even when written directly.
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: a.vendor.id, ruleId: ra.id } });
    await expect(db.delayedStepRun.create({
      data: { vendorId: a.vendor.id, automationRuleId: ra.id, sourceExecutionLogId: log.id, consultationBookingId: bBooking.id, subjectKeyHash: "k", anchorAt: new Date(), nextRunAt: new Date() },
    })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.delayedStepRun.create({
      data: { vendorId: b.vendor.id, automationRuleId: ra.id, sourceExecutionLogId: log.id, consultationBookingId: bBooking.id, subjectKeyHash: "k", anchorAt: new Date(), nextRunAt: new Date() },
    })).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("worker：到點執行", () => {
  it("runs a registration's step N hours after the event: re-reads the recipient, logs it once, queues the e-mail on the sequence quota", async () => {
    const t = await tenant();
    const r = await rule(t);
    const first = await step(t, r.id, 60, [TAG_ACTION, EMAIL_ACTION]);
    const second = await step(t, r.id, 1_440, [{ type: "add_customer_tag", tag: "第三天" }]);
    const lead = await registration(t);
    await registered(t, lead);
    const run = await onlyRun(t);
    // Not yet due.
    await expect(work(t, after(run.anchorAt, 59 * MINUTE))).resolves.toEqual([]);
    // Due: one step, its log, tag and e-mail.
    await expect(work(t, after(run.anchorAt, 61 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed", emailsQueued: 1 }]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({
      status: "active", cursorDelayMinutes: 60, nextRunAt: after(run.anchorAt, 1_440 * MINUTE), claimedAt: null, attemptCount: 0,
    });
    const stepLog = await db.automationExecutionLog.findUniqueOrThrow({ where: { id: automationStepExecutionLogId(t.vendor.id, run.id, first.id) } });
    expect(stepLog).toMatchObject({ ruleId: r.id, status: "completed", conditionMatched: true, eventId: `delayed-step:${run.id}:${first.id}`, trigger: "form_registered", subjectKeyHash: run.subjectKeyHash });
    await expect(db.customerTagAssignment.findFirstOrThrow({ where: { vendorId: t.vendor.id, tag: "第二天" } })).resolves.toMatchObject({ sourceExecutionLogId: stepLog.id });
    const [mail] = await stepMails(t);
    expect(mail).toMatchObject({ trigger: "automation_step", status: "queued", sourceTemplateId: "automation_repurchase_followup_v1" });
    const payload = revealEmailDeliveryPayload(mail!.payloadEncryptedEnvelope, { vendorId: t.vendor.id, deliveryId: mail!.id });
    expect(payload.recipientEmail).toBe(lead.email);
    expect(payload.body).toMatch(new RegExp(`退訂：${APP_URL}/unsubscribe\\?token=`, "u"));
    // The job sends it with the sequence e-mails, not with the time-bound mail.
    const sent = await processDueSequenceEmailDeliveries({ limit: 50 });
    expect(sent).toContainEqual({ deliveryId: mail!.id, status: "sent" });

    // The last step completes the run.
    await expect(work(t, after(run.anchorAt, 1_441 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "completed", cursorDelayMinutes: 1_440, nextRunAt: null });
    await expect(db.automationExecutionLog.count({ where: { id: automationStepExecutionLogId(t.vendor.id, run.id, second.id) } })).resolves.toBe(1);
    await expect(work(t, after(run.anchorAt, 3 * DAY))).resolves.toEqual([]);
  });

  it("leaves automation runs alone in a worker round without the automation processor", async () => {
    const t = await tenant();
    const r = await rule(t);
    await step(t, r.id, 60);
    await registered(t, await registration(t));
    const run = await onlyRun(t);
    await expect(sequenceOnlyWorker({ now: after(run.anchorAt, 2 * DAY), vendorId: t.vendor.id })).resolves.toEqual([]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active", cursorDelayMinutes: -1, attemptCount: 0, claimedAt: null });
  });

  it("runs at most one step per round and skips a step more than 24 hours late without running it", async () => {
    const t = await tenant();
    const r = await rule(t);
    const s1 = await step(t, r.id, 60, [{ type: "add_customer_tag", tag: "一" }]);
    const s2 = await step(t, r.id, 120, [{ type: "add_customer_tag", tag: "二" }]);
    const s3 = await step(t, r.id, 3 * 1_440, [{ type: "add_customer_tag", tag: "三" }]);
    const lead = await registration(t);
    await registered(t, lead);
    const run = await onlyRun(t);
    // Both s1 and s2 are due: only s1 this round.
    await expect(work(t, after(run.anchorAt, 3 * HOUR))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ cursorDelayMinutes: 60 });
    // The job stalls: s2 is now more than a day late and is skipped in bulk, without a log.
    const late = after(run.anchorAt, 2 * HOUR + DELAYED_STEP_STALE_AFTER_MS + MINUTE);
    await expect(work(t, late)).resolves.toEqual([]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ cursorDelayMinutes: 120, nextRunAt: after(run.anchorAt, 3 * DAY) });
    await expect(db.automationExecutionLog.count({ where: { id: automationStepExecutionLogId(t.vendor.id, run.id, s2.id) } })).resolves.toBe(0);
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: "二" } })).resolves.toBe(0);
    await expect(work(t, after(run.anchorAt, 3 * DAY + MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: { in: ["一", "三"] } } })).resolves.toBe(2);
    void s1; void s3;
  });

  it("re-evaluates the step's condition now and records an unmatched condition without actions", async () => {
    const t = await tenant();
    const r = await rule(t);
    // A condition of the existing schema that a registration never meets.
    await db.automationRuleStep.create({
      data: { vendorId: t.vendor.id, ruleId: r.id, delayMinutes: 60, condition: { type: "order_amount_gte", amountCents: 100 } as Prisma.InputJsonValue, actions: [TAG_ACTION] as Prisma.InputJsonArray },
    });
    const lead = await registration(t);
    await registered(t, lead);
    const run = await onlyRun(t);
    await expect(work(t, after(run.anchorAt, 61 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "condition_not_met" }]);
    await expect(db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, eventId: { startsWith: "delayed-step:" } } })).resolves.toMatchObject({ status: "skipped", conditionMatched: false });
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: "第二天" } })).resolves.toBe(0);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "completed" });
  });

  it("mails a registration only once it is verified, and follows the vendor's unsubscribe list without stopping the run", async () => {
    const t = await tenant();
    const r = await rule(t);
    await step(t, r.id, 60, [EMAIL_ACTION, TAG_ACTION]);
    await step(t, r.id, 120, [EMAIL_ACTION]);
    const lead = await registration(t, { verified: false });
    await registered(t, lead);
    const run = await onlyRun(t);
    await expect(work(t, after(run.anchorAt, 61 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    await expect(stepMails(t)).resolves.toEqual([]);
    const firstLog = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, eventId: { startsWith: "delayed-step:" } } });
    expect(firstLog.actionResults).toEqual(expect.arrayContaining([expect.objectContaining({ type: "send_email_notification", status: "recipient_not_linked" })]));
    // Verified now, but unsubscribed from this vendor: skipped and recorded, the run goes on.
    await db.formSubmission.update({ where: { id: lead.id }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date() } });
    await db.emailSuppression.create({ data: { vendorId: t.vendor.id, recipientHash: createEmailRecipientHash(lead.email, t.vendor.id), recipientMaskedEmail: "l***@example.test", reason: "recipient_request", source: "unsubscribe_link" } });
    await expect(work(t, after(run.anchorAt, 121 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    await expect(stepMails(t)).resolves.toEqual([]);
    const logs = await db.automationExecutionLog.findMany({ where: { vendorId: t.vendor.id, eventId: { startsWith: "delayed-step:" } }, orderBy: { createdAt: "asc" } });
    expect(logs[1]!.actionResults).toEqual([expect.objectContaining({ status: "skipped", reason: "recipient_suppressed" })]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "completed" });
  });
});

describe("worker：停止條件", () => {
  async function dueRun(trigger: "form_registered" | "consultation_booked" = "form_registered") {
    const t = await tenant();
    const r = await rule(t, { trigger });
    await step(t, r.id, 60);
    if (trigger === "form_registered") {
      await registered(t, await registration(t));
    } else {
      await booked(t, await booking(t));
    }
    const run = await onlyRun(t);
    return { t, r, run, due: after(run.anchorAt, 61 * MINUTE) };
  }

  it("stops when the rule is switched off, and switching it on again does not revive the run", async () => {
    const { t, r, run, due } = await dueRun();
    await db.automationRule.update({ where: { id: r.id }, data: { isActive: false } });
    await expect(work(t, due)).resolves.toEqual([{ runId: run.id, status: "cancelled", cancelReason: "definition_paused" }]);
    await db.automationRule.update({ where: { id: r.id }, data: { isActive: true } });
    await expect(work(t, due)).resolves.toEqual([]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "cancelled", nextRunAt: null });
  });

  it("stops when the rule's trigger is no longer offered to merchants", async () => {
    const { t, r, run, due } = await dueRun();
    await db.automationRule.update({ where: { id: r.id }, data: { trigger: "form_no_show" } });
    await expect(work(t, due)).resolves.toEqual([{ runId: run.id, status: "cancelled", cancelReason: "definition_paused" }]);
  });

  it("stops with subject_gone when the merchant cancelled the booking, and drops the run with a deleted registration", async () => {
    const booked1 = await dueRun("consultation_booked");
    await db.consultationBooking.update({ where: { id: booked1.run.consultationBookingId! }, data: { status: "cancelled" } });
    await expect(work(booked1.t, booked1.due)).resolves.toEqual([{ runId: booked1.run.id, status: "cancelled", cancelReason: "subject_gone" }]);
    const registered1 = await dueRun();
    await db.formSubmission.delete({ where: { id: registered1.run.formSubmissionId! } });
    await expect(runsOf(registered1.t)).resolves.toEqual([]);
    await expect(work(registered1.t, registered1.due)).resolves.toEqual([]);
  });

  it("keeps a suspended vendor's runs without running them", async () => {
    const { t, run, due } = await dueRun();
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    await expect(work(t, due)).resolves.toEqual([]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active", attemptCount: 0, cursorDelayMinutes: -1 });
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: null, suspendedReason: null } });
    await expect(work(t, due)).resolves.toEqual([{ runId: run.id, status: "executed" }]);
  });

  it("cancels a run as failed after the retry limit", async () => {
    const { t, run, due } = await dueRun();
    await db.delayedStepRun.update({ where: { id: run.id }, data: { attemptCount: DELAYED_STEP_MAX_ATTEMPTS } });
    await expect(work(t, due)).resolves.toEqual([{ runId: run.id, status: "cancelled", cancelReason: "failed" }]);
  });
});

describe("冪等：租約過期重領、兩個 worker 併發", () => {
  it("resumes a step that failed half-way on the same execution log: no voucher, tag, LINE message or e-mail is issued twice", async () => {
    const t = await tenant({ line: true });
    const r = await rule(t);
    const voucher = { type: "issue_repurchase_voucher", productId: t.product.id, discountType: "fixed", discountValue: 10_000, expiresInDays: 3 };
    const line = { type: "line_push", message: "專屬優惠 {{voucher_url}}", buttonLabel: "領取", buttonUrl: "{{voucher_url}}" };
    const s = await step(t, r.id, 60, [voucher, TAG_ACTION, line, EMAIL_ACTION]);
    const lead = await registration(t);
    await db.lineUserIdentity.create({
      data: { vendorId: t.vendor.id, subjectType: "buyer_registration", subjectId: lead.id, lineUserIdHash: createHash("sha256").update(randomUUID()).digest("hex"), lineUserIdEncrypted: "v1.synthetic" },
    });
    await registered(t, lead);
    const run = await onlyRun(t);
    const due = after(run.anchorAt, 61 * MINUTE);
    // The worker dies at the e-mail: voucher, tag and LINE are written, the step fails, the lease stays.
    vi.spyOn(db.emailDelivery, "create").mockRejectedValueOnce(new Error("synthetic crash"));
    await expect(work(t, due)).resolves.toEqual([{ runId: run.id, status: "failed" }]);
    const logId = automationStepExecutionLogId(t.vendor.id, run.id, s.id);
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: logId } })).resolves.toMatchObject({ status: "failed", errorCode: "action_failed" });
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ cursorDelayMinutes: -1, attemptCount: 1, claimedAt: due });
    // Still leased: not claimable before the lease expires.
    await expect(work(t, after(due, DELAYED_STEP_LEASE_MS - MINUTE))).resolves.toEqual([]);
    // Lease expired: the same step resumes on the same log.
    await expect(work(t, after(due, DELAYED_STEP_LEASE_MS + MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed", emailsQueued: 1 }]);
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: logId } })).resolves.toMatchObject({ status: "completed" });
    await expect(db.automationVoucherGrant.count({ where: { vendorId: t.vendor.id, sourceExecutionLogId: logId } })).resolves.toBe(1);
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: "第二天" } })).resolves.toBe(1);
    await expect(db.lineDelivery.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
    await expect(stepMails(t)).resolves.toHaveLength(1);

    // A completed step met again (e.g. after a settle that never committed) only moves the cursor.
    await db.delayedStepRun.update({ where: { id: run.id }, data: { status: "active", cursorDelayMinutes: -1, nextRunAt: due, claimedAt: null } });
    await expect(work(t, due)).resolves.toEqual([{ runId: run.id, status: "skipped_already_sent" }]);
    await expect(db.automationVoucherGrant.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
    await expect(db.lineDelivery.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
    await expect(stepMails(t)).resolves.toHaveLength(1);
  });

  it("lets only one of two concurrent workers claim a run", async () => {
    const t = await tenant();
    const r = await rule(t);
    await step(t, r.id, 60, [TAG_ACTION, EMAIL_ACTION]);
    await registered(t, await registration(t));
    const run = await onlyRun(t);
    const due = after(run.anchorAt, 61 * MINUTE);
    const rounds = await Promise.all([processDueDelayedStepRuns({ now: due, vendorId: t.vendor.id }), processDueDelayedStepRuns({ now: due, vendorId: t.vendor.id })]);
    const statuses = rounds.flat().map((result) => result.status);
    expect(statuses.filter((status) => status === "executed")).toHaveLength(1);
    expect(statuses.filter((status) => status !== "executed" && status !== "claimed_elsewhere")).toEqual([]);
    await expect(stepMails(t)).resolves.toHaveLength(1);
    await expect(db.automationExecutionLog.count({ where: { vendorId: t.vendor.id, eventId: { startsWith: "delayed-step:" } } })).resolves.toBe(1);
  });
});

describe("與序列信共用額度", () => {
  async function pendingMails(t: Tenant, count: number, trigger: string) {
    for (let index = 0; index < count; index += 1) {
      const id = `email_${randomUUID().replace(/-/gu, "")}`;
      await db.emailDelivery.create({
        data: {
          id,
          vendorId: t.vendor.id,
          sourceTemplateId: "synthetic",
          trigger,
          ...protectEmailDeliveryPayload({ recipientEmail: `queued-${index}@example.test`, subject: "合成", body: "合成" }, { vendorId: t.vendor.id, deliveryId: id }),
          idempotencyKey: `synthetic/${id}`,
          status: "queued",
          nextAttemptAt: new Date(Date.now() + DAY),
        },
      });
    }
  }

  it("creates step e-mails only into the room the sequence queue leaves, and counts them in that queue", async () => {
    const t = await tenant();
    const r = await rule(t);
    await step(t, r.id, 60, [EMAIL_ACTION, { type: "send_email_notification", template: "webinar_replay" }]);
    await registered(t, await registration(t));
    const run = await onlyRun(t);
    const due = after(run.anchorAt, 61 * MINUTE);
    // A full queue (sequence e-mails count too): nothing is claimed.
    await pendingMails(t, SEQUENCE_EMAIL_DISPATCH_LIMIT, "sequence_email");
    await expect(processDueDelayedStepRuns({ now: due, vendorId: t.vendor.id })).resolves.toEqual([]);
    // Room for one, but the step needs two: the lease is given back without using an attempt.
    await db.emailDelivery.deleteMany({ where: { vendorId: t.vendor.id, trigger: "sequence_email" } });
    await pendingMails(t, SEQUENCE_EMAIL_DISPATCH_LIMIT - 1, "sequence_email");
    await expect(processDueDelayedStepRuns({ now: due, vendorId: t.vendor.id })).resolves.toEqual([{ runId: run.id, status: "waiting_capacity" }]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active", cursorDelayMinutes: -1, attemptCount: 0, claimedAt: null, nextRunAt: run.nextRunAt });
    // Room for both: both are queued and count against the same queue as sequence e-mails.
    await db.emailDelivery.deleteMany({ where: { vendorId: t.vendor.id, trigger: "sequence_email" } });
    await pendingMails(t, SEQUENCE_EMAIL_DISPATCH_LIMIT - 2, AUTOMATION_STEP_EMAIL_TRIGGER);
    await expect(processDueDelayedStepRuns({ now: due, vendorId: t.vendor.id })).resolves.toEqual([{ runId: run.id, status: "executed", emailsQueued: 2 }]);
    await expect(db.emailDelivery.count({ where: { vendorId: t.vendor.id, trigger: { in: ["sequence_email", AUTOMATION_STEP_EMAIL_TRIGGER] }, status: "queued" } })).resolves.toBe(SEQUENCE_EMAIL_DISPATCH_LIMIT);
  });

  it("supersedes a step e-mail still unsent after six hours and suppresses a blacklisted recipient at send time", async () => {
    expect(isCurrentAutomationStepEmailDelivery({ trigger: "automation", createdAt: new Date(0) }, new Date())).toBe(true);
    expect(isCurrentAutomationStepEmailDelivery({ trigger: AUTOMATION_STEP_EMAIL_TRIGGER }, new Date())).toBe(false);
    const t = await tenant();
    const r = await rule(t);
    await step(t, r.id, 60, [EMAIL_ACTION]);
    const lead = await registration(t);
    await registered(t, lead);
    const run = await onlyRun(t);
    await work(t, after(run.anchorAt, 61 * MINUTE));
    const [mail] = await stepMails(t);
    await expect(isCurrentEmailDeliverySnapshot(mail!, new Date(mail!.createdAt.getTime() + SEQUENCE_EMAIL_SEND_STALE_MS + MINUTE))).resolves.toBe(false);
    await db.emailDelivery.update({ where: { id: mail!.id }, data: { createdAt: new Date(Date.now() - SEQUENCE_EMAIL_SEND_STALE_MS - MINUTE), nextAttemptAt: new Date(Date.now() - MINUTE) } });
    await expect(dispatchEmailDelivery(mail!.id)).resolves.toEqual({ status: "superseded" });
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: mail!.id } })).resolves.toMatchObject({ lastErrorCode: "automation_step_superseded" });

    const other = await registration(t);
    await registered(t, other);
    const otherRun = (await runsOf(t)).find((row) => row.formSubmissionId === other.id)!;
    await work(t, after(otherRun.anchorAt, 61 * MINUTE));
    const queued = (await stepMails(t)).find((row) => row.status === "queued")!;
    await db.blacklist.create({ data: { vendorId: t.vendor.id, identifierType: "email", identifier: other.email.toLowerCase(), reason: "合成" } });
    await expect(dispatchEmailDelivery(queued.id)).resolves.toEqual({ status: "suppressed" });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("does not stop an automation run when the recipient unsubscribes (only its e-mails are skipped)", async () => {
    const t = await tenant();
    const r = await rule(t);
    await step(t, r.id, 60, [EMAIL_ACTION]);
    await step(t, r.id, 120, [TAG_ACTION]);
    const lead = await registration(t);
    await registered(t, lead);
    const run = await onlyRun(t);
    await work(t, after(run.anchorAt, 61 * MINUTE));
    const [mail] = await stepMails(t);
    const request = new Request(`${APP_URL}/api/email/unsubscribe`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: APP_URL },
      body: new URLSearchParams({ token: createEmailUnsubscribeToken(mail!.id) }),
    });
    await unsubscribe(request);
    await expect(db.emailSuppression.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active" });
    await expect(work(t, after(run.anchorAt, 121 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
  });
});

describe("後台：步驟的新增、修改與刪除", () => {
  function form(entries: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  }
  function as(t: Tenant) {
    runtime.actor = { user: { id: `user-${t.vendor.id}` }, vendor: { id: t.vendor.id }, member: { role: "admin" } };
  }

  it("adds, edits and deletes a step through the Server Actions, keeping the step id and writing audit logs", async () => {
    const t = await tenant();
    const r = await rule(t);
    as(t);
    await expect(createAutomationRuleStepAction(form({ ruleId: r.id, delayValue: "2", delayUnit: "days", actionTag: "on", customerTag: "第二天", stepActive: "on" }))).rejects.toThrow("redirect:/settings/automations?updated=step_created");
    const created = await db.automationRuleStep.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: r.id } });
    expect(created).toMatchObject({ delayMinutes: 2_880, isActive: true, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "第二天" }] });
    await expect(updateAutomationRuleStepAction(form({ ruleId: r.id, stepId: created.id, delayValue: "5", delayUnit: "hours", actionEmail: "on", emailTemplate: "class_reminder" }))).rejects.toThrow("redirect:/settings/automations?updated=step_updated");
    await expect(db.automationRuleStep.findUniqueOrThrow({ where: { id: created.id } })).resolves.toMatchObject({ delayMinutes: 300, isActive: false, actions: [{ type: "send_email_notification", template: "class_reminder" }] });
    // Validation: delay range, no action, duplicate delay, unsafe button URL.
    await expect(createAutomationRuleStepAction(form({ ruleId: r.id, delayValue: "0", delayUnit: "hours", actionTag: "on", customerTag: "x" }))).rejects.toThrow("error=invalid_delay");
    await expect(createAutomationRuleStepAction(form({ ruleId: r.id, delayValue: "91", delayUnit: "days", actionTag: "on", customerTag: "x" }))).rejects.toThrow("error=invalid_delay");
    await expect(createAutomationRuleStepAction(form({ ruleId: r.id, delayValue: "3", delayUnit: "minutes", actionTag: "on", customerTag: "x" }))).rejects.toThrow("error=invalid_delay");
    await expect(createAutomationRuleStepAction(form({ ruleId: r.id, delayValue: "1", delayUnit: "days" }))).rejects.toThrow("error=no_action");
    await expect(createAutomationRuleStepAction(form({ ruleId: r.id, delayValue: "5", delayUnit: "hours", actionTag: "on", customerTag: "x" }))).rejects.toThrow("error=duplicate_delay");
    await expect(createAutomationRuleStepAction(form({ ruleId: r.id, delayValue: "1", delayUnit: "days", actionLine: "on", lineMessage: "hi", buttonLabel: "go", buttonUrl: "https://brand.example@evil.example" }))).rejects.toThrow("error=invalid_button_url");
    await expect(deleteAutomationRuleStepAction(form({ ruleId: r.id, stepId: created.id }))).rejects.toThrow("redirect:/settings/automations?updated=step_deleted");
    await expect(db.automationRuleStep.count({ where: { ruleId: r.id } })).resolves.toBe(0);
    const audit = await db.auditLog.findMany({ where: { vendorId: t.vendor.id, targetType: "AutomationRuleStep" }, orderBy: { createdAt: "asc" }, select: { action: true, targetId: true } });
    expect(audit).toEqual([
      { action: "create_automation_rule_step", targetId: created.id },
      { action: "update_automation_rule_step", targetId: created.id },
      { action: "delete_automation_rule_step", targetId: created.id },
    ]);
  });

  it("binds every rule, step and product id to the session's vendor and enforces the limits", async () => {
    const a = await tenant();
    const b = await tenant();
    const ra = await rule(a);
    const rb = await rule(b);
    const sb = await step(b, rb.id, 60);
    const input = { delayMinutes: 120, condition: { type: "always" }, actions: [TAG_ACTION], isActive: true };
    // A's vendor with B's rule, B's step under A's rule, B's product in A's voucher.
    await expect(createAutomationRuleStep({ vendorId: a.vendor.id, ruleId: rb.id, step: input })).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(updateAutomationRuleStep({ vendorId: a.vendor.id, ruleId: ra.id, stepId: sb.id, step: input })).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(updateAutomationRuleStep({ vendorId: a.vendor.id, ruleId: rb.id, stepId: sb.id, step: input })).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(deleteAutomationRuleStep({ vendorId: a.vendor.id, ruleId: rb.id, stepId: sb.id })).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(createAutomationRuleStep({ vendorId: a.vendor.id, ruleId: ra.id, step: { ...input, actions: [{ type: "issue_repurchase_voucher", productId: b.product.id, discountType: "fixed", discountValue: 100, expiresInDays: 3 }] } })).resolves.toEqual({ ok: false, code: "invalid_product" });
    await expect(db.automationRuleStep.findUniqueOrThrow({ where: { id: sb.id } })).resolves.toMatchObject({ ruleId: rb.id, delayMinutes: 60 });
    // Not even a direct write can hang A's step on B's rule (composite foreign key).
    await expect(db.automationRuleStep.create({ data: { vendorId: a.vendor.id, ruleId: rb.id, delayMinutes: 90, condition: {}, actions: [TAG_ACTION] as Prisma.InputJsonArray } })).rejects.toMatchObject({ code: "P2003" });
    // Through the action: B's ids from A's session are "not found".
    runtime.actor = { user: { id: "user-a" }, vendor: { id: a.vendor.id }, member: { role: "owner" } };
    await expect(deleteAutomationRuleStepAction(form({ ruleId: rb.id, stepId: sb.id }))).rejects.toThrow("error=not_found");
    await expect(db.automationRuleStep.count({ where: { id: sb.id } })).resolves.toBe(1);
    // Limits and ranges.
    for (let index = 0; index < MAX_AUTOMATION_RULE_STEPS; index += 1) {
      await expect(createAutomationRuleStep({ vendorId: a.vendor.id, ruleId: ra.id, step: { ...input, delayMinutes: (index + 1) * 60 } })).resolves.toMatchObject({ ok: true });
    }
    await expect(createAutomationRuleStep({ vendorId: a.vendor.id, ruleId: ra.id, step: { ...input, delayMinutes: 100 * 60 } })).resolves.toEqual({ ok: false, code: "step_limit" });
    for (const delayMinutes of [AUTOMATION_STEP_MIN_DELAY_MINUTES - 1, AUTOMATION_STEP_MAX_DELAY_MINUTES + 1, 90.5]) {
      await expect(updateAutomationRuleStep({ vendorId: a.vendor.id, ruleId: ra.id, stepId: (await db.automationRuleStep.findFirstOrThrow({ where: { ruleId: ra.id } })).id, step: { ...input, delayMinutes } })).resolves.toEqual({ ok: false, code: "invalid_delay" });
    }
    await expect(db.automationRuleStep.create({ data: { vendorId: a.vendor.id, ruleId: ra.id, delayMinutes: 59, condition: {}, actions: [TAG_ACTION] as Prisma.InputJsonArray } })).rejects.toThrow(/AutomationRuleStep_delayMinutes_check/u);
    await expect(db.automationRuleStep.create({ data: { vendorId: a.vendor.id, ruleId: ra.id, delayMinutes: 5_000, condition: {}, actions: [] as Prisma.InputJsonArray } })).rejects.toThrow(/AutomationRuleStep_actions_check/u);
    // A hidden trigger: no new or edited step, but deleting one still works.
    const hidden = await rule(a, { trigger: "form_no_show" });
    const hiddenStep = await step(a, hidden.id, 60);
    await expect(createAutomationRuleStep({ vendorId: a.vendor.id, ruleId: hidden.id, step: input })).resolves.toEqual({ ok: false, code: "trigger_unavailable" });
    await expect(updateAutomationRuleStep({ vendorId: a.vendor.id, ruleId: hidden.id, stepId: hiddenStep.id, step: input })).resolves.toEqual({ ok: false, code: "trigger_unavailable" });
    await expect(deleteAutomationRuleStep({ vendorId: a.vendor.id, ruleId: hidden.id, stepId: hiddenStep.id })).resolves.toMatchObject({ ok: true });
  });

  it("follows §3 for people part-way through: a moved step never runs twice, an earlier new step is not back-filled, a switched-off step is skipped", async () => {
    const t = await tenant();
    const r = await rule(t);
    const s60 = await step(t, r.id, 60, [{ type: "add_customer_tag", tag: "一" }]);
    const s180 = await step(t, r.id, 180, [{ type: "add_customer_tag", tag: "三" }]);
    const s300 = await step(t, r.id, 300, [{ type: "add_customer_tag", tag: "五" }]);
    await registered(t, await registration(t));
    const run = await onlyRun(t);
    await expect(work(t, after(run.anchorAt, 61 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    const input = (delayMinutes: number, tag: string, isActive = true) => ({ delayMinutes, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag }], isActive });
    // The executed step moves after the next one: same id, so it is not run again for this person.
    await expect(updateAutomationRuleStep({ vendorId: t.vendor.id, ruleId: r.id, stepId: s60.id, step: input(240, "一") })).resolves.toMatchObject({ ok: true, id: s60.id });
    // A new step after this person's position runs at its time (the save re-times the run).
    await expect(createAutomationRuleStep({ vendorId: t.vendor.id, ruleId: r.id, step: input(120, "二") })).resolves.toMatchObject({ ok: true });
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ cursorDelayMinutes: 60, nextRunAt: after(run.anchorAt, 120 * MINUTE) });
    await expect(work(t, after(run.anchorAt, 121 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    // A new step before this person's position: never back-filled.
    await expect(createAutomationRuleStep({ vendorId: t.vendor.id, ruleId: r.id, step: input(90, "早") })).resolves.toMatchObject({ ok: true });
    // A switched-off step is skipped.
    await expect(updateAutomationRuleStep({ vendorId: t.vendor.id, ruleId: r.id, stepId: s180.id, step: input(180, "三", false) })).resolves.toMatchObject({ ok: true });
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ cursorDelayMinutes: 120, nextRunAt: after(run.anchorAt, 240 * MINUTE) });
    // At 240 the moved step meets its own execution: only the cursor moves.
    await expect(work(t, after(run.anchorAt, 241 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "skipped_already_sent" }]);
    await expect(work(t, after(run.anchorAt, 301 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    const tags = await db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id, tag: { in: ["一", "二", "三", "五", "早"] } }, select: { tag: true } });
    expect(tags.map((row) => row.tag).sort()).toEqual(["一", "二", "五"].sort());
    await expect(db.automationExecutionLog.count({ where: { id: automationStepExecutionLogId(t.vendor.id, run.id, s60.id) } })).resolves.toBe(1);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "completed" });
    void s300;
  });

  it("never deletes a rule with runs; switching it off stops them at their next step; deleting a rule without history removes its steps", async () => {
    const t = await tenant();
    const r = await rule(t);
    await step(t, r.id, 60);
    await registered(t, await registration(t));
    const run = await onlyRun(t);
    as(t);
    await expect(toggleAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow("updated=toggled");
    await expect(deleteAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow("error=delete_has_history");
    await expect(db.automationRule.count({ where: { id: r.id } })).resolves.toBe(1);
    await expect(work(t, after(run.anchorAt, 61 * MINUTE))).resolves.toEqual([{ runId: run.id, status: "cancelled", cancelReason: "definition_paused" }]);
    // A rule that never ran (and so has no run) is deleted with its steps.
    const unused = await rule(t, { isActive: false });
    const unusedStep = await step(t, unused.id, 60);
    await expect(deleteAutomationRuleAction(form({ ruleId: unused.id }))).rejects.toThrow("updated=deleted");
    await expect(db.automationRuleStep.count({ where: { id: unusedStep.id } })).resolves.toBe(0);
  });

  it("drops the runs with the vendor and keeps a round going when one run's rule disappears mid-round", async () => {
    const t = await tenant();
    const r1 = await rule(t);
    await step(t, r1.id, 60);
    const r2 = await rule(t);
    await step(t, r2.id, 60);
    await registered(t, await registration(t));
    const runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    const due = after(runs[1]!.anchorAt, 61 * MINUTE);
    // Deleting a rule directly (as a vendor cascade would) removes its steps and runs.
    await db.automationRule.delete({ where: { id: r1.id } });
    await expect(runsOf(t)).resolves.toHaveLength(1);
    await expect(work(t, due)).resolves.toEqual([{ runId: runs.find((row) => row.automationRuleId === r2.id)!.id, status: "executed" }]);
  });
});
