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
  createResponse: vi.fn(),
  findRegistration: vi.fn(),
  findPaidTransaction: vi.fn(),
  findLive: vi.fn(),
  findSpotlight: vi.fn(),
  countQuestions: vi.fn(),
  createQuestion: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({
  interactionEvent: { findFirst: mocks.findEvent },
  liveInteractionRun: {
    upsert: mocks.upsertRun,
    findFirst: mocks.findRun,
    findUnique: mocks.findRunWithResponses,
    findMany: mocks.findManualRuns,
  },
  liveInteractionResponse: { count: mocks.countResponses, findUnique: mocks.findResponse, groupBy: mocks.groupResponses, create: mocks.createResponse },
  live: { findFirst: mocks.findLive },
  liveQuestion: { findFirst: mocks.findSpotlight, count: mocks.countQuestions, create: mocks.createQuestion },
  $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
    formSubmission: { findFirst: mocks.findRegistration },
    paymentTransaction: { findFirst: mocks.findPaidTransaction },
    liveQuestion: { count: mocks.countQuestions, create: mocks.createQuestion },
    liveInteractionResponse: { count: mocks.countResponses, create: mocks.createResponse },
  }),
}) }));
vi.mock("@/lib/live-quota-admission", async (original) => ({
  ...await original<typeof import("@/lib/live-quota-admission")>(),
  liveViewerTokenFromRequest: () => "A".repeat(43),
  hasActiveLiveViewerSession: mocks.activeViewer,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/sensitive-data", () => ({ decryptSensitiveValue: vi.fn(() => "CD-WIN-ABCD-1234") }));

import { GET, POST } from "./route";

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
  mocks.createResponse.mockResolvedValue({ id: "response-1" });
  mocks.findRegistration.mockResolvedValue({ id: "submission-1" });
  mocks.findPaidTransaction.mockResolvedValue({ id: "payment-1" });
  mocks.findLive.mockResolvedValue({ id: "live-1" });
  mocks.findSpotlight.mockResolvedValue(null);
  mocks.countQuestions.mockResolvedValue(0);
  mocks.createQuestion.mockResolvedValue({ id: "question-1", status: "pending" });
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

  it("records a purchased-only entry only after verified registration and paid live-product purchase checks", async () => {
    mocks.findRun.mockResolvedValue({
      id: "run-purchased", vendorId: "vendor-1", liveId: "live-1", eventType: "lucky_draw", status: "active",
      endsAt: new Date(Date.now() + 60_000),
      configuration: { kind: "lucky_draw", durationSec: 60, slogan: "", eligibility: "purchased" },
    });
    const response = await POST(new Request("https://app.example.test/api/live-interactions", {
      method: "POST",
      headers: {
        origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web",
        cookie: "celebratedeal_form_submission=submission-1",
      },
      body: JSON.stringify({ action: "respond", vendorId: "vendor-1", liveId: "live-1", runId: "run-purchased", value: "entry" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.findRegistration).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: "submission-1", liveId: "live-1", verificationStatus: "VERIFIED",
    }) }));
    expect(mocks.findPaidTransaction).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      vendorId: "vendor-1", status: "paid", metadata: { path: ["formSubmissionId"], equals: "submission-1" },
    }) }));
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      formSubmissionId: "submission-1", participantHash: expect.any(String),
    }) }));
  });

  it("accepts a bounded multi-select poll response and aggregates every selected option", async () => {
    mocks.findRun.mockResolvedValue({
      id: "run-poll", vendorId: "vendor-1", liveId: "live-1", eventType: "poll", status: "active",
      endsAt: new Date(Date.now() + 60_000),
      configuration: { kind: "poll", durationSec: 60, question: "複選", selectionMode: "multiple", maxSelections: 2, options: [{ id: "option-1", label: "A" }, { id: "option-2", label: "B" }] },
    });
    mocks.groupResponses.mockResolvedValue([{ value: '["option-1","option-2"]', _count: { _all: 1 } }]);
    const response = await POST(request({ action: "respond", vendorId: "vendor-1", liveId: "live-1", runId: "run-poll", value: ["option-1", "option-2"] }));
    expect(response.status).toBe(200);
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ value: '["option-1","option-2"]' }) }));
    await expect(response.json()).resolves.toMatchObject({ run: { pollResults: [
      { id: "option-1", votes: 1, percentage: 50 },
      { id: "option-2", votes: 1, percentage: 50 },
    ] } });
  });

  it("rejects duplicate or excessive poll selections", async () => {
    mocks.findRun.mockResolvedValue({
      id: "run-poll", vendorId: "vendor-1", liveId: "live-1", eventType: "poll", status: "active",
      endsAt: new Date(Date.now() + 60_000),
      configuration: { kind: "poll", durationSec: 60, question: "複選", selectionMode: "multiple", maxSelections: 2, options: [{ id: "option-1", label: "A" }, { id: "option-2", label: "B" }] },
    });
    const response = await POST(request({ action: "respond", vendorId: "vendor-1", liveId: "live-1", runId: "run-poll", value: ["option-1", "option-1"] }));
    expect(response.status).toBe(400);
    expect(mocks.createResponse).not.toHaveBeenCalled();
  });

  it("rejects purchased-only draw registration when no paid, live-bound purchase exists", async () => {
    mocks.findRun.mockResolvedValue({
      id: "run-purchased", vendorId: "vendor-1", liveId: "live-1", eventType: "lucky_draw", status: "active",
      endsAt: new Date(Date.now() + 60_000),
      configuration: { kind: "lucky_draw", durationSec: 60, slogan: "", eligibility: "purchased" },
    });
    mocks.findPaidTransaction.mockResolvedValueOnce(null);
    const response = await POST(new Request("https://app.example.test/api/live-interactions", {
      method: "POST",
      headers: {
        origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web",
        cookie: "celebratedeal_form_submission=submission-1",
      },
      body: JSON.stringify({ action: "respond", vendorId: "vendor-1", liveId: "live-1", runId: "run-purchased", value: "entry" }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.createResponse).not.toHaveBeenCalled();
  });

  it("projects a redemption code only to the response that won the draw", async () => {
    mocks.findManualRuns.mockResolvedValue([{ id: "run-winner" }]);
    mocks.findRunWithResponses.mockResolvedValue({
      id: "run-winner", vendorId: "vendor-1", eventType: "lucky_draw", title: "抽獎", status: "closed",
      startsAt: new Date("2026-09-06T00:00:00.000Z"), endsAt: new Date("2026-09-06T00:01:00.000Z"),
      updatedAt: new Date("2026-09-06T00:01:00.000Z"),
      configuration: { kind: "lucky_draw", durationSec: 60, slogan: "口號" }, winnerResponseId: "winner-response",
    });
    mocks.findResponse
      .mockResolvedValueOnce({ id: "other-response", value: "口號" })
      .mockResolvedValueOnce({ id: "winner-response", displayName: "中獎者", winnerClaimCodeEncryptedEnvelope: "v1.envelope" });
    const nonWinner = await GET(new Request("https://app.example.test/api/live-interactions?vendorId=vendor-1&liveId=live-1", {
      headers: { cookie: "celebratedeal_live_viewer=" + "A".repeat(43) },
    }));
    await expect(nonWinner.json()).resolves.toMatchObject({ runs: [{ winnerIsViewer: false, winnerClaimCode: null }] });

    mocks.findResponse
      .mockResolvedValueOnce({ id: "winner-response", value: "口號" })
      .mockResolvedValueOnce({ id: "winner-response", displayName: "中獎者", winnerClaimCodeEncryptedEnvelope: "v1.envelope" });
    const winner = await GET(new Request("https://app.example.test/api/live-interactions?vendorId=vendor-1&liveId=live-1", {
      headers: { cookie: "celebratedeal_live_viewer=" + "A".repeat(43) },
    }));
    await expect(winner.json()).resolves.toMatchObject({ runs: [{ winnerIsViewer: true, winnerClaimCode: "CD-WIN-ABCD-1234" }] });
  });

  it("accepts an anonymous bounded question for an admitted live viewer", async () => {
    const response = await POST(request({ action: "ask_question", vendorId: "vendor-1", liveId: "live-1", body: "可以示範一次嗎？" }));
    expect(response.status).toBe(201);
    expect(mocks.createQuestion).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      vendorId: "vendor-1", liveId: "live-1", participantHash: expect.any(String), displayName: null, body: "可以示範一次嗎?",
    }) }));
  });

  it("rate limits repeated questions by participant within the same tenant live", async () => {
    mocks.countQuestions.mockResolvedValueOnce(3);
    const response = await POST(request({ action: "ask_question", vendorId: "vendor-1", liveId: "live-1", body: "第四題" }));
    expect(response.status).toBe(429);
    expect(mocks.createQuestion).not.toHaveBeenCalled();
  });

  it("projects only the current spotlight question", async () => {
    mocks.findManualRuns.mockResolvedValue([]);
    mocks.findSpotlight.mockResolvedValue({ id: "q-1", body: "精選問題", displayName: null, spotlightedAt: new Date() });
    const response = await GET(new Request("https://app.example.test/api/live-interactions?vendorId=vendor-1&liveId=live-1"));
    await expect(response.json()).resolves.toMatchObject({ runs: [], spotlight: { id: "q-1", body: "精選問題", displayName: null } });
  });
});
