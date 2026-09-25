import { describe, expect, it, vi } from "vitest";
import { probeR2HeadBucket, probeStreamList } from "./provider-readonly-probe";

const accountId = "a".repeat(32);
const r2Env = {
  CLOUDFLARE_R2_ACCOUNT_ID: accountId,
  CLOUDFLARE_R2_ACCESS_KEY_ID: "synthetic-key-id",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "synthetic-key-secret",
  CLOUDFLARE_R2_BUCKET: "synthetic-bucket",
};
const streamEnv = {
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_STREAM_TOKEN: "synthetic-token",
};

describe("provider read-only probes", () => {
  it("does not request R2 when bindings are missing or malformed", async () => {
    const send = vi.fn();
    expect(await probeR2HeadBucket({}, send)).toBe("not_configured");
    expect(await probeR2HeadBucket({ ...r2Env, CLOUDFLARE_R2_ACCOUNT_ID: "bad/path" }, send))
      .toBe("invalid_configuration");
    expect(send).not.toHaveBeenCalled();
  });

  it("uses only HeadBucket inputs and reduces R2 errors to enums", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await probeR2HeadBucket(r2Env, send)).toBe("ok");
    expect(send).toHaveBeenCalledExactlyOnceWith(accountId, "synthetic-key-id", "synthetic-key-secret", "synthetic-bucket");
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 403 }, secret: "must-not-leak" });
    expect(await probeR2HeadBucket(r2Env, send)).toBe("forbidden");
  });

  it("does not request Stream without valid bindings", async () => {
    const fetchImpl = vi.fn();
    expect(await probeStreamList({}, fetchImpl)).toBe("not_configured");
    expect(await probeStreamList({ ...streamEnv, CLOUDFLARE_ACCOUNT_ID: "bad/path" }, fetchImpl))
      .toBe("invalid_configuration");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("issues one bounded Stream GET and discards resource contents", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ success: true, result: [{ uid: "private-video" }] }));
    expect(await probeStreamList(streamEnv, fetchImpl)).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?limit=1`);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reduces Stream failures and malformed responses to enums", async () => {
    const denied = vi.fn().mockResolvedValue(new Response("private-error", { status: 403 }));
    expect(await probeStreamList(streamEnv, denied)).toBe("forbidden");
    const bad = vi.fn().mockResolvedValue(Response.json({ success: false, result: [] }));
    expect(await probeStreamList(streamEnv, bad)).toBe("invalid_response");
    const rejected = vi.fn().mockRejectedValue(new Error("synthetic secret"));
    expect(await probeStreamList(streamEnv, rejected)).toBe("network_error");
  });
});
