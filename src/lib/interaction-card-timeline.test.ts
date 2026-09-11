import { describe, expect, it, vi } from "vitest";
import { CardCommandSchema, CardScheduleSchema, type CardView } from "./interaction-card-contract";
import { resolveCardClock, selectScheduledCard, timelinePosition, selectTimelineCard } from "./interaction-card-timeline";
import { observeCardMedia } from "./interaction-card-media";

const card = (id: string, startSeconds: number, durationSeconds = 10): CardView => ({ id, title: id, status: "draft", startsAt: null, endsAt: null, ownValue: null,
  configuration: { version: 1, kind: "interaction_card", answerType: "text", visibility: "instructor_only", options: [], schedule: { enabled: true, startSeconds, durationSeconds } } });
const live = { streamMode: "vod", status: "live", scheduledAt: new Date("2026-09-11T00:00:00Z"), startedAt: null, endedAt: null, replayAvailableUntil: null, replayEnabled: true, video: { durationSec: 300 } };
describe("card timeline deterministic clocks", () => {
  it("validates finite integer times and prevents schedule injection", () => {
    for (const startSeconds of [-1, 0.5, Infinity, NaN, 86401]) expect(CardScheduleSchema.safeParse({ enabled: true, startSeconds, durationSeconds: 10 }).success).toBe(false);
    for (const durationSeconds of [0, -1, 1.1, Infinity, 86401]) expect(CardScheduleSchema.safeParse({ enabled: true, startSeconds: 0, durationSeconds }).success).toBe(false);
    expect(CardScheduleSchema.safeParse({ enabled: true, startSeconds: 86399, durationSeconds: 2 }).success).toBe(false);
    expect(CardCommandSchema.safeParse({ action: "schedule", liveId: "l", runId: "r", schedule: { enabled: true, startSeconds: 10, durationSeconds: 20 }, vendorId: "foreign" }).success).toBe(false);
  });
  it("never catches up skipped questions, and uses half-open windows", () => {
    const cards = [card("a", 10), card("b", 30), card("c", 60)];
    expect([0, 9.999, 10, 19.999, 20, 55, 65, 70].map(t => selectScheduledCard(cards, t)?.id ?? null)).toEqual([null, null, "a", "a", null, null, "c", null]);
    expect(selectScheduledCard(cards, null)).toBeNull();
    expect(selectScheduledCard(cards, NaN)).toBeNull();
  });
  it("selects exactly one overlapping card independent of request/event order", () => {
    const cards = [card("z", 10, 60), card("b", 20), card("a", 20)];
    expect(selectScheduledCard(cards, 25)?.id).toBe("a");
    expect(selectScheduledCard([...cards].reverse(), 25)?.id).toBe("a");
    expect(selectScheduledCard(cards, 35)?.id).toBe("z");
    expect(selectScheduledCard([{ ...cards[0]!, status: "closed" }], 15)).toBeNull();
    expect(selectScheduledCard([{ ...cards[0]!, configuration: { ...cards[0]!.configuration, schedule: { enabled: false, startSeconds: 10, durationSeconds: 60 } } }], 15)).toBeNull();
  });
  it("keeps pause, rewind, replay and duplicate events tied to media time", () => {
    const clock = { mode: "personal" as const, positionSeconds: null };
    const a = card("a", 10);
    expect([10, 10, 25, 15, 0, 10].map(time => selectScheduledCard([a], timelinePosition(clock, time, 100))?.id ?? null)).toEqual(["a", "a", null, "a", null, "a"]);
    expect(timelinePosition(clock, null, 0)).toBeNull();
  });
  it("uses the common server position for late joiners and expires stale leases", () => {
    const clock = resolveCardClock(live, new Date("2026-09-11T00:01:05Z"));
    expect(clock).toEqual({ mode: "synchronized", positionSeconds: 65 });
    expect(timelinePosition(clock, 0, 2)).toBe(67);
    expect(timelinePosition(clock, 999, 4)).toBeNull();
    expect(selectScheduledCard([card("expired", 10), card("current", 60)], clock.positionSeconds)?.id).toBe("current");
  });
  it("distinguishes real live, waiting, personal replay and unsupported evergreen cohorts", () => {
    expect(resolveCardClock({ ...live, streamMode: "live" }, new Date()).mode).toBe("manual");
    expect(resolveCardClock(live, new Date("2026-09-10T00:00:00Z")).mode).toBe("unavailable");
    expect(resolveCardClock(live, new Date("2026-09-11T00:06:00Z")).mode).toBe("personal");
    expect(resolveCardClock({ ...live, replayEnabled: false }, new Date("2026-09-11T00:06:00Z")).mode).toBe("unavailable");
    expect(resolveCardClock({ ...live, isEvergreen: true }, new Date()).mode).toBe("unavailable");
    expect(resolveCardClock({ ...live, isEvergreen: true, evergreenSessionStartAt: live.scheduledAt }, new Date("2026-09-11T00:00:15Z"))).toEqual({ mode: "synchronized", positionSeconds: 15 });
  });
  it("hides synchronized boundary questions when network uncertainty could make them expired", () => {
    const timeline = { clock: { mode: "synchronized" as const, positionSeconds: 19.8 }, cards: [card("a", 10)] };
    expect(selectTimelineCard(timeline, 0, 0, 0.3)).toBeNull();
    expect(selectTimelineCard(timeline, 0, 0, 0.1)?.id).toBe("a");
    expect(selectTimelineCard(timeline, 0, 0.2, 0.1)).toBeNull();
    expect(selectTimelineCard({ ...timeline, clock: { mode: "personal", positionSeconds: null } }, 15, 0, 0.3)?.id).toBe("a");
  });
  it("integrates native media events without a wall-clock playback fallback", () => {
    const documentTarget = new EventTarget(); vi.stubGlobal("document", documentTarget);
    const video = Object.assign(new EventTarget(), { currentTime: 0, readyState: 1, ended: false, seeking: false });
    const publish = vi.fn();
    try {
      const stop = observeCardMedia(video as unknown as HTMLVideoElement, publish);
      video.currentTime = 15; video.dispatchEvent(new Event("timeupdate")); expect(publish).toHaveBeenLastCalledWith(15);
      video.dispatchEvent(new Event("pause")); expect(publish).toHaveBeenLastCalledWith(15);
      video.seeking = true; video.dispatchEvent(new Event("seeking")); expect(publish).toHaveBeenLastCalledWith(null);
      video.seeking = false; video.currentTime = 5; video.dispatchEvent(new Event("seeked")); expect(publish).toHaveBeenLastCalledWith(5);
      video.currentTime = 11; documentTarget.dispatchEvent(new Event("visibilitychange")); expect(publish).toHaveBeenLastCalledWith(11);
      video.ended = true; video.dispatchEvent(new Event("ended")); expect(publish).toHaveBeenLastCalledWith(null);
      video.ended = false; video.currentTime = 0; video.dispatchEvent(new Event("play")); expect(publish).toHaveBeenLastCalledWith(0);
      stop(); publish.mockClear(); video.dispatchEvent(new Event("timeupdate")); documentTarget.dispatchEvent(new Event("visibilitychange")); expect(publish).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
