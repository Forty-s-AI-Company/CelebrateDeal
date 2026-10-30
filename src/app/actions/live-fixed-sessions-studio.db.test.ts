import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ vendorId: "" }));
const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => db.client }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: async () => ({ id: runtime.vendorId, timezone: "Asia/Taipei" }) }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/line-live-started", () => ({ dispatchLiveStartedLineNotificationsSafely: vi.fn() }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: vi.fn() }));

import { upsertLiveAction } from "@/app/actions";
import { createLiveReminderReconciliationSnapshot } from "@/lib/live-reminder-reconciliation";
import { liveStudioDraftFromFormData } from "@/lib/live-studio-draft-client";

/**
 * The studio save of a fixed-session Live (指定場次) through the real
 * upsertLiveAction and commitLiveDraft transaction. Only the request and
 * session boundaries are synthetic.
 */
const prisma = new PrismaClient();
const vendors: string[] = [];

beforeEach(async () => {
  vi.stubEnv("CSRF_SECRET", "live-fixed-sessions-studio-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fixed-sessions-studio.example.test");
  db.client = prisma;
  const id = randomUUID();
  const vendor = await prisma.vendor.create({ data: { name: "Synthetic sessions studio", slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only", timezone: "Asia/Taipei" } });
  vendors.push(vendor.id);
  runtime.vendorId = vendor.id;
});
afterEach(async () => {
  await prisma.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
  vi.unstubAllEnvs();
});
afterAll(async () => prisma.$disconnect());

async function resources(durationSec = 3_600) {
  const vendorId = runtime.vendorId;
  const video = await prisma.video.create({ data: { vendorId, title: "Recording", sourceType: "url", status: "ready", videoUrl: "https://video.example.test/r.m3u8", durationSec } });
  const form = await prisma.registrationForm.create({ data: {
    vendorId, name: "Form", slug: randomUUID(), headline: "Register",
    fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
  } });
  const template = await prisma.messageTemplate.create({ data: {
    vendorId, name: "Confirmed", channel: "email", trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} {{unsubscribe_url}}", isActive: true,
  } });
  return { video, form, template };
}

const local = (offsetDays: number, time: string) => {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return `${day}T${time}`;
};

async function draft(input: {
  liveId?: string;
  slug: string;
  status: string;
  res: Awaited<ReturnType<typeof resources>>;
  sessions: Array<{ startAt: string; capacity?: string }>;
}) {
  const data = new FormData();
  const rows = input.sessions.map((row) => ({ startAt: row.startAt, capacity: row.capacity ?? "", status: "open" }));
  for (const [key, value] of Object.entries({
    title: "指定場次 Webinar", slug: input.slug, scheduledAt: rows.map((row) => row.startAt).sort().at(-1) ?? "", streamMode: "vod",
    replayEnabled: "on", affiliateMode: "disabled", maxConcurrentViewers: "500", stopWhenCreditsBelow: "300",
    usageAttributionMode: "PROMOTER", quotaPayerScope: "VENDOR", splitOwnerBps: "3000", splitPromoterBps: "7000", studioPreset: "CONTENT",
    videoId: input.res.video.id, formId: input.res.form.id, messageTemplateId: input.res.template.id,
    sessionMode: "fixed_sessions", fixedSessions: JSON.stringify(rows), sessionRegistrationCutoffMinutes: "0", sessionReplayWindowHours: "",
    status: input.status,
  })) data.set(key, value);
  if (input.liveId) data.set("id", input.liveId);
  const saved = await prisma.liveStudioDraft.create({ data: {
    vendorId: runtime.vendorId, liveId: input.liveId ?? null, updatedByMemberId: "synthetic-member",
    payload: liveStudioDraftFromFormData(data, 7), expiresAt: new Date(Date.now() + 60_000),
  } });
  data.set("liveDraftId", saved.id);
  data.set("liveDraftRevision", String(saved.revision));
  return data;
}

async function createScheduledLive(res: Awaited<ReturnType<typeof resources>>, slug: string, sessions: Array<{ startAt: string; capacity?: string }>) {
  await expect(upsertLiveAction(await draft({ slug, status: "scheduled", res, sessions }))).rejects.toThrow(/redirect:\/lives\/[^/]+\/preview/u);
  return prisma.live.findFirstOrThrow({ where: { vendorId: runtime.vendorId, slug }, select: { id: true, scheduledAt: true, sessionMode: true } });
}

describe("studio save of fixed sessions", () => {
  it("cancels a removed session with registrations, supersedes its reminders and queues the cancellation notice", async () => {
    const res = await resources();
    const slug = `fixed-${randomUUID()}`;
    const first = local(2, "14:00");
    const second = local(3, "19:00");
    const live = await createScheduledLive(res, slug, [{ startAt: second }, { startAt: first, capacity: "50" }]);
    expect(live.sessionMode).toBe("fixed_sessions");
    const sessions = await prisma.liveSession.findMany({ where: { liveId: live.id }, orderBy: { startAt: "asc" } });
    expect(sessions.map((row) => [row.capacity, row.status])).toEqual([[50, "open"], [null, "open"]]);
    expect(live.scheduledAt.toISOString()).toBe(sessions[1]!.startAt.toISOString());

    // A verified registrant of the second session with a queued reminder.
    await prisma.liveSession.update({ where: { id: sessions[1]!.id }, data: { registeredCount: 1 } });
    const registrant = await prisma.formSubmission.create({ data: {
      formId: res.form.id, liveId: live.id, liveSessionId: sessions[1]!.id, name: "Lead", email: `lead-${slug}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date(),
    } });
    await prisma.emailDelivery.create({ data: {
      id: `email_${randomUUID().replaceAll("-", "")}`, vendorId: runtime.vendorId, sourceTemplateId: "synthetic", sourceLiveId: live.id,
      sourceFormSubmissionId: registrant.id, trigger: "live_reminder", payloadEncryptedEnvelope: "synthetic", recipientHash: "synthetic",
      recipientMaskedEmail: "l***@example.test", idempotencyKey: `live-reminder/${randomUUID()}`, status: "queued", nextAttemptAt: new Date(Date.now() + 60_000),
    } });

    await expect(upsertLiveAction(await draft({ liveId: live.id, slug, status: "scheduled", res, sessions: [{ startAt: first, capacity: "50" }] })))
      .rejects.toThrow(new RegExp(`redirect:/lives/${live.id}/edit`, "u"));

    const after = await prisma.liveSession.findMany({ where: { liveId: live.id }, orderBy: { startAt: "asc" } });
    expect(after.map((row) => row.status)).toEqual(["open", "cancelled"]);
    expect(after[1]!.cancelledAt).not.toBeNull();
    expect(after[1]!.cancellationNoticesQueuedAt).not.toBeNull();
    expect((await prisma.live.findUniqueOrThrow({ where: { id: live.id } })).scheduledAt.toISOString()).toBe(after[0]!.startAt.toISOString());
    expect(await prisma.emailDelivery.findMany({
      where: { vendorId: runtime.vendorId, sourceFormSubmissionId: registrant.id },
      select: { trigger: true, status: true, lastErrorCode: true },
      orderBy: { trigger: "asc" },
    })).toEqual([
      { trigger: "fixed_session_cancelled", status: "queued", lastErrorCode: null },
      { trigger: "live_reminder", status: "superseded", lastErrorCode: "session_cancelled" },
    ]);
    expect((await prisma.formSubmission.findUniqueOrThrow({ where: { id: registrant.id } })).liveSessionId).toBe(sessions[1]!.id);
  });

  it("refuses a manual start and publishing without a known video length", async () => {
    const res = await resources();
    const slug = `fixed-${randomUUID()}`;
    const live = await createScheduledLive(res, slug, [{ startAt: local(2, "14:00") }]);
    await expect(upsertLiveAction(await draft({ liveId: live.id, slug, status: "live", res, sessions: [{ startAt: local(2, "14:00") }] })))
      .rejects.toThrow(`redirect:/lives/${live.id}/edit?error=fixed_sessions_manual_start`);
    expect((await prisma.live.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("scheduled");

    const unknownLength = await resources(0);
    await expect(upsertLiveAction(await draft({ slug: `fixed-${randomUUID()}`, status: "scheduled", res: unknownLength, sessions: [{ startAt: local(2, "14:00") }] })))
      .rejects.toThrow(/error=invalid_draft.*field=videoId/u);
  });
});

describe("lives without sessions", () => {
  it("keeps the reminder reconciliation digest of a single-start Live unchanged", async () => {
    const { createHash } = await import("node:crypto");
    const scheduledAt = new Date("2030-01-01T12:00:00.000Z");
    const snapshot = createLiveReminderReconciliationSnapshot({
      vendorId: "vendor-a", liveId: "live-a", liveSlug: "slug-a", liveTitle: "Title", liveStatus: "scheduled",
      scheduledAt, reminderOffsetMinutes: 60, template: null,
    }, new Date("2029-12-01T00:00:00.000Z"));
    // The exact v1 identity from before fixed sessions existed.
    const expected = createHash("sha256").update(JSON.stringify([
      "vendor-a", "live-a", "slug-a", "Title", "active", scheduledAt.toISOString(), 60, null, null, false, "live_reminder_reconciliation/v1",
    ])).digest("hex");
    expect(snapshot.configDigest).toBe(expected);
    expect(createLiveReminderReconciliationSnapshot({
      vendorId: "vendor-a", liveId: "live-a", liveSlug: "slug-a", liveTitle: "Title", liveStatus: "scheduled",
      scheduledAt, reminderOffsetMinutes: 60, template: null, fixedSessionsDigest: null,
    }, new Date("2029-12-01T00:00:00.000Z")).configDigest).toBe(expected);
    expect("fixedSessionsDigest" in snapshot).toBe(false);
  });
});
