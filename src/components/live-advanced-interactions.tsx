"use client";

import { BarChart3, Flame, Gift, MessageCircleQuestion, PartyPopper, Sparkles, Trophy, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdvancedInteractionMetadata } from "@/lib/interaction-event";

type AdvancedEvent = {
  id: string;
  eventType: string;
  triggerSec: number;
  title: string;
  metadata?: unknown;
};

type PublicRun = {
  id: string;
  eventType: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  metadata: AdvancedInteractionMetadata;
  responseCount: number;
  responded: boolean;
  ownValue: string | null;
  pollResults: Array<{ id: string; label: string; votes: number; percentage: number }> | null;
  winner: string | null;
  winnerIsViewer: boolean;
  winnerClaimCode?: string | null;
  winnerRevealedAt?: string | null;
  prizeName?: string | null;
};
type PublicSpotlight = { id: string; body: string; displayName: string | null; spotlightedAt: string | null };

function metadata(value: unknown): AdvancedInteractionMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("kind" in value)) return null;
  return value as AdvancedInteractionMetadata;
}

async function interactionRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/live-interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-celebratedeal-client": "web" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status === 409 ? "這個互動已結束，或你已經參加過了。" : "互動連線暫時忙碌，請再試一次。");
  return await response.json() as { run?: PublicRun | null };
}

function WinnerReveal({ run }: { run: PublicRun }) {
  const isWinner = run.winnerIsViewer;
  const [isSpinning, setIsSpinning] = useState(() => Boolean(run.winner) && (!run.winnerRevealedAt || Date.now() - Date.parse(run.winnerRevealedAt) < 5_000));
  const [candidateName, setCandidateName] = useState("抽獎進行中…");
  useEffect(() => {
    if (!isSpinning || !run.winner) return;
    const candidates = ["幸運觀眾", "VIP 學員", "直播鐵粉", "台北 陳**", "高雄 林**", "台中 黃**", run.winner];
    let step = 0;
    const timer = window.setInterval(() => {
      step++;
      setCandidateName(candidates[step % candidates.length]!);
      if (step > 12) setIsSpinning(false);
    }, 150);
    return () => window.clearInterval(timer);
  }, [isSpinning, run.winner]);
    return (<>
{isSpinning ? (
        <div className="mt-4 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 text-center">
          <Sparkles className="mx-auto animate-spin text-amber-600" size={24} />
          <p className="mt-2 text-xs font-bold uppercase tracking-widest text-amber-800">緊張開獎中…</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{candidateName}</p>
        </div>
      ) : run.winner ? (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-gradient-to-b from-amber-100 to-yellow-50 p-4 text-center shadow-inner">
          <Trophy className="mx-auto h-8 w-8 text-amber-700" />
          <p className="mt-1 text-xs font-bold text-amber-800">
            {run.prizeName ? `得獎獎項：${run.prizeName}` : "幸運大抽獎"}
          </p>
          <p className="mt-2 text-xl font-black text-slate-900">恭喜得獎者：{run.winner}！</p>
          {isWinner ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white/90 p-3 shadow-sm">
              <div aria-label="得獎彩帶" className="text-2xl">🎉 🎊 ✨ 🎊 🎉</div>
              <p className="mt-1 text-sm font-black text-emerald-700">你是中獎幸運兒！</p>
              {run.winnerClaimCode ? (
                <>
                  <p className="mt-1 inline-block rounded bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-600">領獎核銷碼：{run.winnerClaimCode}</p>
                  <p className="mt-1 text-xs text-slate-500">請截圖此畫面或向小幫手出示核銷碼領獎。</p>
                </>
              ) : <p className="mt-1 text-xs text-slate-500">核銷碼暫時無法顯示，請聯絡主辦方協助。</p>}
            </div>
          ) : null}
        </div>
      ) : null}
    </>);
  }

export function LiveAdvancedInteractions({
  vendorId,
  liveId,
  currentSeconds,
  events,
  enabled,
}: {
  vendorId: string;
  liveId: string;
  currentSeconds: number;
  events: AdvancedEvent[];
  enabled: boolean;
}) {
  const [run, setRun] = useState<PublicRun | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPollOptions, setSelectedPollOptions] = useState<string[]>([]);
  const [spotlight, setSpotlight] = useState<PublicSpotlight | null>(null);
  const [questionBody, setQuestionBody] = useState("");
  const [questionName, setQuestionName] = useState("");
  const [questionMessage, setQuestionMessage] = useState("");
  const [showQuestions, setShowQuestions] = useState(false);

  const scriptedEvent = useMemo(() => [...events].reverse().find((event) => {
    const config = metadata(event.metadata);
    return config && event.triggerSec <= currentSeconds && currentSeconds < event.triggerSec + config.durationSec;
  }), [currentSeconds, events]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      if (scriptedEvent) {
        const payload = await interactionRequest({ action: "open", vendorId, liveId, eventId: scriptedEvent.id });
        if (payload.run) setRun(payload.run);
      }
      const response = await fetch(`/api/live-interactions?vendorId=${encodeURIComponent(vendorId)}&liveId=${encodeURIComponent(liveId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { runs?: PublicRun[]; spotlight?: PublicSpotlight | null };
      if (!scriptedEvent) setRun(payload.runs?.[0] ?? null);
      setSpotlight(payload.spotlight ?? null);
    } catch {
      // Polling is best effort; the next interval can recover without hiding playback.
    }
  }, [enabled, liveId, scriptedEvent, vendorId]);

  useEffect(() => {
    if (!enabled) return;
    const immediate = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(timer);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!run) return;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((Date.parse(run.endsAt) - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [run]);

  // Reset run-specific input before rendering a different poll.
  const [selectionRunId, setSelectionRunId] = useState(run?.id);
  if (selectionRunId !== run?.id) {
    setSelectionRunId(run?.id);
    setSelectedPollOptions([]);
  }

  async function respond(value: string | string[]) {
    if (!run || isSubmitting) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      const payload = await interactionRequest({ action: "respond", vendorId, liveId, runId: run.id, value, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) });
      if (payload.run) setRun(payload.run);
      setMessage(
        run.eventType === "flash_voucher"
          ? "紅包已放進你的結帳，購買時會自動折抵。"
          : run.eventType === "flash_sale"
            ? "已收到搶購意願，立即點擊結帳！"
            : "已收到，結果會即時更新。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "互動失敗，請再試一次。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function askQuestion() {
    if (isSubmitting || !questionBody.trim()) return;
    setIsSubmitting(true);
    setQuestionMessage("");
    try {
      const response = await fetch("/api/live-interactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-celebratedeal-client": "web" },
        body: JSON.stringify({ action: "ask_question", vendorId, liveId, body: questionBody.trim(), ...(questionName.trim() ? { displayName: questionName.trim() } : {}) }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? "提問有點太快了，請稍後再送。" : "問題暫時送不出去，請再試一次。");
      setQuestionBody("");
      setQuestionMessage("問題已送出，等待助教審核。");
    } catch (error) {
      setQuestionMessage(error instanceof Error ? error.message : "問題暫時送不出去。");
    } finally { setIsSubmitting(false); }
  }

  const closed = !run || remainingSeconds <= 0 || run.status !== "active";

  function renderOffer() {
    if (!run) return null;
    return (<>
{run.metadata.kind === "flash_voucher" ? <div className="mt-4 grid gap-3 text-center"><p className="text-3xl font-black text-red-700">{run.metadata.discountType === "percentage" ? `${run.metadata.discountValue}% OFF` : `折抵 NT$${run.metadata.discountValue / 100}`}</p><p className="text-sm text-slate-600">限量 {run.metadata.maxClaims} 份，目前已有 {run.responseCount} 人領取。</p><button type="button" disabled={run.responded || closed || isSubmitting} onClick={() => void respond("claim")} className="min-h-12 rounded-2xl bg-red-600 px-5 text-lg font-black text-white shadow-lg shadow-red-200 disabled:opacity-50">{run.responded ? "紅包已領取" : "一鍵領取折扣"}</button></div> : null}

      {run.metadata.kind === "flash_sale" ? (
        <div className="mt-4 grid gap-3 text-center">
          <div className="rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 p-4 text-white shadow-lg shadow-red-200">
            <div className="flex items-center justify-center gap-1 text-xs font-black uppercase tracking-widest text-amber-200">
              <Zap size={15} /> 限時下殺搶購
            </div>
            {run.metadata.announcementText ? (
              <p className="mt-1 text-sm font-semibold text-white/90">{run.metadata.announcementText}</p>
            ) : null}
            <div className="mt-2 flex items-baseline justify-center gap-2">
              {run.metadata.salePriceCents !== undefined ? (
                <span className="text-3xl font-black text-white">NT${run.metadata.salePriceCents / 100}</span>
              ) : null}
              {run.metadata.originalPriceCents !== undefined ? (
                <span className="text-sm line-through text-white/70">NT${run.metadata.originalPriceCents / 100}</span>
              ) : null}
            </div>
            {run.metadata.stockLimit ? (
              <p className="mt-1 text-xs font-bold text-amber-100">限量 {run.metadata.stockLimit} 席 · 搶完即止</p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={closed || isSubmitting}
            onClick={() => void respond("view_deal")}
            className="min-h-12 rounded-2xl bg-red-600 px-5 text-lg font-black text-white shadow-lg shadow-red-200 disabled:opacity-50 hover:bg-red-700 transition"
          >
            立即搶購特惠方案
          </button>
        </div>
      ) : null}
    </>);
  }

  function renderDraw() {
    if (!run) return null;
    return (<>
{run.metadata.kind === "lucky_draw" && !run.winner ? (
        <div className="mt-4 grid gap-3">
          {run.metadata.prizeName ? (
            <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-center">
              <span className="text-xs font-black uppercase tracking-wider text-fuchsia-700">本輪獎項</span>
              <p className="text-base font-black text-fuchsia-950">{run.metadata.prizeName}</p>
            </div>
          ) : null}
          <p className="text-sm text-slate-600">
            {run.metadata.eligibility === "purchased"
              ? "限定本場已完成購課且已驗證報名身分的學員參加。"
              : run.metadata.eligibility === "all_viewers"
                ? "在線觀眾全員皆可參加！輸入名稱登記抽獎。"
                : `在留言框輸入口號「${run.metadata.slogan}」，倒數結束後隨機抽出得獎者。`}
          </p>
          {run.metadata.eligibility !== "purchased" ? (
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              disabled={run.responded || closed}
              className="h-11 rounded-xl border border-slate-300 px-3"
              placeholder="你的顯示名稱"
            />
          ) : null}
          <button
            type="button"
            disabled={run.responded || closed || isSubmitting || (run.metadata.eligibility !== "purchased" && !displayName.trim())}
            onClick={() => void respond(run.metadata.kind === "lucky_draw" ? (run.metadata.eligibility === "slogan" || !run.metadata.eligibility ? run.metadata.slogan : "entry") : "")}
            className="min-h-11 rounded-xl bg-fuchsia-600 px-4 font-bold text-white disabled:opacity-50"
          >
            {run.responded ? "已取得抽獎資格" : run.metadata.eligibility === "slogan" || !run.metadata.eligibility ? `留言「${run.metadata.slogan}」參加` : "一鍵登記抽獎"}
          </button>
        </div>
      ) : null}
    </>);
  }

  function renderPoll() {
    if (!run) return null;
    return (<>
{run.metadata.kind === "poll" ? (
        <div className="mt-4 grid gap-2">
          <p className="mb-1 font-bold">{run.metadata.question}</p>
          {run.metadata.selectionMode === "multiple" && !run.responded ? <p className="text-xs text-slate-500">可選最多 {run.metadata.maxSelections ?? run.metadata.options.length} 項</p> : null}
          {(run.pollResults ?? []).map((option) => {
            const selected = selectedPollOptions.includes(option.id);
            return <button key={option.id} type="button" aria-pressed={selected} disabled={run.responded || closed || isSubmitting} onClick={() => {
              if (run.metadata.kind !== "poll") return;
              if (run.metadata.selectionMode !== "multiple") return void respond(option.id);
              const max = run.metadata.maxSelections ?? run.metadata.options.length;
              setSelectedPollOptions((current) => current.includes(option.id) ? current.filter((id) => id !== option.id) : current.length < max ? [...current, option.id] : current);
            }} className={`relative min-h-12 overflow-hidden rounded-xl border bg-white text-left disabled:opacity-90 ${selected ? "border-violet-600 ring-2 ring-violet-200" : "border-violet-200"}`}>
              <span className="absolute inset-y-0 left-0 bg-violet-100 transition-[width] duration-500" style={{ width: `${option.percentage}%` }} />
              <span className="relative flex justify-between gap-3 px-4 py-3 font-semibold"><span>{option.label}</span><span>{option.percentage}%</span></span>
            </button>;
          })}
          {run.metadata.selectionMode === "multiple" && !run.responded ? <button type="button" disabled={closed || isSubmitting || selectedPollOptions.length === 0} onClick={() => void respond(selectedPollOptions)} className="min-h-11 rounded-xl bg-violet-700 px-4 font-bold text-white disabled:opacity-50">送出 {selectedPollOptions.length} 個選項</button> : null}
        </div>
      ) : null}
    </>);
  }

  return (
    <>
      {spotlight ? <aside className="fixed inset-x-4 top-20 z-[75] mx-auto max-w-2xl rounded-2xl border border-amber-300 bg-slate-950/95 p-4 text-white shadow-2xl" aria-live="polite" data-testid="live-question-spotlight"><p className="text-xs font-black uppercase tracking-widest text-amber-300">現場精選問答</p><blockquote className="mt-2 text-lg font-bold">「{spotlight.body}」</blockquote><p className="mt-2 text-sm text-slate-300">— {spotlight.displayName ?? "匿名觀眾"}</p></aside> : null}
      <button type="button" onClick={() => setShowQuestions((value) => !value)} aria-expanded={showQuestions} className="fixed bottom-5 right-5 z-[76] inline-flex min-h-12 items-center gap-2 rounded-full bg-cyan-700 px-4 font-bold text-white shadow-xl"><MessageCircleQuestion size={19} />提問</button>
      {showQuestions ? <aside className="fixed bottom-20 right-4 z-[76] grid w-[min(24rem,calc(100vw-2rem))] gap-3 rounded-2xl border border-cyan-200 bg-white p-4 text-slate-900 shadow-2xl" aria-label="直播提問專區"><h2 className="font-black">想問講師什麼？</h2><input value={questionName} onChange={(event) => setQuestionName(event.target.value)} maxLength={80} placeholder="暱稱（留空即匿名）" className="h-10 rounded-lg border border-slate-300 px-3" /><textarea value={questionBody} onChange={(event) => setQuestionBody(event.target.value)} maxLength={500} rows={4} placeholder="輸入問題，最多 500 字" className="rounded-lg border border-slate-300 px-3 py-2" /><button type="button" disabled={isSubmitting || !questionBody.trim()} onClick={() => void askQuestion()} className="min-h-11 rounded-lg bg-cyan-700 px-4 font-bold text-white disabled:opacity-50">送出問題</button>{questionMessage ? <p role="status" className="text-sm font-semibold">{questionMessage}</p> : null}</aside> : null}
      {run && dismissedRunId !== run.id ? <section className={`fixed inset-x-3 bottom-24 z-[70] mx-auto max-w-md overflow-hidden rounded-3xl border p-5 text-slate-950 shadow-2xl ${run.eventType === "flash_voucher" || run.eventType === "flash_sale" ? "border-red-200 bg-gradient-to-br from-red-50 via-white to-amber-50" : "border-white/50 bg-white/95 backdrop-blur-xl"}`} aria-live="polite" data-testid="live-advanced-interaction">
      <button type="button" onClick={() => setDismissedRunId(run.id)} aria-label="關閉互動視窗" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><X size={17} /></button>
      <div className="flex items-center gap-3 pr-10">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white ${run.eventType === "lucky_draw" ? "bg-fuchsia-600" : run.eventType === "poll" ? "bg-violet-600" : run.eventType === "flash_sale" ? "bg-orange-600" : "bg-red-600"}`}>
          {run.eventType === "lucky_draw" ? <PartyPopper /> : run.eventType === "poll" ? <BarChart3 /> : run.eventType === "flash_sale" ? <Flame /> : <Gift />}
        </span>
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">剩餘 {remainingSeconds} 秒 · {run.responseCount} 人參加</p><h2 className="text-xl font-black">{run.title}</h2></div>
      </div>

      {<WinnerReveal key={`${run.id}:${run.winner}:${run.winnerRevealedAt}`} run={run} />}

      {renderDraw()}

      {renderPoll()}

      {renderOffer()}

      {message ? <p role="status" className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold">{message}</p> : null}
    </section> : null}
    </>
  );
}
