import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { ensureLiveReminderDelivery } from "../src/lib/email-delivery";
import { protectEmailDeliveryPayload, revealEmailDeliveryPayload } from "../src/lib/email-delivery-pii";
import { ensureLiveNotificationDelivery } from "../src/lib/live-notification-delivery";
import { PERSONAL_WATCH_LINK_LABEL } from "../src/lib/live-watch-link-token";
import { MESSAGE_TEMPLATE_NAME_FALLBACK } from "../src/lib/message-template";
import {
  APPLY_CONFIRMATION,
  PRODUCTION_APPROVAL,
  ReminderRerenderRefusedError,
  parseReminderRerenderArguments,
  resolveReminderRerenderTarget,
  runReminderRerender,
} from "./rerender-queued-reminder-content";

/**
 * A3-03 against the disposable loopback PostgreSQL the Vitest config asserts.
 * Rows are queued through the real materializers (current renderer), then
 * their content is replaced by what the pre-#670 renderer produced (the raw
 * name), which is what a row queued before the deploy holds. Synthetic
 * vendors only; each is removed with cascades afterwards.
 */

const db = getDb();
const APP_URL = "https://rerender-queued.example.test";
const vendorIds: string[] = [];
const env = { NEXT_PUBLIC_APP_URL: APP_URL };
const confirmed = { ...env, RERENDER_CONFIRM: APPLY_CONFIRMATION };
const planOptions = { apply: false, target: null, batchSize: 2, vendorId: null } as const;
const applyOptions = { ...planOptions, apply: true } as const;

const PHISHING = ["evil.test", "[點我](https://evil.test/login)"] as const;
const NORMAL = "王小明";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "rerender-queued-reminder-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

type QueuedRow = { id: string; name: string; phishing: boolean; safe: { subject: string; body: string } };

/** Replaces the safe rendering of the name by the raw name, as the pre-#670 renderer wrote it. */
async function makeLegacy(vendorId: string, deliveryId: string, name: string) {
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const safe = revealEmailDeliveryPayload(row.payloadEncryptedEnvelope, { vendorId, deliveryId });
  const legacySubject = safe.subject.replace(`[${MESSAGE_TEMPLATE_NAME_FALLBACK}]`, `[${name}]`);
  const legacyBody = safe.body.replace(`Hi ${MESSAGE_TEMPLATE_NAME_FALLBACK}!`, `Hi ${name}!`);
  expect(legacySubject).not.toBe(safe.subject);
  expect(legacyBody).not.toBe(safe.body);
  const legacy = protectEmailDeliveryPayload({ ...safe, subject: legacySubject, body: legacyBody }, { vendorId, deliveryId });
  await db.emailDelivery.update({ where: { id: deliveryId }, data: { payloadEncryptedEnvelope: legacy.payloadEncryptedEnvelope } });
  return { subject: safe.subject, body: safe.body };
}

/**
 * One vendor with a legacy `live_reminder` and a `before_live` rule on a
 * scheduled Live and a `during_live` rule on a Live that is on air; three
 * registrants each (two phishing names, one ordinary name): nine queued rows.
 */
async function fixture(label: string) {
  const suffix = `${label}-${randomUUID()}`;
  const vendor = await db.vendor.create({
    data: { name: `Rerender ${label}`, slug: `rerender-${suffix}`, email: `rerender-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Form", slug: `rerender-form-${suffix}`, headline: "Synthetic", fields: [] } });
  const template = await db.messageTemplate.create({
    data: {
      vendorId: vendor.id, name: "Reminder", channel: "email", trigger: "live_reminder", isActive: true,
      subject: "[{{name}}] {{live_title}}",
      body: "Hi {{name}}! {{live_title}} at {{live_start_at}} by {{vendor_name}}\n{{live_url}}",
    },
  });
  const now = new Date();
  const scheduled = await db.live.create({
    data: {
      vendorId: vendor.id, formId: form.id, title: "Scheduled live", slug: `rerender-scheduled-${suffix}`, status: "scheduled",
      scheduledAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000), liveReminderTemplateId: template.id, liveReminderOffsetMinutes: 60,
    },
  });
  const onAir = await db.live.create({
    data: {
      vendorId: vendor.id, formId: form.id, title: "On-air live", slug: `rerender-on-air-${suffix}`, status: "live",
      scheduledAt: new Date(now.getTime() - 10 * 60_000), startedAt: new Date(now.getTime() - 5 * 60_000),
    },
  });
  const beforeRule = await db.liveNotificationRule.create({
    data: { vendorId: vendor.id, liveId: scheduled.id, messageTemplateId: template.id, trigger: "before_live", offsetMinutes: 30 },
  });
  const duringRule = await db.liveNotificationRule.create({
    data: { vendorId: vendor.id, liveId: onAir.id, messageTemplateId: template.id, trigger: "during_live", offsetMinutes: 10 },
  });

  const rows: QueuedRow[] = [];
  for (const name of [...PHISHING, NORMAL]) {
    const phishing = name !== NORMAL;
    const email = `lead-${randomUUID()}@example.test`;
    const first = await db.formSubmission.create({
      data: { formId: form.id, liveId: scheduled.id, name, email, verificationStatus: "VERIFIED", verifiedAt: now },
    });
    const second = await db.formSubmission.create({
      data: { formId: form.id, liveId: onAir.id, name, email, verificationStatus: "VERIFIED", verifiedAt: now },
    });
    const reminder = await ensureLiveReminderDelivery({
      vendorId: vendor.id, vendorName: vendor.name, liveId: scheduled.id, liveSlug: scheduled.slug, liveTitle: scheduled.title,
      formSubmissionId: first.id, recipientName: name, recipientEmail: email, liveScheduledAt: scheduled.scheduledAt,
      reminderOffsetMinutes: 60, template, emailBrand: { senderName: "Synthetic Sender", supportEmail: "support@example.test" },
    }, now);
    const before = await ensureLiveNotificationDelivery({ vendorId: vendor.id, liveId: scheduled.id, ruleId: beforeRule.id, submissionId: first.id }, now, { scheduleFuture: true });
    const during = await ensureLiveNotificationDelivery({ vendorId: vendor.id, liveId: onAir.id, ruleId: duringRule.id, submissionId: second.id }, now, { scheduleFuture: true });
    for (const result of [reminder, before, during]) {
      const deliveryId = (result as { deliveryId?: string }).deliveryId;
      expect(deliveryId, JSON.stringify(result)).toBeTruthy();
      const row = await db.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId! } });
      const safe = phishing ? await makeLegacy(vendor.id, row.id, name) : revealEmailDeliveryPayload(row.payloadEncryptedEnvelope, { vendorId: vendor.id, deliveryId: row.id });
      rows.push({ id: row.id, name, phishing, safe: { subject: safe.subject, body: safe.body } });
    }
  }
  const triggers = (await db.emailDelivery.findMany({ where: { vendorId: vendor.id }, select: { trigger: true, status: true } }))
    .map((row) => `${row.trigger}:${row.status}`).sort();
  expect(triggers).toEqual([...Array(3).fill("before_live:queued"), ...Array(3).fill("during_live:queued"), ...Array(3).fill("live_reminder:queued")]);
  return { vendor, template, scheduled, onAir, rows, scope: { vendorIds: [vendor.id] } };
}

async function snapshot(vendorId: string) {
  return db.emailDelivery.findMany({
    where: { vendorId },
    orderBy: { id: "asc" },
    select: { id: true, status: true, payloadEncryptedEnvelope: true, recipientHash: true, idempotencyKey: true, nextAttemptAt: true, attemptCount: true, updatedAt: true, lastErrorCode: true },
  });
}

async function content(vendorId: string, deliveryId: string) {
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  return revealEmailDeliveryPayload(row.payloadEncryptedEnvelope, { vendorId, deliveryId });
}

const zero = { needsRewrite: 0, rewritten: 0, raced: 0, alreadySafe: 0, unrecognized: 0, stale: 0, unreadable: 0, unrenderable: 0 };

describe("scripts/rerender-queued-reminder-content (PostgreSQL, A3-03)", () => {
  it("dry run classifies every row and writes nothing", async () => {
    const f = await fixture("plan");
    const before = await snapshot(f.vendor.id);

    const result = await runReminderRerender(db, planOptions, env, f.scope);

    expect(result).toMatchObject({ mode: "plan", ...zero, scanned: 9, needsRewrite: 6, alreadySafe: 3 });
    expect(result.vendors).toEqual([{ vendorId: f.vendor.id, ...zero, scanned: 9, needsRewrite: 6, alreadySafe: 3 }]);
    expect(await snapshot(f.vendor.id)).toEqual(before);
    // Counts and vendor ids only: no name, address or content in the result.
    const serialized = JSON.stringify(result);
    for (const marker of ["evil", "點我", NORMAL, "@example.test", "Hi "]) expect(serialized).not.toContain(marker);
  });

  it("apply rewrites only the rows whose name read as a link, in place and tenant-bound", async () => {
    const f = await fixture("apply");
    const other = await fixture("other-tenant");
    const otherBefore = await snapshot(other.vendor.id);
    // A sent row with the old content stays as it was sent.
    const sentId = f.rows.find((row) => row.phishing)!.id;
    await db.emailDelivery.update({ where: { id: sentId }, data: { status: "sent", sentAt: new Date(), nextAttemptAt: null } });
    // A dispatcher that read a row before the rewrite.
    const dispatcherRead = await db.emailDelivery.findUniqueOrThrow({ where: { id: f.rows.filter((row) => row.phishing)[1]!.id } });
    const before = new Map((await snapshot(f.vendor.id)).map((row) => [row.id, row]));

    const result = await runReminderRerender(db, applyOptions, confirmed, f.scope);

    expect(result).toMatchObject({ mode: "apply", ...zero, scanned: 8, needsRewrite: 5, rewritten: 5, alreadySafe: 3 });
    for (const row of f.rows) {
      const after = await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
      const prior = before.get(row.id)!;
      // Never the status, schedule, attempts or identity.
      expect({ ...after, payloadEncryptedEnvelope: undefined, updatedAt: undefined }).toMatchObject({
        ...prior, payloadEncryptedEnvelope: undefined, updatedAt: undefined,
      });
      const mail = await content(f.vendor.id, row.id);
      if (row.id === sentId || !row.phishing) {
        expect(after.payloadEncryptedEnvelope).toBe(prior.payloadEncryptedEnvelope);
        expect(after.updatedAt).toEqual(prior.updatedAt);
        if (!row.phishing) expect(mail.subject).toContain(`[${NORMAL}]`);
        continue;
      }
      expect(after.updatedAt.getTime()).toBeGreaterThan(prior.updatedAt.getTime());
      // Exactly what the current renderer queues: the greeting instead of the name, nothing else changed.
      expect({ subject: mail.subject, body: mail.body }).toEqual(row.safe);
      expect(mail.subject.startsWith(`[${MESSAGE_TEMPLATE_NAME_FALLBACK}] `)).toBe(true);
      expect(`${mail.subject}\n${mail.body}`).not.toMatch(/evil|點我/u);
      // The personal watch link queued with the row is kept as it was.
      expect(mail.body).toContain(`${PERSONAL_WATCH_LINK_LABEL}：${APP_URL}/api/live-watch-link?token=`);
      expect(mail.recipientEmail).toMatch(/^lead-.+@example\.test$/u);
      // The sender brand stored with a legacy reminder is kept too.
      if (after.idempotencyKey.startsWith("live-reminder/")) {
        expect(mail.brand).toEqual({ version: 1, senderName: "Synthetic Sender", replyTo: "support@example.test" });
      }
    }
    expect((await content(f.vendor.id, sentId)).subject).toContain("[evil.test]");

    // The dispatcher's claim on what it read before the rewrite fails, so it never sends the old content.
    const claim = await db.emailDelivery.updateMany({
      where: { id: dispatcherRead.id, status: dispatcherRead.status, attemptCount: dispatcherRead.attemptCount, updatedAt: dispatcherRead.updatedAt },
      data: { status: "sending", attemptCount: { increment: 1 } },
    });
    expect(claim.count).toBe(0);

    expect(await snapshot(other.vendor.id)).toEqual(otherBefore);
  });

  it("skips a row that the sender claims or sends between the read and the write", async () => {
    const f = await fixture("race");
    const hooked: string[] = [];
    const result = await runReminderRerender(db, applyOptions, confirmed, f.scope, {
      beforeCompareAndSet: async (row) => {
        hooked.push(row.id);
        if (hooked.length === 1) {
          // dispatchEmailDelivery's claim.
          await db.emailDelivery.updateMany({
            where: { id: row.id, vendorId: row.vendorId, status: "queued" },
            data: { status: "sending", attemptCount: { increment: 1 }, nextAttemptAt: null, claimedAt: new Date() },
          });
        } else if (hooked.length === 2) {
          await db.emailDelivery.updateMany({
            where: { id: row.id, vendorId: row.vendorId },
            data: { status: "sent", sentAt: new Date(), nextAttemptAt: null },
          });
        }
      },
    });

    expect(result).toMatchObject({ mode: "apply", ...zero, scanned: 9, needsRewrite: 6, rewritten: 4, raced: 2, alreadySafe: 3 });
    const [claimed, sent] = await Promise.all(hooked.slice(0, 2).map((id) => db.emailDelivery.findUniqueOrThrow({ where: { id } })));
    expect(claimed!.status).toBe("sending");
    expect(sent!.status).toBe("sent");
    for (const id of hooked.slice(0, 2)) expect((await content(f.vendor.id, id)).subject).toMatch(/evil|點我/u);
    for (const id of hooked.slice(2)) expect((await content(f.vendor.id, id)).subject).toContain(`[${MESSAGE_TEMPLATE_NAME_FALLBACK}]`);
  });

  it("a rerun writes nothing and leaves every row as the first run left it", async () => {
    const f = await fixture("rerun");
    const first = await runReminderRerender(db, applyOptions, confirmed, f.scope);
    expect(first).toMatchObject({ rewritten: 6, alreadySafe: 3 });
    const afterFirst = await snapshot(f.vendor.id);

    const second = await runReminderRerender(db, applyOptions, confirmed, f.scope);
    const plan = await runReminderRerender(db, planOptions, env, f.scope);

    expect(second).toMatchObject({ mode: "apply", ...zero, scanned: 9, alreadySafe: 9 });
    expect(plan).toMatchObject({ mode: "plan", ...zero, scanned: 9, alreadySafe: 9 });
    expect(await snapshot(f.vendor.id)).toEqual(afterFirst);
  });

  it("never writes content it cannot reproduce exactly (renamed vendor, edited template, other app URL)", async () => {
    const renamed = await fixture("renamed");
    await db.vendor.update({ where: { id: renamed.vendor.id }, data: { name: "Renamed after queueing" } });
    const edited = await fixture("edited");
    await db.messageTemplate.update({ where: { id: edited.template.id }, data: { body: "Changed {{name}}" } });
    const otherUrl = await fixture("other-url");
    const before = await Promise.all([renamed, edited, otherUrl].map((f) => snapshot(f.vendor.id)));

    const renamedResult = await runReminderRerender(db, applyOptions, confirmed, renamed.scope);
    const editedResult = await runReminderRerender(db, applyOptions, confirmed, edited.scope);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://another-host.example.test");
    const otherUrlResult = await runReminderRerender(db, applyOptions, { ...confirmed, NEXT_PUBLIC_APP_URL: "https://another-host.example.test" }, otherUrl.scope);

    expect(renamedResult).toMatchObject({ ...zero, scanned: 9, unrecognized: 9 });
    expect(editedResult).toMatchObject({ ...zero, scanned: 9, stale: 9 });
    expect(otherUrlResult).toMatchObject({ ...zero, scanned: 9, unrecognized: 9 });
    expect(await Promise.all([renamed, edited, otherUrl].map((f) => snapshot(f.vendor.id)))).toEqual(before);
  });

  it("--vendor-id limits the run to one tenant", async () => {
    const a = await fixture("only-a");
    const b = await fixture("only-b");
    const bBefore = await snapshot(b.vendor.id);
    const result = await runReminderRerender(db, { ...applyOptions, vendorId: a.vendor.id }, confirmed);
    expect(result.vendors.map((row) => row.vendorId)).toEqual([a.vendor.id]);
    expect(result).toMatchObject({ rewritten: 6, alreadySafe: 3 });
    expect(await snapshot(b.vendor.id)).toEqual(bBefore);
  });

  it("refuses to write without the confirmation, and to run without the app URL", async () => {
    const f = await fixture("refuse");
    const before = await snapshot(f.vendor.id);
    await expect(runReminderRerender(db, applyOptions, env, f.scope)).rejects.toMatchObject({ category: "confirmation-missing" });
    await expect(runReminderRerender(db, planOptions, {}, f.scope)).rejects.toMatchObject({ category: "app-url-missing" });
    expect(await snapshot(f.vendor.id)).toEqual(before);
  });
});

describe("scripts/rerender-queued-reminder-content arguments and target", () => {
  it("parses the documented options and rejects anything else", () => {
    expect(parseReminderRerenderArguments([])).toEqual({ apply: false, target: null, batchSize: 100, vendorId: null });
    expect(parseReminderRerenderArguments(["--apply", "--target=staging", "--batch-size", "50", "--vendor-id", "vendor_1"]))
      .toEqual({ apply: true, target: "staging", batchSize: 50, vendorId: "vendor_1" });
    for (const argv of [["--target=prod"], ["--batch-size", "0"], ["--batch-size", "501"], ["--vendor-id"], ["--vendor-id", "--apply"], ["--write-ids", "x"]]) {
      expect(() => parseReminderRerenderArguments(argv)).toThrow(ReminderRerenderRefusedError);
    }
  });

  it("allows a loopback test database, needs --target for staging and owner approval for production", () => {
    const loopback = "postgresql://postgres:postgres@127.0.0.1:54443/celebratedeal_test?schema=public";
    const remote = "postgresql://user:secret@db.example.test:5432/postgres";
    expect(resolveReminderRerenderTarget({ DATABASE_URL: loopback }, null)).toMatchObject({ target: "loopback" });
    expect(() => resolveReminderRerenderTarget({ DATABASE_URL: loopback }, "production")).toThrow(expect.objectContaining({ category: "target-mismatch" }));
    expect(() => resolveReminderRerenderTarget({}, null)).toThrow(expect.objectContaining({ category: "missing" }));
    expect(() => resolveReminderRerenderTarget({ DATABASE_URL: remote }, null)).toThrow(expect.objectContaining({ category: "remote-without-target" }));
    expect(() => resolveReminderRerenderTarget({ DATABASE_URL: remote }, "staging")).toThrow(expect.objectContaining({ category: "not-staging" }));
    expect(() => resolveReminderRerenderTarget({ DATABASE_URL: remote }, "production")).toThrow(expect.objectContaining({ category: "production-not-approved" }));
    expect(resolveReminderRerenderTarget({ DATABASE_URL: remote, RERENDER_PRODUCTION_APPROVAL: PRODUCTION_APPROVAL }, "production")).toMatchObject({ target: "production" });
  });
});
