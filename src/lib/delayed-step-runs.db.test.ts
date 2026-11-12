import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { automationCustomerKeyHash } from "@/lib/customer-key-hash";
import {
  backfillEmailSequenceEnrollments,
  DELAYED_STEP_LEASE_MS,
  DELAYED_STEP_MAX_ATTEMPTS,
  DELAYED_STEP_STALE_AFTER_MS,
  DELAYED_STEP_TEMPLATE_RETRY_MS,
  enrollSubmissionInEmailSequences,
  isCurrentSequenceEmailDelivery,
  processDueDelayedStepRuns,
  rescheduleActiveRunsForSequence,
  SEQUENCE_BACKFILL_WINDOW_MS,
} from "@/lib/delayed-step-runs";
import { dispatchEmailDelivery, isCurrentEmailDeliverySnapshot } from "@/lib/email-delivery";
import { activateEmailSequence, emailSequenceRunCounts, pauseEmailSequence, saveEmailSequence } from "@/lib/email-sequences";
import { createEmailRecipientHash, createEmailUnsubscribeToken, revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { POST as unsubscribe } from "@/app/api/email/unsubscribe/route";

/**
 * F-3 Email 追銷序列 (docs/product/delayed-steps-design.md §3-§7): enrollment,
 * the step worker, stop conditions, the send-time guard and tenant
 * boundaries, on the disposable PostgreSQL database. Every worker and
 * backfill call is scoped to the test's vendors so rows of other files never
 * change these assertions.
 */

const db = getDb();
const createdVendorIds: string[] = [];
const APP_URL = "https://sequence-test.example.test";
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "delayed-step-run-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  vi.stubEnv("RESEND_API_KEY", "");
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

const activatedAt = new Date("2026-12-01T00:00:00.000Z");
const verifiedAt = new Date("2026-12-01T01:00:00.000Z");
const at = (offsetMs: number) => new Date(verifiedAt.getTime() + offsetMs);

async function tenant(options: { grant?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `序列商家 ${suffix}`,
      slug: `sequence-${suffix}`,
      email: `merchant-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
      betaFeatureGrants: options.grant === false ? [] : ["email_sequences"],
    },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "報名表",
      slug: `sequence-form-${suffix}`,
      headline: "報名",
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      title: `序列直播 ${suffix}`,
      slug: `sequence-live-${suffix}`,
      scheduledAt: new Date("2026-12-10T12:00:00.000Z"),
      status: "scheduled",
    },
  });
  const template = async (name: string, data: Partial<{ isActive: boolean; trigger: string }> = {}) => db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name,
      trigger: data.trigger ?? "sequence_email",
      subject: `${name}：{{live_title}}`,
      body: `{{name}} 你好，這是「${name}」。\n直播：{{live_url}}\n時間：{{live_start_at}}`,
      isActive: data.isActive ?? true,
    },
  });
  const templates = [await template("第一封"), await template("第二封"), await template("第三封")];
  return { vendor, form, live, templates, template };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

async function sequence(t: Tenant, steps: Array<{ delayMinutes: number; template?: number; isActive?: boolean }>, options: { status?: string; activatedAt?: Date | null } = {}) {
  const created = await db.emailSequence.create({
    data: {
      vendorId: t.vendor.id,
      liveId: t.live.id,
      name: "報名後追銷",
      status: options.status ?? "active",
      activatedAt: options.activatedAt === undefined ? activatedAt : options.activatedAt,
    },
  });
  for (const [index, step] of steps.entries()) {
    await db.emailSequenceStep.create({
      data: {
        vendorId: t.vendor.id,
        emailSequenceId: created.id,
        delayMinutes: step.delayMinutes,
        messageTemplateId: t.templates[step.template ?? index]!.id,
        isActive: step.isActive ?? true,
      },
    });
  }
  return created;
}

async function submission(t: Tenant, options: { verifiedAt?: Date | null; email?: string; formId?: string; liveId?: string } = {}) {
  const verified = options.verifiedAt === undefined ? verifiedAt : options.verifiedAt;
  return db.formSubmission.create({
    data: {
      formId: options.formId ?? t.form.id,
      liveId: options.liveId ?? t.live.id,
      name: "王小明",
      email: options.email ?? `lead-${randomUUID().slice(0, 8)}@example.test`,
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      verifiedAt: verified,
    },
  });
}

async function enroll(t: Tenant, submissionId: string, now = at(1_000)) {
  return enrollSubmissionInEmailSequences({ vendorId: t.vendor.id, liveId: t.live.id, formSubmissionId: submissionId, now });
}

function runsOf(vendorId: string) {
  return db.delayedStepRun.findMany({ where: { vendorId }, orderBy: { createdAt: "asc" } });
}

function deliveriesOf(vendorId: string) {
  return db.emailDelivery.findMany({ where: { vendorId, trigger: "sequence_email" }, orderBy: { createdAt: "asc" } });
}

const work = (t: Tenant, now: Date) => processDueDelayedStepRuns({ now, vendorId: t.vendor.id });

describe("加入序列", () => {
  it("adds a registration verified after activation with the anchor, first due time and hashed identities only", async () => {
    const t = await tenant();
    const seq = await sequence(t, [{ delayMinutes: 60 }, { delayMinutes: 1_440 }]);
    const lead = await submission(t, { email: " Lead.Upper@Example.test " });

    await expect(enroll(t, lead.id)).resolves.toEqual({ status: "enrolled", created: 1 });
    const [run] = await runsOf(t.vendor.id);
    expect(run).toMatchObject({
      emailSequenceId: seq.id,
      formSubmissionId: lead.id,
      anchorAt: verifiedAt,
      cursorDelayMinutes: -1,
      nextRunAt: at(HOUR),
      status: "active",
      recipientHash: createEmailRecipientHash("lead.upper@example.test", t.vendor.id),
      subjectKeyHash: automationCustomerKeyHash(t.vendor.id, "lead.upper@example.test"),
    });
    expect(JSON.stringify(run)).not.toContain("example.test");
  });

  it("does not add a registration twice, also when the verify route and the backfill race", async () => {
    const t = await tenant();
    await sequence(t, [{ delayMinutes: 60 }]);
    const lead = await submission(t);
    const results = await Promise.all([
      enroll(t, lead.id),
      backfillEmailSequenceEnrollments({ now: at(1_000), vendorId: t.vendor.id }),
      enroll(t, lead.id),
    ]);
    expect(results).toBeDefined();
    expect(await runsOf(t.vendor.id)).toHaveLength(1);
    await expect(enroll(t, lead.id)).resolves.toEqual({ status: "duplicate", created: 0 });
  });

  it("never reaches back to registrations verified before the sequence was activated", async () => {
    const t = await tenant();
    await sequence(t, [{ delayMinutes: 60 }], { activatedAt: at(HOUR) });
    const before = await submission(t, { verifiedAt });
    await expect(enroll(t, before.id, at(2 * HOUR))).resolves.toEqual({ status: "no_sequence", created: 0 });
    await expect(backfillEmailSequenceEnrollments({ now: at(2 * HOUR), vendorId: t.vendor.id })).resolves.toEqual([]);
    expect(await runsOf(t.vendor.id)).toHaveLength(0);
  });

  it("skips draft and paused sequences and unverified registrations", async () => {
    const t = await tenant();
    await sequence(t, [{ delayMinutes: 60 }], { status: "draft", activatedAt: null });
    await sequence(t, [{ delayMinutes: 120 }], { status: "paused" });
    const lead = await submission(t);
    const unverified = await submission(t, { verifiedAt: null });
    await expect(enroll(t, lead.id)).resolves.toEqual({ status: "no_sequence", created: 0 });
    await expect(enroll(t, unverified.id)).resolves.toEqual({ status: "not_eligible", created: 0 });
    expect(await runsOf(t.vendor.id)).toHaveLength(0);
  });

  it("records an unsubscribed, blacklisted or unusable recipient as stopped, never active, and does not revive them", async () => {
    const t = await tenant();
    const seq = await sequence(t, [{ delayMinutes: 60 }]);
    const unsubscribed = await submission(t, { email: "gone@example.test" });
    const blocked = await submission(t, { email: "Blocked@Example.test" });
    const unusable = await submission(t, { email: "not-an-address" });
    await db.emailSuppression.create({
      data: {
        vendorId: t.vendor.id,
        recipientHash: createEmailRecipientHash("gone@example.test", t.vendor.id),
        recipientMaskedEmail: "g***@example.test",
        reason: "recipient_request",
        source: "unsubscribe_link",
      },
    });
    await db.blacklist.create({ data: { vendorId: t.vendor.id, identifier: "blocked@example.test", identifierType: "email", reason: "合成" } });

    await expect(enroll(t, unsubscribed.id)).resolves.toEqual({ status: "unsubscribed", created: 0 });
    await expect(enroll(t, blocked.id)).resolves.toEqual({ status: "blacklisted", created: 0 });
    await expect(enroll(t, unusable.id)).resolves.toEqual({ status: "subject_gone", created: 0 });
    const runs = await runsOf(t.vendor.id);
    expect(runs.map((row) => [row.formSubmissionId, row.status, row.cancelReason, row.nextRunAt])).toEqual(expect.arrayContaining([
      [unsubscribed.id, "cancelled", "unsubscribed", null],
      [blocked.id, "cancelled", "blacklisted", null],
      [unusable.id, "cancelled", "subject_gone", null],
    ]));
    expect(runs.find((row) => row.formSubmissionId === unusable.id)).toMatchObject({ recipientHash: null, subjectKeyHash: null });
    expect(await emailSequenceRunCounts(t.vendor.id)).toEqual(new Map([[seq.id, { active: 0, completed: 0, cancelled: 3 }]]));

    // Resubscribing or unblocking later does not bring them into the sequence.
    await db.emailSuppression.updateMany({ where: { vendorId: t.vendor.id }, data: { resubscribedAt: new Date() } });
    await db.blacklist.updateMany({ where: { vendorId: t.vendor.id }, data: { isActive: false, unblockedAt: new Date() } });
    await expect(enroll(t, unsubscribed.id)).resolves.toEqual({ status: "duplicate", created: 0 });
    await expect(backfillEmailSequenceEnrollments({ now: at(1_000), vendorId: t.vendor.id })).resolves.toEqual([]);
    expect((await runsOf(t.vendor.id)).every((row) => row.status === "cancelled")).toBe(true);
  });

  it("keeps backfilling past more ineligible registrations than one scan holds (S2)", async () => {
    const t = await tenant();
    await sequence(t, [{ delayMinutes: 60 }]);
    for (let index = 0; index < 6; index += 1) {
      await submission(t, { email: `broken-${index}`, verifiedAt: new Date(verifiedAt.getTime() - (10 - index) * 60_000) });
    }
    const later = await submission(t, { verifiedAt });
    const first = await backfillEmailSequenceEnrollments({ now: at(HOUR), vendorId: t.vendor.id, scanLimit: 5 });
    expect(first.map((result) => result.status)).toEqual(Array(5).fill("subject_gone"));
    const second = await backfillEmailSequenceEnrollments({ now: at(HOUR), vendorId: t.vendor.id, scanLimit: 5 });
    expect(second.map((result) => result.status)).toEqual(["subject_gone", "enrolled"]);
    expect(await runsOf(t.vendor.id)).toEqual(expect.arrayContaining([expect.objectContaining({ formSubmissionId: later.id, status: "active" })]));
    await expect(backfillEmailSequenceEnrollments({ now: at(HOUR), vendorId: t.vendor.id, scanLimit: 5 })).resolves.toEqual([]);
  });

  it("adds one person once per sequence even when they registered through two forms of the same Live (M3)", async () => {
    const t = await tenant();
    const seq = await sequence(t, [{ delayMinutes: 60 }]);
    const secondForm = await db.registrationForm.create({
      data: { vendorId: t.vendor.id, name: "第二張表", slug: `sequence-form-2-${randomUUID().slice(0, 8)}`, headline: "報名", fields: [] },
    });
    const first = await submission(t, { email: "same@example.test" });
    const second = await submission(t, { email: " Same@Example.test ", formId: secondForm.id });
    await expect(enroll(t, first.id)).resolves.toEqual({ status: "enrolled", created: 1 });
    await expect(enroll(t, second.id)).resolves.toEqual({ status: "duplicate", created: 0 });
    const runs = await runsOf(t.vendor.id);
    expect(runs.map((row) => [row.formSubmissionId, row.status, row.cancelReason])).toEqual([
      [first.id, "active", null],
      [second.id, "cancelled", "duplicate"],
    ]);
    // Neither is scanned again, and the duplicate is not counted as a person.
    await expect(backfillEmailSequenceEnrollments({ now: at(1_000), vendorId: t.vendor.id })).resolves.toEqual([]);
    expect(await emailSequenceRunCounts(t.vendor.id)).toEqual(new Map([[seq.id, { active: 1, completed: 0, cancelled: 0 }]]));
    // The database itself refuses a second active place for the same recipient.
    const third = await submission(t);
    await expect(db.delayedStepRun.create({
      data: { vendorId: t.vendor.id, emailSequenceId: seq.id, formSubmissionId: third.id, subjectKeyHash: "x", recipientHash: runs[0]!.recipientHash, anchorAt: verifiedAt, nextRunAt: verifiedAt },
    })).rejects.toMatchObject({ code: "P2002" });
  });

  it("adds nobody while the vendor lacks the email_sequences grant or is suspended", async () => {
    const closed = await tenant({ grant: false });
    await sequence(closed, [{ delayMinutes: 60 }]);
    const lead = await submission(closed);
    await expect(enroll(closed, lead.id)).resolves.toEqual({ status: "feature_disabled", created: 0 });
    await expect(backfillEmailSequenceEnrollments({ now: at(1_000), vendorId: closed.vendor.id })).resolves.toEqual([]);

    const suspended = await tenant();
    await sequence(suspended, [{ delayMinutes: 60 }]);
    const other = await submission(suspended);
    await db.vendor.update({ where: { id: suspended.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    await expect(enroll(suspended, other.id)).resolves.toEqual({ status: "feature_disabled", created: 0 });
    expect(await runsOf(closed.vendor.id)).toHaveLength(0);
    expect(await runsOf(suspended.vendor.id)).toHaveLength(0);
  });

  it("never adds another vendor's registration to a sequence (A's sequence, B's lead)", async () => {
    const a = await tenant();
    const b = await tenant();
    await sequence(a, [{ delayMinutes: 60 }]);
    const bLead = await submission(b);
    // B's registration pointing at A's Live through B's own form (FormSubmission has no vendorId).
    const crossLinked = await submission(b, { liveId: a.live.id });

    await expect(enrollSubmissionInEmailSequences({ vendorId: a.vendor.id, liveId: a.live.id, formSubmissionId: bLead.id, now: at(1_000) }))
      .resolves.toEqual({ status: "not_eligible", created: 0 });
    await expect(enrollSubmissionInEmailSequences({ vendorId: a.vendor.id, liveId: a.live.id, formSubmissionId: crossLinked.id, now: at(1_000) }))
      .resolves.toEqual({ status: "not_eligible", created: 0 });
    await expect(enrollSubmissionInEmailSequences({ vendorId: b.vendor.id, liveId: a.live.id, formSubmissionId: crossLinked.id, now: at(1_000) }))
      .resolves.toEqual({ status: "no_sequence", created: 0 });
    await backfillEmailSequenceEnrollments({ now: at(1_000), vendorId: a.vendor.id });
    expect(await runsOf(a.vendor.id)).toHaveLength(0);
    expect(await runsOf(b.vendor.id)).toHaveLength(0);
  });

  it("backfills verified registrations of the last 48 hours that have no run, once", async () => {
    const t = await tenant();
    await sequence(t, [{ delayMinutes: 60 }], { activatedAt: new Date(verifiedAt.getTime() - 3 * DAY) });
    const recent = await submission(t, { verifiedAt });
    const old = await submission(t, { verifiedAt: new Date(verifiedAt.getTime() - SEQUENCE_BACKFILL_WINDOW_MS - HOUR) });
    await submission(t, { verifiedAt: null });

    const first = await backfillEmailSequenceEnrollments({ now: at(HOUR), vendorId: t.vendor.id });
    expect(first).toEqual([{ status: "enrolled" }]);
    const runs = await runsOf(t.vendor.id);
    expect(runs.map((row) => row.formSubmissionId)).toEqual([recent.id]);
    expect(runs.some((row) => row.formSubmissionId === old.id)).toBe(false);
    await expect(backfillEmailSequenceEnrollments({ now: at(HOUR), vendorId: t.vendor.id })).resolves.toEqual([]);
  });
});

describe("worker", () => {
  async function enrolled(steps: Array<{ delayMinutes: number; template?: number; isActive?: boolean }>, options: { grant?: boolean } = {}) {
    const t = await tenant(options);
    const seq = await sequence(t, steps);
    const lead = await submission(t);
    if (options.grant === false) {
      await db.delayedStepRun.create({
        data: {
          vendorId: t.vendor.id, emailSequenceId: seq.id, formSubmissionId: lead.id, subjectKeyHash: "synthetic",
          anchorAt: verifiedAt, nextRunAt: at(steps[0]!.delayMinutes * 60_000),
        },
      });
    } else {
      await enroll(t, lead.id);
    }
    const [run] = await runsOf(t.vendor.id);
    return { t, seq, lead, run: run! };
  }

  it("leaves a run alone until its step is due", async () => {
    const { t, run } = await enrolled([{ delayMinutes: 60 }]);
    await expect(work(t, at(59 * 60_000))).resolves.toEqual([]);
    const [after] = await runsOf(t.vendor.id);
    expect(after).toMatchObject({ cursorDelayMinutes: -1, status: "active", attemptCount: 0, claimedAt: null, updatedAt: run.updatedAt });
    expect(await deliveriesOf(t.vendor.id)).toHaveLength(0);
  });

  it("queues the Nth e-mail at the Nth delay, one step per round, then completes", async () => {
    const { t, lead, run } = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 120 }, { delayMinutes: 1_440 }]);

    // Both of the first two steps are due; one round sends only the first.
    await expect(work(t, at(3 * HOUR))).resolves.toEqual([{ runId: run.id, status: "queued" }]);
    let deliveries = await deliveriesOf(t.vendor.id);
    expect(deliveries).toHaveLength(1);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: 60, nextRunAt: at(2 * HOUR), status: "active", attemptCount: 0, claimedAt: null })]);
    const first = deliveries[0]!;
    expect(first).toMatchObject({
      status: "queued",
      sourceTemplateId: t.templates[0]!.id,
      sourceLiveId: t.live.id,
      sourceFormSubmissionId: lead.id,
      recipientHash: createEmailRecipientHash(lead.email, t.vendor.id),
    });
    expect(first.idempotencyKey).toMatch(new RegExp(`^sequence-email/${run.id}/[A-Za-z0-9_-]+/${first.id}$`, "u"));
    const payload = revealEmailDeliveryPayload(first.payloadEncryptedEnvelope, { vendorId: t.vendor.id, deliveryId: first.id });
    expect(payload.subject).toBe(`第一封：${t.live.title}`);
    expect(payload.body).toContain("王小明 你好");
    expect(payload.body).toContain(`${APP_URL}/live/${t.live.slug}`);
    expect(payload.body).toContain(`退訂：${APP_URL}/unsubscribe?token=`);
    expect(payload.body).toContain(createEmailUnsubscribeToken(first.id));

    await expect(work(t, at(3 * HOUR))).resolves.toEqual([{ runId: run.id, status: "queued" }]);
    deliveries = await deliveriesOf(t.vendor.id);
    expect(deliveries.map((row) => row.sourceTemplateId)).toEqual([t.templates[0]!.id, t.templates[1]!.id]);
    // The third step is not due yet.
    await expect(work(t, at(3 * HOUR))).resolves.toEqual([]);
    await expect(work(t, at(DAY + 60_000))).resolves.toEqual([{ runId: run.id, status: "queued" }]);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ status: "completed", cursorDelayMinutes: 1_440, nextRunAt: null })]);
    expect(await deliveriesOf(t.vendor.id)).toHaveLength(3);
    await expect(work(t, at(10 * DAY))).resolves.toEqual([]);
  });

  it("skips a step overdue by more than 24 hours, only moving the cursor", async () => {
    const { t, run } = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 2 * 1_440 + 60 }]);
    const late = new Date(at(HOUR).getTime() + DELAYED_STEP_STALE_AFTER_MS + 60_000);
    await expect(work(t, late)).resolves.toEqual([{ runId: run.id, status: "skipped_stale" }]);
    expect(await deliveriesOf(t.vendor.id)).toHaveLength(0);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: 60, status: "active", nextRunAt: at(2 * DAY + HOUR) })]);
    // Exactly 24 hours late is still sent.
    const { t: t2, run: run2 } = await enrolled([{ delayMinutes: 60 }]);
    await expect(work(t2, new Date(at(HOUR).getTime() + DELAYED_STEP_STALE_AFTER_MS))).resolves.toEqual([{ runId: run2.id, status: "queued" }]);
  });

  it("follows the delay positions when steps change part-way (§3 步驟的定位方式)", async () => {
    const { t, seq, run } = await enrolled([
      { delayMinutes: 60, template: 0 },
      { delayMinutes: 1_440, template: 1 },
      { delayMinutes: 4_320, template: 0 },
      { delayMinutes: 7_200, template: 2 },
    ]);
    await work(t, at(HOUR + 60_000));
    await work(t, at(DAY + 60_000));
    expect((await deliveriesOf(t.vendor.id)).map((row) => row.sourceTemplateId)).toEqual([t.templates[0]!.id, t.templates[1]!.id]);

    // A new step earlier than the cursor is never sent to people past it.
    await db.emailSequenceStep.create({ data: { vendorId: t.vendor.id, emailSequenceId: seq.id, delayMinutes: 120, messageTemplateId: t.templates[0]!.id } });
    // Switching off the next step skips straight to the one after it.
    await db.emailSequenceStep.updateMany({ where: { emailSequenceId: seq.id, delayMinutes: 4_320 }, data: { isActive: false } });
    await rescheduleActiveRunsForSequence(db, { vendorId: t.vendor.id, emailSequenceId: seq.id, now: at(DAY + HOUR) });
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ nextRunAt: at(5 * DAY), cursorDelayMinutes: 1_440 })]);
    await expect(work(t, at(3 * DAY + 60_000))).resolves.toEqual([]);

    // Moving a later step's delay without rescheduling: the worker waits for the new time.
    await db.emailSequenceStep.updateMany({ where: { emailSequenceId: seq.id, delayMinutes: 7_200 }, data: { delayMinutes: 8_640 } });
    await expect(work(t, at(5 * DAY + 60_000))).resolves.toEqual([{ runId: run.id, status: "rescheduled" }]);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ nextRunAt: at(6 * DAY), cursorDelayMinutes: 1_440, status: "active" })]);
    await expect(work(t, at(6 * DAY + 60_000))).resolves.toEqual([{ runId: run.id, status: "queued" }]);
    expect((await deliveriesOf(t.vendor.id)).map((row) => row.sourceTemplateId)).toEqual([t.templates[0]!.id, t.templates[1]!.id, t.templates[2]!.id]);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ status: "completed", cursorDelayMinutes: 8_640 })]);
  });

  it("waits for a switched-off template instead of moving on, and skips the step only once it is 24 hours late (S4)", async () => {
    const { t, run } = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 2 * 1_440 + 60 }]);
    await db.messageTemplate.update({ where: { id: t.templates[0]!.id }, data: { isActive: false } });
    const now = at(HOUR + 60_000);
    await expect(work(t, now)).resolves.toEqual([{ runId: run.id, status: "waiting_template" }]);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({
      cursorDelayMinutes: -1, status: "active", attemptCount: 0, claimedAt: null, nextRunAt: new Date(now.getTime() + DELAYED_STEP_TEMPLATE_RETRY_MS),
    })]);
    // Switched back on before the step is a day late: it is sent after all.
    await db.messageTemplate.update({ where: { id: t.templates[0]!.id }, data: { isActive: true } });
    await expect(work(t, at(5 * HOUR))).resolves.toEqual([{ runId: run.id, status: "queued" }]);

    const late = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 2 * 1_440 + 60 }]);
    await db.messageTemplate.update({ where: { id: late.t.templates[0]!.id }, data: { isActive: false } });
    await expect(work(late.t, at(2 * HOUR))).resolves.toEqual([{ runId: late.run.id, status: "waiting_template" }]);
    await expect(work(late.t, new Date(at(HOUR).getTime() + DELAYED_STEP_STALE_AFTER_MS + 60_000))).resolves.toEqual([{ runId: late.run.id, status: "skipped_stale" }]);
    expect(await runsOf(late.t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: 60, status: "active" })]);
    expect(await deliveriesOf(late.t.vendor.id)).toHaveLength(0);
  });

  it("skips only deterministic content problems: unknown variables or a rendered mail over the limits (S3)", async () => {
    const unknownVariable = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 120 }]);
    await db.messageTemplate.update({ where: { id: unknownVariable.t.templates[0]!.id }, data: { body: "{{coupon_code}}" } });
    await expect(work(unknownVariable.t, at(HOUR + 60_000))).resolves.toEqual([{ runId: unknownVariable.run.id, status: "skipped_template" }]);
    expect(await runsOf(unknownVariable.t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: 60 })]);

    const oversized = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 120 }]);
    await db.messageTemplate.update({ where: { id: oversized.t.templates[0]!.id }, data: { body: "{{live_url}}".repeat(2_000) } });
    await expect(work(oversized.t, at(HOUR + 60_000))).resolves.toEqual([{ runId: oversized.run.id, status: "skipped_template" }]);
    expect(await deliveriesOf(oversized.t.vendor.id)).toHaveLength(0);
  });

  it("keeps the step and retries it through the lease when configuration is missing (S3)", async () => {
    const { t, run } = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 120 }]);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    await expect(work(t, at(HOUR + 60_000))).resolves.toEqual([{ runId: run.id, status: "failed" }]);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: -1, status: "active", attemptCount: 1 })]);
    expect(await deliveriesOf(t.vendor.id)).toHaveLength(0);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
    await expect(work(t, new Date(at(HOUR + 60_000).getTime() + DELAYED_STEP_LEASE_MS))).resolves.toEqual([{ runId: run.id, status: "queued" }]);
  });

  it("never sends a step twice to the same person: moving a sent step later or swapping two steps through the editor (B1)", async () => {
    const t = await tenant();
    const created = await saveEmailSequence({
      vendorId: t.vendor.id, sequenceId: null, expectedVersion: null, now: activatedAt,
      data: { name: "報名後追銷", liveId: t.live.id, steps: [{ id: null, delayMinutes: 60, messageTemplateId: t.templates[0]!.id, isActive: true }, { id: null, delayMinutes: 1_440, messageTemplateId: t.templates[1]!.id, isActive: true }] },
    });
    if (!created.ok) throw new Error("create failed");
    await activateEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now: activatedAt });
    const lead = await submission(t);
    await enroll(t, lead.id);
    await work(t, at(HOUR + 60_000));
    const [stepA, stepB] = await db.emailSequenceStep.findMany({ where: { emailSequenceId: created.id }, orderBy: { delayMinutes: "asc" } });

    // A (already sent at 1 hour) moves to 3 days: same step id, never sent again.
    await expect(saveEmailSequence({
      vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 2, now: at(2 * HOUR),
      data: { name: "報名後追銷", liveId: t.live.id, steps: [{ id: stepA!.id, delayMinutes: 4_320, messageTemplateId: t.templates[0]!.id, isActive: true }, { id: stepB!.id, delayMinutes: 1_440, messageTemplateId: t.templates[1]!.id, isActive: true }] },
    })).resolves.toMatchObject({ ok: true });
    const moved = await db.emailSequenceStep.findMany({ where: { emailSequenceId: created.id }, orderBy: { delayMinutes: "asc" } });
    expect(moved.map((step) => [step.id, step.delayMinutes])).toEqual([[stepB!.id, 1_440], [stepA!.id, 4_320]]);
    await expect(work(t, at(DAY + 60_000))).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(work(t, at(3 * DAY + 60_000))).resolves.toEqual([expect.objectContaining({ status: "skipped_already_sent" })]);
    expect((await deliveriesOf(t.vendor.id)).map((row) => row.sourceTemplateId)).toEqual([t.templates[0]!.id, t.templates[1]!.id]);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ status: "completed" })]);

    // Swapping two steps: the step moved before someone's position is not sent to them (§3), and nothing is sent twice.
    const t2 = await tenant();
    const swap = await saveEmailSequence({
      vendorId: t2.vendor.id, sequenceId: null, expectedVersion: null, now: activatedAt,
      data: { name: "互換", liveId: t2.live.id, steps: [{ id: null, delayMinutes: 60, messageTemplateId: t2.templates[0]!.id, isActive: true }, { id: null, delayMinutes: 1_440, messageTemplateId: t2.templates[1]!.id, isActive: true }] },
    });
    if (!swap.ok) throw new Error("create failed");
    await activateEmailSequence({ vendorId: t2.vendor.id, sequenceId: swap.id, expectedVersion: 1, now: activatedAt });
    await enroll(t2, (await submission(t2)).id);
    await work(t2, at(HOUR + 60_000));
    const [a2, b2] = await db.emailSequenceStep.findMany({ where: { emailSequenceId: swap.id }, orderBy: { delayMinutes: "asc" } });
    await expect(saveEmailSequence({
      vendorId: t2.vendor.id, sequenceId: swap.id, expectedVersion: 2, now: at(2 * HOUR),
      data: { name: "互換", liveId: t2.live.id, steps: [{ id: a2!.id, delayMinutes: 1_440, messageTemplateId: t2.templates[0]!.id, isActive: true }, { id: b2!.id, delayMinutes: 60, messageTemplateId: t2.templates[1]!.id, isActive: true }] },
    })).resolves.toMatchObject({ ok: true });
    const swapped = await db.emailSequenceStep.findMany({ where: { emailSequenceId: swap.id }, orderBy: { delayMinutes: "asc" } });
    expect(swapped.map((step) => step.id)).toEqual([b2!.id, a2!.id]);
    await expect(work(t2, at(DAY + 60_000))).resolves.toEqual([expect.objectContaining({ status: "skipped_already_sent" })]);
    await expect(work(t2, at(10 * DAY))).resolves.toEqual([]);
    expect((await deliveriesOf(t2.vendor.id)).map((row) => row.sourceTemplateId)).toEqual([t2.templates[0]!.id]);
  });

  it("drops its result when the merchant saves the steps while it runs, and recomputes next round (M1)", async () => {
    const { t, seq, run } = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 1_440 }]);
    let release: () => void = () => undefined;
    let markLocked: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => { markLocked = resolve; });
    const holder = db.$transaction(async (tx) => {
      // A save in progress: the sequence row is locked and its version moves on.
      await tx.emailSequence.update({ where: { id: seq.id }, data: { version: { increment: 1 } } });
      await tx.emailSequenceStep.updateMany({ where: { emailSequenceId: seq.id, delayMinutes: 1_440 }, data: { delayMinutes: 2_880 } });
      markLocked();
      await new Promise<void>((resolve) => { release = resolve; });
    }, { timeout: 20_000 });
    await locked;
    const racing = work(t, at(HOUR + 60_000));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    release();
    await holder;
    await expect(racing).resolves.toEqual([{ runId: run.id, status: "definition_changed" }]);
    expect(await deliveriesOf(t.vendor.id)).toHaveLength(0);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: -1, claimedAt: null, attemptCount: 0, status: "active" })]);
    await expect(work(t, at(HOUR + 2 * 60_000))).resolves.toEqual([{ runId: run.id, status: "queued" }]);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: 60, nextRunAt: at(2 * DAY) })]);
  });

  it("does not continue a run that was added while the sequence was paused (resume re-anchors activation)", async () => {
    const { t, seq, run } = await enrolled([{ delayMinutes: 60 }]);
    await pauseEmailSequence({ vendorId: t.vendor.id, sequenceId: seq.id, expectedVersion: 1 });
    // An enrollment that raced the pause and left an active run behind.
    await db.delayedStepRun.update({ where: { id: run.id }, data: { status: "active", cancelReason: null, nextRunAt: at(HOUR) } });
    await activateEmailSequence({ vendorId: t.vendor.id, sequenceId: seq.id, expectedVersion: 2, now: at(30 * 60_000) });
    await expect(work(t, at(2 * HOUR))).resolves.toEqual([{ runId: run.id, status: "cancelled", cancelReason: "definition_paused" }]);
    expect(await deliveriesOf(t.vendor.id)).toHaveLength(0);
  });

  it("caps the e-mails one round creates, per vendor and in total, and leaves the rest untouched for the next round (S1)", async () => {
    const big = await tenant();
    await sequence(big, [{ delayMinutes: 60 }]);
    for (let index = 0; index < 4; index += 1) await enroll(big, (await submission(big)).id);
    const small = await tenant();
    await sequence(small, [{ delayMinutes: 60 }]);
    await enroll(small, (await submission(small)).id);
    const now = at(HOUR + 60_000);
    const results = await processDueDelayedStepRuns({ now, budget: { emails: 3, emailsPerVendor: 2 } });
    expect(results.filter((result) => result.status === "queued")).toHaveLength(3);
    expect(await deliveriesOf(big.vendor.id)).toHaveLength(2);
    expect(await deliveriesOf(small.vendor.id)).toHaveLength(1);
    const waiting = (await runsOf(big.vendor.id)).filter((row) => row.cursorDelayMinutes === -1);
    expect(waiting).toHaveLength(2);
    expect(waiting.every((row) => row.nextRunAt?.getTime() === at(HOUR).getTime() && row.attemptCount === 0 && row.claimedAt === null)).toBe(true);
    await processDueDelayedStepRuns({ now, budget: { emails: 3, emailsPerVendor: 2 } });
    expect(await deliveriesOf(big.vendor.id)).toHaveLength(4);
  });

  it("reclaims a lease only after it expired, and cancels after the attempt limit", async () => {
    const { t, run } = await enrolled([{ delayMinutes: 60 }]);
    const now = at(2 * HOUR);
    await db.delayedStepRun.update({ where: { id: run.id }, data: { claimedAt: new Date(now.getTime() - DELAYED_STEP_LEASE_MS + 60_000), attemptCount: 1 } });
    await expect(work(t, now)).resolves.toEqual([]);
    await db.delayedStepRun.update({ where: { id: run.id }, data: { claimedAt: new Date(now.getTime() - DELAYED_STEP_LEASE_MS), attemptCount: 2 } });
    await expect(work(t, now)).resolves.toEqual([{ runId: run.id, status: "queued" }]);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ status: "completed", attemptCount: 0, claimedAt: null })]);

    const { t: t2, run: run2 } = await enrolled([{ delayMinutes: 60 }]);
    await db.delayedStepRun.update({
      where: { id: run2.id },
      data: { claimedAt: new Date(now.getTime() - DELAYED_STEP_LEASE_MS - 1), attemptCount: DELAYED_STEP_MAX_ATTEMPTS },
    });
    await expect(work(t2, now)).resolves.toEqual([{ runId: run2.id, status: "cancelled", cancelReason: "failed" }]);
    expect(await runsOf(t2.vendor.id)).toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "failed", nextRunAt: null })]);
    expect(await deliveriesOf(t2.vendor.id)).toHaveLength(0);
  });

  it("sends one e-mail when two workers race for the same due step", async () => {
    const { t } = await enrolled([{ delayMinutes: 60 }, { delayMinutes: 1_440 }]);
    const now = at(HOUR + 60_000);
    const [left, right] = await Promise.all([work(t, now), work(t, now)]);
    const statuses = [...left, ...right].map((result) => result.status).sort();
    expect(statuses.filter((status) => status === "queued")).toHaveLength(1);
    expect(statuses.every((status) => status === "queued" || status === "claimed_elsewhere")).toBe(true);
    expect(await deliveriesOf(t.vendor.id)).toHaveLength(1);
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: 60, status: "active" })]);
  });

  it("does not pick up runs of a suspended vendor or of a vendor whose grant was closed; the runs stay", async () => {
    const suspended = await enrolled([{ delayMinutes: 60 }]);
    await db.vendor.update({ where: { id: suspended.t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    const closed = await enrolled([{ delayMinutes: 60 }], { grant: false });
    const now = at(2 * HOUR);
    await expect(work(suspended.t, now)).resolves.toEqual([]);
    await expect(work(closed.t, now)).resolves.toEqual([]);
    expect(await runsOf(suspended.t.vendor.id)).toEqual([expect.objectContaining({ status: "active", cursorDelayMinutes: -1, attemptCount: 0 })]);
    expect(await runsOf(closed.t.vendor.id)).toEqual([expect.objectContaining({ status: "active", cursorDelayMinutes: -1, attemptCount: 0 })]);

    // Lifting the suspension lets the run continue where it was.
    await db.vendor.update({ where: { id: suspended.t.vendor.id }, data: { suspendedAt: null, suspendedReason: null } });
    await expect(work(suspended.t, now)).resolves.toEqual([{ runId: suspended.run.id, status: "queued" }]);
  });

  it("stops at the step time on unsubscribe, blacklist and a paused sequence", async () => {
    const unsubscribed = await enrolled([{ delayMinutes: 60 }]);
    await db.emailSuppression.create({
      data: {
        vendorId: unsubscribed.t.vendor.id,
        recipientHash: createEmailRecipientHash(unsubscribed.lead.email, unsubscribed.t.vendor.id),
        recipientMaskedEmail: "l***@example.test",
        reason: "recipient_request",
        source: "unsubscribe_link",
      },
    });
    const blacklisted = await enrolled([{ delayMinutes: 60 }]);
    await db.blacklist.create({ data: { vendorId: blacklisted.t.vendor.id, identifier: blacklisted.lead.email, identifierType: "email", reason: "合成" } });
    const paused = await enrolled([{ delayMinutes: 60 }]);
    await db.emailSequence.update({ where: { id: paused.seq.id }, data: { status: "paused" } });

    const now = at(2 * HOUR);
    await expect(work(unsubscribed.t, now)).resolves.toEqual([{ runId: unsubscribed.run.id, status: "cancelled", cancelReason: "unsubscribed" }]);
    await expect(work(blacklisted.t, now)).resolves.toEqual([{ runId: blacklisted.run.id, status: "cancelled", cancelReason: "blacklisted" }]);
    await expect(work(paused.t, now)).resolves.toEqual([{ runId: paused.run.id, status: "cancelled", cancelReason: "definition_paused" }]);
    for (const fixture of [unsubscribed, blacklisted, paused]) expect(await deliveriesOf(fixture.t.vendor.id)).toHaveLength(0);

    // Resuming the sequence does not bring the cancelled run back.
    await db.emailSequence.update({ where: { id: paused.seq.id }, data: { status: "active", activatedAt: now } });
    await expect(work(paused.t, at(3 * HOUR))).resolves.toEqual([]);
    expect(await runsOf(paused.t.vendor.id)).toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "definition_paused" })]);
  });

  it("removes the run with a deleted registration or a deleted sequence", async () => {
    const goneLead = await enrolled([{ delayMinutes: 60 }]);
    await db.formSubmission.delete({ where: { id: goneLead.lead.id } });
    expect(await runsOf(goneLead.t.vendor.id)).toHaveLength(0);
    const goneSequence = await enrolled([{ delayMinutes: 60 }]);
    await db.emailSequence.delete({ where: { id: goneSequence.seq.id } });
    expect(await runsOf(goneSequence.t.vendor.id)).toHaveLength(0);
    await expect(work(goneLead.t, at(2 * HOUR))).resolves.toEqual([]);
  });

  it("never reads or writes another vendor's runs", async () => {
    const a = await enrolled([{ delayMinutes: 60 }]);
    const b = await enrolled([{ delayMinutes: 60 }]);
    await expect(work(a.t, at(2 * HOUR))).resolves.toEqual([{ runId: a.run.id, status: "queued" }]);
    expect(await runsOf(b.t.vendor.id)).toEqual([expect.objectContaining({ cursorDelayMinutes: -1, status: "active", attemptCount: 0 })]);
    expect(await deliveriesOf(b.t.vendor.id)).toHaveLength(0);
    const [delivery] = await deliveriesOf(a.t.vendor.id);
    expect(delivery!.vendorId).toBe(a.t.vendor.id);
  });

  it("rejects another vendor's template or sequence on a step, and a run on another vendor's sequence", async () => {
    const a = await tenant();
    const b = await tenant();
    const bSequence = await sequence(b, [{ delayMinutes: 60 }]);
    await expect(db.emailSequenceStep.create({
      data: { vendorId: b.vendor.id, emailSequenceId: bSequence.id, delayMinutes: 120, messageTemplateId: a.templates[0]!.id },
    })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.emailSequence.create({ data: { vendorId: a.vendor.id, liveId: b.live.id, name: "跨租戶" } })).rejects.toMatchObject({ code: "P2003" });
    const aLead = await submission(a);
    await expect(db.delayedStepRun.create({
      data: { vendorId: a.vendor.id, emailSequenceId: bSequence.id, formSubmissionId: aLead.id, subjectKeyHash: "x", anchorAt: verifiedAt, nextRunAt: verifiedAt },
    })).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("寄送前檢查與退訂", () => {
  async function queued() {
    const t = await tenant();
    const seq = await sequence(t, [{ delayMinutes: 60 }, { delayMinutes: 1_440 }]);
    const lead = await submission(t);
    await enroll(t, lead.id);
    await work(t, at(HOUR + 60_000));
    const [delivery] = await deliveriesOf(t.vendor.id);
    const [run] = await runsOf(t.vendor.id);
    return { t, seq, lead, delivery: delivery!, run: run! };
  }

  it("passes for the current step, also through the shared snapshot guard and without the idempotency key", async () => {
    const { delivery } = await queued();
    await expect(isCurrentEmailDeliverySnapshot(delivery, at(HOUR + 60_000))).resolves.toBe(true);
    const { idempotencyKey: ignored, ...withoutKey } = delivery;
    void ignored;
    const sendAt = at(HOUR + 2 * 60_000);
    await expect(isCurrentSequenceEmailDelivery({ ...withoutKey }, sendAt, db)).resolves.toBe(true);
    await expect(isCurrentSequenceEmailDelivery({ ...delivery, idempotencyKey: "sequence-email/forged" }, sendAt, db)).resolves.toBe(false);
  });

  it("supersedes a step e-mail still unsent 24 hours after it was created, and any once the grant is closed (S1, M2)", async () => {
    const { t, delivery } = await queued();
    expect(delivery.createdAt).toEqual(at(HOUR + 60_000));
    await expect(isCurrentSequenceEmailDelivery(delivery, new Date(delivery.createdAt.getTime() + DELAYED_STEP_STALE_AFTER_MS), db)).resolves.toBe(true);
    await expect(isCurrentSequenceEmailDelivery(delivery, new Date(delivery.createdAt.getTime() + DELAYED_STEP_STALE_AFTER_MS + 1), db)).resolves.toBe(false);
    await expect(isCurrentSequenceEmailDelivery({ ...delivery, createdAt: undefined }, at(HOUR + 2 * 60_000), db)).resolves.toBe(false);
    await db.vendor.update({ where: { id: t.vendor.id }, data: { betaFeatureGrants: [] } });
    await expect(isCurrentEmailDeliverySnapshot(delivery, at(HOUR + 2 * 60_000))).resolves.toBe(false);
  });

  it("supersedes when the sequence is paused, the step or template changed, the run was cancelled or the recipient is blacklisted", async () => {
    const paused = await queued();
    await db.emailSequence.update({ where: { id: paused.seq.id }, data: { status: "paused" } });
    await expect(isCurrentEmailDeliverySnapshot(paused.delivery)).resolves.toBe(false);

    const stepOff = await queued();
    await db.emailSequenceStep.updateMany({ where: { emailSequenceId: stepOff.seq.id, delayMinutes: 60 }, data: { isActive: false } });
    await expect(isCurrentEmailDeliverySnapshot(stepOff.delivery)).resolves.toBe(false);

    const edited = await queued();
    await db.messageTemplate.update({ where: { id: edited.t.templates[0]!.id }, data: { body: "改過的內容 {{unsubscribe_url}}" } });
    await expect(isCurrentEmailDeliverySnapshot(edited.delivery)).resolves.toBe(false);

    const templateOff = await queued();
    await db.messageTemplate.update({ where: { id: templateOff.t.templates[0]!.id }, data: { isActive: false } });
    await expect(isCurrentEmailDeliverySnapshot(templateOff.delivery)).resolves.toBe(false);

    const cancelled = await queued();
    await db.delayedStepRun.update({ where: { id: cancelled.run.id }, data: { status: "cancelled", cancelReason: "definition_paused", nextRunAt: null } });
    await expect(isCurrentEmailDeliverySnapshot(cancelled.delivery)).resolves.toBe(false);

    const blocked = await queued();
    await db.blacklist.create({ data: { vendorId: blocked.t.vendor.id, identifier: blocked.lead.email, identifierType: "email", reason: "合成" } });
    await expect(isCurrentEmailDeliverySnapshot(blocked.delivery)).resolves.toBe(false);
    // The fixture clock is ahead of the wall clock the dispatcher reads.
    await db.emailDelivery.update({ where: { id: blocked.delivery.id }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });
    await expect(dispatchEmailDelivery(blocked.delivery.id)).resolves.toEqual({ status: "superseded" });
    await expect(db.emailDelivery.findUnique({ where: { id: blocked.delivery.id } })).resolves.toMatchObject({ status: "superseded", lastErrorCode: "sequence_superseded" });

    const deleted = await queued();
    await db.emailSequence.delete({ where: { id: deleted.seq.id } });
    await expect(isCurrentEmailDeliverySnapshot(deleted.delivery)).resolves.toBe(false);
  });

  it("is still current after the last step completed the run", async () => {
    const t = await tenant();
    await sequence(t, [{ delayMinutes: 60 }]);
    const lead = await submission(t);
    await enroll(t, lead.id);
    await work(t, at(HOUR + 60_000));
    expect(await runsOf(t.vendor.id)).toEqual([expect.objectContaining({ status: "completed" })]);
    const [delivery] = await deliveriesOf(t.vendor.id);
    await expect(isCurrentEmailDeliverySnapshot(delivery!)).resolves.toBe(true);
  });

  it("unsubscribing cancels the recipient's runs at this vendor only, in the same request, and later steps are never queued", async () => {
    const { t, delivery, run, lead } = await queued();
    // Same person, another sequence of the same vendor.
    const otherLive = await db.live.create({
      data: { vendorId: t.vendor.id, formId: t.form.id, title: "另一場", slug: `sequence-other-${randomUUID().slice(0, 8)}`, scheduledAt: new Date("2026-12-20T12:00:00.000Z") },
    });
    const otherSequence = await db.emailSequence.create({ data: { vendorId: t.vendor.id, liveId: otherLive.id, name: "另一條", status: "active", activatedAt } });
    await db.emailSequenceStep.create({ data: { vendorId: t.vendor.id, emailSequenceId: otherSequence.id, delayMinutes: 60, messageTemplateId: t.templates[1]!.id } });
    const sameEmail = await submission(t, { liveId: otherLive.id, email: lead.email.toUpperCase() });
    await enrollSubmissionInEmailSequences({ vendorId: t.vendor.id, liveId: otherLive.id, formSubmissionId: sameEmail.id, now: at(1_000) });
    // The same address at another vendor keeps its run.
    const elsewhere = await tenant();
    await sequence(elsewhere, [{ delayMinutes: 60 }]);
    const elsewhereLead = await submission(elsewhere, { email: lead.email });
    await enroll(elsewhere, elsewhereLead.id);

    const response = await unsubscribe(new Request(`${APP_URL}/api/email/unsubscribe`, {
      method: "POST",
      headers: { origin: APP_URL, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: createEmailUnsubscribeToken(delivery.id) }),
    }));
    expect(response.headers.get("location")).toBe(`${APP_URL}/unsubscribe?status=done`);

    const runs = await runsOf(t.vendor.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((row) => row.status === "cancelled" && row.cancelReason === "unsubscribed" && row.nextRunAt === null)).toBe(true);
    await expect(db.emailDelivery.findUnique({ where: { id: delivery.id } })).resolves.toMatchObject({ status: "suppressed" });
    expect(await runsOf(elsewhere.vendor.id)).toEqual([expect.objectContaining({ status: "active" })]);

    await expect(work(t, at(2 * DAY))).resolves.toEqual([]);
    expect((await deliveriesOf(t.vendor.id)).map((row) => row.id)).toEqual([delivery.id]);
    expect(run.status).toBe("active");
  });
});
