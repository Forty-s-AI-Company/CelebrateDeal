"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, LoaderCircle } from "lucide-react";

const STEPS = ["正在分析你的銷售方式…", "正在配置需要的工具…", "正在建立你的商家上線步驟…", "你的專屬工作空間準備好了"];

export function WorkspacePreparingProgress() {
  const [visible, setVisible] = useState(1);
  useEffect(() => {
    const timers = [900, 1900, 3100].map((delay, index) => window.setTimeout(() => setVisible(index + 2), delay));
    return () => timers.forEach(window.clearTimeout);
  }, []);
  return <><LoaderCircle className="size-10 animate-spin text-blue-300 motion-reduce:animate-none" aria-hidden="true" /><h1 className="mt-5 text-3xl font-bold">正在準備你的工作空間</h1><ol className="mt-6 grid gap-3 text-sm text-slate-200" aria-live="polite">{STEPS.slice(0, visible).map((step, index) => <li key={step} className="flex gap-2">{index < visible - 1 || visible === STEPS.length ? <CheckCircle2 size={18} className="text-emerald-400" aria-hidden="true" /> : <LoaderCircle size={18} className="animate-spin text-blue-300 motion-reduce:animate-none" aria-hidden="true" />}{step}</li>)}</ol>{visible === STEPS.length ? <Link href="/dashboard" className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-500 px-5 font-semibold hover:bg-blue-400">進入我的工作空間</Link> : <p className="mt-7 text-sm text-slate-400">偏好、推薦模式與任務正在完成最後確認。</p>}</>;
}
