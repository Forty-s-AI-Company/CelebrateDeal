import { describe, expect, it, vi } from "vitest";
import { runMetricRegistrationPass } from "./live-metric-registration-pass";
const input = { vendorId: "v", liveId: "l", versionId: "version", afterSubmissionId: null, take: 1 };
const page = (cursor: string, hasMore = true) => ({ status: "batch_complete", processed: 1, retryable: 1, terminalGaps: 0,
  outcomes: { pending_verification: 1 }, nextSubmissionId: cursor, hasMore, coverage: "unknown" });
describe("bounded metric reconciliation pass", () => {
  it("advances pages without promoting unknown coverage", async () => {
    const send = vi.fn().mockResolvedValueOnce(page("a")).mockResolvedValueOnce(page("b", false));
    expect(await runMetricRegistrationPass(send, input)).toMatchObject({ status: "pass_complete", pages: 2, processed: 2, retryable: 2, coverage: "unknown" });
    expect(send.mock.calls[1][0].afterSubmissionId).toBe("a");
  });
  it("keeps the last acknowledged cursor on transport failure", async () => {
    const send = vi.fn().mockResolvedValueOnce(page("a")).mockRejectedValueOnce(new Error("synthetic"));
    expect(await runMetricRegistrationPass(send, input)).toMatchObject({ status: "transport_unavailable", nextSubmissionId: "a", pages: 1 });
  });
  it("stops on cycles and page limits", async () => {
    expect(await runMetricRegistrationPass(vi.fn().mockResolvedValue(page("a")), input)).toMatchObject({ status: "no_progress", pages: 1 });
    expect(await runMetricRegistrationPass(vi.fn().mockResolvedValue(page("a")), input, 1)).toMatchObject({ status: "page_limit", pages: 1 });
  });
  it("rejects inconsistent counters and completion claims", async () => {
    expect((await runMetricRegistrationPass(async () => ({ ...page("a"), processed: 2 }), input)).status).toBe("invalid_receipt");
    expect((await runMetricRegistrationPass(async () => ({ ...page("a"), coverage: "complete" }), input)).status).toBe("invalid_receipt");
  });
  it("rejects exhausted-budget completion without acknowledging its cursor", async () => {
    const send = vi.fn().mockResolvedValueOnce(page("a"))
      .mockResolvedValueOnce({ ...page("b", false), status: "budget_exhausted" });
    expect(await runMetricRegistrationPass(send, input)).toMatchObject({
      status: "invalid_receipt", pages: 1, processed: 1, nextSubmissionId: "a",
    });
  });
  it("continues after a valid exhausted-budget page", async () => {
    const send = vi.fn().mockResolvedValueOnce({ ...page("a"), status: "budget_exhausted" })
      .mockResolvedValueOnce(page("b", false));
    expect(await runMetricRegistrationPass(send, { ...input, take: 2 })).toMatchObject({
      status: "pass_complete", pages: 2, processed: 2, nextSubmissionId: "b", coverage: "unknown",
    });
  });
  it.each([
    { ...page("b"), status: "budget_exhausted" },
    { ...page("b"), processed: 0, retryable: 0, outcomes: {}, nextSubmissionId: "a" },
    { ...page("b", false), retryable: 0 },
    { ...page("b", false), outcomes: { recorded: 1 } },
  ])("rejects inconsistent page semantics without advancing", async invalid => {
    const send = vi.fn().mockResolvedValueOnce(page("a")).mockResolvedValueOnce(invalid);
    expect(await runMetricRegistrationPass(send, input)).toMatchObject({
      status: "invalid_receipt", pages: 1, processed: 1, nextSubmissionId: "a",
    });
  });
  it("retains the acknowledged cursor when a later page exceeds the deadline", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn().mockResolvedValueOnce(page("a"))
        .mockImplementationOnce(() => new Promise(() => {}));
      const running = runMetricRegistrationPass(send, input);
      await vi.advanceTimersByTimeAsync(60000);
      expect(await running).toMatchObject({ status: "deadline", pages: 1, processed: 1, nextSubmissionId: "a" });
      expect(send.mock.calls[1][1].aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("aborts a transport that never responds at the deadline", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    try {
      const running = runMetricRegistrationPass(async (_input, current) => { signal = current; return new Promise(() => {}); }, input);
      await vi.advanceTimersByTimeAsync(60000);
      expect((await running).status).toBe("deadline"); expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
