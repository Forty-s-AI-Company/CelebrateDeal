import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";

const now = new Date("2026-10-29T06:03:00.000Z");
const expiresAt = new Date("2026-10-29T08:00:00.000Z");

function submission(liveOverrides: Record<string, unknown> = {}, vendorTimezone: string | null = "Asia/Tokyo") {
  return {
    id: "formsub_evergreen",
    formId: "form-1",
    liveId: "live-1",
    name: "王小明",
    email: "lead@example.test",
    verificationStatus: "UNVERIFIED",
    verificationVersion: 1,
    verificationExpiresAt: expiresAt,
    form: {
      vendorId: "vendor-1",
      vendor: { name: "測試商家", senderName: null, supportEmail: null, contactUrl: null, timezone: vendorTimezone },
    },
    affiliateClick: null,
    live: {
      id: "live-1",
      vendorId: "vendor-1",
      formId: "form-1",
      slug: "evergreen-live",
      title: "常青講座",
      status: "scheduled",
      streamMode: "vod",
      isEvergreen: true,
      evergreenScheduleMode: "just_in_time",
      evergreenIntervalMinutes: 15,
      evergreenDailyTimes: [],
      evergreenSessionStartAt: null,
      replayEnabled: false,
      replayAvailableUntil: null,
      scheduledAt: new Date("2026-08-10T04:00:00.000Z"),
      liveReminderOffsetMinutes: 60,
      video: { durationSec: 1_800 },
      messageTemplate: null,
      liveReminderTemplate: null,
      ...liveOverrides,
    },
  };
}

function database(row: ReturnType<typeof submission>) {
  const tx = {
    formSubmission: { findUnique: vi.fn().mockResolvedValue(row), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    analyticsEvent: { create: vi.fn().mockResolvedValue({}) },
    affiliateClick: { updateMany: vi.fn() },
  };
  return { tx, db: { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) } };
}

const token = () => createFormSubmissionVerificationToken({ submissionId: "formsub_evergreen", expiresAt, version: 1 });

beforeEach(() => vi.stubEnv("CSRF_SECRET", "form-verification-domain-test-secret-longer-than-32-bytes"));
afterEach(() => vi.unstubAllEnvs());

describe("verifyFormSubmission evergreen projection", () => {
  it("projects an active evergreen live with the vendor timezone for the confirmation", async () => {
    const { db, tx } = database(submission());
    const result = await verifyFormSubmission(db as never, token(), now);

    expect(result).toMatchObject({
      status: "verified",
      confirmation: {
        liveScheduledAt: new Date("2026-08-10T04:00:00.000Z"),
        evergreen: {
          vendorTimezone: "Asia/Tokyo",
          live: expect.objectContaining({ id: "live-1", vendorId: "vendor-1", isEvergreen: true, video: { durationSec: 1_800 } }),
        },
      },
    });
    expect(tx.formSubmission.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        form: { select: expect.objectContaining({ vendor: { select: expect.objectContaining({ timezone: true }) } }) },
        live: { select: expect.objectContaining({
          isEvergreen: true, streamMode: true, status: true, evergreenScheduleMode: true, evergreenIntervalMinutes: true,
          evergreenDailyTimes: true, evergreenSessionStartAt: true, replayEnabled: true, replayAvailableUntil: true,
          video: { select: { durationSec: true } },
        }) },
      }),
    }));
  });

  it.each([
    ["a regular live", { isEvergreen: false }],
    ["an evergreen flag on a real-time broadcast", { streamMode: "live" }],
    ["an evergreen flag without a known video duration", { video: { durationSec: null } }],
    ["an ended evergreen live", { status: "ended" }],
  ])("projects no evergreen session for %s", async (_label, overrides) => {
    const { db } = database(submission(overrides));
    await expect(verifyFormSubmission(db as never, token(), now)).resolves.toMatchObject({
      status: "verified",
      confirmation: { evergreen: null },
    });
  });

  it("keeps a missing vendor timezone as null for the session resolver to default", async () => {
    const { db } = database(submission({}, null));
    await expect(verifyFormSubmission(db as never, token(), now)).resolves.toMatchObject({
      confirmation: { evergreen: { vendorTimezone: null } },
    });
  });
});
