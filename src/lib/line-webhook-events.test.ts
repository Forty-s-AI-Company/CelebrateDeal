import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyVerifiedLineWebhookEvents } from "./line-webhook-events";
import { lineUserIdHash } from "./line-credentials";

const userId = `U${"a".repeat(32)}`;
const at = new Date("2026-10-16T01:00:00Z");
const event = (type = "unfollow", timestamp = at.getTime()) => ({ type, timestamp, source: { type: "user", userId } });

describe("verified LINE consent events", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "wp13-synthetic-test-only-key-at-least-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());
  it("rejects an unscoped event even when its caller claims signature verification",async()=>{
    const updateMany=vi.fn();expect(await applyVerifiedLineWebhookEvents({lineUserIdentity:{updateMany}} as never,"vendor-a",JSON.stringify({events:[event()]}),at)).toEqual({status:"invalid_payload"});expect(updateMany).not.toHaveBeenCalled();
  });

  it("revokes only the tenant/provider identity bound no later than the event", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await applyVerifiedLineWebhookEvents({ lineUserIdentity: { updateMany } } as never, "vendor-a", JSON.stringify({ events: [event()] }), at, "account-a");
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { vendorId: "vendor-a", lineOfficialAccountId: "account-a", lineUserIdHash: lineUserIdHash("vendor-a", userId), revokedAt: null, linkedAt: { lte: at } },
      data: { revokedAt: at },
    });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain(userId);
    expect(lineUserIdHash("vendor-a", userId)).not.toBe(lineUserIdHash("vendor-b", userId));
  });

  it("acknowledges follows without creating or restoring a revoked binding", async () => {
    const updateMany = vi.fn();
    expect(await applyVerifiedLineWebhookEvents({ lineUserIdentity: { updateMany } } as never, "vendor-a", JSON.stringify({ events: [event("follow")] }), at, "account-a")).toEqual({ status: "accepted" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(["{", "null", '{"events":{}}', JSON.stringify({ events: Array(1001).fill({}) })])("rejects malformed envelopes without writes", async raw => {
    const updateMany = vi.fn();
    expect(await applyVerifiedLineWebhookEvents({ lineUserIdentity: { updateMany } } as never, "vendor-a", raw, at, "account-a")).toEqual({ status: "invalid_payload" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("ignores unrelated, malformed and group events without writes", async () => {
    const updateMany = vi.fn();
    await applyVerifiedLineWebhookEvents({ lineUserIdentity: { updateMany } } as never, "vendor-a", JSON.stringify({ events: [event("message"), { ...event(), source: { type: "group", userId } }, { ...event(), timestamp: -1 }, { ...event(), source: { type: "user", userId: "other" } }] }), at, "account-a");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not acknowledge future unfollows or write a partial batch before their retry", async () => {
    const updateMany = vi.fn();
    expect(await applyVerifiedLineWebhookEvents({ lineUserIdentity: { updateMany } } as never, "vendor-a", JSON.stringify({ events: [event(), event("unfollow", at.getTime()+5000)] }), at, "account-a")).toEqual({ status: "retry_later" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("propagates persistence failure so the provider can retry", async () => {
    const updateMany = vi.fn().mockRejectedValue(new Error("synthetic-db-failure"));
    await expect(applyVerifiedLineWebhookEvents({ lineUserIdentity: { updateMany } } as never, "vendor-a", JSON.stringify({ events: [event()] }), at, "account-a")).rejects.toThrow("synthetic-db-failure");
  });
});
