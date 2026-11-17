import { describe, expect, it, vi } from "vitest";

const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("no database in unit tests"); } }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: monitoring.captureOperationalError }));

import {
  FORM_NO_SHOW_DEADLINE_MS,
  FORM_NO_SHOW_GRACE_MS,
  FORM_NO_SHOW_LOOKBACK_MS,
  FORM_NO_SHOW_SHARED_SESSION_REGISTRATION_WINDOW_MS,
  formNoShowDeadline,
  formNoShowEventId,
  formNoShowSessionKey,
  formNoShowSessionsForLive,
  runFormNoShowAutomation,
} from "@/lib/form-no-show-automation";
import { EMAIL_SEQUENCE_START_CUTOFF_MS } from "@/lib/delayed-step-runs";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date("2026-11-17T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

type LiveInput = Parameters<typeof formNoShowSessionsForLive>[0];

function live(overrides: Partial<LiveInput> = {}): LiveInput {
  return {
    id: "live-1",
    slug: "launch",
    scheduledAt: at(-3 * HOUR),
    startedAt: null,
    endedAt: null,
    isEvergreen: false,
    streamMode: "vod",
    status: "scheduled",
    evergreenScheduleMode: "just_in_time",
    evergreenIntervalMinutes: 15,
    evergreenDailyTimes: [],
    evergreenSessionStartAt: null,
    sessionMode: "single",
    video: { durationSec: 600 },
    replayEnabled: true,
    replayAvailableUntil: null,
    sessionReplayWindowHours: null,
    sessions: [],
    ...overrides,
  };
}

describe("formNoShowSessionsForLive", () => {
  it("resolves a single-start VOD from scheduledAt for the video's length, after the grace and within the look-back", () => {
    expect(formNoShowSessionsForLive(live(), "Asia/Taipei", NOW)).toEqual([{
      kind: "shared", liveId: "live-1", liveSlug: "launch",
      sessionKey: formNoShowSessionKey.single(at(-3 * HOUR)),
      attendFrom: at(-3 * HOUR), endAt: at(-3 * HOUR + 10 * MINUTE),
      // Review m-4: only registrations verified within 14 days before the start.
      registeredFrom: at(-3 * HOUR - FORM_NO_SHOW_SHARED_SESSION_REGISTRATION_WINDOW_MS),
      replayOpen: true,
    }]);
    // Ends exactly at the grace boundary: due. One millisecond later: not yet.
    const boundary = at(-FORM_NO_SHOW_GRACE_MS - 10 * MINUTE);
    expect(formNoShowSessionsForLive(live({ scheduledAt: boundary }), null, NOW)).toHaveLength(1);
    expect(formNoShowSessionsForLive(live({ scheduledAt: new Date(boundary.getTime() + 1) }), null, NOW)).toEqual([]);
    // Ends exactly at the look-back boundary: no longer due.
    const oldest = at(-FORM_NO_SHOW_GRACE_MS - FORM_NO_SHOW_LOOKBACK_MS - 10 * MINUTE);
    expect(formNoShowSessionsForLive(live({ scheduledAt: oldest }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ scheduledAt: new Date(oldest.getTime() + 1) }), null, NOW)).toHaveLength(1);
  });

  it("cuts a VOD short at the merchant's end, and skips one ended before it started, a draft or an unknown length", () => {
    expect(formNoShowSessionsForLive(live({ status: "ended", endedAt: at(-3 * HOUR + 4 * MINUTE) }), null, NOW))
      .toEqual([expect.objectContaining({ endAt: at(-3 * HOUR + 4 * MINUTE) })]);
    expect(formNoShowSessionsForLive(live({ status: "ended", endedAt: at(-4 * HOUR) }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ status: "ended", endedAt: null }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ status: "draft" }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ video: { durationSec: 0 } }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ video: null }), null, NOW)).toEqual([]);
  });

  it("resolves a real live stream from its earliest start to its end, only once ended", () => {
    const stream = { streamMode: "live", status: "ended", startedAt: at(-3 * HOUR - 5 * MINUTE), endedAt: at(-2 * HOUR) } as const;
    expect(formNoShowSessionsForLive(live(stream), null, NOW)).toEqual([expect.objectContaining({
      sessionKey: formNoShowSessionKey.single(at(-3 * HOUR)),
      attendFrom: at(-3 * HOUR - 5 * MINUTE),
      endAt: at(-2 * HOUR),
    })]);
    expect(formNoShowSessionsForLive(live({ ...stream, startedAt: null }), null, NOW)).toEqual([expect.objectContaining({ attendFrom: at(-3 * HOUR) })]);
    expect(formNoShowSessionsForLive(live({ ...stream, status: "live", endedAt: null }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ ...stream, endedAt: at(-4 * HOUR) }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ streamMode: "unknown" }), null, NOW)).toEqual([]);
  });

  it("resolves each fully played fixed session", () => {
    const sessions = [{ id: "s-past", startAt: at(-3 * HOUR) }, { id: "s-late", startAt: at(-20 * MINUTE) }];
    expect(formNoShowSessionsForLive(live({ sessionMode: "fixed_sessions", sessions }), null, NOW)).toEqual([{
      kind: "shared", liveId: "live-1", liveSlug: "launch",
      sessionKey: formNoShowSessionKey.fixed("s-past", at(-3 * HOUR)),
      attendFrom: at(-3 * HOUR), endAt: at(-3 * HOUR + 10 * MINUTE), liveSessionId: "s-past",
      replayOpen: true,
    }]);
    // The per-session replay window (sessionReplayWindowHours) decides for a fixed session.
    expect(formNoShowSessionsForLive(live({ sessionMode: "fixed_sessions", sessions, sessionReplayWindowHours: 1 }), null, NOW))
      .toEqual([expect.objectContaining({ liveSessionId: "s-past", replayOpen: false })]);
    expect(formNoShowSessionsForLive(live({ sessionMode: "fixed_sessions", sessions, sessionReplayWindowHours: 4 }), null, NOW))
      .toEqual([expect.objectContaining({ liveSessionId: "s-past", replayOpen: true })]);
    expect(formNoShowSessionsForLive(live({ sessionMode: "fixed_sessions", sessions, status: "ended", endedAt: at(-3 * HOUR + 5 * MINUTE) }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ sessionMode: "fixed_sessions", sessions, status: "ended", endedAt: null }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live({ sessionMode: "fixed_sessions", sessions, video: null }), null, NOW)).toEqual([]);
  });

  it("uses the merchant anchor of an active evergreen Live, or the per-visitor window", () => {
    const evergreen = { isEvergreen: true, scheduledAt: at(-30 * 24 * HOUR) } as const;
    expect(formNoShowSessionsForLive(live({ ...evergreen, evergreenSessionStartAt: at(-2 * HOUR) }), null, NOW)).toEqual([expect.objectContaining({
      kind: "shared", sessionKey: formNoShowSessionKey.shared(at(-2 * HOUR)), endAt: at(-2 * HOUR + 10 * MINUTE),
      registeredFrom: at(-2 * HOUR - FORM_NO_SHOW_SHARED_SESSION_REGISTRATION_WINDOW_MS),
    })]);
    expect(formNoShowSessionsForLive(live({ ...evergreen, evergreenSessionStartAt: at(-10 * MINUTE) }), null, NOW)).toEqual([]);
    expect(formNoShowSessionsForLive(live(evergreen), null, NOW)).toEqual([{
      kind: "evergreen", liveId: "live-1", liveSlug: "launch", durationSec: 600,
      startAfter: at(-FORM_NO_SHOW_GRACE_MS - FORM_NO_SHOW_LOOKBACK_MS - 10 * MINUTE),
      startUntil: at(-FORM_NO_SHOW_GRACE_MS - 10 * MINUTE),
      replayOpen: true,
    }]);
  });

  it("marks the replay closed when it is off or expired (review m-5)", () => {
    expect(formNoShowSessionsForLive(live({ replayEnabled: false }), null, NOW)).toEqual([expect.objectContaining({ replayOpen: false })]);
    expect(formNoShowSessionsForLive(live({ replayAvailableUntil: NOW }), null, NOW)).toEqual([expect.objectContaining({ replayOpen: false })]);
    expect(formNoShowSessionsForLive(live({ replayAvailableUntil: at(1) }), null, NOW)).toEqual([expect.objectContaining({ replayOpen: true })]);
  });

  it("names events by registration and session", () => {
    expect(formNoShowEventId("sub-1", formNoShowSessionKey.evergreen(new Date(1_000)))).toBe("form-no-show:sub-1:evergreen-1000");
    expect(formNoShowSessionKey.fixed("s1", new Date(2_000))).toBe("session-s1-2000");
  });
});

describe("formNoShowDeadline", () => {
  it("gives the pass min(30 s, sequence start cutoff − elapsed − 5 s) and skips it below 5 s (review m-2)", () => {
    expect(EMAIL_SEQUENCE_START_CUTOFF_MS).toBe(60_000);
    expect(formNoShowDeadline(0)).toBe(FORM_NO_SHOW_DEADLINE_MS);
    expect(formNoShowDeadline(-5)).toBe(FORM_NO_SHOW_DEADLINE_MS);
    expect(formNoShowDeadline(25_000)).toBe(30_000);
    expect(formNoShowDeadline(40_000)).toBe(15_000);
    // The pass then ends by 55 s, before the sequence work's 60 s start cutoff.
    expect(formNoShowDeadline(50_000)).toBe(5_000);
    expect(formNoShowDeadline(50_001)).toBeNull();
    expect(formNoShowDeadline(Number.NaN)).toBeNull();
  });
});

describe("runFormNoShowAutomation", () => {
  it("does nothing, not even a read, without room or time", async () => {
    const db = { automationRule: { findMany: vi.fn() } };
    await expect(runFormNoShowAutomation({ db: db as never, limit: 0 })).resolves.toMatchObject({ vendors: 0, candidates: 0 });
    await expect(runFormNoShowAutomation({ db: db as never, deadlineMs: 0 })).resolves.toMatchObject({ vendors: 0, candidates: 0 });
    expect(db.automationRule.findMany).not.toHaveBeenCalled();
  });

  it("reports a failing vendor scan without stopping, and leaves unparseable rules out", async () => {
    const db = {
      automationRule: { findMany: vi.fn().mockResolvedValue([
        { id: "bad", vendorId: "v-bad", version: 1, condition: { type: "nope" }, actions: [] },
        { id: "r1", vendorId: "v-1", version: 1, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "x" }] },
      ]) },
      vendor: { findUnique: vi.fn().mockRejectedValue(new Error("scan-private-detail")) },
    };
    const summary = await runFormNoShowAutomation({ db: db as never, now: NOW });
    expect(summary).toMatchObject({ vendors: 1, candidates: 0, errors: 1 });
    expect(db.vendor.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: "v-1" }, select: { timezone: true } });
    // Only the monitoring allowlist's source and operation; no id or message detail in the context.
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), { source: "form_no_show_automation", operation: "vendor_scan" }, undefined);
  });
});
