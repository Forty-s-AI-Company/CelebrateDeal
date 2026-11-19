import { createHash } from "node:crypto";
import type { LiveNotificationDeliveryTrigger } from "@/lib/live-notification-identity";

/**
 * Deterministic EmailDelivery ids of the fixed-time live e-mails: the legacy
 * `live_reminder` and the `before_live` / `during_live` notifications. Every
 * input that changes the rendered content (Live title and slug, template id,
 * subject and body, schedule anchor, offset) is part of the digest, so a
 * queued row's id proves which source it was rendered from.
 *
 * Kept free of database and server imports so the ops script
 * scripts/rerender-queued-reminder-content.ts (A3-03) can use it without the
 * delivery engine. Not imported by client code (node:crypto).
 */

export function stableLiveReminderDeliveryId(input: {
  vendorId: string;
  liveId: string;
  liveSlug: string;
  liveTitle: string;
  formSubmissionId: string;
  liveScheduledAt: Date;
  reminderOffsetMinutes: number;
  template: { id: string; subject: string; body: string };
}) {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      input.vendorId,
      input.liveId,
      input.liveSlug,
      input.liveTitle,
      input.formSubmissionId,
      input.template.id,
      input.template.subject,
      input.template.body,
      input.liveScheduledAt.toISOString(),
      input.reminderOffsetMinutes,
      "live_reminder",
    ]))
    .digest("hex")
    .slice(0, 32);
  return `email_${digest}`;
}

export function stableLiveNotificationDeliveryId(input: {
  vendorId: string;
  liveId: string;
  liveSlug: string;
  liveTitle: string;
  formSubmissionId: string;
  ruleId: string;
  trigger: LiveNotificationDeliveryTrigger;
  offsetMinutes: number;
  anchor: Date;
  template: { id: string; subject: string; body: string };
}) {
  const digest = createHash("sha256").update(JSON.stringify([
    input.vendorId,
    input.liveId,
    input.liveSlug,
    input.liveTitle,
    input.formSubmissionId,
    input.ruleId,
    input.trigger,
    input.offsetMinutes,
    input.template.id,
    input.template.subject,
    input.template.body,
    input.anchor.toISOString(),
    "live_notification/v1",
  ])).digest("hex").slice(0, 32);
  return `email_${digest}`;
}
