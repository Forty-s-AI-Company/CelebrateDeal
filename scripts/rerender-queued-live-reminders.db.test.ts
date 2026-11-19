import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { ensureLiveReminderDelivery } from "../src/lib/email-delivery";
import { protectEmailDeliveryPayload, revealEmailDeliveryPayload } from "../src/lib/email-delivery-pii";
import { ensureLiveNotificationDelivery } from "../src/lib/live-notification-delivery";
import { MESSAGE_TEMPLATE_NAME_FALLBACK } from "../src/lib/message-template";
import {
  APPLY_CONFIRMATION,
  LiveReminderRerenderRefusedError,
  parseLiveReminderRerenderArguments,
  REMOTE_APPROVAL,
  resolveLiveReminderRerenderTarget,
  runLiveReminderRerender,
} from "./rerender-queued-live-reminders";

/**
 * The A2-13 re-render proposal (#670 review MINOR-2) against the disposable
 * loopback PostgreSQL: rows queued before the fix keep the raw name, the
 * script marks one vendor's rows superseded, and regeneration brings the same
 * rows back with the cleaned name.
 */

const db = getDb();
const vendorIds: string[] = [];
const PHISHING = "[點我](https://evil.test/login)";
const DAY = 86_400_000;
const confirmed = { RERENDER_CONFIRM: APPLY_CONFIRMATION };

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "rerender-queued-live-reminders-db-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://rerender.example.test");
});
afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

/**
 * One vendor, stored as the pre-fix code rendered it:
 * - Live A sends its own reminder (`live_reminder`); it also has a before_live
 *   row, which the notification repair would never re-create on such a Live;
 * - Live B has no own reminder and a before_live notification rule.
 * Every recipient is a verified registrant named with a phishing link.
 */
async function preFixSnapshots(label: string) {
  const suffix = `${label}-${randomUUID()}`;
  const vendor = await db.vendor.create({ data: { name: `Rerender ${label}`, slug: `rerender-${suffix}`, email: `rerender-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const template = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "Reminder", channel: "email", trigger: "live_reminder", subject: "{{name}}：{{live_title}}", body: "{{name}} 你好\n{{unsubscribe_url}}", isActive: true },
  });
  const liveWith = async (key: string, ownReminder: boolean) => {
    const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Form", slug: `rerender-form-${key}-${suffix}`, headline: "Synthetic", fields: [] } });
    const live = await db.live.create({
      data: {
        vendorId: vendor.id, formId: form.id, title: "Rerender live", slug: `rerender-live-${key}-${suffix}`, scheduledAt: new Date(Date.now() + 10 * DAY),
        status: "scheduled", liveReminderOffsetMinutes: 60, ...(ownReminder ? { liveReminderTemplateId: template.id } : {}),
      },
    });
    const rule = await db.liveNotificationRule.create({ data: { vendorId: vendor.id, liveId: live.id, messageTemplateId: template.id, trigger: "before_live", offsetMinutes: 60 } });
    const submission = await db.formSubmission.create({
      data: { formId: form.id, liveId: live.id, name: PHISHING, email: `lead-${key}-${suffix}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
    });
    const notice = await ensureLiveNotificationDelivery({ vendorId: vendor.id, liveId: live.id, ruleId: rule.id, submissionId: submission.id }, new Date(), { scheduleFuture: true });
    return { live, submission, noticeId: (notice as { deliveryId: string }).deliveryId };
  };
  const a = await liveWith("a", true);
  const b = await liveWith("b", false);
  const reminder = await ensureLiveReminderDelivery({
    vendorId: vendor.id, vendorName: vendor.name, liveId: a.live.id, liveSlug: a.live.slug, liveTitle: a.live.title, formSubmissionId: a.submission.id,
    recipientName: a.submission.name, recipientEmail: a.submission.email, liveScheduledAt: a.live.scheduledAt, reminderOffsetMinutes: 60, template,
  });
  const ids = { reminderId: (reminder as { deliveryId: string }).deliveryId, legacyNoticeId: a.noticeId, noticeId: b.noticeId };
  // What the code before A2-13 stored: the raw name, queued a day ago.
  for (const [id, email] of [[ids.reminderId, a.submission.email], [ids.legacyNoticeId, a.submission.email], [ids.noticeId, b.submission.email]] as const) {
    const preFix = protectEmailDeliveryPayload({ recipientEmail: email, subject: `${PHISHING}：Rerender live`, body: `${PHISHING} 你好` }, { vendorId: vendor.id, deliveryId: id });
    await db.emailDelivery.update({ where: { id }, data: { payloadEncryptedEnvelope: preFix.payloadEncryptedEnvelope, createdAt: new Date(Date.now() - DAY) } });
  }
  return { vendorId: vendor.id, ...ids };
}

async function stored(vendorId: string, id: string) {
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { id } });
  return { status: row.status, ...revealEmailDeliveryPayload(row.payloadEncryptedEnvelope, { vendorId, deliveryId: id }) };
}

const options = (vendorId: string, extra: string[] = []) => parseLiveReminderRerenderArguments([
  "--vendor-id", vendorId, "--queued-before", new Date(Date.now() - 60 * 60_000).toISOString(), ...extra,
]);

describe("scripts/rerender-queued-live-reminders (PostgreSQL, A2-13)", () => {
  it("dry-runs by default: counts this vendor's rows and writes nothing", async () => {
    const f = await preFixSnapshots("dry");
    await expect(runLiveReminderRerender(db, options(f.vendorId), confirmed)).resolves.toEqual({
      mode: "plan", eligibleByTrigger: { live_reminder: 1, before_live: 1 }, tooSoonByTrigger: {}, notRegenerableByTrigger: { before_live: 1 }, lives: 2,
    });
    for (const id of [f.reminderId, f.noticeId, f.legacyNoticeId]) {
      const row = await stored(f.vendorId, id);
      expect(row.status).toBe("queued");
      expect(row.body).toContain(PHISHING);
    }
  });

  it("writes only with --apply and the confirmation, then brings the same rows back with the cleaned name", async () => {
    const [f, other] = [await preFixSnapshots("apply-a"), await preFixSnapshots("apply-b")];
    await expect(runLiveReminderRerender(db, options(f.vendorId, ["--apply"]), {})).rejects.toBeInstanceOf(LiveReminderRerenderRefusedError);
    expect((await stored(f.vendorId, f.reminderId)).status).toBe("queued");

    const outcome = await runLiveReminderRerender(db, options(f.vendorId, ["--apply", "--rematerialize"]), confirmed);
    expect(outcome).toMatchObject({ mode: "apply", superseded: 2, reconciliationsQueued: 1, rematerialized: { notRestored: 0 } });
    for (const id of [f.reminderId, f.noticeId]) {
      const row = await stored(f.vendorId, id);
      expect(row.status, id).toBe("queued");
      expect(row.body, id).not.toMatch(/evil|點我/u);
      expect(row.subject, id).toBe(`${MESSAGE_TEMPLATE_NAME_FALLBACK}：Rerender live`);
      expect(row.body.startsWith(`${MESSAGE_TEMPLATE_NAME_FALLBACK} 你好`), id).toBe(true);
    }
    // The before_live row nothing would bring back is left exactly as it was (reported, not lost).
    const legacy = await stored(f.vendorId, f.legacyNoticeId);
    expect(legacy.status).toBe("queued");
    expect(legacy.body).toContain(PHISHING);
    // Another vendor's rows are never touched.
    for (const id of [other.reminderId, other.noticeId, other.legacyNoticeId]) {
      const row = await stored(other.vendorId, id);
      expect(row.status).toBe("queued");
      expect(row.body).toContain(PHISHING);
    }
    await expect(db.emailDelivery.count({ where: { vendorId: f.vendorId, status: "superseded" } })).resolves.toBe(0);
  });

  it("leaves rows queued after the cutoff, and rows due too soon to be brought back", async () => {
    const f = await preFixSnapshots("bounds");
    await db.emailDelivery.update({ where: { id: f.noticeId }, data: { createdAt: new Date() } });
    await db.emailDelivery.update({ where: { id: f.reminderId }, data: { nextAttemptAt: new Date(Date.now() + 10 * 60_000) } });
    await expect(runLiveReminderRerender(db, options(f.vendorId, ["--apply"]), confirmed)).resolves.toMatchObject({
      mode: "apply", eligibleByTrigger: {}, tooSoonByTrigger: { live_reminder: 1 }, superseded: 0,
    });
    for (const id of [f.reminderId, f.noticeId, f.legacyNoticeId]) expect((await stored(f.vendorId, id)).status).toBe("queued");
  });

  it("requires a vendor and a cutoff, and guards remote targets like the other one-off scripts", () => {
    expect(() => parseLiveReminderRerenderArguments(["--queued-before", "2026-11-20T00:00:00Z"])).toThrow(LiveReminderRerenderRefusedError);
    expect(() => parseLiveReminderRerenderArguments(["--vendor-id", "v1"])).toThrow(LiveReminderRerenderRefusedError);
    expect(() => parseLiveReminderRerenderArguments(["--vendor-id", "v1", "--queued-before", "yesterday"])).toThrow(LiveReminderRerenderRefusedError);
    expect(() => parseLiveReminderRerenderArguments(["--vendor-id", "v1", "--queued-before", "2026-11-20T00:00:00Z", "--rematerialize"])).toThrow(LiveReminderRerenderRefusedError);
    const remote = { DATABASE_URL: "postgresql://user:pass@db.example.test:5432/app" };
    expect(() => resolveLiveReminderRerenderTarget(remote, { apply: false, target: null })).toThrow(LiveReminderRerenderRefusedError);
    expect(() => resolveLiveReminderRerenderTarget(remote, { apply: true, target: "production" })).toThrow(LiveReminderRerenderRefusedError);
    expect(resolveLiveReminderRerenderTarget({ ...remote, RERENDER_REMOTE_APPROVAL: REMOTE_APPROVAL }, { apply: true, target: "production" })).toMatchObject({ target: "production" });
  });
});
