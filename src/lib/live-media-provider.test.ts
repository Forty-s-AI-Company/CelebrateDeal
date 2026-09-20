import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaOrigin, mediaPath, mediaResourcePath, startMediaSession, stopMediaSession } from "./live-media-provider";

afterEach(() => vi.unstubAllGlobals());
describe("private media signaling", () => {
  it("only accepts a configured root origin and rejects credentials, paths and remote plaintext", () => {
    expect(mediaOrigin("")).toBeNull();
    expect(mediaOrigin("http://127.0.0.1:18889")).toBe("http://127.0.0.1:18889");
    expect(mediaOrigin("https://media.internal")).toBe("https://media.internal");
    for (const value of ["http://public.test", "https://user:pass@media.test", "https://media.test/api", "https://media.test/?x=1", "file:///tmp", "broken"]) expect(mediaOrigin(value)).toBeNull();
  });
  it("binds paths to both tenant and activity without ambiguous concatenation", () => {
    expect(mediaPath("a", "bc")).not.toBe(mediaPath("ab", "c"));
    expect(mediaPath("tenant-b", "same-live")).not.toBe(mediaPath("tenant-a", "same-live"));
    expect(mediaPath("a", "b")).toMatch(/^\/cd_[a-f0-9]{64}$/);
  });
  it("rejects provider location redirects, cross-stream and traversal resources", () => {
    const endpoint = `https://media.internal${mediaPath("a", "b")}/whip`;
    const suffix = "00000000-0000-0000-0000-000000000000";
    expect(mediaResourcePath(`${endpoint}/${suffix}`, endpoint)).toBe(new URL(endpoint).pathname + "/" + suffix);
    for (const value of [null, `https://attacker.test/${suffix}`, `../other/${suffix}`, `${endpoint}/${suffix}?secret=1`, `${endpoint}/../../../${suffix}`]) expect(() => mediaResourcePath(value, endpoint)).toThrow();
  });
  it("starts and deletes a real-shaped WHIP resource without forwarding redirects", async () => {
    const path = mediaPath("a", "b");
    const resource = `${path}/whip/00000000-0000-0000-0000-000000000000`;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("v=0\r\n", { status: 201, headers: { location: resource } })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await startMediaSession("http://127.0.0.1:18889", path, "publish", "v=0\r\n")).toEqual({ answer: "v=0\r\n", resourcePath: resource });
    await stopMediaSession("http://127.0.0.1:18889", resource);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", method: "POST" });
    await expect(stopMediaSession("http://127.0.0.1:18889", "//attacker.test/delete")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
