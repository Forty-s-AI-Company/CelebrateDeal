import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findEvent: vi.fn(),
  upsertRun: vi.fn(),
  findRun: vi.fn(),
  findRunWithResponses: vi.fn(),
  findManualRuns: vi.fn(),
  activeViewer: vi.fn(),
  countResponses: vi.fn(),
  findResponse: vi.fn(),
  groupResponses: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({
  interactionEvent: { findFirst: mocks.findEvent },
  liveInteractionRun: {
    upsert: mocks.upsertRun,
    findFirst: mocks.findRun,
    findUnique: mocks.findRunWithResponses,
    findMany: mocks.findManualRuns,
  },
  liveInteractionResponse: { count: mocks.countResponses, findUnique: mocks.findResponse, groupBy: mocks.groupResponses, create: vi.fn() },
  $transaction: vi.fn(),
}) }));
vi.mock("@/lib/live-quota-admission", async (original) => ({
  ...await original<typeof import("@/lib/live-quota-admission")>(),
  liveViewerTokenFromRequest: () => "A".repeat(43),
  hasActiveLiveViewerSession: mocks.activeViewer,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://app.example.test/api/live-interactions", {
    method: "POST",
    headers: { origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeViewer.mockResolvedValue(true);
  mocks.upsertRun.mockResolvedValue({ id: "run-1" });
  mocks.countResponses.mockResolvedValue(1);
  mocks.findResponse.mockResolvedValue(null);
  mocks.groupResponses.mockResolvedValue([{ value: "option-1", _count: { _all: 1 } }]);
  mocks.findRunWithResponses.mockResolvedValue({
    id: "run-1", eventType: "poll", title: "你選哪個？", status: "active",
    startsAt: new Date("2026-09-06T00:00:00.000Z"), endsAt: new Date("2026-09-06T00:01:00.000Z"),
    configuration: { kind: "poll", durationSec: 60, question: "你選哪個？", options: [{ id: "option-1", label: "A" }, { id: "option-2", label: "B" }] },
    winnerResponseId: null,
  });
});

describe("live interaction public contract", () => {
  it("opens only a published event bound to the admitted live and returns aggregate poll results", async () => {
    const playbackStartedAt = new Date(Date.now() - 40_000);
    mocks.findEvent.mockResolvedValue({
      id: "event-1", eventType: "poll", triggerSec: 30, title: "你選哪個？", productId: null,
      metadata: { question: "你選哪個？", options: ["A", "B"], durationSec: 60 },
      script: { lives: [{
        streamMode: "live", scheduledAt: playbackStartedAt, status: "live",
        startedAt: playbackStartedAt, endedAt: null, replayAvailableUntil: null,
        replayEnabled: true, video: { durationSec: 3600 },
      }] },
    });
    const response = await POST(request({ action: "open", vendorId: "vendor-1", liveId: "live-1", eventId: "event-1" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ run: {
      id: "run-1",
      responseCount: 1,
      pollResults: [
        { id: "option-1", votes: 1, percentage: 100 },
        { id: "option-2", votes: 0, percentage: 0 },
      ],
    } });
    expect(mocks.findEvent).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      script: expect.objectContaining({ vendorId: "vendor-1", status: "published", lives: { some: { id: "live-1", vendorId: "vendor-1" } } }),
    }) }));
  });

  it("fails closed before reading an event when the viewer session is not active", async () => {
    mocks.activeViewer.mockResolvedValueOnce(false);
    const response = await POST(request({ action: "open", vendorId: "vendor-1", liveId: "live-1", eventId: "event-1" }));
    expect(response.status).toBe(401);
    expect(mocks.findEvent).not.toHaveBeenCalled();
  });

  it("does not create a scheduled run before its server-side trigger time", async () => {
    mocks.findEvent.mockResolvedValue({
      id: "event-early", eventType: "poll", triggerSec: 3_600, title: "還沒開始", productId: null,
      metadata: { question: "還沒開始", options: ["A", "B"], durationSec: 60 },
      script: { lives: [{
        streamMode: "live", scheduledAt: new Date(), status: "live",
        startedAt: new Date(), endedAt: null, replayAvailableUntil: null,
        replayEnabled: true, video: { durationSec: 7_200 },
      }] },
    });

    const response = await POST(request({
      action: "open", vendorId: "vendor-1", liveId: "live-1", eventId: "event-early",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Interaction is outside its scheduled window" });
    expect(mocks.upsertRun).not.toHaveBeenCalled();
  });

  it("does not reopen a scheduled run after its configured duration", async () => {
    const playbackStartedAt = new Date(Date.now() - 120_000);
    mocks.findEvent.mockResolvedValue({
      id: "event-late", eventType: "poll", triggerSec: 30, title: "已結束", productId: null,
      metadata: { question: "已結束", options: ["A", "B"], durationSec: 60 },
      script: { lives: [{
        streamMode: "live", scheduledAt: playbackStartedAt, status: "live",
        startedAt: playbackStartedAt, endedAt: null, replayAvailableUntil: null,
        replayEnabled: true, video: { durationSec: 7_200 },
      }] },
    });

    const response = await POST(request({
      action: "open", vendorId: "vendor-1", liveId: "live-1", eventId: "event-late",
    }));

    expect(response.status).toBe(409);
    expect(mocks.upsertRun).not.toHaveBeenCalled();
  });
});
