"use client";

import { BarChart3, Gift, PartyPopper, Trophy } from "lucide-react";
import { useActionState, useState } from "react";
import {
  drawLiveInteractionWinnerAction,
  startLiveInteractionAction,
} from "@/app/actions";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";

const initialState = { status: "idle" as const, message: "" };

export function LiveInteractionStudio({
  liveId,
  csrfToken,
  products,
  initialDrawRuns,
}: {
  liveId: string;
  csrfToken: string;
  products: Array<{ id: string; name: string; checkoutUrl?: string | null }>;
  initialDrawRuns: Array<{ id: string; title: string; responseCount: number }>;
}) {
  const [eventType, setEventType] = useState("lucky_draw");
  const [startState, startAction, starting] = useActionState(startLiveInteractionAction, initialState);
  const [drawState, drawAction, drawing] = useActionState(drawLiveInteractionWinnerAction, initialState);
  const drawRunIds = [
    ...(eventType === "lucky_draw" && startState.status === "success" && startState.runId ? [{ id: startState.runId, title: "剛發起的抽獎", responseCount: 0 }] : []),
    ...initialDrawRuns,
  ].filter((run, index, runs) => runs.findIndex(({ id }) => id === run.id) === index);

  return (
    <section className="mb-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-red-50 p-5 shadow-sm" aria-labelledby="live-interaction-studio-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">即時互動控制台</p><h2 id="live-interaction-studio-title" className="mt-1 text-xl font-black text-slate-950">手動發起抽獎、投票或限時紅包</h2><p className="mt-1 text-sm text-slate-600">只有直播狀態為「直播中」時才會送出；時間軸自動事件仍由互動腳本負責。</p></div>
      </div>
      <form action={startAction} className="mt-4 grid gap-3">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <input type="hidden" name="liveId" value={liveId} />
        <div className="grid gap-3 md:grid-cols-[180px_1fr_140px]">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">互動類型<select name="eventType" value={eventType} onChange={(event) => setEventType(event.target.value)} className="h-11 rounded-xl border border-slate-300 bg-white px-3"><option value="lucky_draw">幸運大抽獎</option><option value="poll">即時投票</option><option value="flash_voucher">空投限時紅包</option></select></label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">標題<input name="title" required maxLength={160} defaultValue="直播限定互動" className="h-11 rounded-xl border border-slate-300 px-3" /></label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">開放秒數<input name="durationSec" type="number" min={5} max={600} defaultValue={60} required className="h-11 rounded-xl border border-slate-300 px-3" /></label>
        </div>
        {eventType === "lucky_draw" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">抽獎留言口號<input name="slogan" required maxLength={80} defaultValue="週年快樂" className="h-11 rounded-xl border border-slate-300 px-3" /></label> : null}
        {eventType === "poll" ? <div className="grid gap-3 md:grid-cols-2"><label className="grid gap-1 text-sm font-semibold text-slate-700">投票問題<input name="question" required maxLength={160} defaultValue="最喜歡哪一款？" className="h-11 rounded-xl border border-slate-300 px-3" /></label><label className="grid gap-1 text-sm font-semibold text-slate-700">選項（每行一個）<textarea name="options" required defaultValue={"選項一\n選項二"} rows={2} className="rounded-xl border border-slate-300 px-3 py-2" /></label></div> : null}
        {eventType === "flash_voucher" ? <div className="grid gap-3 md:grid-cols-4"><label className="grid gap-1 text-sm font-semibold text-slate-700">折扣類型<select name="discountType" defaultValue="percentage" className="h-11 rounded-xl border border-slate-300 bg-white px-3"><option value="percentage">百分比</option><option value="fixed">固定金額</option></select></label><label className="grid gap-1 text-sm font-semibold text-slate-700">折扣值（固定金額請填元）<input name="discountValue" type="number" min={1} defaultValue={10} required className="h-11 rounded-xl border border-slate-300 px-3" /></label><label className="grid gap-1 text-sm font-semibold text-slate-700">份數<input name="maxClaims" type="number" min={1} max={100000} defaultValue={100} required className="h-11 rounded-xl border border-slate-300 px-3" /></label><label className="grid gap-1 text-sm font-semibold text-slate-700">適用商品<select name="productId" className="h-11 rounded-xl border border-slate-300 bg-white px-3"><option value="">全部站內結帳商品</option>{products.filter((product) => !product.checkoutUrl).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label></div> : null}
        <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={starting} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-700 px-5 font-bold text-white disabled:opacity-50">{eventType === "lucky_draw" ? <PartyPopper size={18} /> : eventType === "poll" ? <BarChart3 size={18} /> : <Gift size={18} />}{starting ? "發起中…" : "立即發起"}</button>{startState.message ? <p role={startState.status === "error" ? "alert" : "status"} className={`text-sm font-semibold ${startState.status === "error" ? "text-red-700" : "text-emerald-700"}`}>{startState.message}</p> : null}</div>
      </form>
      {drawRunIds.length > 0 ? <form action={drawAction} className="mt-5 flex flex-wrap items-end gap-3 border-t border-violet-100 pt-4"><input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} /><label className="grid min-w-64 gap-1 text-sm font-semibold text-slate-700">待開獎場次<select name="runId" className="h-11 rounded-xl border border-slate-300 bg-white px-3">{drawRunIds.map((run) => <option key={run.id} value={run.id}>{run.title}（{run.responseCount} 人）</option>)}</select></label><button type="submit" disabled={drawing} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-5 font-bold text-slate-950 disabled:opacity-50"><Trophy size={18} />{drawing ? "抽獎中…" : "隨機抽出得獎者"}</button>{drawState.message ? <p role={drawState.status === "error" ? "alert" : "status"} className="text-sm font-semibold text-slate-700">{drawState.message}</p> : null}</form> : null}
    </section>
  );
}
