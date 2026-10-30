import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { ensureLiveNotificationDelivery, supersedeLiveNotificationDeliveriesForLifecycle } from "@/lib/live-notification-delivery";

/**
 * B-3: live notification materialization at READ COMMITTED under row locks,
 * against the disposable loopback PostgreSQL the Vitest config asserts.
 * Synthetic vendors only; each is removed with cascades afterwards.
 */

const vendorIds: string[] = [];
beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "live-notification-delivery-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://live-notification-delivery.example.test");
});
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture(label: string) {
  const db = getDb();
  const suffix = `${label}-${randomUUID()}`;
  const vendor = await db.vendor.create({
    data: { name: `Notify ${label}`, slug: `notify-${suffix}`, email: `notify-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Form", slug: `notify-form-${suffix}`, headline: "Synthetic", fields: [] } });
  const template = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "Reminder", channel: "email", trigger: "live_reminder", subject: "{{live_title}}", body: "Hello {{name}}\n{{unsubscribe_url}}", isActive: true },
  });
  const live = await db.live.create({
    data: { vendorId: vendor.id, formId: form.id, title: "Synthetic live", slug: `notify-live-${suffix}`, scheduledAt: new Date(Date.now() + 30 * 24 * 60 * 60_000), status: "scheduled" },
  });
  const rule = await db.liveNotificationRule.create({
    data: { vendorId: vendor.id, liveId: live.id, messageTemplateId: template.id, trigger: "before_live", offsetMinutes: 60 },
  });
  const submission = await db.formSubmission.create({
    data: { formId: form.id, liveId: live.id, name: "Lead", email: `lead-${suffix}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
  const input = { vendorId: vendor.id, liveId: live.id, ruleId: rule.id, submissionId: submission.id };
  return { vendor, template, live, rule, submission, input };
}

const materialize = (input: Parameters<typeof ensureLiveNotificationDelivery>[0]) =>
  ensureLiveNotificationDelivery(input, new Date(), { scheduleFuture: true });

function rowsOf(vendorId: string) {
  return getDb().emailDelivery.findMany({
    where: { vendorId },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, lastErrorCode: true },
  });
}

async function waitingOnLock(pattern: string) {
  for (let poll = 0; poll < 200; poll += 1) {
    const [row] = await getDb().$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${pattern}`;
    if ((row?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`no backend waited on a lock for ${pattern}`);
}

/** Holds the registration row lock so a materialization stops after its Live FOR SHARE. */
async function holdRegistration(submissionId: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held!: () => void;
  const holding = new Promise<void>((resolve) => { held = resolve; });
  const done = getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "FormSubmission" WHERE "id" = ${submissionId} FOR NO KEY UPDATE`;
    held();
    await gate;
  }, { timeout: 30_000 });
  await holding;
  return { release: async () => { release(); await done; } };
}

describe("live notification materialization (disposable PostgreSQL, B-3)", () => {
  it("binds every id to the vendor: a mixed or foreign id locks and writes nothing", async () => {
    const [a, b] = [await fixture("tenant-a"), await fixture("tenant-b")];

    await expect(materialize({ ...a.input, vendorId: b.vendor.id })).resolves.toEqual({ status: "not_configured" });
    await expect(materialize({ ...a.input, ruleId: b.rule.id })).resolves.toEqual({ status: "not_configured" });
    await expect(materialize({ ...a.input, submissionId: b.submission.id })).resolves.toEqual({ status: "not_configured" });
    await expect(materialize({ ...b.input, liveId: a.live.id })).resolves.toEqual({ status: "not_configured" });
    expect(await rowsOf(a.vendor.id)).toEqual([]);
    expect(await rowsOf(b.vendor.id)).toEqual([]);

    await expect(materialize(a.input)).resolves.toMatchObject({ status: "queued" });
    expect(await rowsOf(a.vendor.id)).toHaveLength(1);
    expect(await rowsOf(b.vendor.id)).toEqual([]);
  });

  it("keeps one active row per recipient and rule across config changes, reactivates a returning snapshot and never re-sends", async () => {
    const db = getDb();
    const f = await fixture("config");
    const first = await materialize(f.input);
    expect(first).toMatchObject({ status: "queued" });
    await expect(materialize(f.input)).resolves.toEqual({ status: "duplicate", deliveryId: (first as { deliveryId: string }).deliveryId });

    // Template content changes: a new snapshot id; the old row is superseded in the same step.
    await db.messageTemplate.update({ where: { id: f.template.id }, data: { body: "Changed {{name}}\n{{unsubscribe_url}}" } });
    const second = await materialize(f.input);
    expect(second).toMatchObject({ status: "queued" });
    expect(await rowsOf(f.vendor.id)).toEqual([
      { id: (first as { deliveryId: string }).deliveryId, status: "superseded", lastErrorCode: "config_superseded" },
      { id: (second as { deliveryId: string }).deliveryId, status: "queued", lastErrorCode: null },
    ]);

    // Back to the original content: the original row is reactivated, the other superseded.
    await db.messageTemplate.update({ where: { id: f.template.id }, data: { body: "Hello {{name}}\n{{unsubscribe_url}}" } });
    await expect(materialize(f.input)).resolves.toEqual({ status: "reactivated", deliveryId: (first as { deliveryId: string }).deliveryId });
    expect((await rowsOf(f.vendor.id)).map((row) => row.status)).toEqual(["queued", "superseded"]);

    // Once one snapshot was sent, no further row is written for this recipient and rule.
    await db.emailDelivery.update({ where: { id: (first as { deliveryId: string }).deliveryId }, data: { status: "sent", sentAt: new Date(), nextAttemptAt: null } });
    await db.messageTemplate.update({ where: { id: f.template.id }, data: { body: "Third {{name}}\n{{unsubscribe_url}}" } });
    await expect(materialize(f.input)).resolves.toEqual({ status: "already_sent" });
    expect(await rowsOf(f.vendor.id)).toHaveLength(2);
  });

  it("makes a lifecycle change wait for an in-flight materialization so its supersede sees that row", async () => {
    const db = getDb();
    const f = await fixture("lifecycle");
    const holder = await holdRegistration(f.submission.id);
    const materialized = materialize(f.input);
    await waitingOnLock('%JOIN "FormSubmission" s%');

    // The same shape as the live update action: READ COMMITTED, update the Live, then supersede.
    const started = db.$transaction(async (tx) => {
      await tx.live.update({ where: { id: f.live.id, vendorId: f.vendor.id }, data: { status: "live", startedAt: new Date() } });
      await supersedeLiveNotificationDeliveriesForLifecycle(tx, { vendorId: f.vendor.id, liveId: f.live.id, triggers: ["before_live"] });
    }, { timeout: 30_000 });
    await waitingOnLock('UPDATE "public"."Live"%');

    await holder.release();
    const result = await materialized;
    expect(result).toMatchObject({ status: "queued" });
    await started;

    expect(await rowsOf(f.vendor.id)).toEqual([
      { id: (result as { deliveryId: string }).deliveryId, status: "superseded", lastErrorCode: "lifecycle_superseded" },
    ]);
    // A materialization after the start writes nothing for before_live.
    await expect(materialize(f.input)).resolves.toEqual({ status: "not_due" });
  });

  it("lets a different recipient finish while another recipient's materialization is in flight", async () => {
    const db = getDb();
    const f = await fixture("independent");
    const other = await db.formSubmission.create({
      data: { formId: f.live.formId!, liveId: f.live.id, name: "Other", email: `other-${randomUUID()}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
    });
    const holder = await holdRegistration(f.submission.id);
    // In flight: holds Live, rule and template FOR SHARE and waits for its registration.
    const blocked = materialize(f.input);
    try {
      await waitingOnLock('%JOIN "FormSubmission" s%');
      await expect(materialize({ ...f.input, submissionId: other.id })).resolves.toMatchObject({ status: "queued" });
    } finally {
      await holder.release();
    }
    await expect(blocked).resolves.toMatchObject({ status: "queued" });
    expect((await rowsOf(f.vendor.id)).map((row) => row.status)).toEqual(["queued", "queued"]);
  });
});
