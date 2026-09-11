"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Building2, Check, ChevronDown, FolderKanban, Plus } from "lucide-react";

export type ProjectSwitcherItem = { id: string; name: string; status: string };

export function WorkspaceProjectSwitcher({
  workspaceName,
  projects,
  selectedProjectId,
  selectProject,
}: {
  workspaceName: string;
  projects: ProjectSwitcherItem[];
  selectedProjectId: string | null;
  selectProject: (projectId: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = projects.find((project) => project.id === selectedProjectId);

  function choose(projectId: string | null) {
    startTransition(async () => {
      await selectProject(projectId);
      setOpen(false);
    });
  }

  return (
    <div className="relative mb-3 rounded-xl border border-slate-200 bg-slate-50/80 p-2" data-workspace-switcher>
      <p className="flex items-center gap-2 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><Building2 size={13} aria-hidden="true" />商家 Workspace</p>
      <p className="truncate px-2 pb-2 pt-1 text-sm font-semibold text-slate-800">{workspaceName}</p>
      <button type="button" disabled={pending} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:ring-4 focus-visible:ring-blue-100">
        <FolderKanban size={16} className="shrink-0 text-blue-600" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{current?.name ?? "全部專案總覽"}</span>
        <ChevronDown size={16} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? <div role="menu" aria-label="切換銷售專案" className="absolute left-2 right-2 top-full z-50 mt-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
        <button role="menuitemradio" aria-checked={!selectedProjectId} type="button" onClick={() => choose(null)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-slate-50"><Check size={15} className={!selectedProjectId ? "opacity-100" : "opacity-0"} aria-hidden="true" /><span><b className="block">全部專案總覽</b><span className="text-xs text-slate-500">商家彙總，僅供檢視</span></span></button>
        {projects.map((project) => <button key={project.id} role="menuitemradio" aria-checked={project.id === selectedProjectId} type="button" onClick={() => choose(project.id)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-slate-50"><Check size={15} className={project.id === selectedProjectId ? "opacity-100" : "opacity-0"} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{project.name}</span></button>)}
        <div className="mt-1 border-t border-slate-100 pt-1">
          <Link role="menuitem" href="/projects/new" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Plus size={15} aria-hidden="true" />建立新專案</Link>
          <Link role="menuitem" href="/projects" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-50"><FolderKanban size={15} aria-hidden="true" />管理專案</Link>
        </div>
      </div> : null}
    </div>
  );
}
