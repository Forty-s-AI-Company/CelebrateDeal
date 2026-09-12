"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Clock3, MoreHorizontal, Rocket } from "lucide-react";
import { controlOnboardingGuideAction } from "@/app/actions/sales-workspace-actions";

export type SidebarOnboardingTask = { key: string; title: string; href: string; status: string; estimateMinutes: number; impact?: string | null };

export function OnboardingTaskPanel({ title, tasks, initiallyCollapsed, persistCollapsed }: { title: string; tasks: SidebarOnboardingTask[]; initiallyCollapsed: boolean; persistCollapsed: (collapsed: boolean) => Promise<void> }) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const terminalCount = tasks.filter((task) => ["completed", "skipped", "archived"].includes(task.status)).length;
  const allComplete = tasks.length > 0 && terminalCount === tasks.length;
  const [collapsed, setCollapsed] = useState(initiallyCollapsed || allComplete);
  const effectiveCollapsed = collapsed || allComplete;
  const [, startTransition] = useTransition();
  const [controlPending, startControlTransition] = useTransition();
  const router = useRouter();
  const next = tasks.find((task) => !["completed", "skipped", "archived"].includes(task.status));
  const percentage = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);

  function toggle() {
    const value = !effectiveCollapsed;
    setCollapsed(value);
    startTransition(() => persistCollapsed(value));
  }

  function controlGuide(control: "hide" | "remind" | "stop") {
    startControlTransition(async () => {
      await controlOnboardingGuideAction(control);
      router.refresh();
    });
  }

  if (tasks.length === 0) return null;
  return <section className="mb-3 overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50" aria-labelledby="onboarding-task-title">
    <button type="button" onClick={toggle} aria-expanded={!effectiveCollapsed} aria-controls="onboarding-task-content" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 focus-visible:ring-4 focus-visible:ring-blue-200">
      <Rocket size={16} className="text-blue-600" aria-hidden="true" /><span id="onboarding-task-title" className="min-w-0 flex-1 truncate">🚀 {title} {completed}/{tasks.length}</span><ChevronDown size={16} className={`transition ${effectiveCollapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
    </button>
    {!effectiveCollapsed ? <div id="onboarding-task-content" className="border-t border-blue-100 px-3 pb-3 pt-3">
      <div className="h-2 overflow-hidden rounded-full bg-white" role="progressbar" aria-label={`${title}完成進度`} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${completed}/${tasks.length} 已完成`}><div className="h-full rounded-full bg-blue-600 transition-[width] motion-reduce:transition-none" style={{ width: `${percentage}%` }} /></div>
      {allComplete ? <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={17} aria-hidden="true" />所有任務已完成</p> : next ? <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">下一個最重要的任務</p><p className="mt-1 text-sm font-semibold text-slate-900">{next.title}</p>{next.impact ? <p className="mt-1 text-xs leading-5 text-amber-700">{next.impact}</p> : null}<p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Clock3 size={13} aria-hidden="true" />約 {next.estimateMinutes} 分鐘</p><Link href={next.href} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700">繼續設定</Link></div> : null}
      <Link href="/onboarding" className="mt-2 inline-flex min-h-11 w-full items-center justify-center text-xs font-semibold text-blue-700 hover:underline">查看全部任務</Link>
      <details className="group mt-1 border-t border-blue-100 pt-1">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">
          <MoreHorizontal size={14} aria-hidden="true" />導引選項
        </summary>
        <div className="grid gap-1 pb-1" aria-busy={controlPending}>
          <button type="button" disabled={controlPending} onClick={() => controlGuide("hide")} className="min-h-11 rounded-md px-2 text-left text-xs text-slate-700 hover:bg-white disabled:opacity-50">暫時隱藏 1 天</button>
          <button type="button" disabled={controlPending} onClick={() => controlGuide("remind")} className="min-h-11 rounded-md px-2 text-left text-xs text-slate-700 hover:bg-white disabled:opacity-50">一週後提醒</button>
          <button type="button" disabled={controlPending} onClick={() => controlGuide("stop")} className="min-h-11 rounded-md px-2 text-left text-xs text-slate-700 hover:bg-white disabled:opacity-50">停止顯示導引</button>
        </div>
      </details>
    </div> : null}
  </section>;
}
