import { describe, expect, it } from "vitest";
import {
  FixedSessionValidationError,
  fixedSessionDraftRows,
  fixedSessionRegistrationState,
  fixedSessionReplayAvailableUntil,
  fixedSessionScheduledAt,
  formatFixedSessionStart,
  groupOpenFixedSessionsByDate,
  isFixedSessionLive,
  MAX_FIXED_SESSIONS,
  parseFixedSessionRows,
  parseStudioFixedSessionSettings,
  pickPublicFixedSession,
  resolveFixedSessionRuntime,
} from "@/lib/live-fixed-sessions";
import { LiveStudioDraftPayloadSchema } from "@/lib/live-studio-draft";
import { liveStudioDraftFromFormData } from "@/lib/live-studio-draft-client";

const TZ = "Asia/Taipei";
const NOW = new Date("2026-10-29T04:00:00.000Z"); // 2026-10-29 12:00 Asia/Taipei
const row = (startAt: string, capacity = "", status: "open" | "closed" = "open") => ({ startAt, capacity, status });

function codeOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error instanceof FixedSessionValidationError ? [error.code, error.index] : String(error);
  }
  return null;
}

describe("parseFixedSessionRows", () => {
  it("parses Asia/Taipei wall-clock rows and sorts them", () => {
    const parsed = parseFixedSessionRows([
      row("2026-10-31T20:00"),
      row("2026-10-30T14:00", "50"),
      row("2026-10-31T13:00", "", "closed"),
      row("2026-10-30T19:00"),
    ], { timeZone: TZ, now: NOW, requireFuture: true });
    expect(parsed.map((session) => [session.startAt.toISOString(), session.capacity, session.status])).toEqual([
      ["2026-10-30T06:00:00.000Z", 50, "open"],
      ["2026-10-30T11:00:00.000Z", null, "open"],
      ["2026-10-31T05:00:00.000Z", null, "closed"],
      ["2026-10-31T12:00:00.000Z", null, "open"],
    ]);
    expect(fixedSessionScheduledAt(parsed)?.toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });

  it("rejects empty, too many, invalid, duplicate, past and badly sized rows", () => {
    const options = { timeZone: TZ, now: NOW, requireFuture: true };
    expect(codeOf(() => parseFixedSessionRows([], options))).toEqual(["fixed_sessions_required", null]);
    const many = Array.from({ length: MAX_FIXED_SESSIONS + 1 }, (_, index) => row(`2026-11-${String(1 + (index % 28)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00`));
    expect(codeOf(() => parseFixedSessionRows(many, options))).toEqual(["fixed_sessions_too_many", null]);
    expect(codeOf(() => parseFixedSessionRows([row("2026-10-30")], options))).toEqual(["fixed_session_invalid_time", 0]);
    expect(codeOf(() => parseFixedSessionRows([row("2026-10-30T14:00"), row("2026-10-30T14:00")], options))).toEqual(["fixed_session_duplicate", 1]);
    expect(codeOf(() => parseFixedSessionRows([row("2026-10-29T11:59")], options))).toEqual(["fixed_session_in_past", 0]);
    expect(codeOf(() => parseFixedSessionRows([row("2026-10-30T14:00", "0")], options))).toEqual(["fixed_session_invalid_capacity", 0]);
    expect(codeOf(() => parseFixedSessionRows([row("2026-10-30T14:00", "100001")], options))).toEqual(["fixed_session_invalid_capacity", 0]);
    expect(codeOf(() => parseFixedSessionRows([row("2026-10-30T14:00", "1.5")], options))).toEqual(["fixed_session_invalid_capacity", 0]);
  });

  it("allows past rows for a draft and keeps already stored past sessions when publishing", () => {
    expect(parseFixedSessionRows([row("2026-10-01T10:00")], { timeZone: TZ, now: NOW, requireFuture: false })).toHaveLength(1);
    const stored = new Date("2026-10-01T02:00:00.000Z").getTime();
    expect(parseFixedSessionRows([row("2026-10-01T10:00"), row("2026-11-01T10:00")], {
      timeZone: TZ, now: NOW, requireFuture: true, existingStartTimes: new Set([stored]),
    })).toHaveLength(2);
  });
});

describe("parseStudioFixedSessionSettings", () => {
  it("returns null for a single start and the parsed settings for fixed sessions", () => {
    expect(parseStudioFixedSessionSettings({}, { timeZone: TZ, now: NOW, requireFuture: true })).toBeNull();
    const settings = parseStudioFixedSessionSettings({
      sessionMode: "fixed_sessions",
      fixedSessions: [row("2026-10-30T14:00")],
      sessionRegistrationCutoffMinutes: "15",
      sessionReplayWindowHours: "48",
    }, { timeZone: TZ, now: NOW, requireFuture: true });
    expect(settings).toMatchObject({ sessionRegistrationCutoffMinutes: 15, sessionReplayWindowHours: 48 });
    expect(settings?.scheduledAt.toISOString()).toBe("2026-10-30T06:00:00.000Z");
  });

  it("rejects an out-of-range cutoff or replay window", () => {
    const base = { sessionMode: "fixed_sessions", fixedSessions: [row("2026-10-30T14:00")] };
    const options = { timeZone: TZ, now: NOW, requireFuture: true };
    expect(() => parseStudioFixedSessionSettings({ ...base, sessionRegistrationCutoffMinutes: "1441" }, options)).toThrow("cutoff");
    expect(() => parseStudioFixedSessionSettings({ ...base, sessionReplayWindowHours: "0" }, options)).toThrow("replay");
    expect(parseStudioFixedSessionSettings({ ...base, sessionRegistrationCutoffMinutes: "", sessionReplayWindowHours: "" }, options))
      .toMatchObject({ sessionRegistrationCutoffMinutes: 0, sessionReplayWindowHours: null });
  });
});

describe("session state and timing", () => {
  const start = new Date("2026-10-30T06:00:00.000Z");
  const record = (overrides: Partial<{ capacity: number | null; registeredCount: number; status: string }> = {}) => ({
    id: "session-a", startAt: start, capacity: 2, registeredCount: 0, status: "open", ...overrides,
  });

  it("classifies registration availability with the cutoff", () => {
    const rules = { sessionRegistrationCutoffMinutes: 10 };
    expect(fixedSessionRegistrationState(record(), rules, NOW)).toBe("open");
    expect(fixedSessionRegistrationState(record({ registeredCount: 2 }), rules, NOW)).toBe("full");
    expect(fixedSessionRegistrationState(record({ capacity: null, registeredCount: 9_999 }), rules, NOW)).toBe("open");
    expect(fixedSessionRegistrationState(record({ status: "closed" }), rules, NOW)).toBe("closed");
    expect(fixedSessionRegistrationState(record({ status: "cancelled" }), rules, NOW)).toBe("cancelled");
    expect(fixedSessionRegistrationState(record(), rules, new Date(start.getTime() + 9 * 60_000))).toBe("open");
    expect(fixedSessionRegistrationState(record(), rules, new Date(start.getTime() + 10 * 60_000))).toBe("past");
    expect(fixedSessionRegistrationState(record(), { sessionRegistrationCutoffMinutes: 0 }, start)).toBe("past");
  });

  it("applies each session's replay window under the Live's absolute deadline", () => {
    const duration = 3_600;
    const end = start.getTime() + duration * 1_000;
    expect(fixedSessionReplayAvailableUntil(record(), { replayEnabled: false, replayAvailableUntil: null, sessionReplayWindowHours: 24 }, duration)).toBeNull();
    expect(fixedSessionReplayAvailableUntil(record(), { replayEnabled: true, replayAvailableUntil: null, sessionReplayWindowHours: null }, duration)).toBeNull();
    expect(fixedSessionReplayAvailableUntil(record(), { replayEnabled: true, replayAvailableUntil: null, sessionReplayWindowHours: 24 }, duration)?.getTime())
      .toBe(end + 24 * 3_600_000);
    const cap = new Date(end + 2 * 3_600_000);
    expect(fixedSessionReplayAvailableUntil(record(), { replayEnabled: true, replayAvailableUntil: cap, sessionReplayWindowHours: 24 }, duration)).toEqual(cap);
  });

  it("resolves waiting, playing at the session offset, replay and unavailable per session", () => {
    const live = { status: "scheduled", endedAt: null, replayEnabled: true, replayAvailableUntil: null, sessionReplayWindowHours: 2, video: { durationSec: 3_600 } };
    const session = { startAt: start, status: "open" };
    expect(resolveFixedSessionRuntime(live, session, new Date(start.getTime() - 1_000))).toEqual({ state: "waiting", playbackStartSeconds: null });
    expect(resolveFixedSessionRuntime(live, session, new Date(start.getTime() + 90_000))).toEqual({ state: "playing", playbackStartSeconds: 90 });
    expect(resolveFixedSessionRuntime(live, session, new Date(start.getTime() + 2 * 3_600_000)).state).toBe("replay");
    expect(resolveFixedSessionRuntime(live, session, new Date(start.getTime() + 3 * 3_600_000)).state).toBe("unavailable");
    expect(resolveFixedSessionRuntime({ ...live, replayEnabled: false }, session, new Date(start.getTime() + 2 * 3_600_000)).state).toBe("unavailable");
    expect(resolveFixedSessionRuntime(live, { ...session, status: "cancelled" }, new Date(start.getTime() + 90_000)).state).toBe("unavailable");
    expect(resolveFixedSessionRuntime({ ...live, status: "draft" }, session, new Date(start.getTime() + 90_000)).state).toBe("unavailable");
  });

  it("picks the playing, then the next, then the latest non-cancelled session", () => {
    const at = (hours: number, status = "open") => ({ id: `s${hours}`, startAt: new Date(NOW.getTime() + hours * 3_600_000), status });
    const sessions = [at(-5), at(-0.5), at(3), at(6, "cancelled"), at(9)];
    expect(pickPublicFixedSession(sessions, 3_600, NOW)?.id).toBe("s-0.5");
    expect(pickPublicFixedSession(sessions, 600, NOW)?.id).toBe("s3");
    expect(pickPublicFixedSession([at(-5), at(-3), at(2, "cancelled")], 600, NOW)?.id).toBe("s-3");
    expect(pickPublicFixedSession([at(2, "cancelled")], 600, NOW)).toBeNull();
  });
});

describe("public grouping and studio rows", () => {
  it("groups open sessions by Taipei date and marks full ones", () => {
    const sessions = [
      { id: "b", startAt: new Date("2026-10-30T11:00:00.000Z"), capacity: 2, registeredCount: 2, status: "open" },
      { id: "a", startAt: new Date("2026-10-30T06:00:00.000Z"), capacity: null, registeredCount: 4, status: "open" },
      { id: "c", startAt: new Date("2026-10-31T05:00:00.000Z"), capacity: 9, registeredCount: 1, status: "closed" },
      { id: "d", startAt: new Date("2026-10-31T12:00:00.000Z"), capacity: 9, registeredCount: 1, status: "open" },
      { id: "e", startAt: new Date("2026-10-31T16:30:00.000Z"), capacity: null, registeredCount: 0, status: "cancelled" },
      { id: "past", startAt: new Date("2026-10-29T03:00:00.000Z"), capacity: null, registeredCount: 0, status: "open" },
    ];
    expect(groupOpenFixedSessionsByDate(sessions, { sessionRegistrationCutoffMinutes: 0 }, { now: NOW })).toEqual([
      {
        date: "2026-10-30",
        label: "10月30日（週五）",
        sessions: [
          { id: "a", startAt: "2026-10-30T06:00:00.000Z", timeLabel: "14:00", capacity: null, remaining: null, full: false },
          { id: "b", startAt: "2026-10-30T11:00:00.000Z", timeLabel: "19:00", capacity: 2, remaining: 0, full: true },
        ],
      },
      {
        date: "2026-10-31",
        label: "10月31日（週六）",
        sessions: [{ id: "d", startAt: "2026-10-31T12:00:00.000Z", timeLabel: "20:00", capacity: 9, remaining: 8, full: false }],
      },
    ]);
  });

  it("round-trips stored sessions into studio rows without cancelled ones", () => {
    expect(fixedSessionDraftRows([
      { startAt: new Date("2026-10-31T12:00:00.000Z"), capacity: null, status: "open" },
      { startAt: new Date("2026-10-30T06:00:00.000Z"), capacity: 50, status: "closed" },
      { startAt: new Date("2026-10-30T08:00:00.000Z"), capacity: null, status: "cancelled" },
    ], TZ)).toEqual([
      { startAt: "2026-10-30T14:00", capacity: "50", status: "closed" },
      { startAt: "2026-10-31T20:00", capacity: "", status: "open" },
    ]);
    expect(isFixedSessionLive({ sessionMode: "fixed_sessions" })).toBe(true);
    expect(isFixedSessionLive({ sessionMode: "single" })).toBe(false);
    expect(isFixedSessionLive(null)).toBe(false);
    expect(formatFixedSessionStart(new Date("2026-10-30T06:00:00.000Z"))).toContain("2026");
  });
});

describe("studio draft payload", () => {
  function studioForm(entries: Array<[string, string]>) {
    const data = new FormData();
    for (const [key, value] of [["title", "Webinar"], ["slug", "webinar"], ["scheduledAt", "2026-10-31T20:00"], ["streamMode", "vod"], ["affiliateMode", "enabled"], ["usageAttributionMode", "PROMOTER"], ["quotaPayerScope", "VENDOR"], ...entries] as Array<[string, string]>) data.append(key, value);
    return data;
  }

  it("keeps a single-start Live's payload free of session keys", () => {
    const payload = liveStudioDraftFromFormData(studioForm([["sessionMode", "single"]]), 4);
    expect(Object.keys(payload).filter((key) => key.startsWith("session") || key === "fixedSessions")).toEqual([]);
    // A draft saved before the field existed parses unchanged.
    expect("sessionMode" in LiveStudioDraftPayloadSchema.parse({ title: "Legacy" })).toBe(false);
  });

  it("carries fixed session rows, cutoff and replay window through autosave", () => {
    const rows = [row("2026-10-30T14:00", "50"), row("2026-10-30T19:00", "", "closed")];
    const payload = liveStudioDraftFromFormData(studioForm([
      ["sessionMode", "fixed_sessions"],
      ["fixedSessions", JSON.stringify(rows)],
      ["sessionRegistrationCutoffMinutes", "15"],
      ["sessionReplayWindowHours", "48"],
    ]), 4);
    expect(payload).toMatchObject({ sessionMode: "fixed_sessions", fixedSessions: rows, sessionRegistrationCutoffMinutes: "15", sessionReplayWindowHours: "48" });
    // Resume: the saved payload parses back to the same rows.
    expect(LiveStudioDraftPayloadSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  it("rejects more than the session limit or a malformed row in the draft", () => {
    const tooMany = Array.from({ length: MAX_FIXED_SESSIONS + 1 }, () => row("2026-10-30T14:00"));
    expect(LiveStudioDraftPayloadSchema.safeParse({ sessionMode: "fixed_sessions", fixedSessions: tooMany }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ sessionMode: "fixed_sessions", fixedSessions: [{ startAt: "x", capacity: "-1" }] }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ sessionMode: "fixed_sessions", fixedSessions: [{ startAt: "x", extra: true }] }).success).toBe(false);
  });
});