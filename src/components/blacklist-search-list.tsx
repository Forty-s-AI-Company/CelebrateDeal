"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { unblockBlacklistAction } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge } from "@/components/ui";
import { filterBlacklistEntries } from "@/lib/blacklist-search";
import { formatDateTime } from "@/lib/format";

type BlacklistListEntry = {
  id: string;
  identifier: string;
  identifierType: string;
  reason: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
};

const identifierTypeLabels: Record<string, string> = {
  email: "Email",
  phone: "電話",
  ip: "IP位址",
  visitor_id: "訪客識別碼",
  keyword: "關鍵字",
};

type BlacklistStatusFilter = "all" | "active" | "inactive";

function normalizeBlacklistQuery(value: string) {
  return value.trim().slice(0, 120);
}

export function BlacklistSearchList({
  entries,
  csrfToken,
}: {
  entries: BlacklistListEntry[];
  csrfToken: string;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<BlacklistStatusFilter>("all");
  const visibleEntries = useMemo(
    () => {
      const queryEntries = filterBlacklistEntries(entries, normalizeBlacklistQuery(query));
      if (status === "active") return queryEntries.filter((entry) => entry.isActive);
      if (status === "inactive") return queryEntries.filter((entry) => !entry.isActive);
      return queryEntries;
    },
    [entries, query, status],
  );
  const hasFilters = Boolean(normalizeBlacklistQuery(query)) || status !== "all";

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end" role="search">
        <div className="grid flex-1 gap-1.5">
          <label className="text-sm font-medium text-slate-700" htmlFor="blacklist-local-search">搜尋黑名單</label>
          <input
            id="blacklist-local-search"
            type="search"
            value={query}
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋識別值、原因、備註"
            className="h-10 w-full rounded-md border border-border px-3 text-sm"
          />
        </div>
        <div className="grid gap-1.5 sm:w-40">
          <label className="text-sm font-medium text-slate-700" htmlFor="blacklist-status-filter">狀態</label>
          <select
            id="blacklist-status-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as BlacklistStatusFilter)}
            className="h-10 w-full rounded-md border border-border px-3 text-sm"
          >
            <option value="all">全部</option>
            <option value="active">封鎖中</option>
            <option value="inactive">已解除</option>
          </select>
        </div>
        <span className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-600">
          <Search size={16} aria-hidden="true" />
          本機篩選
        </span>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500" aria-live="polite">顯示 {visibleEntries.length} / {entries.length} 筆黑名單</p>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
            className="text-sm font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-950"
          >
            清除條件
          </button>
        ) : null}
      </div>
      <div className="grid gap-3">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <h2 className="font-semibold text-slate-950">還沒有黑名單紀錄</h2>
            <p className="mt-2 text-sm text-slate-500">請使用同頁的「新增封鎖項目」表單加入第一筆黑名單。</p>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <h2 className="font-semibold text-slate-950">找不到符合條件的黑名單紀錄</h2>
            <p className="mt-2 text-sm text-slate-500">請調整搜尋文字或狀態條件。</p>
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <div key={entry.id} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-950">{entry.identifier}</h2>
                  <Badge tone={entry.isActive ? "orange" : "gray"}>{entry.isActive ? "封鎖中" : "已解除"}</Badge>
                  <Badge tone="blue">{identifierTypeLabels[entry.identifierType] ?? entry.identifierType}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-600">{entry.reason}</p>
                <p className="mt-1 text-xs text-slate-400">建立：{formatDateTime(new Date(entry.createdAt))}</p>
              </div>
              {entry.isActive ? (
                <form action={unblockBlacklistAction}>
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <input type="hidden" name="id" value={entry.id} />
                  <FormSubmitButton
                    pendingChildren="解除中…"
                    pendingMessage={`正在解除 ${entry.identifier} 的封鎖，請勿重複送出。`}
                    className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    解除封鎖
                  </FormSubmitButton>
                </form>
              ) : null}
            </div>
          ))
        )}
      </div>
    </>
  );
}
