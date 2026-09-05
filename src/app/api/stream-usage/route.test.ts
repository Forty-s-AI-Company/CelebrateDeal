import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getDb: vi.fn(),
  getActiveLiveViewerSession: vi.fn(),
  dispatchAutomationEvent: vi.fn(),
  liveViewerTokenFromRequest: vi.fn(),
  recordStreamUsageLedgerEntry: vi.fn(),
  StreamUsageValidationError: class StreamUsageValidationError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/live-quota-admission", () => ({
  getActiveLiveViewerSession: mocks.getActiveLiveViewerSession,
  liveViewerTokenFromRequest: mocks.liveViewerTokenFromRequest,
}));
vi.mock("@/lib/automation-workflow", () => ({ dispatchAutomationEvent: mocks.dispatchAutomationEvent }));
vi.mock("@/lib/stream-usage", () => ({
  recordStreamUsageLedgerEntry: mocks.recordStreamUsageLedgerEntry,
  StreamUsageValidationError: mocks.StreamUsageValidationError,
  STREAM_USAGE_MAX_HEARTBEAT_SECONDS: 60,
}));

import { POST } from "./route";

const payload = {
  vendorId: "vendor-1",
  liveId: "live-1",
  sourcePageSlug: "partner-page",
  eventId: "00000000-0000-4000-8000-000000000001",
  watchSeconds: 60,
};

function request(body: unknown = payload, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/stream-usage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.getDb.mockReturnValue({
    streamUsageLedgerEntry: { aggregate: vi.fn().mockResolvedValue({ _sum: { watchSeconds: 120 } }) },
    formSubmission: { findFirst: vi.fn().mockResolvedValue(null) },
  });
  mocks.liveViewerTokenFromRequest.mockReturnValue("A".repeat(43));
  mocks.getActiveLiveViewerSession.mockResolvedValue({ id: "session-1", tokenHash: "viewer-hash" });
  mocks.dispatchAutomationEvent.mockResolvedValue([]);
  mocks.recordStreamUsageLedgerEntry.mockResolvedValue({ duplicate: false, entryId: "usage-1", source: "TEAM_FUNNEL_PAGE" });
});

describe("POST /api/stream-usage", () => {
  it("records a server-validated heartbeat and returns only bounded status", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: false });
    expect(mocks.getActiveLiveViewerSession).toHaveBeenCalledWith(expect.any(Object), {
      vendorId: payload.vendorId,
      liveId: payload.liveId,
      token: "A".repeat(43),
    });
    expect(mocks.recordStreamUsageLedgerEntry).toHaveBeenCalledWith({ ...payload, viewerKeyHash: "viewer-hash" });
    expect(mocks.dispatchAutomationEvent).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      eventId: payload.eventId,
      trigger: "viewer_watch_progress",
      watchSecondsTotal: 120,
    }));
  });

  it("uses a verified same-live registration as the automation recipient", async () => {
    const db = {
      streamUsageLedgerEntry: { aggregate: vi.fn().mockResolvedValue({ _sum: { watchSeconds: 300 } }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ id: "submission-1" }) },
    };
    mocks.getDb.mockReturnValue(db);
    const response = await POST(request(payload, { cookie: "celebratedeal_form_submission=submission-1" }));
    expect(response.status).toBe(200);
    expect(db.formSubmission.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "submission-1", liveId: "live-1", verificationStatus: "VERIFIED" }),
    }));
    expect(mocks.dispatchAutomationEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      subjectType: "buyer_registration",
      subjectId: "submission-1",
      subjectKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      watchSecondsTotal: 300,
    }));
  });

  it("rejects a missing admission cookie before the usage ledger", async () => {
    mocks.liveViewerTokenFromRequest.mockReturnValue(null);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.getActiveLiveViewerSession).not.toHaveBeenCalled();
    expect(mocks.recordStreamUsageLedgerEntry).not.toHaveBeenCalled();
  });

  it.each(["foreign vendor/live session", "expired session"])("rejects %s before the usage ledger", async () => {
    mocks.getActiveLiveViewerSession.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.recordStreamUsageLedgerEntry).not.toHaveBeenCalled();
  });

  it("rejects missing client proof and malformed usage before the ledger", async () => {
    const missingProof = await POST(request(payload, { "x-celebratedeal-client": "mobile" }));
    expect(missingProof.status).toBe(403);

    const malformed = await POST(request({ ...payload, watchSeconds: 61 }));
    expect(malformed.status).toBe(400);
    expect(mocks.recordStreamUsageLedgerEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["live_not_found", 404],
    ["source_page_not_found", 404],
    ["event_conflict", 409],
    ["invalid_duration", 400],
    ["invalid_event", 400],
    ["stream_minutes_exhausted", 429],
  ] as const)("maps %s without exposing internal details", async (code, status) => {
    mocks.recordStreamUsageLedgerEntry.mockRejectedValueOnce(new mocks.StreamUsageValidationError(code));

    const response = await POST(request());

    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).not.toContain(code);
    expect(body).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it("returns a safe 500 for an unexpected ledger failure", async () => {
    mocks.recordStreamUsageLedgerEntry.mockRejectedValueOnce(new Error("database detail"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to record usage" });
  });

  it("returns the stable public code needed to stop exhausted browser playback", async () => {
    mocks.recordStreamUsageLedgerEntry.mockRejectedValueOnce(new mocks.StreamUsageValidationError("stream_minutes_exhausted"));

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Stream quota exhausted",
      code: "stream_minutes_exhausted",
    });
  });
});
