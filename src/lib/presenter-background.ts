export type BackgroundState = "off" | "loading" | "active" | "failed" | "unsupported" | "slow";
export const BACKGROUND_LABELS: Record<BackgroundState, string> = {
  off: "去背已關閉", loading: "正在載入本機去背模型，暫用一般攝影機…",
  active: "本機去背中；送出畫面已套用", failed: "去背失敗，已回到一般攝影機，可重試",
  unsupported: "此瀏覽器不支援本機去背，使用一般攝影機", slow: "處理效能不足，已回到一般攝影機",
};

/** 專用 worker 一次只接收一張縮小影格；不傳送任何影像至網路。 */
export function createPresenterBackground(onState: (state: BackgroundState) => void) {
  let worker: Worker | undefined;
  let frame: ImageBitmap | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let ready = false;
  let busy = false;
  let lastCapture = -Infinity;
  let slowFrames = 0;
  const clear = () => {
    generation++;
    clearTimeout(watchdog);
    worker?.terminate(); worker = undefined;
    frame?.close(); frame = undefined;
    ready = false; busy = false; slowFrames = 0; lastCapture = -Infinity;
  };
  const fail = (state: BackgroundState) => { clear(); onState(state); };
  return {
    setEnabled(enabled: boolean) {
      clear();
      if (!enabled) { onState("off"); return; }
      if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
        onState("unsupported"); return;
      }
      onState("loading");
      const attempt = generation;
      try {
        const current = new Worker("/presenter-segmentation/worker.js");
        worker = current;
        watchdog = setTimeout(() => fail("failed"), 20000);
        current.onerror = () => { if (attempt === generation) fail("failed"); };
        current.onmessageerror = () => { if (attempt === generation) fail("failed"); };
        current.onmessage = (event: MessageEvent<{ type: string; bitmap?: ImageBitmap; durationMs?: number }>) => {
          const data = event.data;
          if (attempt !== generation) { data.bitmap?.close(); return; }
          clearTimeout(watchdog);
          if (data.type === "ready") { ready = true; return; }
          if (data.type !== "frame" || !data.bitmap) { fail("failed"); return; }
          busy = false;
          slowFrames = (data.durationMs ?? Infinity) > 150 ? slowFrames + 1 : 0;
          if (slowFrames >= 10) { data.bitmap.close(); fail("slow"); return; }
          frame?.close(); frame = data.bitmap;
          onState("active");
        };
        current.postMessage({ type: "init" });
      } catch { fail("failed"); }
    },
    capture(video: HTMLVideoElement) {
      const now = performance.now();
      if (!ready || busy || now - lastCapture < 1000 / 15) return;
      busy = true; lastCapture = now;
      const attempt = generation;
      // 保留來源比例，限制最多 640×480，避免主執行緒與 worker 排隊。
      const scale = Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight);
      watchdog = setTimeout(() => fail("slow"), 2000);
      void createImageBitmap(video, { resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)), resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)) }).then(bitmap => {
        if (attempt !== generation || !worker) { bitmap.close(); return; }
        try { worker.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]); }
        catch { bitmap.close(); fail("failed"); }
      }).catch(() => { if (attempt === generation) fail("failed"); });
    },
    frame: () => frame,
    stop() { clear(); onState("off"); },
  };
}
