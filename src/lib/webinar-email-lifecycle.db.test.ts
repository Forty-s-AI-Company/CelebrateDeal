import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import {
  ensureFormSubmissionVerificationDelivery,
  ensureLiveReminderDelivery,
  ensureRegistrationConfirmationDelivery,
  processDuePostLiveFollowups,
} from "@/lib/email-delivery";
import { createEmailRecipientHash } from "@/lib/email-delivery-pii";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";

const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "webinar-email-lifecycle-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://webinar-lifecycle.example.test");
});

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

describe("webinar email lifecycle disposable database integration", () => {
  it("queues verification, confirmation, reminder and post-live email exactly once", async () => {
    const db = getDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const verificationAt = new Date("2026-08-17T00:00:00.000Z");
    const liveScheduledAt = new Date("2026-08-17T02:00:00.000Z");
    const verificationExpiresAt = new Date("2026-08-18T00:00:00.000Z");
    const followupAt = new Date("2026-08-17T02:40:00.000Z");
    const recipientEmail = `lifecycle-${suffix}@example.test`;

    const vendor = await db.vendor.create({
      data: {
        name: `Lifecycle Vendor ${suffix}`,
        slug: `lifecycle-vendor-${suffix}`,
        email: `merchant-${suffix}@example.test`,
        passwordHash: "disposable-test-only",
        senderName: "Lifecycle Academy",
        supportEmail: "support@example.test",
        contactUrl: "https://webinar-lifecycle.example.test/contact",
      },
    });
    createdVendorIds.push(vendor.id);

    const form = await db.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: "Lifecycle registration",
        slug: `lifecycle-form-${suffix}`,
        headline: "Join the lifecycle webinar",
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      },
    });
    const [confirmationTemplate, reminderTemplate, followupTemplate] = await Promise.all([
      db.messageTemplate.create({
        data: {
          vendorId: vendor.id,
          name: "Registration confirmed",
          trigger: "registration_confirmed",
          subject: "{{name}}，你已完成 {{live_title}} 報名",
          body: "直播時間：{{live_start_at}}\n{{unsubscribe_url}}",
        },
      }),
      db.messageTemplate.create({
        data: {
          vendorId: vendor.id,
          name: "Live reminder",
          trigger: "live_reminder",
          subject: "{{live_title}} 即將開始",
          body: "{{name}}，直播時間是 {{live_start_at}}。\n{{unsubscribe_url}}",
        },
      }),
      db.messageTemplate.create({
        data: {
          vendorId: vendor.id,
          name: "Post-live followup",
          trigger: "post_live_followup",
          subject: "{{live_title}} 課後通知",
          body: "謝謝 {{name}} 參加課程。\n{{unsubscribe_url}}",
        },
      }),
    ]);
    const video = await db.video.create({
      data: {
        vendorId: vendor.id,
        title: "Lifecycle prerecorded video",
        videoUrl: "https://media.example.test/lifecycle.mp4",
        durationSec: 600,
        status: "ready",
      },
    });
    const live = await db.live.create({
      data: {
        vendorId: vendor.id,
        formId: form.id,
        videoId: video.id,
        messageTemplateId: confirmationTemplate.id,
        liveReminderTemplateId: reminderTemplate.id,
        liveReminderOffsetMinutes: 60,
        title: "Lifecycle webinar",
        slug: `lifecycle-live-${suffix}`,
        scheduledAt: liveScheduledAt,
        status: "published",
        streamMode: "vod",
      },
    });
    await db.liveNotificationRule.create({
      data: {
        vendorId: vendor.id,
        liveId: live.id,
        messageTemplateId: followupTemplate.id,
        trigger: "post_live_followup",
        offsetMinutes: 30,
      },
    });
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        liveId: live.id,
        name: "Lifecycle Lead",
        email: recipientEmail,
        source: "live",
        verificationExpiresAt,
      },
    });

    const verificationInput = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      liveId: live.id,
      formSubmissionId: submission.id,
      recipientName: submission.name,
      recipientEmail: submission.email,
      verificationVersion: submission.verificationVersion,
      verificationExpiresAt,
      emailBrand: {
        senderName: vendor.senderName,
        supportEmail: vendor.supportEmail,
        contactUrl: vendor.contactUrl,
      },
    };
    await expect(ensureFormSubmissionVerificationDelivery(verificationInput)).resolves.toMatchObject({
      status: "queued",
    });
    await expect(ensureFormSubmissionVerificationDelivery(verificationInput)).resolves.toMatchObject({
      status: "duplicate",
    });

    const token = createFormSubmissionVerificationToken({
      submissionId: submission.id,
      expiresAt: verificationExpiresAt,
      version: submission.verificationVersion,
    });
    const verification = await verifyFormSubmission(db, token, verificationAt);
    if (verification.status !== "verified" || !verification.confirmation) {
      throw new Error("Expected the registration to produce an email confirmation context.");
    }
    const confirmation = verification.confirmation;
    await expect(ensureRegistrationConfirmationDelivery(confirmation)).resolves.toMatchObject({ status: "queued" });
    await expect(ensureRegistrationConfirmationDelivery(confirmation)).resolves.toMatchObject({ status: "duplicate" });

    const reminderInput = {
      ...confirmation,
      template: confirmation.reminderTemplate,
      reminderOffsetMinutes: confirmation.liveReminderOffsetMinutes,
    };
    await expect(ensureLiveReminderDelivery(reminderInput, verificationAt)).resolves.toMatchObject({
      status: "scheduled",
      nextAttemptAt: new Date("2026-08-17T01:00:00.000Z"),
    });
    await expect(ensureLiveReminderDelivery(reminderInput, verificationAt)).resolves.toMatchObject({
      status: "duplicate",
    });

    await expect(processDuePostLiveFollowups({ now: followupAt })).resolves.toEqual(
      expect.arrayContaining([{ status: "queued" }]),
    );
    await expect(processDuePostLiveFollowups({ now: followupAt })).resolves.toEqual(
      expect.arrayContaining([{ status: "duplicate" }]),
    );
    await expect(verifyFormSubmission(db, token, new Date(verificationAt.getTime() + 1_000))).resolves.toEqual({
      status: "already_verified",
      chatSession: { submissionId: submission.id },
    });

    const deliveries = await db.emailDelivery.findMany({
      where: { vendorId: vendor.id },
      orderBy: { trigger: "asc" },
    });
    expect(deliveries).toHaveLength(4);
    expect(deliveries.map((delivery) => delivery.trigger)).toEqual([
      "form_submission_verification",
      "live_reminder",
      "post_live_followup",
      "registration_confirmed",
    ]);
    const expectedRecipientHash = createEmailRecipientHash(recipientEmail, vendor.id);
    expect(deliveries.every((delivery) => delivery.recipientHash === expectedRecipientHash)).toBe(true);
    expect(JSON.stringify(deliveries)).not.toContain(recipientEmail);
    expect(await db.analyticsEvent.count({
      where: { vendorId: vendor.id, liveId: live.id, eventType: "lead_submit" },
    })).toBe(1);
  });
});
