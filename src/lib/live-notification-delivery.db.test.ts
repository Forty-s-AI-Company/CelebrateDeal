import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({ vendorId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: vi.fn() }));
vi.mock("@/lib/auth", () => {
  const context = async () => ({ auth: { user: { id: "user-synthetic" }, member: { role: "owner" } }, vendor: { id: ctx.vendorId, timezone: "Asia/Taipei" } });
  return { requireVendorManagerContext: context, requireVendorManager: async () => (await context()).vendor };
});

import { upsertTemplateAction } from "@/app/actions/webinar-resource-actions";
import { getDb } from "@/lib/db";
import {
  ensureLiveNotificationDelivery,
  processLegacyReminderCutovers,
  supersedeLiveNotificationDeliveriesForLifecycle,
} from "@/lib/live-notification-delivery";
import { isLockTimeout } from "@/lib/serializable-retry";

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

  it("makes a template edit wait for an in-flight materialization and supersede the row it committed (M-1)", async () => {
    const f = await fixture("template-edit");
    ctx.vendorId = f.vendor.id;
    const holder = await holdRegistration(f.submission.id);
    const materialized = materialize(f.input);
    await waitingOnLock('%JOIN "FormSubmission" s%');

    // The real Server Action: its template update waits on the materializer's template FOR SHARE.
    const form = new FormData();
    form.set("id", f.template.id);
    form.set("expectedUpdatedAt", f.template.updatedAt.toISOString());
    form.set("name", "Reminder");
    form.set("channel", "email");
    form.set("trigger", "live_reminder");
    form.set("subject", "{{live_title}}");
    form.set("body", "Edited {{name}}\n{{unsubscribe_url}}");
    form.set("isActive", "on");
    const edited = upsertTemplateAction({ status: "idle", version: 0 } as never, form);
    const editedOutcome = expect(edited).rejects.toThrow("REDIRECT:/messages/templates");
    await waitingOnLock('UPDATE "public"."MessageTemplate"%');

    await holder.release();
    const result = await materialized;
    expect(result).toMatchObject({ status: "queued" });
    await editedOutcome;

    // The edit's supersede ran after its wait and saw the old-content row.
    expect(await rowsOf(f.vendor.id)).toEqual([
      { id: (result as { deliveryId: string }).deliveryId, status: "superseded", lastErrorCode: "config_superseded" },
    ]);
    // The next materialization uses the edited content.
    const next = await materialize(f.input);
    expect(next).toMatchObject({ status: "queued" });
    expect((next as { deliveryId: string }).deliveryId).not.toBe((result as { deliveryId: string }).deliveryId);
  });

  it("orders the legacy cutover after an in-flight materialization: no deadlock, no partial cutover (m-1)", async () => {
    const db = getDb();
    const f = await fixture("cutover");
    // A legacy reminder binding with an equivalent before_live rule makes the Live a cutover candidate.
    await db.live.update({ where: { id: f.live.id }, data: { liveReminderTemplateId: f.template.id, liveReminderOffsetMinutes: 60 } });
    const holder = await holdRegistration(f.submission.id);
    const materialized = materialize(f.input);
    await waitingOnLock('%JOIN "FormSubmission" s%');

    // The cutover's first statement is its Live lock; it waits there, holding nothing.
    const cutover = processLegacyReminderCutovers({ vendorId: f.vendor.id });
    await waitingOnLock('%FROM "Live"%FOR NO KEY UPDATE%');

    await holder.release();
    await expect(materialized).resolves.toMatchObject({ status: "queued" });
    // The materializer's row already covers the recipient: the cutover writes nothing.
    await expect(cutover).resolves.toEqual([{ status: "duplicate_conflict" }]);
    expect(await rowsOf(f.vendor.id)).toHaveLength(1);
    expect((await db.live.findUniqueOrThrow({ where: { id: f.live.id }, select: { liveReminderTemplateId: true } })).liveReminderTemplateId).toBe(f.template.id);
  });

  it("bounds the wait on a held registration with lock_timeout, re-runs it and then gives up without writing (m-2)", async () => {
    const f = await fixture("lock-timeout");
    const holder = await holdRegistration(f.submission.id);
    const started = Date.now();
    let failure: unknown;
    try {
      await materialize(f.input);
    } catch (error) {
      failure = error;
    } finally {
      await holder.release();
    }
    const elapsed = Date.now() - started;
    expect(isLockTimeout(failure)).toBe(true);
    // Three attempts of about 2 s each, far below an unbounded wait.
    expect(elapsed).toBeGreaterThanOrEqual(5_500);
    expect(elapsed).toBeLessThan(12_000);
    expect(await rowsOf(f.vendor.id)).toEqual([]);
    // Once the registration is free the same call succeeds.
    await expect(materialize(f.input)).resolves.toMatchObject({ status: "queued" });
  }, 30_000);
});
