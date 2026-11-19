import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A3-04 (#669 review MINOR-A): the session-hint rules of resolveViewerFixedSession
// against an in-memory database. The hint's signature is covered by the
// cookie module's own tests and the DB tests; here a hint value "hint:<id>"
// simply names registration <id> of this vendor and Live.
vi.mock("@/lib/live-attendance-cookie", () => ({
  liveSessionHintTokenFromCookieHeader: vi.fn(() => null),
  liveSessionHintSubmissionId: vi.fn((token: string | null | undefined, input: { vendorId: string; liveId: string }) => (
    input.vendorId === "vendor_a" && input.liveId === "live_a" && typeof token === "string" && token.startsWith("hint:") ? token.slice(5) : null
  )),
}));

import { createFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import type { FixedSessionRecord, FixedSessionRuntimeLive } from "@/lib/live-fixed-sessions";
import { resolveViewerFixedSession } from "@/lib/live-fixed-sessions-store";

const NOW = new Date("2026-11-19T04:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DURATION_SECONDS = 3_600;

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const session = (id: string, offsetMs: number, status: FixedSessionRecord["status"] = "open"): FixedSessionRecord => ({
  id, startAt: at(offsetMs), capacity: null, registeredCount: 0, status,
});

function liveRules(overrides: Partial<FixedSessionRuntimeLive> = {}): FixedSessionRuntimeLive {
  return {
    status: "scheduled",
    endedAt: null,
    replayEnabled: true,
    replayAvailableUntil: null,
    sessionReplayWindowHours: null,
    video: { durationSec: DURATION_SECONDS },
    ...overrides,
  };
}

/**
 * The two reads the resolver makes: one registration (bound to vendor_a /
 * live_a, VERIFIED) with the session it holds now, and the Live's sessions.
 */
function fakeDb(state: { sessions: FixedSessionRecord[]; registrations: Record<string, string | null> }) {
  return {
    formSubmission: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; liveId: string; form: { vendorId: string } } }) => {
        if (where.liveId !== "live_a" || where.form.vendorId !== "vendor_a" || !(where.id in state.registrations)) return null;
        const held = state.sessions.find((candidate) => candidate.id === state.registrations[where.id]);
        return held ? { liveSession: held } : null;
      }),
    },
    liveSession: {
      findMany: vi.fn(async () => state.sessions
        .filter((candidate) => candidate.status !== "cancelled")
        .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())),
    },
  };
}

type Db = Parameters<typeof resolveViewerFixedSession>[0];

function resolve(
  state: Parameters<typeof fakeDb>[0],
  input: { hint?: string | null; registrationToken?: string | null; live?: FixedSessionRuntimeLive },
) {
  return resolveViewerFixedSession(fakeDb(state) as unknown as Db, {
    vendorId: "vendor_a",
    liveId: "live_a",
    registrationToken: input.registrationToken ?? null,
    sessionHintToken: input.hint ?? null,
    live: input.live ?? liveRules(),
    now: NOW,
  });
}

describe("resolveViewerFixedSession session-hint edges (A3-04)", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "fixed-session-store-unit-secret-longer-than-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  // `playing` started 10 minutes ago; `ended` started 2 hours ago (over an hour ago).
  const playing = session("playing", -10 * MINUTE);
  const ended = session("ended", -2 * HOUR);
  const upcoming = session("upcoming", 2 * HOUR);

  it("keeps an ended hinted session while its replay is open", async () => {
    const state = { sessions: [ended, playing], registrations: { lead: "ended" } };
    expect(await resolve(state, { hint: "hint:lead" })).toMatchObject({ id: "ended", source: "session_hint" });
    // A 2-hour per-session window: the session ended an hour ago, so its replay is open for one more hour.
    expect(await resolve(state, { hint: "hint:lead", live: liveRules({ sessionReplayWindowHours: 2 }) }))
      .toMatchObject({ id: "ended", source: "session_hint" });
  });

  it("drops an ended hinted session once replays are off, and follows the session playing now", async () => {
    const state = { sessions: [ended, playing], registrations: { lead: "ended" } };
    expect(await resolve(state, { hint: "hint:lead", live: liveRules({ replayEnabled: false }) }))
      .toMatchObject({ id: "playing", source: "public" });
  });

  it("drops an ended hinted session whose replay window or the Live's replay deadline has passed", async () => {
    const state = { sessions: [ended, playing], registrations: { lead: "ended" } };
    expect(await resolve(state, { hint: "hint:lead", live: liveRules({ sessionReplayWindowHours: 1 }) }))
      .toMatchObject({ id: "playing", source: "public" });
    expect(await resolve(state, { hint: "hint:lead", live: liveRules({ replayAvailableUntil: at(-MINUTE) }) }))
      .toMatchObject({ id: "playing", source: "public" });
    // Exactly at the deadline the replay is already closed (same rule as the runtime).
    expect(await resolve(state, { hint: "hint:lead", live: liveRules({ replayAvailableUntil: NOW }) }))
      .toMatchObject({ id: "playing", source: "public" });
  });

  it("with no replay and nothing playing, an ended hint gives way to the next public session (or the latest)", async () => {
    const off = liveRules({ replayEnabled: false });
    expect(await resolve({ sessions: [ended, upcoming], registrations: { lead: "ended" } }, { hint: "hint:lead", live: off }))
      .toMatchObject({ id: "upcoming", source: "public" });
    // Only the ended session exists: the public schedule picks it too, but not as the hint.
    expect(await resolve({ sessions: [ended], registrations: { lead: "ended" } }, { hint: "hint:lead", live: off }))
      .toMatchObject({ id: "ended", source: "public" });
  });

  it("never lets replay rules touch a playing or waiting hinted session", async () => {
    const off = liveRules({ replayEnabled: false, replayAvailableUntil: at(-HOUR) });
    const own = session("own", -40 * MINUTE);
    expect(await resolve({ sessions: [own, playing], registrations: { lead: "own" } }, { hint: "hint:lead", live: off }))
      .toMatchObject({ id: "own", source: "session_hint" });
    expect(await resolve({ sessions: [upcoming, session("later", 5 * HOUR)], registrations: { lead: "upcoming" } }, { hint: "hint:lead", live: off }))
      .toMatchObject({ id: "upcoming", source: "session_hint" });
  });

  it("re-reads the registration's current session: a moved registration never uses the session it held before", async () => {
    const own = session("own", -40 * MINUTE);
    // Moved from `own` (playing) to an upcoming session while `playing` also plays: the public session playing latest.
    expect(await resolve({ sessions: [own, playing, upcoming], registrations: { lead: "upcoming" } }, { hint: "hint:lead" }))
      .toMatchObject({ id: "playing", source: "public" });
    // Moved to a session that is already over, replays off: the public schedule.
    const off = liveRules({ replayEnabled: false });
    expect(await resolve({ sessions: [own, ended, playing], registrations: { lead: "ended" } }, { hint: "hint:lead", live: off }))
      .toMatchObject({ id: "playing", source: "public" });
    // …with replays on: the replay of the session it holds now.
    expect(await resolve({ sessions: [own, ended, playing], registrations: { lead: "ended" } }, { hint: "hint:lead" }))
      .toMatchObject({ id: "ended", source: "session_hint" });
    // Moved to a cancelled session: ignored, as before.
    const cancelled = session("cancelled", -20 * MINUTE, "cancelled");
    expect(await resolve({ sessions: [own, cancelled, playing], registrations: { lead: "cancelled" } }, { hint: "hint:lead" }))
      .toMatchObject({ id: "playing", source: "public" });
  });

  it("keeps the registration cookie strict: its own ended session without replay is not swapped", async () => {
    const state = { sessions: [ended, playing], registrations: { lead: "ended" } };
    const registrationToken = createFormSubmissionChatSessionToken({ submissionId: "lead", now: NOW });
    expect(await resolve(state, { registrationToken, live: liveRules({ replayEnabled: false }) }))
      .toMatchObject({ id: "ended", source: "registration" });
  });

  it("ignores a hint naming no registration of this Live, or one that does not verify", async () => {
    const state = { sessions: [ended, playing], registrations: { lead: "ended" } };
    expect(await resolve(state, { hint: "hint:someone-else" })).toMatchObject({ id: "playing", source: "public" });
    expect(await resolve(state, { hint: "forged" })).toMatchObject({ id: "playing", source: "public" });
  });
});
