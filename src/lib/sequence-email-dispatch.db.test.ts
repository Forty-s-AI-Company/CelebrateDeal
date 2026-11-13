import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));

// The provider is the only fake: the queue, the send-time guard and the
// database are the real ones (the same approach as email-delivery-immediate).
vi.mock("@/lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/email")>(),
  sendTransactionalEmail: mocks.sendTransactionalEmail,
}));

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
    // The sequence e-mails have been waiting longer than the reminder.
    const sequenceRows = [row("sequence_email", earlier), row("sequence_email", earlier)];
    const reminder = row("registration_confirmed", later);
    await db.emailDelivery.createMany({ data: [...sequenceRows, reminder] });

    const mine = (rows: Array<{ deliveryId: string; status: string }>) => rows.filter((result) => [reminder.id, ...sequenceRows.map((entry) => entry.id)].includes(result.deliveryId));
    // The time-bound pass never takes a sequence e-mail, however long it waited.
    expect(mine(await processDueEmailDeliveries(1))).toEqual([{ deliveryId: reminder.id, status: "sent" }]);
    const sequencePass = mine(await processDueSequenceEmailDeliveries({ limit: 1 }));
    expect(sequencePass).toHaveLength(1);
    expect(sequenceRows.map((entry) => entry.id)).toContain(sequencePass[0]!.deliveryId);
    // Its own deadline stops it before the next send.
    expect(mine(await processDueSequenceEmailDeliveries({ limit: 5, deadline: Date.now() - 1 }))).toEqual([]);
    // One sequence e-mail waits for the next round instead of taking the reminder's place.
    const waiting = await db.emailDelivery.findMany({ where: { vendorId: f.vendor.id, trigger: "sequence_email", status: "queued" } });
    expect(waiting).toHaveLength(1);
  });
});
