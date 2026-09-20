export type MediaScope = { liveId: string; vendorId?: string; direction: "publish" | "read" | "monitor" };
export type MediaConnection = { close(): void; connected: Promise<void> };
const headers = { "Content-Type": "application/json", "x-celebratedeal-client": "web" };

/** Native WHIP/WHEP negotiation with full ICE gathering; no provider credentials in the browser. */
export function connectLiveMedia(scope: MediaScope, options: { stream?: MediaStream; video?: HTMLVideoElement; onFailure: () => void }): MediaConnection {
  const peer = new RTCPeerConnection({ iceServers: [] });
  const lifetime = new AbortController();
  let closed = false;
  let sessionId: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatPending = false;
  const remote = new MediaStream();
  const request = async (action: string, extra = {}) => {
    const timeout = AbortSignal.timeout(action === "stop" ? 5_000 : 20_000);
    // Offer 必須讀完晚到的 session 才能補送 stop；只有心跳隨播放器關閉取消。
    const signal = action === "heartbeat" ? AbortSignal.any([timeout, lifetime.signal]) : timeout;
    const response = await fetch("/api/live-media", { method: "POST", headers, body: JSON.stringify({ ...scope, action, ...extra }), keepalive: action === "stop", signal });
    if (!response.ok) throw new Error("影音服務無法連線，請稍後重試。");
    return response.json() as Promise<{ answer?: string; sessionId?: string }>;
  };
  function stopRemote() { if (sessionId) { const id = sessionId; sessionId = undefined; void request("stop", { sessionId: id }).catch(() => undefined); } }
  function close() {
    if (closed) return;
    closed = true;
    lifetime.abort();
    clearInterval(heartbeat);
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    peer.close();
    remote.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.stop(); });
    if (options.video?.srcObject === remote) options.video.srcObject = null;
    stopRemote();
  }
  const fail = () => { if (!closed) { close(); options.onFailure(); } };
  peer.ontrack = event => {
    remote.addTrack(event.track);
    event.track.onended = fail;
    // A lost source must not remain as an apparently live frozen frame.
    event.track.onmute = () => { if (!closed && peer.connectionState !== "connected") fail(); };
    if (options.video) { options.video.srcObject = remote; void options.video.play().catch(() => undefined); }
  };
  if (options.stream) for (const track of options.stream.getTracks()) peer.addTransceiver(track, { direction: "sendonly", streams: [options.stream] });
  else { peer.addTransceiver("video", { direction: "recvonly" }); peer.addTransceiver("audio", { direction: "recvonly" }); }
  const connected = (async () => {
    try {
      await peer.setLocalDescription(await peer.createOffer());
      await waitFor(() => peer.iceGatheringState === "complete", () => closed, 10_000, lifetime.signal);
      if (closed) throw new Error("連線已停止。");
      const result = await request("offer", { sdp: peer.localDescription?.sdp });
      sessionId = result.sessionId;
      if (closed) { stopRemote(); throw new Error("連線已停止。"); }
      if (!sessionId || !result.answer) throw new Error("媒體回應不正確。");
      await peer.setRemoteDescription({ type: "answer", sdp: result.answer });
      await waitFor(() => peer.connectionState === "connected", () => closed || peer.connectionState === "failed", 15_000, lifetime.signal);
      if (closed) throw new Error("連線已停止。");
      await request("heartbeat", { sessionId });
      if (closed) throw new Error("連線已停止。");
      peer.onconnectionstatechange = () => { if (["failed", "disconnected", "closed"].includes(peer.connectionState)) fail(); };
      heartbeat = setInterval(() => {
        if (heartbeatPending || closed) return;
        heartbeatPending = true;
        void request("heartbeat", { sessionId }).catch(fail).finally(() => { heartbeatPending = false; });
      }, 20_000);
    } catch (error) { close(); throw error; }
  })();
  return { connected, close };
}

function waitFor(ready: () => boolean, stopped: () => boolean, timeout: number, signal: AbortSignal) {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error("連線已停止。"));
    const check = () => {
      if (signal.aborted || stopped()) return abort();
      if (ready()) return finish();
      if (Date.now() - start >= timeout) return finish(new Error("影音連線逾時。"));
      timer = setTimeout(check, 50);
    };
    signal.addEventListener("abort", abort, { once: true });
    check();
  });
}
