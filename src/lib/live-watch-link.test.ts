import { describe, expect, it } from "vitest";
import { sessionHintExpiresAt } from "@/lib/live-watch-link";

// A2-10 review MINOR-3: the session hint lives only until the viewing window
// of the registrant's session closes, never past the link that set it.
const HOUR = 3_600_000;
const NOW = new Date("2026-11-20T02:00:00.000Z");
const START = new Date("2026-11-20T04:00:00.000Z");
const LINK = new Date(START.getTime() + 30 * 24 * HOUR);
const live = (overrides: Partial<Parameters<typeof sessionHintExpiresAt>[0]> = {}) => ({
  vendorId: "vendor_a",
  replayEnabled: false,
  replayAvailableUntil: null,
  sessionReplayWindowHours: null,
  video: { vendorId: "vendor_a", durationSec: 3_600 },
  ...overrides,
});

describe("sessionHintExpiresAt", () => {
  it("ends with the session when replays are off", () => {
    expect(sessionHintExpiresAt(live(), { startAt: START }, LINK, NOW)).toEqual(new Date(START.getTime() + HOUR));
  });

  it("ends with the session's replay window, or the Live's earlier replay deadline", () => {
    expect(sessionHintExpiresAt(live({ replayEnabled: true, sessionReplayWindowHours: 48 }), { startAt: START }, LINK, NOW))
      .toEqual(new Date(START.getTime() + HOUR + 48 * HOUR));
    const deadline = new Date(START.getTime() + 5 * HOUR);
    expect(sessionHintExpiresAt(live({ replayEnabled: true, sessionReplayWindowHours: 48, replayAvailableUntil: deadline }), { startAt: START }, LINK, NOW))
      .toEqual(deadline);
    // A replay deadline before the session's natural end still leaves the session itself.
    expect(sessionHintExpiresAt(live({ replayEnabled: true, replayAvailableUntil: new Date(START.getTime() - HOUR) }), { startAt: START }, LINK, NOW))
      .toEqual(new Date(START.getTime() + HOUR));
  });

  it("falls back to the link's expiry for an open-ended replay, and never outlives the link", () => {
    expect(sessionHintExpiresAt(live({ replayEnabled: true }), { startAt: START }, LINK, NOW)).toEqual(LINK);
    const shortLink = new Date(START.getTime() + 30 * 60_000 + 456);
    expect(sessionHintExpiresAt(live(), { startAt: START }, shortLink, NOW)).toEqual(new Date(START.getTime() + 30 * 60_000));
  });

  it("sets nothing once the window is over, and ignores another vendor's video length", () => {
    expect(sessionHintExpiresAt(live(), { startAt: START }, LINK, new Date(START.getTime() + HOUR))).toBeNull();
    expect(sessionHintExpiresAt(live(), { startAt: START }, LINK, new Date(START.getTime() + HOUR - 500))).toBeNull();
    expect(sessionHintExpiresAt(live({ video: { vendorId: "vendor_b", durationSec: 3_600 } }), { startAt: START }, LINK, NOW)).toEqual(START);
  });
});
