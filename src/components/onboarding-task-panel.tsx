"use client";

import { useId, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ChevronDown, MoreHorizontal, Rocket } from "lucide-react";
import { controlOnboardingGuideAction } from "@/app/actions/sales-workspace-actions";
import { nextOnboardingChecklistItem, type OnboardingChecklistItem } from "@/lib/merchant-onboarding";

/** A row of the unified checklist (`onboardingChecklistItems`); `/onboarding` shows the same rows in full. */
export type SidebarOnboardingTask = OnboardingChecklistItem;

export function OnboardingTaskPanel({ title, tasks, initiallyCollapsed, persistCollapsed }: { title: string; tasks: SidebarOnboardingTask[]; initiallyCollapsed: boolean; persistCollapsed: (collapsed: boolean) => Promise<void> }) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  // Checklist steps are only ever done or not yet done; they cannot be skipped or archived.
  const allComplete = tasks.length > 0 && completed === tasks.length;
  const [collapsed, setCollapsed] = useState(initiallyCollapsed || allComplete);
  // Completion chooses the initial state; users can still reopen the panel.
  const effectiveCollapsed = collapsed;
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const contentId = `${panelId}-content`;
  const [, startTransition] = useTransition();
  const [controlPending, startControlTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  // Same rule as /onboarding's「繼續」: deferred external work waits until local steps are done.
  const next = nextOnboardingChecklistItem(tasks);
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
  return <section className="mb-3 overflow-hidden rounded-xl border border-border bg-card" aria-labelledby={titleId}>
    <button type="button" onClick={toggle} aria-expanded={!effectiveCollapsed} aria-controls={contentId} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 focus-visible:ring-4 focus-visible:ring-blue-200">
      <Rocket size={16} className="text-muted" aria-hidden="true" /><span id={titleId} className="min-w-0 flex-1 truncate">{title} {completed}/{tasks.length}</span><ChevronDown size={16} className={`transition ${effectiveCollapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
    </button>
    {!effectiveCollapsed ? <div id={contentId} className="border-t border-border px-3 pb-3 pt-3">
      <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label={`${title}完成進度`} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${completed}/${tasks.length} 已完成`}><div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${percentage}%` }} /></div>
      {allComplete ? <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={17} aria-hidden="true" />所有任務已完成</p> : next ? <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">下一個最重要的任務</p><p className="mt-1 text-sm font-semibold text-slate-900">{next.title}</p>{next.href.split("?")[0] === pathname ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">你已在這個任務的設定頁，請在右側頁面完成設定，完成後進度會自動更新。</p> : <Link href={next.href} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark">繼續設定</Link>}</div> : null}
      <Link href="/onboarding" className="mt-2 inline-flex min-h-11 w-full items-center justify-center text-xs font-semibold text-primary hover:underline">查看全部任務</Link>
      <details className="group mt-1 border-t border-border pt-1">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">
          <MoreHorizontal size={14} aria-hidden="true" />導引選項
        </summary>
        <div className="grid gap-1 pb-1" aria-busy={controlPending}>
          <button type="button" disabled={controlPending} onClick={() => controlGuide("hide")} className="min-h-11 rounded-md px-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">暫時隱藏 1 天</button>
          <button type="button" disabled={controlPending} onClick={() => controlGuide("remind")} className="min-h-11 rounded-md px-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">一週後提醒</button>
          <button type="button" disabled={controlPending} onClick={() => controlGuide("stop")} className="min-h-11 rounded-md px-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">停止顯示導引</button>
        </div>
      </details>
    </div> : null}
  </section>;
}
