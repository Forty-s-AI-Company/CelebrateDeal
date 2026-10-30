import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({ vendor: { id: "", timezone: "Asia/Taipei" }, failInFlightSweep: false }));
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));

vi.mock("@/lib/monitoring", () => monitoring);
// Real module; only the evergreen post-commit sweep can be made to fail (m-3).
vi.mock("@/lib/live-notification-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/live-notification-delivery")>();
  return {
    ...actual,
    supersedeFixedTimeNotificationsForActiveEvergreen: async (...args: Parameters<typeof actual.supersedeFixedTimeNotificationsForActiveEvergreen>) => {
      if (ctx.failInFlightSweep) throw new Error("synthetic sweep failure");
      return actual.supersedeFixedTimeNotificationsForActiveEvergreen(...args);
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerContext: async () => ({
    auth: { user: { id: "user-disposable" }, member: { role: "owner" } },
    vendor: ctx.vendor,
  }),
}));

import { updateEvergreenWebinarSettingsAction } from "@/app/actions/evergreen-webinar-actions";
import { getDb } from "@/lib/db";
import { rematerializeEvergreenLiveNow } from "@/lib/evergreen-rematerialization";
import { dispatchEmailDelivery } from "@/lib/email-delivery";
import { ensureLiveNotificationDelivery, isCurrentLiveNotificationDeliverySnapshot, processDueLiveNotifications } from "@/lib/live-notification-delivery";
import { processLiveReminderReconciliationJobs } from "@/lib/live-reminder-reconciliation";

const createdVendorIds: string[] = [];
const now = new Date();
const scheduledAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
/** The real action stamps jobs with the wall clock, so the follow-up runs use a later one. */
const later = () => new Date(Date.now() + 1_000);

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "evergreen-rematerialization-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://evergreen-rematerialization.example.test");
});

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
  ctx.failInFlightSweep = false;
  monitoring.captureOperationalError.mockClear();
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(label: string, options: { legacyReminder: boolean; registrants?: number; isEvergreen?: boolean }) {
  const db = getDb();
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vendor = await db.vendor.create({
    data: { name: `Evergreen ${suffix}`, slug: `evergreen-remat-${suffix}`, email: `evergreen-remat-${suffix}@example.test`, passwordHash: "disposable-test-only" },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: `Form ${suffix}`, slug: `evergreen-remat-form-${suffix}`, headline: "Disposable form", fields: [] },
  });
  const template = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: `Reminder ${suffix}`, channel: "email", trigger: "live_reminder", subject: "{{live_title}}", body: "Hello {{name}}\n{{unsubscribe_url}}", isActive: true },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: `Video ${suffix}`, videoUrl: "https://media.example.test/evergreen.mp4", durationSec: 600, status: "ready" },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      videoId: video.id,
      title: `Live ${suffix}`,
      slug: `evergreen-remat-live-${suffix}`,
      scheduledAt,
      status: "scheduled",
      streamMode: "vod",
      isEvergreen: options.isEvergreen ?? true,
      ...(options.legacyReminder ? { liveReminderTemplateId: template.id, liveReminderOffsetMinutes: 60 } : {}),
    },
  });
  const rule = options.legacyReminder
    ? null
    : await db.liveNotificationRule.create({
      data: { vendorId: vendor.id, liveId: live.id, messageTemplateId: template.id, trigger: "before_live", offsetMinutes: 60 },
    });
  const submissionIds: string[] = [];
  for (let index = 0; index < (options.registrants ?? 1); index += 1) {
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        liveId: live.id,
        name: `Verified Lead ${index}`,
        email: `lead-${index}-${suffix}@example.test`,
        verificationStatus: "VERIFIED",
        verifiedAt: now,
      },
    });
    submissionIds.push(submission.id);
  }
  return { vendor, form, template, live, rule, submissionIds };
}

/** Runs the real Server Action (real Serializable transaction, real queries) as this fixture's vendor. */
async function saveEvergreen(fixture: Fixture, isEvergreen: boolean) {
  ctx.vendor = { id: fixture.vendor.id, timezone: fixture.vendor.timezone };
  const data = new FormData();
  data.set("liveId", fixture.live.id);
  if (isEvergreen) data.set("isEvergreen", "on");
  data.set("evergreenScheduleMode", "just_in_time");
  data.set("evergreenIntervalMinutes", "15");
  data.set("evergreenPreviewRate", "1");
  await expect(updateEvergreenWebinarSettingsAction(data)).rejects.toThrow(`REDIRECT:/lives/${fixture.live.id}/edit?notice=evergreen_saved`);
}

function deliveryCount(fixture: Fixture, trigger: string, status?: string) {
  return getDb().emailDelivery.count({
    where: { vendorId: fixture.vendor.id, sourceLiveId: fixture.live.id, trigger, ...(status ? { status } : {}) },
  });
}

describe("evergreen settings re-materialization (disposable PostgreSQL)", () => {
  it("schedules the legacy live reminder right after evergreen is turned off, and the scheduled job adds nothing", async () => {
    const fixture = await createFixture("legacy", { legacyReminder: true });
    await saveEvergreen(fixture, true);
    expect(await deliveryCount(fixture, "live_reminder")).toBe(0);

    await saveEvergreen(fixture, false);
    // The save only queued the job; nothing is scheduled until it is worked off.
    expect(await deliveryCount(fixture, "live_reminder")).toBe(0);

    const outcome = await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now: later() });
    expect(outcome).toMatchObject({ reminderJobs: 1, failed: [] });
    expect(await deliveryCount(fixture, "live_reminder", "queued")).toBe(1);
    expect(await getDb().liveReminderReconciliationJob.count({
      where: { vendorId: fixture.vendor.id, liveId: fixture.live.id, lifecycle: "pending" },
    })).toBe(0);

    // Idempotency: the scheduled job, and a repeated immediate run, find nothing to do.
    expect(await processLiveReminderReconciliationJobs({ now: later() })).not.toContainEqual(expect.objectContaining({ status: "pending" }));
    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now: later() });
    expect(await deliveryCount(fixture, "live_reminder")).toBe(1);
  });

  it("materializes before_live rules right after evergreen is turned off, and is idempotent with the scheduled job", async () => {
    const fixture = await createFixture("rules", { legacyReminder: false });
    await saveEvergreen(fixture, true);
    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now: later() });
    expect(await deliveryCount(fixture, "before_live")).toBe(0);

    await saveEvergreen(fixture, false);
    expect(await deliveryCount(fixture, "before_live")).toBe(0);

    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now: later() });
    expect(await deliveryCount(fixture, "before_live", "queued")).toBe(1);

    // The scheduled materializer and a second immediate run converge on the same row.
    await processDueLiveNotifications({ now: later(), vendorId: fixture.vendor.id, includeFuture: true });
    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now: later() });
    expect(await deliveryCount(fixture, "before_live")).toBe(1);
  });

  it("cancels only queued or failed before_live emails of this live when evergreen is turned on", async () => {
    const fixture = await createFixture("enable", { legacyReminder: false });
    const other = await createFixture("enable-other-vendor", { legacyReminder: false });
    const db = getDb();
    const siblingLive = await db.live.create({
      data: {
        vendorId: fixture.vendor.id, formId: fixture.form.id, videoId: fixture.live.videoId, title: "Sibling", slug: `${fixture.live.slug}-sibling`,
        scheduledAt, status: "scheduled", streamMode: "vod", isEvergreen: false,
      },
    });
    const seed = (id: string, owner: { vendorId: string; liveId: string; templateId: string }, status: string, trigger = "before_live") =>
      db.emailDelivery.create({
        data: {
          id, vendorId: owner.vendorId, sourceTemplateId: owner.templateId, sourceLiveId: owner.liveId, sourceFormSubmissionId: null, trigger,
          payloadEncryptedEnvelope: "disposable", recipientHash: `hash-${id}`, recipientMaskedEmail: "d***@example.test",
          idempotencyKey: `key-${id}`, status, maxAttempts: 5, nextAttemptAt: status === "sent" ? null : now,
        },
      });
    const mine = { vendorId: fixture.vendor.id, liveId: fixture.live.id, templateId: fixture.template.id };
    const tag = Math.random().toString(36).slice(2, 8);
    await Promise.all([
      seed(`${tag}-queued`, mine, "queued"),
      seed(`${tag}-failed`, mine, "failed"),
      seed(`${tag}-during`, mine, "queued", "during_live"),
      seed(`${tag}-sent`, mine, "sent"),
      seed(`${tag}-suppressed`, mine, "suppressed"),
      seed(`${tag}-sending`, mine, "sending"),
      seed(`${tag}-sibling`, { vendorId: fixture.vendor.id, liveId: siblingLive.id, templateId: fixture.template.id }, "queued"),
      seed(`${tag}-other-vendor`, { vendorId: other.vendor.id, liveId: other.live.id, templateId: other.template.id }, "queued"),
    ]);

    await saveEvergreen(fixture, false);
    await saveEvergreen(fixture, true);

    const statusOf = async (suffix: string) => (await db.emailDelivery.findUnique({ where: { id: `${tag}-${suffix}` }, select: { status: true } }))?.status;
    expect(await statusOf("queued")).toBe("superseded");
    expect(await statusOf("failed")).toBe("superseded");
    expect(await statusOf("during")).toBe("superseded");
    expect(await statusOf("sent")).toBe("sent");
    expect(await statusOf("suppressed")).toBe("suppressed");
    expect(await statusOf("sending")).toBe("sending");
    expect(await statusOf("sibling")).toBe("queued");
    expect(await statusOf("other-vendor")).toBe("queued");

    // Evergreen stays on: re-materialization and the scheduled pass create nothing new.
    const before = await db.emailDelivery.count({ where: { vendorId: fixture.vendor.id } });
    await rematerializeEvergreenLiveNow({ vendorId: fixture.vendor.id, liveId: fixture.live.id, now: later() });
    await processDueLiveNotifications({ now: later(), vendorId: fixture.vendor.id, includeFuture: true });
    expect(await db.emailDelivery.count({ where: { vendorId: fixture.vendor.id } })).toBe(before);
  });

  /**
   * Enables evergreen while a real materialization of the fixture's first
   * registrant is in flight (it has taken Live FOR SHARE and waits for the
   * registration), and returns that materialization's result.
   */
  async function enableEvergreenDuringInFlightMaterialization(fixture: Fixture) {
    const db = getDb();
    const submissionId = fixture.submissionIds[0]!;
    const waitingOnLock = async (pattern: string) => {
      for (let poll = 0; poll < 200; poll += 1) {
        const [row] = await db.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${pattern}`;
        if ((row?.n ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`no backend waited on a lock for ${pattern}`);
    };

    // 1. Hold the registration lock so the real materialization stops after
    //    it has taken Live FOR SHARE and before it reads or writes anything.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const holding = new Promise<void>((resolve) => { held = resolve; });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FormSubmission" WHERE "id" = ${submissionId} FOR NO KEY UPDATE`;
      held();
      await gate;
    }, { timeout: 30_000 });
    await holding;
    const materialized = ensureLiveNotificationDelivery(
      { vendorId: fixture.vendor.id, liveId: fixture.live.id, ruleId: fixture.rule!.id, submissionId },
      new Date(),
      { scheduleFuture: true },
    );
    await waitingOnLock('%JOIN "FormSubmission" s%');

    // 2. Enabling evergreen now: its Serializable transaction takes its
    //    snapshot and then waits on the materialization's Live FOR SHARE.
    const saved = saveEvergreen(fixture, true);
    await waitingOnLock('UPDATE "public"."Live"%');

    // 3. The materialization still sees the fixed-time Live, queues its row
    //    and commits; only then can the save update the Live and commit.
    release();
    await holder;
    const result = await materialized;
    expect(result).toMatchObject({ status: "queued" });
    await saved;
    return result as { status: "queued"; deliveryId: string };
  }

  it("cancels the fixed-time row of a materialization that was in flight while evergreen was being enabled (B-3)", async () => {
    const fixture = await createFixture("in-flight", { legacyReminder: false, isEvergreen: false });
    const result = await enableEvergreenDuringInFlightMaterialization(fixture);

    // The save's own supersede ran on a snapshot older than that row; the
    // post-commit pass cancelled it.
    expect(await getDb().emailDelivery.findUniqueOrThrow({ where: { id: result.deliveryId }, select: { status: true, lastErrorCode: true } }))
      .toEqual({ status: "superseded", lastErrorCode: "lifecycle_superseded" });
    expect(await deliveryCount(fixture, "before_live", "queued")).toBe(0);
  });

  it("still never sends that row when the post-commit pass fails: the send-time check supersedes it (m-3)", async () => {
    const db = getDb();
    const fixture = await createFixture("sweep-fails", { legacyReminder: false, isEvergreen: false });
    // Due now and the Live still ahead, so the only thing that makes the row stale is evergreen.
    await db.live.update({ where: { id: fixture.live.id }, data: { scheduledAt: new Date(Date.now() + 30 * 60_000) } });
    ctx.failInFlightSweep = true;

    const result = await enableEvergreenDuringInFlightMaterialization(fixture);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "evergreen_settings", operation: "supersede_in_flight", status: "failed",
    });
    const row = await db.emailDelivery.findUniqueOrThrow({ where: { id: result.deliveryId } });
    expect(row.status).toBe("queued");
    expect(row.nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await isCurrentLiveNotificationDeliverySnapshot(row)).toBe(false);

    // The worker claims it and finalizes it as superseded before any provider call.
    await expect(dispatchEmailDelivery(row.id)).resolves.toEqual({ status: "superseded" });
    expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id }, select: { status: true, lastErrorCode: true, sentAt: true, providerMessageId: true } }))
      .toEqual({ status: "superseded", lastErrorCode: "config_superseded", sentAt: null, providerMessageId: null });
  });

  it("stays inside the tenant: another vendor's pending job and a foreign live id are untouched", async () => {
    const [a, b] = [await createFixture("tenant-a", { legacyReminder: true }), await createFixture("tenant-b", { legacyReminder: true })];
    await saveEvergreen(a, false);
    await saveEvergreen(b, false);

    // Vendor A's id with vendor B's live must do nothing at all.
    await rematerializeEvergreenLiveNow({ vendorId: a.vendor.id, liveId: b.live.id, now: later() });
    expect(await deliveryCount(b, "live_reminder")).toBe(0);
    expect(await getDb().liveReminderReconciliationJob.count({ where: { vendorId: b.vendor.id, lifecycle: "pending" } })).toBe(1);

    await rematerializeEvergreenLiveNow({ vendorId: a.vendor.id, liveId: a.live.id, now: later() });
    expect(await deliveryCount(a, "live_reminder", "queued")).toBe(1);
    expect(await deliveryCount(b, "live_reminder")).toBe(0);
    expect(await getDb().liveReminderReconciliationJob.count({ where: { vendorId: b.vendor.id, lifecycle: "pending" } })).toBe(1);
  });

  it.each([1, 2, 3])("immediate re-materialization racing the scheduled job (round %i) never throws and leaves exactly one delivery per registrant", async () => {
    const fixture = await createFixture("race", { legacyReminder: false, registrants: 4, isEvergreen: false });
    const scope = { vendorId: fixture.vendor.id, liveId: fixture.live.id, now: later() };

    const settled = await Promise.allSettled([
      rematerializeEvergreenLiveNow(scope),
      processDueLiveNotifications({ now: later(), vendorId: fixture.vendor.id, includeFuture: true }),
      rematerializeEvergreenLiveNow(scope),
      processDueLiveNotifications({ now: later(), vendorId: fixture.vendor.id, includeFuture: true }),
    ]);
    // Nothing escapes: a conflict is retried, and one that outlives the retries is contained per recipient.
    expect(settled.filter((result) => result.status === "rejected")).toEqual([]);

    // A recipient skipped by a contained conflict is picked up by the next pass.
    await processDueLiveNotifications({ now: later(), vendorId: fixture.vendor.id, includeFuture: true });

    const rows = await getDb().emailDelivery.findMany({
      where: { vendorId: fixture.vendor.id, sourceLiveId: fixture.live.id, trigger: "before_live" },
      select: { sourceFormSubmissionId: true, status: true },
    });
    expect(rows).toHaveLength(fixture.submissionIds.length);
    expect(rows.map((row) => row.sourceFormSubmissionId).sort()).toEqual([...fixture.submissionIds].sort());
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(["queued"]));
  });
});
