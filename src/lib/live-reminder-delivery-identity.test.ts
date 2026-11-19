import { describe, expect, it } from "vitest";
import { stableLiveNotificationDeliveryId, stableLiveReminderDeliveryId } from "@/lib/live-reminder-delivery-identity";

/**
 * Golden ids (A3-03). Rows already queued in every environment carry these
 * ids, and the send-time guards and scripts/rerender-queued-reminder-content.ts
 * recompute them from the current sources: any change to the digest input
 * would mark every queued reminder stale. The expected values were computed
 * with the implementation as it stood on master before it moved here.
 */
const scheduledAt = new Date("2026-12-01T12:00:00.000Z");
const template = { id: "template_golden", subject: "[{{name}}] {{live_title}}", body: "Hi {{name}}!" };
const base = {
  vendorId: "vendor_golden",
  liveId: "live_golden",
  liveSlug: "golden-live",
  liveTitle: "Golden live",
  formSubmissionId: "submission_golden",
  template,
};

describe("live reminder delivery identity", () => {
  it("keeps the live_reminder id byte for byte", () => {
    expect(stableLiveReminderDeliveryId({ ...base, liveScheduledAt: scheduledAt, reminderOffsetMinutes: 60 }))
      .toBe("email_9f3da5b49639257dad55c8875f20b221");
  });

  it("keeps the live notification id byte for byte", () => {
    expect(stableLiveNotificationDeliveryId({ ...base, ruleId: "rule_golden", trigger: "before_live", offsetMinutes: 30, anchor: scheduledAt }))
      .toBe("email_597ac4710263c9136d9b92677963ad60");
  });

  it("changes the live_reminder id with every rendered input", () => {
    const input = { ...base, liveScheduledAt: scheduledAt, reminderOffsetMinutes: 60 };
    const id = stableLiveReminderDeliveryId(input);
    for (const changed of [
      { ...input, liveTitle: "Renamed" },
      { ...input, liveSlug: "renamed" },
      { ...input, template: { ...template, body: "Changed" } },
      { ...input, template: { ...template, subject: "Changed" } },
      { ...input, liveScheduledAt: new Date(scheduledAt.getTime() + 1) },
      { ...input, reminderOffsetMinutes: 30 },
    ]) expect(stableLiveReminderDeliveryId(changed)).not.toBe(id);
  });
});
