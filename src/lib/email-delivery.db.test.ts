import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { createEmailRecipientHash } from "@/lib/email-delivery-pii";
import {
  ensureLiveReminderDelivery,
  ensureRegistrationConfirmationDelivery,
} from "@/lib/email-delivery";
import {
  loadEmailDeliverySearchResult,
  requeueEmailDelivery,
} from "@/lib/email-delivery-operations";

const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "g7-07-disposable-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://g7-07.example.test");
});

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function createVendor() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vendor = await getDb().vendor.create({
    data: {
      name: `G7-07 Email Vendor ${suffix}`,
      slug: `g7-07-email-${suffix}`,
      email: `g7-07-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  return vendor;
}

function deliveryInput(vendor: { id: string; name: string }, submissionId: string) {
  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    liveId: "disposable-live-1",
    liveSlug: "disposable-live-one",
    liveTitle: "Disposable live",
    formSubmissionId: submissionId,
    recipientName: "Disposable Lead",
    recipientEmail: "disposable-lead@example.test",
    liveScheduledAt: new Date("2026-08-10T04:00:00.000Z"),
    template: {
      id: "disposable-template-1",
      vendorId: vendor.id,
      channel: "email",
      trigger: "registration_confirmed",
      subject: "Registration confirmed",
      body: "Hello {{name}} {{unsubscribe_url}}",
      isActive: true,
    },
  };
}

describe("email delivery disposable database invariants", () => {
  it("persists one idempotent delivery and tenant-scoped suppression state", async () => {
    const vendor = await createVendor();

    const first = await ensureRegistrationConfirmationDelivery(deliveryInput(vendor, "submission-1"));
    const duplicate = await ensureRegistrationConfirmationDelivery(deliveryInput(vendor, "submission-1"));
    expect(first.status).toBe("queued");
    expect(duplicate.status).toBe("duplicate");
    expect(await getDb().emailDelivery.count({ where: { vendorId: vendor.id } })).toBe(1);

    const recipientHash = createEmailRecipientHash("disposable-lead@example.test", vendor.id);
    await getDb().emailSuppression.create({
      data: {
        vendorId: vendor.id,
        recipientHash,
        recipientMaskedEmail: "d***@example.test",
        reason: "recipient_request",
        source: "disposable_test",
      },
    });
    const suppressed = await ensureRegistrationConfirmationDelivery(deliveryInput(vendor, "submission-2"));
    expect(suppressed.status).toBe("suppressed");
    expect(await getDb().emailDelivery.count({
      where: { vendorId: vendor.id, status: "suppressed" },
    })).toBe(1);
  });

  it("persists schedule and template revisions while atomically superseding older unsent reminders", async () => {
    const vendor = await createVendor();
    const now = new Date("2026-08-10T00:00:00.000Z");
    const base = {
      ...deliveryInput(vendor, "submission-reminder-1"),
      reminderOffsetMinutes: 60,
      template: {
        ...deliveryInput(vendor, "submission-reminder-1").template,
        id: "disposable-reminder-template-1",
        trigger: "live_reminder",
        subject: "{{live_title}} starts at {{live_start_at}}",
      },
    };

    const first = await ensureLiveReminderDelivery(base, now);
    const duplicate = await ensureLiveReminderDelivery(base, now);
    const revised = await ensureLiveReminderDelivery({
      ...base,
      liveScheduledAt: new Date("2026-08-10T05:00:00.000Z"),
    }, now);
    const revisedTemplate = await ensureLiveReminderDelivery({
      ...base,
      liveScheduledAt: new Date("2026-08-10T05:00:00.000Z"),
      template: {
        ...base.template,
        body: "Updated reminder {{name}} {{unsubscribe_url}}",
      },
    }, now);

    expect(first).toMatchObject({ status: "scheduled", nextAttemptAt: new Date("2026-08-10T03:00:00.000Z") });
    expect(duplicate).toMatchObject({ status: "duplicate", deliveryStatus: "queued" });
    expect(revised).toMatchObject({ status: "scheduled", nextAttemptAt: new Date("2026-08-10T04:00:00.000Z") });
    expect(revisedTemplate).toMatchObject({ status: "scheduled", nextAttemptAt: new Date("2026-08-10T04:00:00.000Z") });
    const schedules = await getDb().emailDelivery.findMany({
      where: { vendorId: vendor.id, trigger: "live_reminder" },
      select: { status: true, nextAttemptAt: true, lastErrorCode: true },
    });
    expect(schedules).toHaveLength(3);
    expect(schedules).toEqual(expect.arrayContaining([
      { status: "superseded", nextAttemptAt: null, lastErrorCode: "schedule_superseded" },
      { status: "superseded", nextAttemptAt: null, lastErrorCode: "schedule_superseded" },
      { status: "queued", nextAttemptAt: new Date("2026-08-10T04:00:00.000Z"), lastErrorCode: null },
    ]));
  });

  it("searches exact recipient hashes and filters within the authenticated tenant", async () => {
    const vendor = await createVendor();
    const otherVendor = await createVendor();
    const recipientEmail = "merchant-search@example.test";
    const own = await ensureRegistrationConfirmationDelivery({
      ...deliveryInput(vendor, "submission-search-own"),
      recipientEmail,
    });
    await ensureRegistrationConfirmationDelivery({
      ...deliveryInput(otherVendor, "submission-search-foreign"),
      recipientEmail,
    });
    if (!("deliveryId" in own)) throw new Error("Expected a searchable delivery id.");
    await getDb().emailDelivery.update({
      where: { id: own.deliveryId },
      data: { status: "failed", lastErrorCode: "network" },
    });

    const exact = await loadEmailDeliverySearchResult(vendor.id, {
      query: recipientEmail.toUpperCase(),
      status: "ALL",
      trigger: "ALL",
      page: 1,
    });
    expect(exact).toMatchObject({ totalItems: 1, page: 1, totalPages: 1 });
    expect(exact.items).toEqual([
      expect.objectContaining({ id: own.deliveryId, status: "failed", canRetry: true }),
    ]);
    expect(JSON.stringify(exact)).not.toContain(recipientEmail);

    const filtered = await loadEmailDeliverySearchResult(vendor.id, {
      query: "",
      status: "failed",
      trigger: "registration_confirmed",
      page: 1,
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.id).toBe(own.deliveryId);

    const foreign = await loadEmailDeliverySearchResult(vendor.id, {
      query: "other-vendor-only@example.test",
      status: "ALL",
      trigger: "ALL",
      page: 1,
    });
    expect(foreign.totalItems).toBe(0);
  });

  it("requeues only a tenant-owned failed delivery while preserving provider identity and audit history", async () => {
    const vendor = await createVendor();
    const otherVendor = await createVendor();
    const queued = await ensureRegistrationConfirmationDelivery(deliveryInput(vendor, "submission-manual-retry"));
    const deliveryId = "deliveryId" in queued ? queued.deliveryId : null;
    if (!deliveryId) throw new Error("Expected a queued delivery id.");
    await getDb().emailDelivery.update({
      where: { id: deliveryId },
      data: { status: "exhausted", attemptCount: 5, nextAttemptAt: null, lastErrorCode: "network" },
    });
    const before = await getDb().emailDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: { idempotencyKey: true, payloadEncryptedEnvelope: true },
    });
    const now = new Date("2026-08-10T02:00:00.000Z");

    await expect(requeueEmailDelivery({
      vendorId: otherVendor.id,
      deliveryId,
      actorId: "other-member",
      actorLabel: "owner",
      now,
    })).resolves.toEqual({ status: "missing" });
    await expect(requeueEmailDelivery({
      vendorId: vendor.id,
      deliveryId,
      actorId: "member-1",
      actorLabel: "owner",
      now,
    })).resolves.toEqual({ status: "requeued", previousStatus: "exhausted" });

    const after = await getDb().emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(after).toMatchObject({
      status: "queued",
      attemptCount: 0,
      manualRetryCount: 1,
      lastManualRetryAt: now,
      nextAttemptAt: now,
      lastErrorCode: null,
      idempotencyKey: before.idempotencyKey,
      payloadEncryptedEnvelope: before.payloadEncryptedEnvelope,
    });
    expect(await getDb().auditLog.count({
      where: {
        vendorId: vendor.id,
        targetType: "EmailDelivery",
        targetId: deliveryId,
        action: "email_delivery_requeued",
      },
    })).toBe(1);
  });
});
