import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// R-10 on real PostgreSQL: the runner's synthetic merchant is built with the
// same rows registration, the onboarding questionnaire, the live studio and a
// public registration create. Only the mail transport is synthetic.
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/email", async (original) => ({
  ...await original<typeof import("@/lib/email")>(),
  sendTransactionalEmail: mail.send,
}));

import { getDb } from "@/lib/db";
import { dispatchEmailDelivery, ensureFormSubmissionVerificationDelivery, processDueEmailDeliveries } from "@/lib/email-delivery";
import { firstSuccessBuyerEmail, firstSuccessOwnerEmail } from "@/lib/staging-first-success";
import {
  FIRST_SUCCESS_CLEANUP_DELETED_AUDIT_ACTION,
  FIRST_SUCCESS_CLEANUP_REASON,
  FIRST_SUCCESS_CLEANUP_RETENTION_MS,
  runFirstSuccessCleanup,
} from "@/lib/staging-first-success-cleanup";
import { createStudentPortalAccessToken } from "@/lib/student-portal-auth";
import { isVendorAvailableForPublic } from "@/lib/vendor-suspension";

const db = getDb();
const vendorIds: string[] = [];
const userIds: string[] = [];
const DAY = 24 * 60 * 60 * 1_000;

/** The disposable loopback permit of isWp4BoundNonProductionRuntime (never valid on Vercel). */
const STAGING_LIKE_ENV = {
  VERCEL_ENV: "preview",
  PAYUNI_ENV: "sandbox",
  WP4_SANDBOX_EXECUTOR_ENABLED: "true",
  WP4_DISPOSABLE_RUNNER_MARKER: "verified-loopback",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3999",
  DATABASE_URL: "postgresql://synthetic@127.0.0.1:54383/celebratedeal_test",
  DIRECT_URL: "postgresql://synthetic@127.0.0.1:54383/celebratedeal_test",
};

type Tenant = {
  vendorId: string; ownerId: string; runId: string; liveId: string; projectId: string; formId: string;
  submissionId: string; deliveryId: string | null;
};

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "first-success-cleanup-disposable-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://first-success-cleanup.example.test");
  mail.send.mockResolvedValue({ id: "synthetic-provider-id" });
});

afterEach(async () => {
  mail.send.mockReset();
  const ids = vendorIds.splice(0);
  await db.live.deleteMany({ where: { vendorId: { in: ids } } });
  await db.registrationForm.deleteMany({ where: { vendorId: { in: ids } } });
  await db.userOnboardingPreference.deleteMany({ where: { vendorId: { in: ids } } });
  await db.vendor.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await db.auditLog.deleteMany({ where: { actorLabel: "job:staging-first-success-cleanup" } });
  vi.unstubAllEnvs();
});

function newRunId() {
  return randomBytes(12).toString("hex");
}

/**
 * Same rows the O-13 journey leaves: registration (user, vendor, owner member,
 * onboarding preference, consent, audit, session), questionnaire (project +
 * task states), product, form, video, template, scheduled live bound to the
 * project with its product, published project, a buyer registration and its
 * queued verification email.
 */
async function createRunnerTenant(options: {
  runId?: string; ownerEmail?: string; slug?: string; name?: string; queueEmail?: boolean;
} = {}): Promise<Tenant> {
  const runId = options.runId ?? newRunId();
  const short = runId.slice(0, 10);
  const email = options.ownerEmail ?? firstSuccessOwnerEmail(runId);
  const user = await db.user.create({ data: { name: `Synthetic owner ${short}`, email, passwordHash: "synthetic-only" } });
  userIds.push(user.id);
  const vendor = await db.vendor.create({
    data: { name: options.name ?? `Synthetic workspace ${short}`, slug: options.slug ?? `synthetic-workspace-${short}-${randomUUID()}`, email, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  await db.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: "owner", status: "active" } });
  await db.userPolicyConsent.create({ data: { userId: user.id, vendorId: vendor.id, context: "merchant_registration", termsVersion: "t1", privacyVersion: "p1" } });
  await db.auditLog.create({ data: { vendorId: vendor.id, actorId: user.id, actorLabel: "owner", action: "registration_completed", targetType: "User", targetId: user.id } });
  await db.userSession.create({ data: { userId: user.id, vendorId: vendor.id, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + DAY) } });
  const project = await db.salesProject.create({
    data: { vendorId: vendor.id, name: "我的第一個銷售專案", slug: "first-sales-project", mode: "live_course", primaryFlow: "live", status: "published", publishedAt: new Date() },
  });
  await db.userOnboardingPreference.create({ data: { userId: user.id, vendorId: vendor.id, questionnaireStep: 4, selectedProjectId: project.id } });
  await db.onboardingTaskState.create({ data: { vendorId: vendor.id, projectId: project.id, scopeKey: project.id, taskKey: "create_live", status: "not_started" } });
  const product = await db.product.create({ data: { vendorId: vendor.id, name: `CDFS ${runId.slice(0, 8)} 商品`, slug: `cdfs-product-${short}`, priceCents: 99_000, isActive: true } });
  await db.salesProjectProduct.create({ data: { vendorId: vendor.id, projectId: project.id, productId: product.id } });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id, projectId: project.id, name: `CDFS ${runId.slice(0, 8)} 報名表`, slug: `cdfs-form-${short}`, headline: "報名",
      fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
    },
  });
  const video = await db.video.create({ data: { vendorId: vendor.id, title: "影片", videoUrl: "https://example.com/celebratedeal-synthetic-first-success.mp4", durationSec: 600, status: "ready" } });
  const template = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "報名成功信", trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} 您好\n{{unsubscribe_url}}" },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id, projectId: project.id, formId: form.id, videoId: video.id, messageTemplateId: template.id,
      title: `CDFS ${runId.slice(0, 8)} Live`, slug: `cdfs-live-${short}-${randomUUID().slice(0, 8)}`,
      scheduledAt: new Date(Date.now() + 3 * DAY), status: "scheduled", streamMode: "vod",
    },
  });
  await db.liveProduct.create({ data: { vendorId: vendor.id, liveId: live.id, productId: product.id } });
  const member = await db.vendorMember.findFirstOrThrow({ where: { vendorId: vendor.id, userId: user.id } });
  await db.liveStudioDraft.create({ data: { vendorId: vendor.id, liveId: live.id, payload: {}, updatedByMemberId: member.id, expiresAt: new Date(Date.now() + DAY), consumedAt: new Date() } });
  // Public page views reference both the project (RESTRICT) and the live (SET NULL).
  await db.analyticsEvent.create({ data: { vendorId: vendor.id, projectId: project.id, liveId: live.id, eventType: "page_view", visitorId: `cdfs-visitor-${short}` } });
  const submission = await db.formSubmission.create({
    data: { formId: form.id, liveId: live.id, name: `Synthetic buyer ${short}`, email: firstSuccessBuyerEmail(runId), source: "live", verificationExpiresAt: new Date(Date.now() + 2 * DAY) },
  });
  let deliveryId: string | null = null;
  if (options.queueEmail !== false) {
    await ensureFormSubmissionVerificationDelivery({
      vendorId: vendor.id, vendorName: vendor.name, liveId: live.id, formSubmissionId: submission.id,
      recipientName: submission.name, recipientEmail: submission.email, verificationVersion: submission.verificationVersion,
      verificationExpiresAt: submission.verificationExpiresAt!,
      emailBrand: { senderName: null, supportEmail: null, contactUrl: null },
    });
    const delivery = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: vendor.id, sourceFormSubmissionId: submission.id } });
    await db.emailDelivery.update({ where: { id: delivery.id }, data: { nextAttemptAt: new Date(Date.now() - 60_000) } });
    deliveryId = delivery.id;
  }
  await createStudentPortalAccessToken(db, { vendorId: vendor.id, email: firstSuccessBuyerEmail(runId), purpose: "magic_link" });
  return { vendorId: vendor.id, ownerId: user.id, runId, liveId: live.id, projectId: project.id, formId: form.id, submissionId: submission.id, deliveryId };
}

/** A pending (unpaid) order is already a finance record the cleanup must not touch. */
async function createPendingOrder(vendorId: string) {
  await db.commerceOrder.create({
    data: {
      vendorId, orderNumber: `CDFS-${randomUUID()}`, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: randomBytes(32).toString("base64url"),
      subtotalAmountCents: 99_000, totalAmountCents: 99_000, buyerEncryptedEnvelope: "synthetic", buyerMaskedName: "S***", buyerMaskedEmail: "d***@resend.dev",
    },
  });
}

async function vendorState(vendorId: string) {
  return db.vendor.findUnique({ where: { id: vendorId }, select: { suspendedAt: true, suspendedReason: true } });
}

/** Every row in any table with a vendorId / user-reference column that still points at the deleted ids. */
async function leftoverRows(vendorId: string, userId: string) {
  const columns = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN ('vendorId', 'userId', 'ownerUserId', 'acceptedUserId', 'invitedByUserId', 'createdById')`;
  const leftovers: string[] = [];
  for (const { table_name: table, column_name: column } of columns) {
    const id = column === "vendorId" ? vendorId : userId;
    const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "${table.replaceAll('"', "")}" WHERE "${column.replaceAll('"', "")}" = $1`, id);
    if (Number(rows[0]?.count ?? 0) > 0) leftovers.push(`${table}.${column}`);
  }
  return leftovers;
}

describe("first-success cleanup boundary", () => {
  it("refuses outside the bound staging runtime without reading or writing anything", async () => {
    const tenant = await createRunnerTenant();
    for (const env of [
      { ...STAGING_LIKE_ENV, VERCEL_ENV: "production" },
      { ...STAGING_LIKE_ENV, PAYUNI_ENV: "production" },
      { ...STAGING_LIKE_ENV, WP4_SANDBOX_EXECUTOR_ENABLED: undefined },
      { ...STAGING_LIKE_ENV, VERCEL_PROJECT_ID: "prj_production_project" },
      { ...STAGING_LIKE_ENV, DATABASE_URL: "postgresql://synthetic@db.example.test:5432/postgres" },
      {},
    ]) {
      for (const mode of ["deactivate", "delete"] as const) {
        const receipt = await runFirstSuccessCleanup({ mode, env, now: new Date(Date.now() + 30 * DAY) });
        expect(receipt).toMatchObject({ result: "REFUSED", examined: 0, deactivated: 0, deleted: 0 });
      }
    }
    // process.env of this test process is not a staging runtime either.
    await expect(runFirstSuccessCleanup({ mode: "deactivate" })).resolves.toMatchObject({ result: "REFUSED" });
    await expect(vendorState(tenant.vendorId)).resolves.toEqual({ suspendedAt: null, suspendedReason: null });
    expect(await db.auditLog.count({ where: { actorLabel: "job:staging-first-success-cleanup" } })).toBe(0);
  });
});

describe("first-success cleanup on PostgreSQL", () => {
  it("deactivates only runner vendors and leaves look-alikes, other mailboxes and paying vendors alone", async () => {
    const runner = await createRunnerTenant();
    const lookAlikeName = await createRunnerTenant({ ownerEmail: `owner-${randomUUID()}@example.test`, queueEmail: false });
    const lookAlikeId = newRunId();
    const buyerMailbox = await createRunnerTenant({ runId: lookAlikeId, ownerEmail: `delivered+cdfs-buyer-${lookAlikeId}@resend.dev`, queueEmail: false });
    const shortRun = await createRunnerTenant({ ownerEmail: `delivered+cdfs-owner-${newRunId().slice(0, 23)}@resend.dev`, queueEmail: false });
    const otherSlug = await createRunnerTenant({ slug: `wuhe-select-${randomUUID()}`, queueEmail: false });
    const mismatchedSlug = await createRunnerTenant({ slug: `synthetic-workspace-${newRunId().slice(0, 10)}-${randomUUID()}`, queueEmail: false });
    const withMember = await createRunnerTenant({ queueEmail: false });
    const staff = await db.user.create({ data: { name: "Real staff", email: `staff-${randomUUID()}@example.test`, passwordHash: "synthetic-only" } });
    userIds.push(staff.id);
    await db.vendorMember.create({ data: { vendorId: withMember.vendorId, userId: staff.id, role: "admin", status: "active" } });
    const paying = await createRunnerTenant({ queueEmail: false });
    await createPendingOrder(paying.vendorId);
    const adminSuspended = await createRunnerTenant({ queueEmail: false });
    await db.vendor.update({ where: { id: adminSuspended.vendorId }, data: { suspendedAt: new Date(Date.now() - 30 * DAY), suspendedReason: "平台管理員凍結" } });

    const receipt = await runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV });
    expect(receipt).toMatchObject({
      mode: "deactivate", result: "COMPLETED", deactivated: 1, deleted: 0, failed: 0, alreadyDeactivated: 0,
      // `otherSlug` is not even a candidate: the SQL filter needs the synthetic-workspace- slug prefix.
      skipped: { financialRecords: 1, unexpectedMembership: 1, notRunnerVendor: 2, notEligible: 0 },
      affected: { lives: 1, registrations: 1, projects: 1, queuedEmailDeliveries: 1, ownerUsers: 0 },
    });
    expect(receipt.runIdPrefixes.processed).toEqual([runner.runId.slice(0, 8)]);
    expect(receipt.runIdPrefixes.skipped).toEqual(expect.arrayContaining([paying.runId.slice(0, 8), withMember.runId.slice(0, 8)]));
    const serialized = JSON.stringify(receipt);
    for (const forbidden of ["@", "resend", runner.runId, runner.vendorId, "synthetic-workspace", "Synthetic"]) expect(serialized).not.toContain(forbidden);

    const runnerState = await vendorState(runner.vendorId);
    expect(runnerState).toMatchObject({ suspendedAt: expect.any(Date), suspendedReason: FIRST_SUCCESS_CLEANUP_REASON });
    await expect(isVendorAvailableForPublic(db, runner.vendorId)).resolves.toBe(false);
    expect(await db.studentPortalAccessToken.count({ where: { vendorId: runner.vendorId } })).toBe(0);
    for (const untouched of [lookAlikeName, buyerMailbox, shortRun, otherSlug, mismatchedSlug, withMember, paying]) {
      await expect(vendorState(untouched.vendorId)).resolves.toEqual({ suspendedAt: null, suspendedReason: null });
    }
    await expect(vendorState(adminSuspended.vendorId)).resolves.toMatchObject({ suspendedReason: "平台管理員凍結" });
    // Nothing is deleted in deactivate mode.
    expect(await db.live.count({ where: { vendorId: runner.vendorId } })).toBe(1);
    expect(await db.formSubmission.count({ where: { id: runner.submissionId } })).toBe(1);

    const audit = await db.auditLog.findFirstOrThrow({ where: { vendorId: runner.vendorId, action: "vendor_suspended" } });
    expect(audit).toMatchObject({ actorId: null, actorLabel: "job:staging-first-success-cleanup", after: expect.objectContaining({ reason: FIRST_SUCCESS_CLEANUP_REASON, runIdPrefix: runner.runId.slice(0, 8) }) });
    const summary = await db.auditLog.findFirstOrThrow({ where: { action: "staging_first_success_cleanup", vendorId: null } });
    expect(summary.targetId).toBe("deactivate");
    expect(JSON.stringify(summary.after)).not.toContain("@");
  });

  it("stops the email job for a deactivated vendor while other vendors still send", async () => {
    const runner = await createRunnerTenant();
    const control = await createRunnerTenant({ ownerEmail: `owner-${randomUUID()}@example.test` });
    await runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV });

    const results = await processDueEmailDeliveries(50);
    const ids = results.map((row) => row.deliveryId);
    expect(ids).not.toContain(runner.deliveryId);
    expect(ids).toContain(control.deliveryId);
    await expect(dispatchEmailDelivery(runner.deliveryId!)).resolves.toEqual({ status: "vendor_suspended" });
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: runner.deliveryId! } })).resolves.toMatchObject({ status: "queued", attemptCount: 0 });
    const recipients = mail.send.mock.calls.map((call) => JSON.stringify(call));
    expect(recipients.some((call) => call.includes(firstSuccessBuyerEmail(runner.runId)))).toBe(false);
    expect(recipients.some((call) => call.includes(firstSuccessBuyerEmail(control.runId)))).toBe(true);
  });

  it("is idempotent, keeps the retention window and deletes without orphans", async () => {
    const runner = await createRunnerTenant();
    const bystander = await createRunnerTenant({ ownerEmail: `owner-${randomUUID()}@example.test`, queueEmail: false });
    const t0 = new Date();
    await expect(runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV, now: t0 })).resolves.toMatchObject({ deactivated: 1 });
    // Second deactivate: nothing new, the vendor is reported as already held.
    await expect(runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV, now: new Date(t0.getTime() + 60_000) }))
      .resolves.toMatchObject({ result: "COMPLETED", examined: 0, deactivated: 0, alreadyDeactivated: 1 });

    // Inside the retention window nothing can be deleted, even one minute before it ends.
    const early = await runFirstSuccessCleanup({ mode: "delete", env: STAGING_LIKE_ENV, now: new Date(t0.getTime() + FIRST_SUCCESS_CLEANUP_RETENTION_MS - 60_000) });
    expect(early).toMatchObject({ result: "COMPLETED", examined: 0, deleted: 0, retained: 1 });
    expect(await db.vendor.count({ where: { id: runner.vendorId } })).toBe(1);

    // A vendor that was never deactivated is not a delete candidate at all.
    const fresh = await createRunnerTenant({ queueEmail: false });

    const after = new Date(t0.getTime() + FIRST_SUCCESS_CLEANUP_RETENTION_MS + 60_000);
    const deleted = await runFirstSuccessCleanup({ mode: "delete", env: STAGING_LIKE_ENV, now: after });
    expect(deleted).toMatchObject({
      mode: "delete", result: "COMPLETED", examined: 1, deleted: 1, failed: 0, retained: 0,
      affected: { lives: 1, registrations: 1, projects: 1, queuedEmailDeliveries: 1, ownerUsers: 1 },
    });
    expect(deleted.runIdPrefixes.processed).toEqual([runner.runId.slice(0, 8)]);
    expect(await db.vendor.count({ where: { id: runner.vendorId } })).toBe(0);
    expect(await db.user.count({ where: { id: runner.ownerId } })).toBe(0);
    expect(await db.formSubmission.count({ where: { id: runner.submissionId } })).toBe(0);
    expect(await db.emailDelivery.count({ where: { id: runner.deliveryId! } })).toBe(0);
    await expect(leftoverRows(runner.vendorId, runner.ownerId)).resolves.toEqual([]);
    // The audit trail survives without the vendor: its own history plus one deletion record.
    expect(await db.auditLog.count({ where: { targetId: runner.ownerId, action: "registration_completed" } })).toBe(1);
    await expect(db.auditLog.findFirstOrThrow({ where: { action: FIRST_SUCCESS_CLEANUP_DELETED_AUDIT_ACTION, targetId: runner.vendorId } }))
      .resolves.toMatchObject({ vendorId: null, after: expect.objectContaining({ deleted: true, ownerUsers: 1 }) });

    // Others are untouched; the fresh runner vendor still runs normally until it is deactivated first.
    await expect(vendorState(bystander.vendorId)).resolves.toEqual({ suspendedAt: null, suspendedReason: null });
    await expect(vendorState(fresh.vendorId)).resolves.toEqual({ suspendedAt: null, suspendedReason: null });
    expect(await db.live.count({ where: { vendorId: { in: [bystander.vendorId, fresh.vendorId] } } })).toBe(2);

    // Running delete again is a no-op.
    await expect(runFirstSuccessCleanup({ mode: "delete", env: STAGING_LIKE_ENV, now: after }))
      .resolves.toMatchObject({ result: "COMPLETED", examined: 0, deleted: 0, failed: 0 });
  });

  it("rolls a vendor back completely when any step of its deletion fails, and continues with the next", async () => {
    const broken = await createRunnerTenant();
    const healthy = await createRunnerTenant({ queueEmail: false });
    const t0 = new Date();
    await runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV, now: t0 });
    // The owner User delete fails after the vendor row (and its cascade) was already removed in the same transaction.
    const failingDb = {
      vendor: db.vendor,
      auditLog: db.auditLog,
      $transaction: ((callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { timeout?: number }) => db.$transaction((tx) => callback(new Proxy(tx, {
        get(target, property, receiver) {
          if (property !== "user") return Reflect.get(target, property, receiver);
          // Every other User call (lock, counts) still reaches the real delegate.
          return new Proxy(target.user, {
            get(users, method, usersReceiver) {
              if (method !== "deleteMany") return Reflect.get(users, method, usersReceiver);
              return async (args: Prisma.UserDeleteManyArgs) => {
                if (args.where?.id === broken.ownerId) throw new Error("synthetic owner delete failure");
                return users.deleteMany(args);
              };
            },
          });
        },
      })), options)) as typeof db.$transaction,
    };
    const receipt = await runFirstSuccessCleanup({ mode: "delete", env: STAGING_LIKE_ENV, db: failingDb, now: new Date(t0.getTime() + 8 * DAY) });
    expect(receipt).toMatchObject({ result: "PARTIAL", examined: 2, deleted: 1, failed: 1 });
    expect(receipt.runIdPrefixes.failed).toEqual([broken.runId.slice(0, 8)]);
    expect(receipt.runIdPrefixes.processed).toEqual([healthy.runId.slice(0, 8)]);
    await expect(vendorState(broken.vendorId)).resolves.toMatchObject({ suspendedReason: FIRST_SUCCESS_CLEANUP_REASON });
    expect(await db.live.count({ where: { id: broken.liveId } })).toBe(1);
    expect(await db.formSubmission.count({ where: { id: broken.submissionId } })).toBe(1);
    expect(await db.user.count({ where: { id: broken.ownerId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: FIRST_SUCCESS_CLEANUP_DELETED_AUDIT_ACTION, targetId: broken.vendorId } })).toBe(0);
    expect(await db.vendor.count({ where: { id: healthy.vendorId } })).toBe(0);
  });

  it("never deletes a deactivated vendor that later gained an order, billing rows or a member", async () => {
    const paying = await createRunnerTenant({ queueEmail: false });
    const joined = await createRunnerTenant({ queueEmail: false });
    const limited = await createRunnerTenant({ queueEmail: false });
    const metered = await createRunnerTenant({ queueEmail: false });
    const t0 = new Date();
    await expect(runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV, now: t0 })).resolves.toMatchObject({ deactivated: 4 });
    await createPendingOrder(paying.vendorId);
    // One-to-one (VendorUsageLimit) and list (UsageRecord) billing rows are finance records too.
    await db.vendorUsageLimit.create({ data: { vendorId: limited.vendorId, resetAt: new Date(t0.getTime() + 30 * DAY) } });
    await db.usageRecord.create({ data: { vendorId: metered.vendorId, recordType: "monthly_usage_snapshot", quantity: 0, unit: "minute" } });
    const staff = await db.user.create({ data: { name: "Real staff", email: `staff-${randomUUID()}@example.test`, passwordHash: "synthetic-only" } });
    userIds.push(staff.id);
    await db.vendorMember.create({ data: { vendorId: joined.vendorId, userId: staff.id, role: "admin", status: "active" } });

    const receipt = await runFirstSuccessCleanup({ mode: "delete", env: STAGING_LIKE_ENV, now: new Date(t0.getTime() + 30 * DAY) });
    expect(receipt).toMatchObject({ result: "COMPLETED", deleted: 0, failed: 0, skipped: { financialRecords: 3, unexpectedMembership: 1 } });
    expect(await db.vendor.count({ where: { id: { in: [paying.vendorId, joined.vendorId, limited.vendorId, metered.vendorId] } } })).toBe(4);
    expect(await db.vendorUsageLimit.count({ where: { vendorId: limited.vendorId } })).toBe(1);
    expect(await db.usageRecord.count({ where: { vendorId: metered.vendorId } })).toBe(1);
    expect(await db.commerceOrder.count({ where: { vendorId: paying.vendorId } })).toBe(1);
    expect(await db.user.count({ where: { id: staff.id } })).toBe(1);
  });

  it("skipped vendors never pin the batch, and a cut-off batch reports PARTIAL", async () => {
    // Three older runner vendors that are always skipped, then two eligible ones.
    const skipped: Tenant[] = [];
    for (let index = 0; index < 3; index += 1) {
      const tenant = await createRunnerTenant({ queueEmail: false });
      await createPendingOrder(tenant.vendorId);
      skipped.push(tenant);
    }
    const first = await createRunnerTenant({ queueEmail: false });
    const second = await createRunnerTenant({ queueEmail: false });

    const one = await runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV, limits: { batch: 1, examine: 10 } });
    expect(one).toMatchObject({ result: "PARTIAL", truncated: true, examined: 4, deactivated: 1, failed: 0, skipped: { financialRecords: 3 } });
    expect(one.runIdPrefixes.processed).toEqual([first.runId.slice(0, 8)]);
    const two = await runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV, limits: { batch: 1, examine: 10 } });
    expect(two).toMatchObject({ result: "COMPLETED", truncated: false, examined: 4, deactivated: 1, alreadyDeactivated: 1 });
    expect(two.runIdPrefixes.processed).toEqual([second.runId.slice(0, 8)]);

    // The examine bound also cuts the scan off (and says so) instead of running unbounded.
    const third = await createRunnerTenant({ queueEmail: false });
    const capped = await runFirstSuccessCleanup({ mode: "deactivate", env: STAGING_LIKE_ENV, limits: { batch: 5, examine: 2 } });
    expect(capped).toMatchObject({ result: "PARTIAL", truncated: true, examined: 2, deactivated: 0 });
    await expect(vendorState(third.vendorId)).resolves.toEqual({ suspendedAt: null, suspendedReason: null });
    for (const tenant of skipped) await expect(vendorState(tenant.vendorId)).resolves.toEqual({ suspendedAt: null, suspendedReason: null });
  });
});
