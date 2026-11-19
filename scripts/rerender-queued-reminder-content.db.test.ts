import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real dispatcher runs against a mocked provider, and the suspension check
// (between its read and its claim) is the seam for a rewrite in between.
const seams = vi.hoisted(() => ({ beforeClaim: null as null | (() => Promise<void>) }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/email")>(),
  sendTransactionalEmail: vi.fn(async () => ({ id: "provider-synthetic" })),
}));
vi.mock("@/lib/vendor-suspension-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vendor-suspension-state")>();
  return {
    ...actual,
    isVendorSuspendedById: async (...args: Parameters<typeof actual.isVendorSuspendedById>) => {
      const seam = seams.beforeClaim;
      seams.beforeClaim = null;
      if (seam) await seam();
      return actual.isVendorSuspendedById(...args);
    },
  };
});

import { getDb } from "../src/lib/db";
import { sendTransactionalEmail } from "../src/lib/email";
import { dispatchEmailDelivery, ensureLiveReminderDelivery } from "../src/lib/email-delivery";
import { formatLiveStartAt } from "../src/lib/email-delivery-format";
import { canManuallyRequeueEmailDelivery } from "../src/lib/email-delivery-operations";
import { protectEmailDeliveryPayload, revealEmailDeliveryPayload } from "../src/lib/email-delivery-pii";
import { ensureLiveNotificationDelivery } from "../src/lib/live-notification-delivery";
import { PERSONAL_WATCH_LINK_LABEL } from "../src/lib/live-watch-link-token";
import { MESSAGE_TEMPLATE_NAME_FALLBACK } from "../src/lib/message-template";
import { safeRecipientNameOr } from "../src/lib/safe-recipient-name";
import {
  APPLY_CONFIRMATION,
  NON_REQUEUEABLE_EXHAUSTED_CODES,
  PRODUCTION_APPROVAL,
  ReminderRerenderRefusedError,
  parseReminderRerenderArguments,
  provablyNeverSent,
  reminderRerenderRunStatus,
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
const DAY = 24 * 60 * 60_000;

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "rerender-queued-reminder-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  vi.stubEnv("DATA_ENCRYPTION_KEYRING", "");
  vi.mocked(sendTransactionalEmail).mockClear();
  seams.beforeClaim = null;
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

type Content = { subject: string; body: string };
type QueuedRow = { id: string; trigger: string; name: string; phishing: boolean; submissionId: string; safe: Content };

function reveal(vendorId: string, row: { id: string; payloadEncryptedEnvelope: string }) {
  return revealEmailDeliveryPayload(row.payloadEncryptedEnvelope, { vendorId, deliveryId: row.id });
}

async function content(vendorId: string, deliveryId: string) {
  return reveal(vendorId, await db.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } }));
}

/** Stores new subject and body for a row (same recipient and brand), as an older server would have queued them. */
async function storeContent(vendorId: string, deliveryId: string, next: Content) {
  const current = await content(vendorId, deliveryId);
  const sealed = protectEmailDeliveryPayload({ ...current, ...next }, { vendorId, deliveryId });
  await db.emailDelivery.update({ where: { id: deliveryId }, data: { payloadEncryptedEnvelope: sealed.payloadEncryptedEnvelope } });
}

/** The pre-#670 content of a row: the raw name where the current renderer put the safe one. */
function legacyOf(safe: Content, name: string): Content {
  const shown = safeRecipientNameOr(name, MESSAGE_TEMPLATE_NAME_FALLBACK);
  const subject = safe.subject.replace(`[${shown}]`, `[${name}]`).replace(/\s+/gu, " ").trim();
  const body = safe.body.replace(`Hi ${shown}!`, `Hi ${name}!`);
  expect(subject).not.toBe(safe.subject);
  expect(body).not.toBe(safe.body);
  return { subject, body };
}

/** Removes the appended (last) personal watch link paragraph, as in a row queued before Q-17. */
function withoutWatchLink(body: string) {
  const start = body.lastIndexOf(`\n\n${PERSONAL_WATCH_LINK_LABEL}：`);
  expect(start).toBeGreaterThan(0);
  const end = body.indexOf("\n", start + 2);
  return end < 0 ? body.slice(0, start) : body.slice(0, start) + body.slice(end);
}

/**
 * One vendor with a legacy `live_reminder` and a `before_live` rule on a
 * scheduled Live and a `during_live` rule on a Live that is on air; per name
 * one registration on each: three queued rows per name. Rows of a name that
 * the current renderer changes get the pre-#670 content.
 */
async function fixture(label: string, options: { names?: readonly string[]; scheduledTitle?: string } = {}) {
  const names = options.names ?? [...PHISHING, NORMAL];
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
      vendorId: vendor.id, formId: form.id, title: options.scheduledTitle ?? "Scheduled live", slug: `rerender-scheduled-${suffix}`, status: "scheduled",
      scheduledAt: new Date(now.getTime() + 7 * DAY), liveReminderTemplateId: template.id, liveReminderOffsetMinutes: 60,
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
  for (const name of names) {
    const phishing = safeRecipientNameOr(name, MESSAGE_TEMPLATE_NAME_FALLBACK) !== name;
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
    for (const [result, submissionId] of [[reminder, first.id], [before, first.id], [during, second.id]] as const) {
      const deliveryId = (result as { deliveryId?: string }).deliveryId;
      expect(deliveryId, JSON.stringify(result)).toBeTruthy();
      const row = await db.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId! } });
      const safe = reveal(vendor.id, row);
      if (phishing) await storeContent(vendor.id, row.id, legacyOf(safe, name));
      rows.push({ id: row.id, trigger: row.trigger, name, phishing, submissionId, safe: { subject: safe.subject, body: safe.body } });
    }
  }
  expect(rows.map((row) => row.trigger).sort()).toEqual(
    [...Array(names.length).fill("before_live"), ...Array(names.length).fill("during_live"), ...Array(names.length).fill("live_reminder")],
  );
  const phishingRows = rows.filter((row) => row.phishing);
  return { vendor, template, scheduled, onAir, form, rows, phishingRows, scope: { vendorIds: [vendor.id] } };
}

async function snapshot(vendorId: string) {
  return db.emailDelivery.findMany({
    where: { vendorId },
    orderBy: { id: "asc" },
    select: {
      id: true, status: true, payloadEncryptedEnvelope: true, recipientHash: true, idempotencyKey: true, nextAttemptAt: true,
      attemptCount: true, manualRetryCount: true, updatedAt: true, lastErrorCode: true, sourceTemplateId: true,
    },
  });
}

async function envelopeOf(id: string) {
  return (await db.emailDelivery.findUniqueOrThrow({ where: { id } })).payloadEncryptedEnvelope;
}

const zero = {
  needsRewrite: 0, rewritten: 0, raced: 0, alreadySafe: 0, unrecognized: 0, stale: 0, unreadable: 0,
  ambiguousAttempt: 0, keyMismatch: 0, unrenderable: 0, rowError: 0,
};

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
    const sentId = f.phishingRows[0]!.id;
    await db.emailDelivery.update({ where: { id: sentId }, data: { status: "sent", sentAt: new Date(), nextAttemptAt: null } });
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
      const mail = reveal(f.vendor.id, after);
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
      if (row.trigger === "live_reminder") {
        expect(mail.brand).toEqual({ version: 1, senderName: "Synthetic Sender", replyTo: "support@example.test" });
      }
    }
    expect((await content(f.vendor.id, sentId)).subject).toContain("[evil.test]");
    expect(await snapshot(other.vendor.id)).toEqual(otherBefore);
  });

  it("a dispatcher that read the row before the rewrite loses its claim and sends the new content next round", async () => {
    const f = await fixture("dispatch", { names: [PHISHING[0]] });
    const reminder = f.rows.find((row) => row.trigger === "live_reminder")!;
    await db.emailDelivery.update({ where: { id: reminder.id }, data: { nextAttemptAt: new Date(Date.now() - 60_000) } });
    let rewrite: Awaited<ReturnType<typeof runReminderRerender>> | null = null;
    // Runs after dispatchEmailDelivery read the row (old content) and before its claim.
    seams.beforeClaim = async () => {
      rewrite = await runReminderRerender(db, applyOptions, confirmed, f.scope);
    };

    await expect(dispatchEmailDelivery(reminder.id)).resolves.toEqual({ status: "claimed_elsewhere" });
    expect(rewrite).toMatchObject({ rewritten: 3 });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: reminder.id } })).toMatchObject({ status: "queued", attemptCount: 0 });

    await expect(dispatchEmailDelivery(reminder.id)).resolves.toEqual({ status: "sent" });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(sendTransactionalEmail).mock.calls[0]![0];
    expect(sent.subject).toBe(reminder.safe.subject);
    expect(`${sent.subject}\n${sent.text}\n${sent.html}`).not.toMatch(/evil/u);
    expect(sent.idempotencyKey).toBe(`live-reminder/${reminder.id}`);
  });

  it("re-renders fixed-session rows anchored on the registrant's own session", async () => {
    const suffix = randomUUID();
    const vendor = await db.vendor.create({
      data: { name: "Rerender fixed", slug: `rerender-fixed-${suffix}`, email: `rerender-fixed-${suffix}@example.test`, passwordHash: "synthetic-only" },
    });
    vendorIds.push(vendor.id);
    const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Form", slug: `rerender-fixed-form-${suffix}`, headline: "Synthetic", fields: [] } });
    const template = await db.messageTemplate.create({
      data: {
        vendorId: vendor.id, name: "Reminder", channel: "email", trigger: "live_reminder", isActive: true,
        subject: "[{{name}}] {{live_title}}", body: "Hi {{name}}! {{live_title}} at {{live_start_at}} by {{vendor_name}}\n{{live_url}}",
      },
    });
    const now = new Date();
    const live = await db.live.create({
      data: {
        vendorId: vendor.id, formId: form.id, title: "Fixed live", slug: `rerender-fixed-live-${suffix}`, status: "scheduled", sessionMode: "fixed_sessions",
        scheduledAt: new Date(now.getTime() + 10 * DAY), liveReminderTemplateId: template.id, liveReminderOffsetMinutes: 60,
      },
    });
    const session = await db.liveSession.create({ data: { vendorId: vendor.id, liveId: live.id, startAt: new Date(now.getTime() + 3 * DAY), status: "open" } });
    const rule = await db.liveNotificationRule.create({
      data: { vendorId: vendor.id, liveId: live.id, messageTemplateId: template.id, trigger: "before_live", offsetMinutes: 30 },
    });
    const name = PHISHING[0];
    const email = `lead-${randomUUID()}@example.test`;
    const submission = await db.formSubmission.create({
      data: { formId: form.id, liveId: live.id, liveSessionId: session.id, name, email, verificationStatus: "VERIFIED", verifiedAt: now },
    });
    const reminder = await ensureLiveReminderDelivery({
      vendorId: vendor.id, vendorName: vendor.name, liveId: live.id, liveSlug: live.slug, liveTitle: live.title,
      formSubmissionId: submission.id, recipientName: name, recipientEmail: email, liveScheduledAt: session.startAt,
      reminderOffsetMinutes: 60, template,
    }, now);
    const before = await ensureLiveNotificationDelivery({ vendorId: vendor.id, liveId: live.id, ruleId: rule.id, submissionId: submission.id }, now, { scheduleFuture: true });
    const ids = [reminder, before].map((result) => (result as { deliveryId: string }).deliveryId);
    const safe = new Map<string, Content>();
    for (const id of ids) {
      const mail = await content(vendor.id, id);
      // Shown time is the registrant's session, not the Live's scheduledAt.
      expect(mail.body).toContain(formatLiveStartAt(session.startAt));
      expect(mail.body).not.toContain(formatLiveStartAt(live.scheduledAt));
      safe.set(id, { subject: mail.subject, body: mail.body });
      await storeContent(vendor.id, id, legacyOf(mail, name));
    }

    const result = await runReminderRerender(db, applyOptions, confirmed, { vendorIds: [vendor.id] });

    expect(result).toMatchObject({ ...zero, scanned: 2, needsRewrite: 2, rewritten: 2 });
    for (const id of ids) {
      const mail = await content(vendor.id, id);
      expect({ subject: mail.subject, body: mail.body }).toEqual(safe.get(id));
    }
  });

  it("rewrites a failed row only when no attempt can have reached the provider", async () => {
    const f = await fixture("failed");
    const [configurationOnce, network, providerRejected, configurationTwice, manuallyRetried, untouched] = f.phishingRows;
    const set = (row: QueuedRow, data: { status?: string; attemptCount: number; lastErrorCode: string | null; manualRetryCount?: number }) =>
      db.emailDelivery.update({ where: { id: row.id }, data: { status: "failed", failedAt: new Date(), ...data } });
    await set(configurationOnce!, { attemptCount: 1, lastErrorCode: "configuration" });
    await set(network!, { attemptCount: 1, lastErrorCode: "network" });
    await set(providerRejected!, { attemptCount: 1, lastErrorCode: "provider_rejected" });
    await set(configurationTwice!, { attemptCount: 2, lastErrorCode: "configuration" });
    // A manual retry put it back in the queue and cleared the error code.
    await set(manuallyRetried!, { status: "queued", attemptCount: 0, lastErrorCode: null, manualRetryCount: 1 });
    const ambiguous = [network!, providerRejected!, configurationTwice!, manuallyRetried!];
    const envelopes = new Map(await Promise.all(ambiguous.map(async (row) => [row.id, await envelopeOf(row.id)] as const)));

    const result = await runReminderRerender(db, applyOptions, confirmed, f.scope);

    expect(result).toMatchObject({ ...zero, scanned: 9, needsRewrite: 2, rewritten: 2, ambiguousAttempt: 4, alreadySafe: 3 });
    for (const row of [configurationOnce!, untouched!]) {
      expect(await content(f.vendor.id, row.id)).toMatchObject(row.safe);
    }
    expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: configurationOnce!.id } }))
      .toMatchObject({ status: "failed", attemptCount: 1, lastErrorCode: "configuration" });
    for (const row of ambiguous) expect(await envelopeOf(row.id)).toBe(envelopes.get(row.id));
  });

  it("covers exhausted rows a merchant can still retry, with the same attempt rule", async () => {
    const f = await fixture("exhausted");
    const [retryableAmbiguous, notRetryable, retryableNeverSent] = f.phishingRows;
    await db.emailDelivery.update({ where: { id: retryableAmbiguous!.id }, data: { status: "exhausted", attemptCount: 5, lastErrorCode: "network", nextAttemptAt: null } });
    await db.emailDelivery.update({ where: { id: notRetryable!.id }, data: { status: "exhausted", attemptCount: 1, lastErrorCode: "provider_rejected", nextAttemptAt: null } });
    await db.emailDelivery.update({
      where: { id: retryableNeverSent!.id },
      data: { status: "exhausted", attemptCount: 1, maxAttempts: 1, lastErrorCode: "configuration", nextAttemptAt: null },
    });
    const untouched = [retryableAmbiguous!, notRetryable!];
    const envelopes = new Map(await Promise.all(untouched.map(async (row) => [row.id, await envelopeOf(row.id)] as const)));

    const result = await runReminderRerender(db, applyOptions, confirmed, f.scope);

    // The provider_rejected row is out of scope (never retried), so 8 rows are scanned.
    expect(result).toMatchObject({ ...zero, scanned: 8, needsRewrite: 4, rewritten: 4, ambiguousAttempt: 1, alreadySafe: 3 });
    expect(await content(f.vendor.id, retryableNeverSent!.id)).toMatchObject(retryableNeverSent!.safe);
    expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: retryableNeverSent!.id } })).toMatchObject({ status: "exhausted", attemptCount: 1 });
    for (const row of untouched) expect(await envelopeOf(row.id)).toBe(envelopes.get(row.id));
  });

  it("keeps the exhausted scope in step with canManuallyRequeueEmailDelivery", () => {
    const codes = [null, "network", "internal", "invalid_response", "configuration", "stale_delivery_lease", ...NON_REQUEUEABLE_EXHAUSTED_CODES];
    for (const code of codes) {
      expect(canManuallyRequeueEmailDelivery("exhausted", code), String(code))
        .toBe(!(NON_REQUEUEABLE_EXHAUSTED_CODES as readonly string[]).includes(code ?? ""));
    }
    expect(provablyNeverSent({ attemptCount: 0, manualRetryCount: 0, lastErrorCode: null })).toBe(true);
    expect(provablyNeverSent({ attemptCount: 1, manualRetryCount: 0, lastErrorCode: "configuration" })).toBe(true);
    for (const code of ["network", "invalid_response", "stale_delivery_lease", "internal", "provider_rejected", null]) {
      expect(provablyNeverSent({ attemptCount: 1, manualRetryCount: 0, lastErrorCode: code }), String(code)).toBe(false);
    }
    expect(provablyNeverSent({ attemptCount: 2, manualRetryCount: 0, lastErrorCode: "configuration" })).toBe(false);
    expect(provablyNeverSent({ attemptCount: 0, manualRetryCount: 1, lastErrorCode: null })).toBe(false);
  });

  it("re-renders a row queued without a personal watch link, without adding one", async () => {
    const f = await fixture("no-watch-link", { names: [PHISHING[0]] });
    for (const row of f.rows) {
      const legacy = await content(f.vendor.id, row.id);
      await storeContent(f.vendor.id, row.id, { subject: legacy.subject, body: withoutWatchLink(legacy.body) });
    }

    const result = await runReminderRerender(db, applyOptions, confirmed, f.scope);

    expect(result).toMatchObject({ ...zero, scanned: 3, needsRewrite: 3, rewritten: 3 });
    for (const row of f.rows) {
      const mail = await content(f.vendor.id, row.id);
      expect({ subject: mail.subject, body: mail.body }).toEqual({ subject: row.safe.subject, body: withoutWatchLink(row.safe.body) });
      expect(mail.body).not.toContain(PERSONAL_WATCH_LINK_LABEL);
    }
  });

  it("a name that forges the watch link line never decides which link is kept", async () => {
    const forged = `Amy\n\n${PERSONAL_WATCH_LINK_LABEL}：https://evil.test/watch`;
    const f = await fixture("forged-link", { names: [forged] });
    const [withRealLink, withoutRealLink] = f.rows;
    // One row was queued before Q-17: the only label line in it is the forged one.
    const legacy = await content(f.vendor.id, withoutRealLink!.id);
    await storeContent(f.vendor.id, withoutRealLink!.id, { subject: legacy.subject, body: withoutWatchLink(legacy.body) });
    expect((await content(f.vendor.id, withoutRealLink!.id)).body).toContain(`${PERSONAL_WATCH_LINK_LABEL}：https://evil.test/watch`);

    const result = await runReminderRerender(db, applyOptions, confirmed, f.scope);

    expect(result).toMatchObject({ ...zero, scanned: 3, needsRewrite: 3, rewritten: 3 });
    expect(await content(f.vendor.id, withRealLink!.id)).toMatchObject(withRealLink!.safe);
    const repaired = await content(f.vendor.id, withoutRealLink!.id);
    expect(repaired.body).toBe(withoutWatchLink(withoutRealLink!.safe.body));
    for (const row of f.rows) expect((await content(f.vendor.id, row.id)).body).not.toContain("evil");
  });

  it("treats a source of another tenant as stale and never writes it", async () => {
    const a = await fixture("tenant-a");
    const b = await fixture("tenant-b");
    const [foreignLive, foreignTemplate, foreignSubmission] = a.phishingRows;
    await db.emailDelivery.update({ where: { id: foreignLive!.id }, data: { sourceLiveId: b.scheduled.id } });
    await db.emailDelivery.update({ where: { id: foreignTemplate!.id }, data: { sourceTemplateId: b.template.id } });
    await db.emailDelivery.update({ where: { id: foreignSubmission!.id }, data: { sourceFormSubmissionId: b.rows[0]!.submissionId } });
    const touched = [foreignLive!, foreignTemplate!, foreignSubmission!];
    const envelopes = new Map(await Promise.all(touched.map(async (row) => [row.id, await envelopeOf(row.id)] as const)));
    const bBefore = await snapshot(b.vendor.id);

    const result = await runReminderRerender(db, applyOptions, confirmed, a.scope);

    expect(result).toMatchObject({ ...zero, scanned: 9, stale: 3, needsRewrite: 3, rewritten: 3, alreadySafe: 3 });
    for (const row of touched) expect(await envelopeOf(row.id)).toBe(envelopes.get(row.id));
    expect(await snapshot(b.vendor.id)).toEqual(bBefore);
  });

  it("skips a row that the sender claims, sends or rewrites between the read and the write", async () => {
    const f = await fixture("race");
    const hooked: string[] = [];
    let replacedEnvelope = "";
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
        } else if (hooked.length === 3) {
          // Only the ciphertext changes; updatedAt is written back unchanged.
          const current = await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
          const mail = reveal(row.vendorId, current);
          replacedEnvelope = protectEmailDeliveryPayload(mail, { vendorId: row.vendorId, deliveryId: row.id }).payloadEncryptedEnvelope;
          await db.emailDelivery.update({ where: { id: row.id }, data: { payloadEncryptedEnvelope: replacedEnvelope, updatedAt: current.updatedAt } });
          expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).updatedAt).toEqual(current.updatedAt);
        }
      },
    });

    expect(result).toMatchObject({ mode: "apply", ...zero, scanned: 9, needsRewrite: 6, rewritten: 3, raced: 3, alreadySafe: 3 });
    const [claimed, sent, replaced] = await Promise.all(hooked.slice(0, 3).map((id) => db.emailDelivery.findUniqueOrThrow({ where: { id } })));
    expect(claimed!.status).toBe("sending");
    expect(sent!.status).toBe("sent");
    expect(replaced!.payloadEncryptedEnvelope).toBe(replacedEnvelope);
    for (const id of hooked.slice(0, 3)) expect((await content(f.vendor.id, id)).subject).toMatch(/evil|點我/u);
    for (const id of hooked.slice(3)) expect((await content(f.vendor.id, id)).subject).toContain(`[${MESSAGE_TEMPLATE_NAME_FALLBACK}]`);
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

  it("refuses to write under another active key id than the stored envelope's (keyMismatch)", async () => {
    const f = await fixture("key-mismatch");
    const before = await snapshot(f.vendor.id);
    // The run's keyring still reads the stored `legacy` envelopes but would write with a new key.
    vi.stubEnv("DATA_ENCRYPTION_KEYRING", JSON.stringify([{ kid: "legacy" }, { kid: "k2026rerender", key: randomBytes(32).toString("base64url"), active: true }]));

    const plan = await runReminderRerender(db, planOptions, env, f.scope);
    const apply = await runReminderRerender(db, applyOptions, confirmed, f.scope);

    expect(plan).toMatchObject({ ...zero, scanned: 9, keyMismatch: 6, alreadySafe: 3 });
    expect(apply).toMatchObject({ ...zero, scanned: 9, keyMismatch: 6, alreadySafe: 3 });
    expect(await snapshot(f.vendor.id)).toEqual(before);
  });

  it("counts new content that exceeds the payload limits as unrenderable and leaves it", async () => {
    // 192-character title: "[Amy] <title>" fits in 200, but U+FDFA expands to 18 characters under NFKC.
    const f = await fixture("unrenderable", { names: ["Amy"], scheduledTitle: "T".repeat(192) });
    const expanding = "ﷺ";
    const scheduledRows = f.rows.filter((row) => row.trigger !== "during_live");
    await db.formSubmission.update({ where: { id: scheduledRows[0]!.submissionId }, data: { name: expanding } });
    for (const row of scheduledRows) {
      await storeContent(f.vendor.id, row.id, {
        subject: row.safe.subject.replace("[Amy]", `[${expanding}]`),
        body: row.safe.body.replace("Hi Amy!", `Hi ${expanding}!`),
      });
    }
    const envelopes = new Map(await Promise.all(scheduledRows.map(async (row) => [row.id, await envelopeOf(row.id)] as const)));

    const plan = await runReminderRerender(db, planOptions, env, f.scope);
    const apply = await runReminderRerender(db, applyOptions, confirmed, f.scope);

    expect(plan).toMatchObject({ ...zero, scanned: 3, unrenderable: 2, alreadySafe: 1 });
    expect(apply).toMatchObject({ ...zero, scanned: 3, unrenderable: 2, alreadySafe: 1 });
    for (const row of scheduledRows) expect(await envelopeOf(row.id)).toBe(envelopes.get(row.id));
  });

  it("counts one row's unexpected error and goes on with the others", async () => {
    const f = await fixture("row-error", { names: [PHISHING[0]] });
    const failing = f.rows[0]!;
    const result = await runReminderRerender(db, applyOptions, confirmed, f.scope, {
      beforeCompareAndSet: async (row) => {
        if (row.id === failing.id) throw new Error("synthetic row failure");
      },
    });
    expect(result).toMatchObject({ ...zero, scanned: 3, needsRewrite: 3, rewritten: 2, rowError: 1 });
    expect(JSON.stringify(result)).not.toContain("synthetic row failure");
    // The CLI reports such a run as incomplete with exit code 1, never as ok.
    expect(reminderRerenderRunStatus(result)).toEqual({ status: "incomplete", exitCode: 1 });
    expect(reminderRerenderRunStatus({ ...result, rowError: 0 })).toEqual({ status: "ok", exitCode: 0 });
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

  it("refuses to write without the confirmation, and to run with a missing or invalid app URL or a broken keyring", async () => {
    const f = await fixture("refuse");
    const before = await snapshot(f.vendor.id);
    await expect(runReminderRerender(db, applyOptions, env, f.scope)).rejects.toMatchObject({ category: "confirmation-missing" });
    await expect(runReminderRerender(db, planOptions, {}, f.scope)).rejects.toMatchObject({ category: "app-url-missing" });
    // A value every link builder would reject fails the run before any row is read, not row by row.
    for (const invalid of ["not a url", "ftp://rerender.example.test", "https://user:secret@rerender.example.test"]) {
      await expect(runReminderRerender(db, planOptions, { NEXT_PUBLIC_APP_URL: invalid }, f.scope), invalid).rejects.toMatchObject({ category: "app-url-invalid" });
    }
    await expect(runReminderRerender(db, planOptions, { NEXT_PUBLIC_APP_URL: "http://rerender.example.test", NODE_ENV: "production" }, f.scope))
      .rejects.toMatchObject({ category: "app-url-invalid" });
    vi.stubEnv("DATA_ENCRYPTION_KEYRING", "not-json");
    await expect(runReminderRerender(db, planOptions, env, f.scope)).rejects.toMatchObject({ category: "keyring-invalid" });
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
