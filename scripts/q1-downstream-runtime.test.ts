import { describe, expect, it, vi } from "vitest";
import { fetchQ1Downstream } from "./q1-downstream-runtime";
describe("fixed deployed-process readonly request", () => {
  const receipt = { classification: "SCHEMA_INCOMPATIBLE", readStage: "NONE", readClass: "NONE", schema: [], enums: [], decrypt: "NOT_RUN", protect: "NOT_RUN",
    billingPurposeClass: "NOT_RUN", coursePolicySnapshotClass: "NOT_RUN", merchantSnapshotExists: null, emailDeliveryExists: null,
    paidOrderEventExists: null, databaseWrites: false, callbackPosts: 0, callbackReplayAuthorized: false };
  it("uses only GET on the fixed staging endpoint and validates the closed response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(receipt)));
    expect(await fetchQ1Downstream("synthetic-job-binding", "a".repeat(40), request)).toEqual(receipt);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]![0]).toBe("https://celebrate-deal-staging.carry-digital-nomad.in.net/api/admin/ops/payuni/q1-downstream-readonly");
    expect(request.mock.calls[0]![1]).toMatchObject({ method: "GET", redirect: "error", headers: { "x-celebratedeal-source-sha": "a".repeat(40) } });
  });
  it.each(["", "LATEST", "b".repeat(39)])("rejects invalid runtime source %s before any transport", async source => {
    const request = vi.fn<typeof fetch>();
    await expect(fetchQ1Downstream("synthetic-job-binding", source, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects raw extra fields and never retries a lost transport", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, private: "synthetic" })))
      .mockRejectedValueOnce(new Error("synthetic transport failure"));
    await expect(fetchQ1Downstream("synthetic-job-binding", "a".repeat(40), request)).rejects.toThrow();
    await expect(fetchQ1Downstream("synthetic-job-binding", "a".repeat(40), request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
