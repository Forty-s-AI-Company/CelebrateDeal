"use client";

import { useEffect, useRef, useState } from "react";
import { InstructorDanmakuSwitch } from "@/components/live-danmaku";
import { DEFAULT_PRESENTER_LAYOUT, type PresenterLayout } from "@/lib/presenter-layout";
import { createPresenterMedia, type PresenterMedia } from "@/lib/presenter-media";
import { connectLiveMedia, type MediaConnection } from "@/lib/live-media-client";
import { BACKGROUND_LABELS, type BackgroundState } from "@/lib/presenter-background";

const headers = { "Content-Type": "application/json", "x-celebratedeal-client": "web" };
type Configuration = { layout: PresenterLayout; enabled: boolean; configured: boolean; liveStatus: string; streamMode: string; viewerUrl: string };
const buttonClass = "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-40";

export function PresenterStudio({ liveId }: { liveId: string }) {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [layout, setLayout] = useState(DEFAULT_PRESENTER_LAYOUT);
  const [message, setMessage] = useState("正在讀取排版設定…");
  const [busy, setBusy] = useState(false);
  const [broadcast, setBroadcast] = useState(false);
  const [camera, setCamera] = useState(false);
  const [screen, setScreen] = useState(false);
  const [background, setBackground] = useState<BackgroundState>("off");
  const [monitoring, setMonitoring] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const monitor = useRef<HTMLVideoElement>(null);
  const media = useRef<PresenterMedia | null>(null);
  const publisher = useRef<MediaConnection | null>(null);
  const reader = useRef<MediaConnection | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void fetch(`/api/live-presenter?liveId=${encodeURIComponent(liveId)}`, { headers, signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("無法讀取設定，請重新整理。");
      const value: Configuration = await response.json();
      if (active.current) { setConfig(value); setLayout(value.layout); setMessage("設定已載入。請先開啟攝影機與分享 PPT。"); }
    }).catch(error => { if (active.current) setMessage(error.message); });
    return () => { active.current = false; controller.abort(); publisher.current?.close(); reader.current?.close(); media.current?.stop(); media.current = null; };
  }, [liveId]);
  useEffect(() => { media.current?.setLayout(layout); }, [layout]);

  const getMedia = () => {
    if (!canvas.current) throw new Error("預覽尚未準備好。");
    if (!media.current) { media.current = createPresenterMedia(canvas.current, value => { if (active.current) setMessage(value); }, value => { if (active.current) setBackground(value); }); media.current.setLayout(layout); }
    return media.current;
  };
  async function task(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch (error) { if (active.current) setMessage(error instanceof Error ? error.message : "操作失敗，請重試。"); }
    finally { if (active.current) setBusy(false); }
  }
  async function save(enableBroadcast = false) {
    const response = await fetch("/api/live-presenter", { method: "POST", headers, body: JSON.stringify({ liveId, layout, ...(enableBroadcast ? { enableBroadcast } : {}) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "保存失敗。");
    if (active.current) { if (enableBroadcast) setConfig(value => value ? { ...value, enabled: true, streamMode: "live" } : value); setMessage("排版已保存，下次開啟會還原設定。"); }
  }
  function stop() {
    generation.current++;
    publisher.current?.close(); publisher.current = null;
    reader.current?.close(); reader.current = null;
    media.current?.stop(); media.current = null;
    setBroadcast(false); setMonitoring(false); setCamera(false); setScreen(false);
    setMessage("已停止傳送並釋放攝影機與分享來源。活動狀態請在活動管理中結束。");
  }
  async function start() {
    const attempt = generation.current;
    await save();
    if (!active.current || attempt !== generation.current) return;
    const connection = connectLiveMedia({ liveId, direction: "publish" }, { stream: getMedia().output(), onFailure: () => { if (active.current) { stop(); setMessage("直播連線中斷，已釋放來源，請重新開啟並重連。"); } } });
    publisher.current = connection;
    await connection.connected;
    if (active.current) { setBroadcast(true); setMessage("正在直播；排版調整會即時傳送給觀眾，按保存可保留到下次。"); }
  }
  async function startSource(kind: "camera" | "screen") {
    const attempt = generation.current;
    if (kind === "camera") await getMedia().startCamera();
    else await getMedia().startScreen();
    if (active.current && attempt === generation.current) {
      if (kind === "camera") setCamera(true); else setScreen(true);
    }
  }
  async function startMonitor() {
    if (!monitor.current) return;
    reader.current?.close();
    const connection = connectLiveMedia({ liveId, direction: "monitor" }, { video: monitor.current, onFailure: () => { if (active.current) { setMonitoring(false); setMessage("回傳監看中斷，可重新連線。"); } } });
    reader.current = connection;
    await connection.connected;
    if (active.current) setMonitoring(true);
  }

  return <div className="space-y-5" data-testid="presenter-studio">
    <InstructorDanmakuSwitch key={liveId} liveId={liveId} />
    <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-700">在瀏覽器開啟攝影機與麥克風，分享 PPT 視窗，再開始直播。子母畫面可將透明人像疊在 PPT 四角，請避免遮住文字。此版不錄影。</p>
    {config && !config.enabled && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
      <p>目前來源為既有影片／外部串流。已合成影片無法拆開重排；分離預錄素材的同步合成尚未支援。</p>
      <p className="mt-2">啟用瀏覽器直播會改用攝影機與分享畫面，關閉此活動的預錄與回放；原影片保留，可在活動編輯中重新選取。</p>
      <button className={`${buttonClass} mt-3`} disabled={busy || !config.configured || ["live", "ended"].includes(config.liveStatus)} onClick={() => void task(() => save(true))}>改用瀏覽器直播</button>
    </div>}
    {config && !config.configured && <p role="alert" className="text-sm text-amber-800">媒體伺服器尚未設定；可以調整排版，啟用推流需先完成 MediaMTX 連線。</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <h2 className="font-semibold">送出畫面預覽</h2>
        <canvas ref={canvas} style={{ aspectRatio: layout.orientation === "portrait" ? "9 / 16" : "16 / 9", maxHeight: "75dvh", width: "auto", maxWidth: "100%" }} className="mx-auto rounded-xl bg-slate-950" aria-label="講師與 PPT 合成預覽" />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={!config || busy || broadcast} onClick={() => void task(() => startSource("camera"))}>開啟攝影機與麥克風</button>
          <button className={buttonClass} disabled={!config || busy} onClick={() => void task(() => startSource("screen"))}>分享 PPT 視窗</button>
          <button className={buttonClass} disabled={busy || broadcast || !camera || !screen || !config?.enabled || !config.configured} onClick={() => void task(start)}>開始直播</button>
          <button className={buttonClass} onClick={stop}>停止傳送與釋放來源</button>
        </div>
        <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={background === "loading" || background === "active"} disabled={!camera} onChange={event => getMedia().setBackgroundRemoval(event.target.checked)} />講師透明人像去背</label>
          <p role="status" aria-live="polite">{BACKGROUND_LABELS[background]}</p>
          <p className="text-slate-600">僅處理獨立攝影機；模型在此裝置執行，不把攝影機影像送到新增第三方服務。首次開啟會下載模型與執行檔。來源切換後需重新開啟；不支援拆解已合成預錄影片。</p>
        </div>
      </div>
      <fieldset disabled={!config || busy} className="space-y-4 rounded-xl border border-slate-200 p-4">
        <legend className="px-2 font-semibold">講師排版</legend>
        <p className="text-sm">{layout.orientation === "portrait" ? "直式 9:16：完整簡報在上、人像在下；兩區各自保留素材比例。" : "橫式 16:9"} 方向請於活動編輯中、開播前設定。</p>
        <label className="block text-sm">版型<select aria-label="版型" disabled={layout.orientation === "portrait"} className="mt-1 w-full rounded border p-2" value={layout.mode} onChange={e => setLayout({ ...layout, mode: e.target.value as PresenterLayout["mode"] })}><option value="side-by-side">{layout.orientation === "portrait" ? "PPT 上、講師下" : "PPT 左、講師右"}</option><option value="picture-in-picture">{layout.orientation === "portrait" ? "直式使用 PPT 上、講師下" : "子母畫面"}</option></select></label>
        <label className="block text-sm">子母畫面位置<select aria-label="子母畫面位置" className="mt-1 w-full rounded border p-2" disabled={layout.orientation === "portrait" || layout.mode !== "picture-in-picture"} value={layout.corner} onChange={e => setLayout({ ...layout, corner: e.target.value as PresenterLayout["corner"] })}>{[["top-left", "左上"], ["bottom-left", "左下"], ["top-right", "右上"], ["bottom-right", "右下"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-sm">講師寬度：{layout.cameraPercent}%<input aria-label="講師畫面大小" disabled={layout.orientation === "portrait"} className="mt-2 w-full" type="range" min="15" max="35" step="1" value={layout.cameraPercent} onChange={e => setLayout({ ...layout, cameraPercent: Number(e.target.value) })} /></label>
        <button className={buttonClass} onClick={() => void task(() => save())}>保存設定</button>
      </fieldset>
    </div>
    <p role="status" aria-live="polite" className="text-sm text-slate-700">{message}</p>
    <section className="space-y-3 rounded-xl border border-slate-200 p-4">
      <h2 className="font-semibold">觀眾實際影音監看</h2>
      <p className="text-sm text-slate-600">接收媒體伺服器回傳的同一路畫面，可能有延遲。監看預設靜音，避免回音；互動卡片與主要操作位於影片外。</p>
      <video ref={monitor} muted controls playsInline style={{ aspectRatio: layout.orientation === "portrait" ? "9 / 16" : "16 / 9", maxHeight: "75dvh" }} className="w-full max-w-3xl rounded-lg bg-black object-contain" aria-label="觀眾影音回傳" />
      <button className={buttonClass} disabled={busy || !config?.enabled || monitoring} onClick={() => void task(startMonitor)}>連線觀眾畫面</button>
      {config && <a className="ml-4 text-sm underline" href={config.viewerUrl} target="_blank" rel="noreferrer">開啟完整觀眾頁面</a>}
    </section>
  </div>;
}
