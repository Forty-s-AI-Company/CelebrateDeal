"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import type { SalesWorkspaceQuestionnaire } from "@/lib/sales-workspace";

export type QuestionnaireAnswers = SalesWorkspaceQuestionnaire;

type Question = {
  key: keyof QuestionnaireAnswers;
  title: string;
  multiple?: boolean;
  options: Array<{ value: string; label: string; hint?: string }>;
};

const QUESTIONS: Question[] = [
  { key: "sellingApproach", title: "你主要想怎麼成交？", options: [
    { value: "live", label: "用直播或線上活動賣課", hint: "適合活動報名、直播銷講與限時成交" },
    { value: "consultation", label: "透過諮詢、預約成交", hint: "適合高客單服務與一對一跟進" },
    { value: "both", label: "兩種方式都需要", hint: "先選一條主流程，其他工具隨時可用" },
    { value: "unsure", label: "我還不確定", hint: "我們會依你的商品與進度提供建議" },
  ] },
  { key: "productType", title: "你主要銷售什麼？", options: [
    { value: "online_course", label: "線上課程" }, { value: "consulting_service", label: "顧問／教練服務" },
    { value: "in_person_event", label: "實體活動" }, { value: "membership", label: "會員訂閱" },
    { value: "digital_product", label: "其他數位商品" },
  ] },
  { key: "requiredFeatures", title: "你的成交流程需要哪些功能？", multiple: true, options: [
    { value: "funnel_page", label: "建立活動或漏斗頁" }, { value: "live_pitch", label: "直播銷講" },
    { value: "booking", label: "開放預約" }, { value: "online_payment", label: "線上收款" },
    { value: "conversion_tracking", label: "追蹤訪客與成交資料" }, { value: "customer_notification", label: "自動通知客戶" },
  ] },
  { key: "progressStage", title: "目前進度到哪裡？", options: [
    { value: "starting", label: "剛開始，什麼都還沒有" }, { value: "has_offer", label: "已經有商品或服務" },
    { value: "has_customers", label: "已經有客戶，想整理流程" }, { value: "migrating", label: "已在使用其他系統，準備搬過來" },
  ] },
];

export function PersonalizedOnboardingQuestionnaire({
  initialStep,
  initialAnswers,
  saveAnswer,
  complete,
}: {
  initialStep: number;
  initialAnswers: QuestionnaireAnswers;
  saveAnswer: (step: number, answers: QuestionnaireAnswers) => Promise<void>;
  complete: () => Promise<void>;
}) {
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), QUESTIONS.length - 1));
  const [answers, setAnswers] = useState(initialAnswers);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isPending, startTransition] = useTransition();
  const question = QUESTIONS[step]!;
  const selected = answers[question.key];
  const selectedValues: readonly string[] = Array.isArray(selected) ? selected : [];
  const canContinue = question.multiple ? Array.isArray(selected) && selected.length > 0 : typeof selected === "string";
  const progress = Math.round(((step + 1) / QUESTIONS.length) * 100);

  const liveMessage = useMemo(() => saveState === "saving" ? "正在儲存答案" : saveState === "saved" ? "答案已儲存" : saveState === "error" ? "答案尚未儲存，請重試" : "", [saveState]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = window.setTimeout(() => setSaveState("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  function choose(value: string) {
    const nextAnswers = question.multiple
      ? { ...answers, [question.key]: selectedValues.includes(value) ? selectedValues.filter((item) => item !== value) : [...selectedValues, value] }
      : { ...answers, [question.key]: value };
    setAnswers(nextAnswers);
    setSaveState("saving");
    startTransition(async () => {
      try {
        await saveAnswer(step, nextAnswers);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    });
  }

  function next() {
    if (!canContinue || isPending) return;
    if (step < QUESTIONS.length - 1) {
      setStep((value) => value + 1);
      return;
    }
    startTransition(complete);
  }

  return (
    <section className="mx-auto w-full max-w-4xl" aria-labelledby="question-title">
      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-4 text-sm font-semibold text-slate-600">
          <span>第 {step + 1} 題，共 {QUESTIONS.length} 題</span><span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="問卷進度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`第 ${step + 1} 題，共 ${QUESTIONS.length} 題`}>
          <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:p-8">
        <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-700"><Sparkles size={16} aria-hidden="true" />個人化工作空間</p>
        <h1 id="question-title" className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{question.title}</h1>
        {question.multiple ? <p className="mt-2 text-sm text-slate-500">可複選，選擇所有適用項目。</p> : null}
        <div className="mt-7 grid gap-3 sm:grid-cols-2" role={question.multiple ? "group" : "radiogroup"} aria-label={question.title}>
          {question.options.map((option) => {
            const active = Array.isArray(selected) ? selectedValues.includes(option.value) : selected === option.value;
            return <button key={option.value} type="button" role={question.multiple ? "checkbox" : "radio"} aria-checked={active} onClick={() => choose(option.value)} className={`flex min-h-24 items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 ${active ? "border-blue-600 bg-blue-50 text-blue-950 shadow-sm" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"}`}>
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>{active ? <Check size={15} aria-hidden="true" /> : null}</span>
              <span><span className="block font-semibold">{option.label}</span>{option.hint ? <span className="mt-1 block text-sm leading-5 text-slate-500">{option.hint}</span> : null}</span>
            </button>;
          })}
        </div>
        <p className="mt-4 min-h-5 text-sm text-slate-500" role={saveState === "error" ? "alert" : "status"} aria-live="polite">{liveMessage}</p>
        <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" disabled={step === 0 || isPending} onClick={() => setStep((value) => Math.max(0, value - 1))} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"><ArrowLeft size={17} aria-hidden="true" />上一題</button>
          <button type="button" disabled={!canContinue || isPending || saveState === "saving"} onClick={next} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{step === QUESTIONS.length - 1 ? "產生我的工作空間" : "下一題"}<ArrowRight size={17} aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  );
}
