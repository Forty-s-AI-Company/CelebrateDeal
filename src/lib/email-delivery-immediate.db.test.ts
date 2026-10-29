import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
  sendTransactionalEmail: vi.fn(),
}));

// Capture post-response callbacks so the test decides when the "response has
// finished". The real `after` throws outside a Next.js request scope.
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    mocks.afterCallbacks.push(callback);
  },
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/email")>(),
  sendTransactionalEmail: mocks.sendTransactionalEmail,
}));

import { getDb } from "@/lib/db";
import { TransactionalEmailError } from "@/lib/email";
import {
  dispatchEmailDelivery,
  ensureLiveReminderDelivery,
  ensureRegistrationConfirmationDelivery,
} from "@/lib/email-delivery";
import {
  dispatchEmailDeliveriesNow,
  IMMEDIATE_EMAIL_DISPATCH_ACTOR,
  isImmediateEmailDelivery,
  scheduleImmediateEmailDispatch,
} from "@/lib/email-delivery-immediate";

const createdVendorIds: string[] = [];

async function runAfterCallbacks() {
  const callbacks = mocks.afterCallbacks.splice(0);
  for (const callback of callbacks) await callback();
  return callbacks.length;
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "immediate-dispatch-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://immediate-dispatch.example.test");
  mocks.afterCallbacks.length = 0;
  mocks.sendTransactionalEmail.mockReset();
  mocks.sendTransactionalEmail.mockImplementation(async (input: { idempotencyKey?: string }) => ({
    id: `provider-${input.idempotencyKey ?? "none"}`,
  }));
});

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function createVendor() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vendor = await getDb().vendor.create({
    data: {
      name: `Immediate Dispatch Vendor ${suffix}`,
      slug: `immediate-dispatch-${suffix}`,
      email: `immediate-dispatch-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  return vendor;
}

function confirmationInput(vendor: { id: string; name: string }, submissionId: string) {
  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    liveId: "disposable-live-immediate",
    liveSlug: "disposable-live-immediate",
    liveTitle: "Disposable immediate live",
    formSubmissionId: submissionId,
    recipientName: "Disposable Lead",
    recipientEmail: "disposable-immediate@example.test",
    liveScheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    template: {
      id: "disposable-immediate-template",
      vendorId: vendor.id,
      channel: "email",
      trigger: "registration_confirmed",
      subject: "Registration confirmed",
      body: "Hello {{name}} {{unsubscribe_url}}",
      isActive: true,
    },
  };
}

async function queuedConfirmation(vendor: { id: string; name: string }, submissionId: string) {
  const created = await ensureRegistrationConfirmationDelivery(confirmationInput(vendor, submissionId));
  if (created.status !== "queued") throw new Error(`Expected a queued delivery, got ${created.status}.`);
  return created.deliveryId;
}

describe("immediate email dispatch against the disposable database", () => {
  it("sends a send-now delivery exactly once through the post-response hook", async () => {
    const vendor = await createVendor();
    const deliveryId = await queuedConfirmation(vendor, "submission-immediate-1");

    // Scheduling twice (duplicate ids, or two code paths) still sends once.
    expect(scheduleImmediateEmailDispatch([deliveryId, deliveryId, null])).toBe(true);
    expect(scheduleImmediateEmailDispatch([deliveryId])).toBe(true);
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(await getDb().emailDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { status: true } }))
      .toEqual({ status: "queued" });

    expect(await runAfterCallbacks()).toBe(2);

    expect(mocks.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "disposable-immediate@example.test",
      idempotencyKey: `registration-confirmed/${deliveryId}`,
    }));
    const row = await getDb().emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(row).toMatchObject({ status: "sent", attemptCount: 1, nextAttemptAt: null, claimedAt: null });
    expect(await getDb().auditLog.count({
      where: { vendorId: vendor.id, targetId: deliveryId, action: "email_delivery_sent", actorLabel: IMMEDIATE_EMAIL_DISPATCH_ACTOR },
    })).toBe(1);

    // The job afterwards finds nothing left to send for this row.
    await expect(dispatchEmailDelivery(deliveryId)).resolves.toEqual({ status: "not_due" });
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("leaves a future live reminder to the job even if a hook tries to dispatch it", async () => {
    const vendor = await createVendor();
    const now = new Date();
    const reminder = await ensureLiveReminderDelivery({
      ...confirmationInput(vendor, "submission-immediate-reminder"),
      liveScheduledAt: new Date(now.getTime() + 3 * 60 * 60_000),
      reminderOffsetMinutes: 60,
      template: {
        ...confirmationInput(vendor, "submission-immediate-reminder").template,
        id: "disposable-immediate-reminder-template",
        trigger: "live_reminder",
        subject: "{{live_title}} starts soon",
      },
    }, now);
    if (reminder.status !== "scheduled") throw new Error(`Expected a scheduled reminder, got ${reminder.status}.`);

    expect(isImmediateEmailDelivery(reminder.nextAttemptAt, now)).toBe(false);
    // Defence in depth: the shared dispatcher refuses a row that is not yet due.
    await expect(dispatchEmailDeliveriesNow([reminder.deliveryId])).resolves.toEqual([
      { deliveryId: reminder.deliveryId, status: "not_due" },
    ]);
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(await getDb().emailDelivery.findUniqueOrThrow({
      where: { id: reminder.deliveryId },
      select: { status: true, attemptCount: true, nextAttemptAt: true },
    })).toEqual({ status: "queued", attemptCount: 0, nextAttemptAt: reminder.nextAttemptAt });
  });

  it("sends exactly once when the job and the hook race for the same rows", async () => {
    const vendor = await createVendor();
    const deliveryIds = await Promise.all([1, 2, 3, 4, 5].map((index) => queuedConfirmation(vendor, `submission-race-${index}`)));
    // Hold the provider call open so every racer reaches the claim step while
    // the first claimant is still sending.
    mocks.sendTransactionalEmail.mockImplementation(async (input: { idempotencyKey?: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { id: `provider-${input.idempotencyKey ?? "none"}` };
    });

    const settled = await Promise.all(deliveryIds.flatMap((deliveryId) => [
      dispatchEmailDelivery(deliveryId),
      dispatchEmailDeliveriesNow([deliveryId]).then(([result]) => result),
      dispatchEmailDelivery(deliveryId),
      dispatchEmailDeliveriesNow([deliveryId]).then(([result]) => result),
    ]));

    expect(mocks.sendTransactionalEmail).toHaveBeenCalledTimes(deliveryIds.length);
    const sentKeys = mocks.sendTransactionalEmail.mock.calls.map(([input]) => (input as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(sentKeys).size).toBe(deliveryIds.length);
    expect(settled.filter((result) => result?.status === "sent")).toHaveLength(deliveryIds.length);
    expect(settled.every((result) => ["sent", "claimed_elsewhere", "not_due"].includes(result?.status ?? ""))).toBe(true);
    const rows = await getDb().emailDelivery.findMany({
      where: { id: { in: deliveryIds } },
      select: { status: true, attemptCount: true },
    });
    expect(rows).toHaveLength(deliveryIds.length);
    expect(rows.every((row) => row.status === "sent" && row.attemptCount === 1)).toBe(true);
    expect(await getDb().auditLog.count({
      where: { vendorId: vendor.id, targetId: { in: deliveryIds }, action: "email_delivery_sent" },
    })).toBe(deliveryIds.length);
  });

  it("keeps a row retryable for the job when the hook's provider call fails", async () => {
    const vendor = await createVendor();
    const deliveryId = await queuedConfirmation(vendor, "submission-immediate-failure");
    mocks.sendTransactionalEmail.mockRejectedValueOnce(new TransactionalEmailError("network"));

    scheduleImmediateEmailDispatch([deliveryId]);
    // The hook never rejects, so the already-sent response is unaffected.
    await expect(runAfterCallbacks()).resolves.toBe(1);

    const failed = await getDb().emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(failed).toMatchObject({ status: "failed", attemptCount: 1, claimedAt: null, lastErrorCode: "network" });
    expect(failed.nextAttemptAt).toBeInstanceOf(Date);
    expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // Once its backoff elapses, the job retries and sends it exactly once.
    await getDb().emailDelivery.update({ where: { id: deliveryId }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });
    await expect(dispatchEmailDelivery(deliveryId)).resolves.toEqual({ status: "sent" });
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(await getDb().emailDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: { status: true, attemptCount: true },
    })).toEqual({ status: "sent", attemptCount: 2 });
  });
});
