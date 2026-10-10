import { describe, expect, it, vi } from "vitest";
import { CALLBACK_EXECUTION_SOURCE, replayOriginalCallback } from "./q1-original-callback";

describe("one original callback replay transport", () => {
  it("uses the fixed original endpoint and execution source without caller IDs or a body", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" })));
    const result = await replayOriginalCallback("synthetic-job-secret", request);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("https://celebrate-deal-staging.carry-digital-nomad.in.net/api/admin/ops/payuni/q1-original-callback-retry",
      expect.objectContaining({ method: "POST", redirect: "error", headers: {
        authorization: "Bearer synthetic-job-secret", "x-celebratedeal-source-sha": CALLBACK_EXECUTION_SOURCE,
      } }));
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(result).toMatchObject({ status: "OBSERVED", callbackPosts: 1, possibleDatabaseWrites: true, retryAttempts: 1 });
  });
  it("rejects absent injection before any request", async () => {
    const request = vi.fn<typeof fetch>();
    expect(await replayOriginalCallback("", request)).toMatchObject({ callbackPosts: 0, possibleDatabaseWrites: false });
    expect(request).not.toHaveBeenCalled();
  });
  it("never repeats an unknown transport outcome", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("synthetic transport failure"));
    expect(await replayOriginalCallback("synthetic", request)).toMatchObject({ status: "BLOCKED", callbackPosts: 1, retryAttempts: 1 });
    expect(request).toHaveBeenCalledOnce();
  });
  it("persists the conservative reservation before transport and does not send if persistence fails", async () => {
    let persisted = false;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      expect(persisted).toBe(true);
      return new Response(JSON.stringify({ status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" }));
    });
    await replayOriginalCallback("synthetic", request, async () => { persisted = true; });
    expect(request).toHaveBeenCalledOnce();
    request.mockClear();
    expect(await replayOriginalCallback("synthetic", request, async () => { throw new Error("synthetic receipt write failure"); }))
      .toMatchObject({ status: "BLOCKED", possibleDatabaseWrites: true });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { status: "PROCESSED", retryAttempts: 0, failureCode: "NONE" },
    { status: "ALREADY_PROCESSED", retryAttempts: 1, failureCode: "NONE" },
    { status: "PROCESSED", retryAttempts: 1, failureCode: "NONE", secret: "not-output" },
    { status: "PROCESSED", retryAttempts: 2, failureCode: "NONE" },
  ])("fails closed on invalid response %#", async body => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
    expect(await replayOriginalCallback("synthetic", request)).toMatchObject({ status: "BLOCKED", callbackStatus: "TRANSPORT_OR_RESPONSE_UNVERIFIED" });
    expect(request).toHaveBeenCalledOnce();
  });
});
describe("original callback closed failure detail", () => {
  it.each(["scope_mismatch", "amount_mismatch", "processing_timeout", "inventory_conflict"])("keeps %s failed and never retries it", async failureCode => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "RETRY_FAILED", retryAttempts: 1, failureCode })));
    expect(await replayOriginalCallback("synthetic-job-binding", request)).toMatchObject({ status: "BLOCKED", callbackStatus: "RETRY_FAILED", failureCode });
    expect(request).toHaveBeenCalledOnce();
  });
});
