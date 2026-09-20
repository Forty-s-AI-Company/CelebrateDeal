"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { LandingPageSummary } from "@/lib/landing-page-service";

type StatusFilter = "active" | "draft" | "all";

export function FunnelList({ pages, readOnly = false }: { pages: LandingPageSummary[]; readOnly?: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const filtered = useMemo(() => pages.filter((page) => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
    const matchesQuery = `${page.name} ${page.slug}`.toLocaleLowerCase("zh-TW").includes(normalizedQuery);
    const matchesStatus = status === "all" || (status === "active" ? page.status === "published" : page.status === "draft");
    return matchesQuery && matchesStatus;
  }), [pages, query, status]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  function resetFilters(next: { query?: string; status?: StatusFilter; size?: number }) {
    if (next.query !== undefined) setQuery(next.query);
    if (next.status !== undefined) setStatus(next.status);
    if (next.size !== undefined) setPageSize(next.size);
    setCurrentPage(1);
  }

  return <section aria-label="Funnel 清單" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50/70 p-4">
      <label className="min-w-56 flex-1 text-sm font-semibold text-slate-700">搜尋
        <input value={query} onChange={(event) => resetFilters({ query: event.target.value })} placeholder="搜尋名稱或網址" className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
      </label>
      <label className="text-sm font-semibold text-slate-700">狀態
        <select value={status} onChange={(event) => resetFilters({ status: event.target.value as StatusFilter })} className="mt-1 block min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
          <option value="active">已發布</option><option value="draft">草稿</option><option value="all">全部</option>
        </select>
      </label>
      <label className="text-sm font-semibold text-slate-700">每頁
        <select value={pageSize} onChange={(event) => resetFilters({ size: Number(event.target.value) })} className="mt-1 block min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
          <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
        </select>
      </label>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-white text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">名稱</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">更新時間</th><th className="px-5 py-3 text-right">操作</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{visible.map((page) => <tr key={page.id} className="hover:bg-slate-50">
          <td className="px-5 py-4"><p className="font-semibold text-slate-950">{page.name}</p><p className="mt-1 font-mono text-xs text-slate-500">/lp/{page.slug}</p></td>
          <td className="px-5 py-4"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${page.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{page.status === "published" ? "✓ 已發布" : "草稿"}</span></td>
          <td className="px-5 py-4 text-slate-600"><time dateTime={page.updatedAt.toISOString()}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(page.updatedAt)}</time></td>
          <td className="px-5 py-4 text-right">{readOnly ? <span className="text-xs text-slate-400">唯讀</span> : <Link href={`/landing-pages/${page.id}/operations`} className="font-semibold text-blue-700 hover:text-blue-900">開啟 Funnel →</Link>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {!visible.length ? <div className="px-5 py-12 text-center"><p className="font-semibold text-slate-800">找不到符合條件的 Funnel</p><p className="mt-1 text-sm text-slate-500">調整搜尋字詞或狀態篩選。</p></div> : null}
    <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm text-slate-500"><span>共 {filtered.length} 筆</span><div className="flex items-center gap-2"><button type="button" disabled={safePage <= 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">上一頁</button><span>{safePage} / {totalPages}</span><button type="button" disabled={safePage >= totalPages} onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">下一頁</button></div></div>
  </section>;
}
