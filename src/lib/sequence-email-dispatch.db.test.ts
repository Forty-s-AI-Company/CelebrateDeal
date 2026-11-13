import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));

// The provider is the only fake: the queue, the send-time guard and the
// database are the real ones (the same approach as email-delivery-immediate).
vi.mock("@/lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/email")>(),
  sendTransactionalEmail: mocks.sendTransactionalEmail,
}));

import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { enrollSubmissionInEmailSequences, processDueDelayedStepRuns } from "@/lib/delayed-step-runs";
import { dispatchEmailDelivery, processDueEmailDeliveries, processDueSequenceEmailDeliveries } from "@/lib/email-delivery";
import { protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";

/**
 * F-3 step e-mails through the real dispatcher (M5), and the dispatch order
 * of S1: time-bound mail first on its own quota, sequence e-mails after it on
 * theirs.
 */

const db = getDb();
const createdVendorIds: string[] = [];
const APP_URL = "https://sequence-dispatch.example.test";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "sequence-dispatch-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  // Synthetic provider settings for the worker's check; the provider itself is the mock above.
  vi.stubEnv("RESEND_API_KEY", "re_synthetic_dispatch_test");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal <no-reply@example.test>");
  mocks.sendTransactionalEmail.mockReset();
  mocks.sendTransactionalEmail.mockImplementation(async (input: { idempotencyKey?: string }) => ({ id: `provider-${input.idempotencyKey ?? "x"}` }));
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture() {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: { name: `寄送 ${suffix}`, slug: `seq-dispatch-${suffix}`, email: `d-${suffix}@example.test`, passwordHash: "disposable", betaFeatureGrants: ["email_sequences"] },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "表", slug: `seq-dispatch-form-${suffix}`, headline: "表", fields: [] } });
  const live = await db.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "寄送直播", slug: `seq-dispatch-live-${suffix}`, scheduledAt: new Date(Date.now() + 30 * 86_400_000) } });
  const template = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "序列信", trigger: "sequence_email", subject: "{{live_title}} 下一步", body: "{{name}} 你好" },
  });
  const sequence = await db.emailSequence.create({ data: { vendorId: vendor.id, liveId: live.id, name: "序列", status: "active", activatedAt: new Date(Date.now() - 3 * 3_600_000) } });
  await db.emailSequenceStep.create({ data: { vendorId: vendor.id, emailSequenceId: sequence.id, delayMinutes: 60, messageTemplateId: template.id } });
  return { vendor, form, live, template, sequence };
}

describe("sequence e-mail dispatch", () => {
  it("sends a due step e-mail through the provider with the unsubscribe link and marks it sent", async () => {
    const f = await fixture();
    const lead = await db.formSubmission.create({
      data: { formId: f.form.id, liveId: f.live.id, name: "王小明", email: `lead-${randomUUID().slice(0, 8)}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    await expect(enrollSubmissionInEmailSequences({ vendorId: f.vendor.id, liveId: f.live.id, formSubmissionId: lead.id })).resolves.toMatchObject({ status: "enrolled" });
    await expect(processDueDelayedStepRuns({ vendorId: f.vendor.id })).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    const delivery = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: f.vendor.id, trigger: "sequence_email" } });

    await expect(dispatchEmailDelivery(delivery.id)).resolves.toEqual({ status: "sent" });
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const sent = mocks.sendTransactionalEmail.mock.calls[0]![0] as { to: string; subject: string; text: string; idempotencyKey: string };
    expect(sent.to).toBe(lead.email);
    expect(sent.subject).toBe("寄送直播 下一步");
    expect(sent.text).toContain("王小明 你好");
    expect(sent.text).toContain(`${APP_URL}/unsubscribe?token=`);
    expect(sent.idempotencyKey).toBe(delivery.idempotencyKey);
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({ status: "sent", providerMessageId: `provider-${delivery.idempotencyKey}` });
    // A second dispatch of the same row never reaches the provider again.
    await expect(dispatchEmailDelivery(delivery.id)).resolves.toEqual({ status: "not_due" });
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps sequence e-mails out of the time-bound pass and sends them on their own quota (S1, MAJOR 1)", async () => {
    const f = await fixture();
    const earlier = new Date(Date.now() - 60 * 60_000);
    const later = new Date(Date.now() - 60_000);
    const row = (trigger: string, nextAttemptAt: Date) => {
      const id = `email_${randomUUID().replace(/-/gu, "")}`;
      return {
        id,
        vendorId: f.vendor.id,
        sourceTemplateId: f.template.id,
        trigger,
        ...protectEmailDeliveryPayload({ recipientEmail: `r-${randomUUID().slice(0, 6)}@example.test`, subject: "合成", body: "合成內容" }, { vendorId: f.vendor.id, deliveryId: id }),
        idempotencyKey: `dispatch-order/${id}`,
        status: "queued",
        nextAttemptAt,
      };
    };
    // The sequence e-mails have been waiting longer than the reminder (and than anything else due).
    const sequenceRows = [row("sequence_email", new Date(1_000)), row("sequence_email", new Date(2_000))];
    // F-4: a delayed automation step e-mail is on the same quota as sequence e-mails.
    const automationStepRow = row("automation_step", new Date(1_500));
    void earlier;
    const reminder = row("registration_confirmed", later);
    await db.emailDelivery.createMany({ data: [...sequenceRows, automationStepRow, reminder] });

    const mine = (rows: Array<{ deliveryId: string; status: string }>) => rows.filter((result) => [reminder.id, automationStepRow.id, ...sequenceRows.map((entry) => entry.id)].includes(result.deliveryId));
    // The queue is shared with every other test file of the run, which may
    // leave due rows behind (CI does): size each pass from what is due now.
    const dueNow = (trigger: Prisma.EmailDeliveryWhereInput["trigger"]) => db.emailDelivery.count({
      where: {
        trigger,
        OR: [
          { status: { in: ["queued", "failed"] }, nextAttemptAt: { lte: new Date() } },
          { status: "sending", claimedAt: { lte: new Date(Date.now() - 10 * 60_000) } },
        ],
      },
    });
    // The time-bound pass never takes a sequence e-mail, however long it
    // waited: with room for everything due, it sends the reminder and none of them.
    const timeBound = await processDueEmailDeliveries((await dueNow({ notIn: ["sequence_email", "automation_step"] })) + 5);
    expect(mine(timeBound)).toEqual([{ deliveryId: reminder.id, status: "sent" }]);
    const timeBoundTriggers = await db.emailDelivery.findMany({ where: { id: { in: timeBound.map((result) => result.deliveryId) } }, select: { trigger: true } });
    expect(timeBoundTriggers.some((entry) => entry.trigger === "sequence_email" || entry.trigger === "automation_step")).toBe(false);
    // The sequence pass takes them oldest first, on its own quota. Stale leases
    // are recovered first, so leave room for those plus exactly one of ours.
    const staleSequenceLeases = await db.emailDelivery.count({ where: { trigger: { in: ["sequence_email", "automation_step"] }, status: "sending", claimedAt: { lte: new Date(Date.now() - 10 * 60_000) } } });
    const sequencePass = mine(await processDueSequenceEmailDeliveries({ limit: staleSequenceLeases + 1 }));
    expect(sequencePass).toHaveLength(1);
    expect(sequencePass[0]!.deliveryId).toBe(sequenceRows[0]!.id);
    // Its own deadline stops it before the next send.
    expect(mine(await processDueSequenceEmailDeliveries({ limit: 5, deadline: Date.now() - 1 }))).toEqual([]);
    // One sequence e-mail waits for the next round instead of taking the reminder's place.
    const waiting = await db.emailDelivery.findMany({ where: { vendorId: f.vendor.id, trigger: { in: ["sequence_email", "automation_step"] }, status: "queued" } });
    expect(waiting.map((entry) => entry.id).sort()).toEqual([automationStepRow.id, sequenceRows[1]!.id].sort());
    // The next sequence pass takes the automation step e-mail (older) before the second sequence e-mail.
    const nextPass = mine(await processDueSequenceEmailDeliveries({ limit: staleSequenceLeases + 1 }));
    expect(nextPass.map((entry) => entry.deliveryId)).toEqual([automationStepRow.id]);
  });
});
