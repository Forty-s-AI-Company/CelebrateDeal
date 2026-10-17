import { describe, expect, it, vi } from "vitest";
import { issueMetricSession, parseMetricSessionRequest } from "./live-metric-session";
import { MetricIngestError } from "./live-metric-ingestion";
const requestId = "de305d54-75b4-431b-adb2-eb6b9e546014";
describe("metric session issuance input boundary", () => {
  it("rejects server renewal without the required intake binding", async () => {
    const db = { $transaction: vi.fn() };
    await expect(issueMetricSession(db, vi.fn(), { versionId: "version", expiresAt: new Date("2030-01-01") }, { requestId }, { renewPlaybackIntake: true }))
      .rejects.toMatchObject({ code: "invalid_payload" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("accepts only a request id", () => { expect(parseMetricSessionRequest({ requestId })).toEqual({ requestId }); });
  it.each([null, {}, { requestId: "x" }, { requestId, submissionId: "forged" }, { requestId, versionId: "client-version" }, { requestId, anchorAtMs: 123 }, { requestId, expiresAt: "forever" }])("rejects client identity and lifecycle input %j", (body) => {
    expect(() => parseMetricSessionRequest(body)).toThrow(new MetricIngestError("invalid_payload"));
  });
  it.each(["P2028", "P2024"])("maps bounded transaction failure %s to retryable without internal detail", async (code) => {
    const db = { $transaction: vi.fn().mockRejectedValue({ code, message: "synthetic internal diagnostic" }) };
    await expect(issueMetricSession(db, vi.fn(), { versionId: "version", expiresAt: new Date("2030-01-01") }, { requestId })).rejects.toThrow(new MetricIngestError("retryable_conflict"));
  });
  it("rejects an invalid provisioning lifetime before opening a transaction", async () => {
    const db = { $transaction: vi.fn() };
    await expect(issueMetricSession(db, vi.fn(), { versionId: "version", expiresAt: new Date(NaN) }, { requestId })).rejects.toThrow(new MetricIngestError("invalid_payload"));
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
