"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus } from "lucide-react";
import { selectSalesProjectAction } from "@/app/actions/sales-workspace-actions";

export type SalesProjectChoice = { id: string; name: string };

/**
 * 一頁式網站屬於銷售專案。在「全部專案總覽（唯讀）」或尚未有專案時，
 * 說明原因並讓使用者直接切換專案（沿用側欄切換器的 `selectSalesProjectAction`，
 * 同樣的權限與 ownership 檢查），或前往建立專案；切換後留在原頁重新整理。
 */
export function SalesProjectRequiredNotice({ projects, purpose = "manage", className = "" }: {
  projects: readonly SalesProjectChoice[];
  /** manage: 管理／建立一頁式網站；template: 使用範本。只影響說明文字。 */
  purpose?: "manage" | "template";
  className?: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  const action = purpose === "template" ? "使用範本建立或套用網站" : "建立或編輯一頁式網站";

  function choose(projectId: string) {
    if (pendingId) return;
    setError("");
    setPendingId(projectId);
    startTransition(async () => {
      try {
        await selectSalesProjectAction(projectId);
        router.refresh();
      } catch {
        setError("無法切換到這個專案，請重新整理後再試。");
      } finally {
        setPendingId(null);
      }
    });
  }

  const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  return <section aria-labelledby={titleId} data-sales-project-required className={`rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-slate-800 sm:p-5 ${className}`}>
    <h2 id={titleId} className="text-base font-bold text-slate-950">一頁式網站屬於銷售專案，請先選擇專案</h2>
    {projects.length ? <>
      <p className="mt-1 leading-6 text-slate-700">目前沒有選定銷售專案（例如正在看「全部專案總覽（唯讀）」），所以不能{action}。選擇一個專案後會留在這一頁繼續操作。</p>
      <ul aria-label="可切換的銷售專案" className="mt-3 grid gap-2 sm:grid-cols-2">
        {projects.map((project) => <li key={project.id}>
          <button type="button" disabled={pendingId !== null} onClick={() => choose(project.id)} className={`${button} w-full justify-start border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>
            <FolderKanban size={16} aria-hidden className="shrink-0 text-blue-700" />
            <span className="min-w-0 flex-1 truncate text-left">{pendingId === project.id ? "切換中…" : `切換到「${project.name}」`}</span>
          </button>
        </li>)}
      </ul>
      <p className="mt-3 text-xs text-slate-600">也可以用左上角的專案切換器，或<Link href="/projects" className="mx-1 font-semibold text-blue-800 underline">管理銷售專案</Link>。</p>
    </> : <>
      <p className="mt-1 leading-6 text-slate-700">你還沒有任何銷售專案。先建立一個專案，就能{action}。</p>
      <Link href="/projects/new" className={`${button} mt-3 bg-blue-700 text-white hover:bg-blue-800`}><Plus size={16} aria-hidden />建立銷售專案</Link>
    </>}
    {error ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-red-800">{error}</p> : null}
  </section>;
}
