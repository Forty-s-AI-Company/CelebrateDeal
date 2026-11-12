import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import {
  evergreenRegistrationRecordNeeded,
  recordEvergreenSessionAssignment,
  recordEvergreenSessionForRegistrant,
} from "@/lib/evergreen-session-assignment";
import { evergreenScheduleForLive, evergreenScheduleFingerprint } from "@/lib/evergreen-viewer-session";
import {
  createFormSubmissionChatSessionToken,
  FORM_SUBMISSION_CHAT_SESSION_COOKIE,
} from "@/lib/form-submission-chat-session";

/**
 * EvergreenSessionAssignment writes against the disposable loopback
 * PostgreSQL. Synthetic vendors only; each is removed with its cascades.
 */

const vendorIds: string[] = [];
const FP_A = "a".repeat(32);
const FP_B = "b".repeat(32);
const T0 = new Date("2026-11-13T02:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "evergreen-assignment-db-secret-longer-than-thirty-two-bytes");
});
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture(label: string) {
  const db = getDb();
  const suffix = `${label}-${randomUUID()}`;
  const vendor = await db.vendor.create({
    data: { name: `Assignment ${label}`, slug: `eg-assign-${suffix}`, email: `eg-assign-${suffix}@example.test`, passwordHash: "synthetic-only", timezone: "Asia/Taipei" },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id, name: "Form", slug: `eg-assign-form-${suffix}`, headline: "Synthetic",
      fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
    },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "Recording", videoUrl: "https://media.example.test/evergreen.mp4", durationSec: 600, status: "ready" },
  });
  const createLive = (slug: string) => db.live.create({
    data: {
      vendorId: vendor.id, formId: form.id, videoId: video.id, title: "Evergreen", slug: `${slug}-${suffix}`,
      scheduledAt: T0, status: "scheduled", streamMode: "vod", isEvergreen: true, evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15,
    },
    include: { video: { select: { durationSec: true } } },
  });
  const live = await createLive("eg-assign-live");
  const otherLive = await createLive("eg-assign-other");
  const register = (liveId: string, name: string, verificationStatus: "VERIFIED" | "UNVERIFIED" = "VERIFIED") => db.formSubmission.create({
    data: { formId: form.id, liveId, name, email: `${name}-${suffix}@example.test`, verificationStatus },
  });
  return { vendor, form, live, otherLive, register };
}

function rows(vendorId: string) {
  return getDb().evergreenSessionAssignment.findMany({
    where: { vendorId },
    orderBy: { id: "asc" },
    select: { vendorId: true, liveId: true, formSubmissionId: true, sessionStartAt: true, scheduleFingerprint: true },
  });
}

describe("recordEvergreenSessionAssignment", () => {
  it("records a VERIFIED registration of this Live with the server-resolved start and fingerprint", async () => {
    const fx = await fixture("verified");
    const submission = await fx.register(fx.live.id, "verified");

    await expect(recordEvergreenSessionAssignment({
      vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: at(15), scheduleFingerprint: FP_A, now: T0,
    })).resolves.toBe("recorded");
    await expect(rows(fx.vendor.id)).resolves.toEqual([
      { vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: at(15), scheduleFingerprint: FP_A },
    ]);
  });

  it("writes nothing for an unverified registration, another Live's registration or another tenant's binding", async () => {
    const fx = await fixture("rejects");
    const other = await fixture("rejects-other-tenant");
    const unverified = await fx.register(fx.live.id, "unverified", "UNVERIFIED");
    const otherLiveSubmission = await fx.register(fx.otherLive.id, "other-live");
    const ownSubmission = await fx.register(fx.live.id, "own");
    const foreignSubmission = await other.register(other.live.id, "foreign");
    const record = (vendorId: string, liveId: string, formSubmissionId: string) => recordEvergreenSessionAssignment({
      vendorId, liveId, formSubmissionId, sessionStartAt: at(15), scheduleFingerprint: FP_A, now: T0,
    });

    await expect(record(fx.vendor.id, fx.live.id, unverified.id)).resolves.toBe("skipped");
    // A registration of another Live of the same vendor.
    await expect(record(fx.vendor.id, fx.live.id, otherLiveSubmission.id)).resolves.toBe("skipped");
    // Another tenant's registration id presented on this tenant's Live.
    await expect(record(fx.vendor.id, fx.live.id, foreignSubmission.id)).resolves.toBe("skipped");
    // This tenant's registration presented under another vendor id.
    await expect(record(other.vendor.id, fx.live.id, ownSubmission.id)).resolves.toBe("skipped");
    // Malformed input never reaches the database.
    await expect(recordEvergreenSessionAssignment({
      vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: ownSubmission.id, sessionStartAt: at(15), scheduleFingerprint: "not-a-fingerprint",
    })).resolves.toBe("skipped");

    await expect(rows(fx.vendor.id)).resolves.toEqual([]);
    await expect(rows(other.vendor.id)).resolves.toEqual([]);
  });

  it("replaces the row when the schedule changed, even with an earlier start", async () => {
    const fx = await fixture("fingerprint");
    const submission = await fx.register(fx.live.id, "fingerprint");
    const record = (start: Date, fingerprint: string) => recordEvergreenSessionAssignment({
      vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: start, scheduleFingerprint: fingerprint, now: T0,
    });

    await expect(record(at(60), FP_A)).resolves.toBe("recorded");
    await expect(record(at(15), FP_B)).resolves.toBe("recorded");
    await expect(rows(fx.vendor.id)).resolves.toEqual([
      expect.objectContaining({ formSubmissionId: submission.id, sessionStartAt: at(15), scheduleFingerprint: FP_B }),
    ]);
  });

  it("under the same schedule only moves to a later start", async () => {
    const fx = await fixture("later");
    const submission = await fx.register(fx.live.id, "later");
    const record = (start: Date) => recordEvergreenSessionAssignment({
      vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: start, scheduleFingerprint: FP_A, now: T0,
    });

    await expect(record(at(30))).resolves.toBe("recorded");
    await expect(record(at(15))).resolves.toBe("skipped");
    await expect(record(at(30))).resolves.toBe("skipped");
    await expect(rows(fx.vendor.id)).resolves.toEqual([expect.objectContaining({ sessionStartAt: at(30) })]);
    await expect(record(at(45))).resolves.toBe("recorded");
    await expect(rows(fx.vendor.id)).resolves.toEqual([expect.objectContaining({ sessionStartAt: at(45) })]);
  });

  it("keeps one row with the latest start when two browsers record at the same time", async () => {
    const fx = await fixture("concurrent");
    const submission = await fx.register(fx.live.id, "concurrent");
    const record = (start: Date) => recordEvergreenSessionAssignment({
      vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: start, scheduleFingerprint: FP_A, now: T0,
    });

    for (let round = 0; round < 5; round += 1) {
      const starts = [at(15 + round * 60), at(45 + round * 60), at(30 + round * 60)];
      const results = await Promise.all(starts.map(record));
      expect(results).toContain("recorded");
      await expect(rows(fx.vendor.id)).resolves.toEqual([expect.objectContaining({ sessionStartAt: at(45 + round * 60) })]);
    }
  });

  it("is removed with its Live (registrations kept) and with its vendor", async () => {
    const db = getDb();
    const fx = await fixture("cascade");
    const submission = await fx.register(fx.live.id, "cascade");
    await recordEvergreenSessionAssignment({
      vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: at(15), scheduleFingerprint: FP_A,
    });
    await db.live.delete({ where: { id: fx.live.id } });
    await expect(rows(fx.vendor.id)).resolves.toEqual([]);
    await expect(db.formSubmission.findUnique({ where: { id: submission.id }, select: { liveId: true } })).resolves.toEqual({ liveId: null });

    const second = await fx.register(fx.otherLive.id, "cascade-vendor");
    await recordEvergreenSessionAssignment({
      vendorId: fx.vendor.id, liveId: fx.otherLive.id, formSubmissionId: second.id, sessionStartAt: at(15), scheduleFingerprint: FP_A,
    });
    await expect(rows(fx.vendor.id)).resolves.toHaveLength(1);
    await db.vendor.delete({ where: { id: fx.vendor.id } });
    await expect(db.evergreenSessionAssignment.count({ where: { formSubmissionId: second.id } })).resolves.toBe(0);
  });

  it("rejects a row naming another Live's registration at the database level", async () => {
    const fx = await fixture("fk");
    const otherLiveSubmission = await fx.register(fx.otherLive.id, "fk");
    await expect(getDb().evergreenSessionAssignment.create({
      data: { vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: otherLiveSubmission.id, sessionStartAt: at(15), scheduleFingerprint: FP_A },
    })).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("recordEvergreenSessionForRegistrant", () => {
  function sessionFor(live: Awaited<ReturnType<typeof fixture>>["live"]) {
    const schedule = evergreenScheduleForLive(live, "Asia/Taipei", T0)!;
    return { assigned: true, sessionStartAt: at(15), schedule };
  }

  it("records from a signed registration cookie and ignores requests without one", async () => {
    const fx = await fixture("cookie");
    const submission = await fx.register(fx.live.id, "cookie");
    const session = sessionFor(fx.live);
    const token = createFormSubmissionChatSessionToken({ submissionId: submission.id, now: T0 });
    const withCookie = new Request("https://example.test/api/live-evergreen-session", {
      method: "POST",
      headers: { cookie: `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });
    const forged = new Request("https://example.test/api/live-evergreen-session", {
      method: "POST",
      headers: { cookie: `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(`${token.slice(0, -2)}xx`)}` },
    });
    const anonymous = new Request("https://example.test/api/live-evergreen-session", { method: "POST" });
    const record = (request: Request) => recordEvergreenSessionForRegistrant({
      live: fx.live, session, registration: { request }, now: T0, operation: "viewer_session",
    });

    await expect(record(anonymous)).resolves.toBe("skipped");
    await expect(record(forged)).resolves.toBe("skipped");
    await expect(rows(fx.vendor.id)).resolves.toEqual([]);
    await expect(record(withCookie)).resolves.toBe("recorded");
    await expect(rows(fx.vendor.id)).resolves.toEqual([
      expect.objectContaining({ formSubmissionId: submission.id, sessionStartAt: at(15), scheduleFingerprint: evergreenScheduleFingerprint(session.schedule) }),
    ]);
  });

  it("records nothing for a merchant anchor (shared start)", async () => {
    const fx = await fixture("shared");
    const submission = await fx.register(fx.live.id, "shared");
    const shared = evergreenScheduleForLive({ ...fx.live, evergreenSessionStartAt: at(60) }, "Asia/Taipei", T0)!;
    expect(shared.sharedStartAt).toEqual(at(60));
    await expect(recordEvergreenSessionForRegistrant({
      live: fx.live,
      session: { assigned: true, sessionStartAt: at(60), schedule: shared },
      registration: { submissionId: submission.id },
      now: T0,
      operation: "verification",
    })).resolves.toBe("skipped");
    await expect(rows(fx.vendor.id)).resolves.toEqual([]);
  });

  it("does not record an unassigned (read-only) session", async () => {
    const fx = await fixture("unassigned");
    const submission = await fx.register(fx.live.id, "unassigned");
    await expect(recordEvergreenSessionForRegistrant({
      live: fx.live,
      session: { ...sessionFor(fx.live), assigned: false },
      registration: { submissionId: submission.id },
      now: T0,
      operation: "verification",
    })).resolves.toBe("skipped");
    await expect(rows(fx.vendor.id)).resolves.toEqual([]);
  });
});

describe("evergreenRegistrationRecordNeeded (viewer page, read-only)", () => {
  function cookieFor(submissionId: string) {
    return `analytics=1; ${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(createFormSubmissionChatSessionToken({ submissionId, now: T0 }))}`;
  }

  it("asks for a claim only while a verified registrant's current session is unrecorded", async () => {
    const fx = await fixture("needed");
    const submission = await fx.register(fx.live.id, "needed");
    const schedule = evergreenScheduleForLive(fx.live, "Asia/Taipei", T0)!;
    const session = { assigned: true, sessionStartAt: at(15), schedule };
    const needed = (overrides: Partial<Parameters<typeof evergreenRegistrationRecordNeeded>[0]> = {}) => evergreenRegistrationRecordNeeded({
      live: fx.live, session, cookieHeader: cookieFor(submission.id), now: T0, ...overrides,
    });

    await expect(needed()).resolves.toBe(true);
    // Same schedule but an earlier recorded start (another browser): still needed.
    await recordEvergreenSessionAssignment({ vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: at(0), scheduleFingerprint: evergreenScheduleFingerprint(schedule) });
    await expect(needed()).resolves.toBe(true);
    // Recorded at this start: nothing to do.
    await recordEvergreenSessionAssignment({ vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: at(15), scheduleFingerprint: evergreenScheduleFingerprint(schedule) });
    await expect(needed()).resolves.toBe(false);
    // A row from an older schedule does not count.
    await recordEvergreenSessionAssignment({ vendorId: fx.vendor.id, liveId: fx.live.id, formSubmissionId: submission.id, sessionStartAt: at(15), scheduleFingerprint: FP_B });
    await expect(needed()).resolves.toBe(true);
  });

  it("answers false without a valid cookie, for other registrations, or without a per-visitor session", async () => {
    const fx = await fixture("not-needed");
    const other = await fixture("not-needed-other");
    const unverified = await fx.register(fx.live.id, "unverified", "UNVERIFIED");
    const otherLive = await fx.register(fx.otherLive.id, "other-live");
    const foreign = await other.register(other.live.id, "foreign");
    const own = await fx.register(fx.live.id, "own");
    const schedule = evergreenScheduleForLive(fx.live, "Asia/Taipei", T0)!;
    const session = { assigned: true, sessionStartAt: at(15), schedule };
    const check = (cookieHeader: string | null, input: Partial<Parameters<typeof evergreenRegistrationRecordNeeded>[0]> = {}) => evergreenRegistrationRecordNeeded({
      live: fx.live, session, cookieHeader, now: T0, ...input,
    });

    await expect(check(null)).resolves.toBe(false);
    await expect(check(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=forged`)).resolves.toBe(false);
    await expect(check(cookieFor(unverified.id))).resolves.toBe(false);
    await expect(check(cookieFor(otherLive.id))).resolves.toBe(false);
    await expect(check(cookieFor(foreign.id))).resolves.toBe(false);
    await expect(check(cookieFor(own.id), { session: { ...session, assigned: false } })).resolves.toBe(false);
    const shared = evergreenScheduleForLive({ ...fx.live, evergreenSessionStartAt: at(60) }, "Asia/Taipei", T0)!;
    await expect(check(cookieFor(own.id), { session: { assigned: true, sessionStartAt: at(60), schedule: shared } })).resolves.toBe(false);
    await expect(check(cookieFor(own.id))).resolves.toBe(true);
  });
});
