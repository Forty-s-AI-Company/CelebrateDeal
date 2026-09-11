import { afterEach, describe, expect, it, vi } from "vitest";
import { connectLiveMedia } from "./live-media-client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(fetcher = vi.fn()) {
  const close = vi.fn();
  class Peer {
    iceGatheringState = "complete"; connectionState = "connected";
    localDescription = { sdp: "v=0\r\n" };
    addTransceiver() {} async createOffer() { return this.localDescription; }
    async setLocalDescription() {} async setRemoteDescription() {}
    close = close;
  }
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal("MediaStream", class { getTracks() { return []; } });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, close };
}
describe("media negotiation lifecycle", () => {
  it("does not install a timer after stopping during the first heartbeat", async () => {
    let resolveHeartbeat!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveHeartbeat = resolve; });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ answer: "v=0", sessionId: "session" }))).mockReturnValueOnce(pending).mockResolvedValue(new Response("{}"));
    setup(fetcher);
    const timer = vi.spyOn(globalThis, "setInterval");
    const connection = connectLiveMedia({ liveId: "a", direction: "monitor" }, { onFailure: vi.fn() });
    const outcome = connection.connected.catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    connection.close();
    resolveHeartbeat(new Response("{}"));
    await outcome;
    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
  });
  it("releases a session returned after the component closes while an offer is pending", async () => {
    let resolveOffer!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveOffer = resolve; });
    const { fetcher, close } = setup(vi.fn().mockReturnValueOnce(pending).mockResolvedValue(new Response("{}")));
    const connection = connectLiveMedia({ liveId: "a", direction: "monitor" }, { onFailure: vi.fn() });
    const result = connection.connected.catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    connection.close();
    resolveOffer(new Response(JSON.stringify({ answer: "v=0", sessionId: "late-session" })));
    await result;
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toMatchObject({ action: "stop", sessionId: "late-session" });
  });
  it("closes the peer on negotiation failure", async () => {
    const { close } = setup(vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    const connection = connectLiveMedia({ liveId: "a", direction: "monitor" }, { onFailure: vi.fn() });
    await expect(connection.connected).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });
  it("renews only after connection and closes on revoked admission", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ answer: "v=0", sessionId: "session" }))).mockResolvedValueOnce(new Response("{}")).mockResolvedValueOnce(new Response("{}", { status: 401 })).mockResolvedValue(new Response("{}"));
    const { close } = setup(fetcher); const failure = vi.fn();
    const connection = connectLiveMedia({ liveId: "a", vendorId: "tenant", direction: "read" }, { onFailure: failure });
    await connection.connected;
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body).action).toBe("heartbeat");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(failure).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
