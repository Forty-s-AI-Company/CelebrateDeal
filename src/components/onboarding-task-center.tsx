"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Circle, Clock3, PauseCircle } from "lucide-react";

import {
  controlOnboardingGuideAction,
  setOnboardingTaskStatusAction,
} from "@/app/actions/sales-workspace-actions";
import { Badge } from "@/components/ui";

export type TaskCenterTask = {
  key: string;
  title: string;
  status: string;
  estimateMinutes: number;
  href: string;
  required: boolean;
  impact?: string | null;
};

const statusLabel: Record<string, string> = {
  not_started: "尚未開始",
  in_progress: "進行中",
  completed: "已完成",
  skipped: "已略過",
  needs_attention: "需要處理",
  archived: "已封存",
};

export function OnboardingTaskCenter({
  scopeKey,
  scopeLabel,
  tasks,
  guideStopped,
}: {
  scopeKey: string;
  scopeLabel: string;
  tasks: TaskCenterTask[];
  guideStopped: boolean;
}) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const completed = tasks.filter((task) => task.status === "completed").length;
  const percentage = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);

  function updateTask(taskKey: string, status: "in_progress" | "skipped" | "needs_attention" | "archived") {
    setPendingKey(taskKey);
    startTransition(async () => {
      await setOnboardingTaskStatusAction(scopeKey, taskKey, status);
      setPendingKey(null);
      router.refresh();
    });
  }

  function restartGuide() {
    setPendingKey("guide");
    startTransition(async () => {
      await controlOnboardingGuideAction("restart");
      setPendingKey(null);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="task-center-title" className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-indigo-50/70 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">目前資料範圍</p>
          <h2 id="task-center-title" className="mt-1 text-lg font-semibold text-slate-950">{scopeLabel}</h2>
          <p className="mt-1 text-sm text-slate-600">任務完成會由真實設定自動判斷；手動控制不會偽造成已完成。</p>
        </div>
        {guideStopped ? (
          <button type="button" disabled={isPending} onClick={restartGuide} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:opacity-50">重新開始導引</button>
        ) : null}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-slate-800">已完成 {completed}/{tasks.length}</span>
        <span className="tabular-nums text-slate-600">{percentage}%</span>
      </div>
      <div role="progressbar" aria-label={`${scopeLabel}上線任務進度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${completed}/${tasks.length} 已完成`} className="mt-2 h-2.5 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-blue-600 transition-[width] motion-reduce:transition-none" style={{ width: `${percentage}%` }} />
      </div>

      <ol className="mt-5 grid gap-3">
        {tasks.map((task, index) => {
          const taskPending = isPending && pendingKey === task.key;
          const terminal = ["completed", "archived"].includes(task.status);
          return (
            <li key={task.key} className="rounded-lg border border-white/90 bg-white/90 p-4">
              <div className="flex items-start gap-3">
                {task.status === "completed" ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={19} aria-hidden="true" /> : task.status === "needs_attention" ? <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={19} aria-hidden="true" /> : task.status === "skipped" || task.status === "archived" ? <PauseCircle className="mt-0.5 shrink-0 text-slate-500" size={19} aria-hidden="true" /> : <Circle className="mt-0.5 shrink-0 text-blue-400" size={19} aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{index + 1}. {task.title}</h3>
                    <Badge tone={task.status === "completed" ? "green" : task.status === "needs_attention" || task.status === "skipped" ? "orange" : "gray"}>{statusLabel[task.status] ?? task.status}</Badge>
                    {!task.required ? <Badge tone="blue">可略過</Badge> : null}
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock3 size={13} aria-hidden="true" />約 {task.estimateMinutes} 分鐘</p>
                  {task.impact ? <p role="status" className="mt-2 text-sm leading-6 text-amber-700">{task.impact}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2" aria-busy={taskPending}>
                    {!terminal ? <Link href={task.href} className="inline-flex min-h-10 items-center rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">前往設定</Link> : null}
                    {task.status === "not_started" ? <button type="button" disabled={taskPending} onClick={() => updateTask(task.key, "in_progress")} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">標記進行中</button> : null}
                    {!terminal && task.status !== "needs_attention" ? <button type="button" disabled={taskPending} onClick={() => updateTask(task.key, "needs_attention")} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">需要協助</button> : null}
                    {!terminal && task.status !== "skipped" ? <button type="button" disabled={taskPending} onClick={() => updateTask(task.key, "skipped")} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">略過</button> : null}
                    {task.status === "skipped" ? <button type="button" disabled={taskPending} onClick={() => updateTask(task.key, "in_progress")} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">重新處理</button> : null}
                    {task.status !== "completed" && task.status !== "archived" ? <button type="button" disabled={taskPending} onClick={() => updateTask(task.key, "archived")} className="min-h-10 px-2 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50">封存</button> : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">{isPending ? "正在更新任務狀態" : ""}</p>
    </section>
  );
}
