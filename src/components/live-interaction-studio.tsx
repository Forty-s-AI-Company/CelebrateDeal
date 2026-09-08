"use client";

import { BarChart3, Flame, Gift, PartyPopper, Trophy } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  drawLiveInteractionWinnerAction,
  startLiveInteractionAction,
} from "@/app/actions";
import { endLiveInteractionAction, getLivePollStudioSnapshotAction, moderateLiveQuestionAction, verifyLuckyDrawWinnerClaimAction } from "@/app/actions/interaction-actions";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";

const initialState = { status: "idle" as const, message: "" };

export function LiveInteractionStudio({
  liveId,
  csrfToken,
  products,
  initialDrawRuns,
  initialPollRuns,
  initialClaimRuns,
  initialQuestions,
}: {
  liveId: string;
  csrfToken: string;
  products: Array<{ id: string; name: string; checkoutUrl?: string | null }>;
  initialDrawRuns: Array<{ id: string; title: string; responseCount: number }>;
  initialPollRuns: Array<{ id: string; title: string; responseCount: number; pollResults?: Array<{ id: string; label: string; votes: number; percentage: number }> }>;
  initialClaimRuns: Array<{ id: string; title: string }>;
  initialQuestions: Array<{ id: string; body: string; displayName: string | null; status: "pending" | "spotlight" | "answered" | "hidden"; createdAt: string }>;
}) {
  const [eventType, setEventType] = useState("lucky_draw");
  const [eligibility, setEligibility] = useState("slogan");
  const [startState, startAction, starting] = useActionState(startLiveInteractionAction, initialState);
  const [drawState, drawAction, drawing] = useActionState(drawLiveInteractionWinnerAction, initialState);
  const [endState, endAction, ending] = useActionState(endLiveInteractionAction, initialState);
  const [claimState, claimAction, claiming] = useActionState(verifyLuckyDrawWinnerClaimAction, initialState);
  const [questionState, questionAction, moderating] = useActionState(moderateLiveQuestionAction, initialState);
  const [pollRuns, setPollRuns] = useState(initialPollRuns);
  useEffect(() => {
    let active = true;
    const refreshPolls = async () => { const snapshot = await getLivePollStudioSnapshotAction(liveId); if (active) setPollRuns(snapshot); };
    void refreshPolls();
    const timer = window.setInterval(() => void refreshPolls(), 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [liveId]);
  const drawRunIds = [
    ...(eventType === "lucky_draw" && startState.status === "success" && startState.runId ? [{ id: startState.runId, title: "剛發起的抽獎", responseCount: 0 }] : []),
    ...initialDrawRuns,
  ].filter((run, index, runs) => runs.findIndex(({ id }) => id === run.id) === index);
  const claimRunIds = [
    ...(drawState.status === "success" && drawState.runId ? [{ id: drawState.runId, title: "剛完成的抽獎" }] : []),
    ...initialClaimRuns,
  ].filter((run, index, runs) => runs.findIndex(({ id }) => id === run.id) === index);

  return (
    <section className="mb-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-red-50 p-5 shadow-sm" aria-labelledby="live-interaction-studio-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">即時互動控制台</p>
          <h2 id="live-interaction-studio-title" className="mt-1 text-xl font-black text-slate-950">手動發起抽獎、投票、限時搶購或紅包</h2>
          <p className="mt-1 text-sm text-slate-600">只有直播狀態為「直播中」時才會送出；時間軸自動事件仍由互動腳本負責。</p>
        </div>
      </div>
      <form action={startAction} className="mt-4 grid gap-3">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <input type="hidden" name="liveId" value={liveId} />
        <div className="grid gap-3 md:grid-cols-[180px_1fr_140px]">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            互動類型
            <select name="eventType" value={eventType} onChange={(event) => setEventType(event.target.value)} className="h-11 rounded-xl border border-slate-300 bg-white px-3">
              <option value="lucky_draw">幸運大抽獎</option>
              <option value="poll">即時投票</option>
              <option value="flash_sale">限時快閃搶購</option>
              <option value="flash_voucher">空投限時紅包</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            標題
            <input name="title" required maxLength={160} defaultValue="直播限定互動" className="h-11 rounded-xl border border-slate-300 px-3" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            開放秒數
            <input name="durationSec" type="number" min={5} max={3600} defaultValue={eventType === "flash_sale" ? 300 : 60} required className="h-11 rounded-xl border border-slate-300 px-3" />
          </label>
        </div>

        {eventType === "lucky_draw" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              獎項名稱（選填）
              <input name="prizeName" maxLength={100} placeholder="例如：iPhone 16、簽名書、一對一諮詢" className="h-11 rounded-xl border border-slate-300 px-3" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              抽獎資格
              <select name="eligibility" value={eligibility} onChange={(e) => setEligibility(e.target.value)} className="h-11 rounded-xl border border-slate-300 bg-white px-3">
                <option value="slogan">全體留言口號參加</option>
                <option value="purchased">限定已購課學員專屬</option>
                <option value="all_viewers">在線觀眾全員一鍵登記</option>
              </select>
            </label>
            {eligibility === "slogan" ? (
              <label className="grid gap-1 text-sm font-semibold text-slate-700 md:col-span-2">
                抽獎留言口號
                <input name="slogan" required maxLength={80} defaultValue="週年快樂" className="h-11 rounded-xl border border-slate-300 px-3" />
              </label>
            ) : null}
            <div className="md:col-span-2 pt-1">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                <input type="checkbox" name="excludePreviousWinners" value="true" className="h-4 w-4 rounded text-violet-600 border-slate-300" />
                排除本場直播先前已中獎者（防作弊、維護公平性）
              </label>
            </div>
          </div>
        ) : null}

        {eventType === "poll" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              投票問題
              <input name="question" required maxLength={160} defaultValue="最喜歡哪一款？" className="h-11 rounded-xl border border-slate-300 px-3" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              作答方式
              <select name="selectionMode" className="h-11 rounded-xl border border-slate-300 bg-white px-3">
                <option value="single">單選</option>
                <option value="multiple">多選（最多 2 項）</option>
              </select>
              <input type="hidden" name="maxSelections" value="2" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              選項（每行一個）
              <textarea name="options" required defaultValue={"選項一\n選項二"} rows={2} className="rounded-xl border border-slate-300 px-3 py-2" />
            </label>
          </div>
        ) : null}

        {eventType === "flash_sale" ? (
          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              促銷商品
              <select name="productId" required className="h-11 rounded-xl border border-slate-300 bg-white px-3">
                <option value="">請選擇商品</option>
                {products.filter((product) => !product.checkoutUrl).map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              特惠促銷價（元）
              <input name="salePriceCents" type="number" min={1} placeholder="例如：990" className="h-11 rounded-xl border border-slate-300 px-3" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              原價參考（元）
              <input name="originalPriceCents" type="number" min={1} placeholder="例如：2980" className="h-11 rounded-xl border border-slate-300 px-3" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              限量席次
              <input name="stockLimit" type="number" min={1} max={100000} placeholder="例如：30" className="h-11 rounded-xl border border-slate-300 px-3" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700 md:col-span-4">
              快閃促銷標語
              <input name="announcementText" maxLength={200} placeholder="例如：直播限定特惠！前 30 名現折 2,000 元！" className="h-11 rounded-xl border border-slate-300 px-3" />
            </label>
          </div>
        ) : null}

        {eventType === "flash_voucher" ? (
          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              折扣類型
              <select name="discountType" defaultValue="percentage" className="h-11 rounded-xl border border-slate-300 bg-white px-3">
                <option value="percentage">百分比</option>
                <option value="fixed">固定金額</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              折扣值（固定金額請填元）
              <input name="discountValue" type="number" min={1} defaultValue={10} required className="h-11 rounded-xl border border-slate-300 px-3" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              份數
              <input name="maxClaims" type="number" min={1} max={100000} defaultValue={100} required className="h-11 rounded-xl border border-slate-300 px-3" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              適用商品
              <select name="productId" className="h-11 rounded-xl border border-slate-300 bg-white px-3">
                <option value="">全部站內結帳商品</option>
                {products.filter((product) => !product.checkoutUrl).map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={starting} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-700 px-5 font-bold text-white disabled:opacity-50">
            {eventType === "lucky_draw" ? <PartyPopper size={18} /> : eventType === "poll" ? <BarChart3 size={18} /> : eventType === "flash_sale" ? <Flame size={18} /> : <Gift size={18} />}
            {starting ? "發起中…" : "立即發起"}
          </button>
          {startState.message ? (
            <p role={startState.status === "error" ? "alert" : "status"} className={`text-sm font-semibold ${startState.status === "error" ? "text-red-700" : "text-emerald-700"}`}>
              {startState.message}
            </p>
          ) : null}
        </div>
      </form>

      {pollRuns.length > 0 ? (
        <form action={endAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-violet-100 pt-4">
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          <label className="grid min-w-64 gap-1 text-sm font-semibold text-slate-700">進行中的投票
            <select name="runId" className="h-11 rounded-xl border border-slate-300 bg-white px-3">
              {pollRuns.map((run) => <option key={run.id} value={run.id}>{run.title}（{run.responseCount} 人）</option>)}
            </select>
          </label>
          <button type="submit" disabled={ending} className="min-h-11 rounded-xl bg-slate-800 px-5 font-bold text-white disabled:opacity-50">{ending ? "結束中…" : "提前結束投票"}</button>
          {endState.message ? <p role={endState.status === "error" ? "alert" : "status"} className="text-sm font-semibold text-slate-700">{endState.message}</p> : null}
        </form>
      ) : null}
      {pollRuns.map((poll) => <div key={`${poll.id}-results`} className="mt-3 rounded-xl border border-violet-200 bg-white p-3"><p className="font-bold text-slate-900">{poll.title} · {poll.responseCount} 票</p><div className="mt-2 grid gap-2">{poll.pollResults?.map((option) => <div key={option.id}><div className="flex justify-between text-sm font-semibold"><span>{option.label}</span><span>{option.votes} 票／{option.percentage}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-violet-600 transition-[width] duration-500" style={{ width: `${option.percentage}%` }} /></div></div>)}</div></div>)}

      {drawRunIds.length > 0 || claimRunIds.length > 0 ? (
        <div className="mt-5 grid gap-3 border-t border-violet-100 pt-4">
          {drawRunIds.length > 0 ? <form action={drawAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
            <label className="grid min-w-64 gap-1 text-sm font-semibold text-slate-700">
              待開獎場次
              <select name="runId" className="h-11 rounded-xl border border-slate-300 bg-white px-3">
                {drawRunIds.map((run) => <option key={run.id} value={run.id}>{run.title}（{run.responseCount} 人）</option>)}
              </select>
            </label>
            <button type="submit" disabled={drawing} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-5 font-bold text-slate-950 disabled:opacity-50">
              <Trophy size={18} />{drawing ? "抽獎中…" : "隨機抽出得獎者"}
            </button>
            {drawState.message ? <p role={drawState.status === "error" ? "alert" : "status"} className="text-sm font-semibold text-slate-700">{drawState.message}</p> : null}
          </form> : null}
          {claimRunIds.length > 0 ? <form action={claimAction} className="flex flex-wrap items-end gap-3 border-t border-violet-100 pt-3">
            <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
            <label className="grid min-w-52 gap-1 text-sm font-semibold text-slate-700">得獎場次
              <select name="runId" className="h-11 rounded-xl border border-slate-300 bg-white px-3">
                {claimRunIds.map((run) => <option key={run.id} value={run.id}>{run.title}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">得獎核銷碼
              <input name="claimCode" required pattern="CD-WIN-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}" maxLength={16} placeholder="CD-WIN-1234-5678" className="h-11 rounded-xl border border-slate-300 px-3 font-mono" />
            </label>
            <button type="submit" disabled={claiming} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 font-bold text-white disabled:opacity-50">{claiming ? "核銷中…" : "驗證並核銷"}</button>
            {claimState.message ? <p role={claimState.status === "error" ? "alert" : "status"} className="text-sm font-semibold text-slate-700">{claimState.message}</p> : null}
          </form> : null}
        </div>
      ) : null}

      <section className="mt-6 border-t border-violet-100 pt-5" aria-labelledby="live-question-moderation-title">
        <h3 id="live-question-moderation-title" className="text-lg font-black text-slate-900">觀眾問答審核</h3>
        <p className="mt-1 text-sm text-slate-600">待審核、已置頂、已回答與隱藏問題都集中在這裡。</p>
        {questionState.message ? <p role={questionState.status === "error" ? "alert" : "status"} className="mt-2 text-sm font-semibold text-slate-700">{questionState.message}</p> : null}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {(["pending", "spotlight", "answered", "hidden"] as const).map((status) => (
            <div key={status} className="rounded-xl border border-slate-200 bg-white p-3">
              <h4 className="font-bold text-slate-800">{{ pending: "待審核", spotlight: "已置頂", answered: "已回答", hidden: "隱藏" }[status]}</h4>
              <div className="mt-2 grid gap-2">
                {initialQuestions.filter((question) => question.status === status).map((question) => (
                  <article key={question.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-900">{question.body}</p>
                    <p className="mt-1 text-xs text-slate-500">{question.displayName ?? "匿名觀眾"} · {new Date(question.createdAt).toLocaleString("zh-TW")}</p>
                    {status === "pending" || status === "spotlight" ? <form action={questionAction} className="mt-2 flex gap-2">
                      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} /><input type="hidden" name="questionId" value={question.id} />
                      {status === "pending" ? <button name="status" value="spotlight" disabled={moderating} className="rounded-lg bg-amber-500 px-3 py-2 font-bold text-slate-950 disabled:opacity-50">精選上牆</button> : <button name="status" value="answered" disabled={moderating} className="rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white disabled:opacity-50">標為已回答</button>}
                      <button name="status" value="hidden" disabled={moderating} className="rounded-lg bg-slate-700 px-3 py-2 font-bold text-white disabled:opacity-50">隱藏</button>
                    </form> : null}
                  </article>
                ))}
                {initialQuestions.every((question) => question.status !== status) ? <p className="text-sm text-slate-400">目前沒有項目</p> : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
