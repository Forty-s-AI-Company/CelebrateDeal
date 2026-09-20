import { containPresenterRect, DEFAULT_PRESENTER_LAYOUT, PresenterLayoutSchema, presenterDimensions, presenterRegions, type PresenterLayout, type PresenterRect } from "./presenter-layout";
import { createPresenterBackground, type BackgroundState } from "./presenter-background";

type Source = { stream: MediaStream; video: HTMLVideoElement; cleanup: () => void };
export type PresenterMedia = {
  startCamera(): Promise<void>;
  startScreen(): Promise<void>;
  setLayout(layout: PresenterLayout): void;
  setBackgroundRemoval(enabled: boolean): void;
  output(): MediaStream;
  stop(): void;
};

/** 必須先啟動來源再取 output；取得的合成視訊軌不因版型切換而改變。 */
export function createPresenterMedia(canvas: HTMLCanvasElement, onStatus: (message: string) => void, onBackground: (state: BackgroundState) => void = () => {}) : PresenterMedia {
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器不支援畫面合成");
  let stopped = false;
  const background = createPresenterBackground(onBackground);
  let layout = DEFAULT_PRESENTER_LAYOUT;
  let composed: MediaStream | undefined;
  const sources: Partial<Record<"camera" | "screen", Source>> = {};
  const pending: Partial<Record<"camera" | "screen", Promise<void>>> = {};
  const release = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());
  const paintSource = (source: Source | undefined, box: PresenterRect, label: string) => {
    context.fillStyle = "#111827";
    context.fillRect(box.x, box.y, box.width, box.height);
    const track = source?.stream.getVideoTracks()[0];
    if (source && track?.readyState === "live" && !track.muted && track.enabled && source.video.readyState >= 2 && source.video.videoWidth > 0) {
      const rect = containPresenterRect(source.video.videoWidth, source.video.videoHeight, box);
      context.drawImage(source.video, rect.x, rect.y, rect.width, rect.height);
    } else {
      context.fillStyle = "#cbd5e1";
      context.font = "28px sans-serif";
      context.textAlign = "center";
      context.fillText(label, box.x + box.width / 2, box.y + box.height / 2);
    }
  };
  const draw = () => {
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const regions = presenterRegions(layout);
    paintSource(sources.screen, regions.screen, "尚未分享簡報");
    const camera = sources.camera;
    const track = camera?.stream.getVideoTracks()[0];
    const available = camera && track?.readyState === "live" && !track.muted && track.enabled && camera.video.readyState >= 2 && camera.video.videoWidth > 0;
    if (available) background.capture(camera.video);
    const cutout = available ? background.frame() : undefined;
    if (cutout) {
      // 直接合成在同一個送出 canvas，不依賴 WebRTC 傳輸 alpha。
      const rect = containPresenterRect(cutout.width, cutout.height, regions.camera);
      context.drawImage(cutout, rect.x, rect.y, rect.width, rect.height);
    } else paintSource(camera, regions.camera, "攝影機暫停");
  };
  draw();
  const timer = setInterval(draw, 1000 / 30);
  const disposeSource = (kind: "camera" | "screen") => {
    if (kind === "camera") background.stop();
    const source = sources[kind];
    if (!source) return;
    source.cleanup();
    source.video.pause();
    source.video.srcObject = null;
    for (const track of source.stream.getAudioTracks()) composed?.removeTrack(track);
    release(source.stream);
    delete sources[kind];
  };
  const start = (kind: "camera" | "screen"): Promise<void> => {
    if (stopped) return Promise.reject(new Error("導播已關閉"));
    if (pending[kind]) return pending[kind];
    const task = (async () => {
      let acquired: MediaStream | undefined;
      try {
        acquired = kind === "camera"
          ? await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        if (stopped) { release(acquired); return; }
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = acquired;
        // 播放 promise 可能延後；先登記來源，stop() 才能立即釋放裝置。
        disposeSource(kind);
        const stream = acquired;
        const listeners: Array<() => void> = [];
        sources[kind] = { stream, video, cleanup: () => listeners.forEach((remove) => remove()) };
        for (const track of stream.getTracks()) {
          for (const event of ["ended", "mute", "unmute"]) {
            const handler = () => {
              if (stopped) return;
              if (kind === "camera" && event === "mute" && track.kind === "video") background.stop();
              if (event === "ended" && track.kind === "video") disposeSource(kind);
              draw();
              onStatus(event === "unmute" ? "來源已恢復" : event === "ended" ? "來源已停止，請重新選擇" : "來源暫時中斷");
            };
            track.addEventListener(event, handler);
            listeners.push(() => track.removeEventListener(event, handler));
          }
        }
        for (const track of stream.getAudioTracks()) composed?.addTrack(track);
        await video.play();
        if (!stopped && sources[kind]?.stream === stream) { draw(); onStatus(kind === "camera" ? "攝影機與麥克風已開啟" : "簡報分享已開啟"); }
      } catch (error) {
        if (acquired && sources[kind]?.stream === acquired) disposeSource(kind);
        else if (acquired) release(acquired);
        if (!stopped) { onStatus(kind === "camera" ? "無法開啟攝影機或麥克風，請確認權限" : "尚未分享簡報，請重新選擇視窗"); throw error; }
      }
    })().finally(() => { delete pending[kind]; });
    pending[kind] = task;
    return task;
  };
  return {
    startCamera: () => start("camera"), startScreen: () => start("screen"),
    setBackgroundRemoval(enabled) {
      if (stopped) return;
      const track = sources.camera?.stream.getVideoTracks()[0];
      if (enabled && (!track || track.readyState !== "live" || track.muted || !track.enabled)) {
        background.stop(); onStatus("請先開啟可用的獨立攝影機來源。"); return;
      }
      background.setEnabled(enabled); draw();
    },
    setLayout(next) {
      const parsed = PresenterLayoutSchema.parse(next);
      const size = presenterDimensions(parsed);
      // 取得輸出後鎖定方向，避免中途變更 WebRTC 軌道解析度。
      if (composed && (canvas.width !== size.width || canvas.height !== size.height)) throw new Error("請停止傳送後再變更活動方向。");
      layout = parsed;
      if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; }
      if (!stopped) draw();
    },
    output() {
      if (stopped) throw new Error("導播已關閉");
      if (!composed) {
        composed = canvas.captureStream(30);
        // Favor slide detail over motion when WebRTC adapts to constrained bandwidth.
        for (const track of composed.getVideoTracks()) track.contentHint = "detail";
        for (const track of sources.camera?.stream.getAudioTracks() ?? []) composed.addTrack(track);
      }
      return composed;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      disposeSource("camera"); disposeSource("screen");
      if (composed) release(composed);
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
    },
  };
}
