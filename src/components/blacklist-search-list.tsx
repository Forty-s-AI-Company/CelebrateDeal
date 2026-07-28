"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { unblockBlacklistAction } from "@/app/actions";
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

export function BlacklistSearchList({
  entries,
  csrfToken,
}: {
  entries: BlacklistListEntry[];
  csrfToken: string;
}) {
  const [query, setQuery] = useState("");
  const visibleEntries = useMemo(
    () => filterBlacklistEntries(entries, query),
    [entries, query],
  );

  return (
    <>
      <div className="mb-4 flex gap-2" role="search">
        <label className="sr-only" htmlFor="blacklist-local-search">搜尋黑名單</label>
        <input
          id="blacklist-local-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋識別值、原因、備註"
          className="h-10 flex-1 rounded-md border border-border px-3 text-sm"
        />
        <span className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-600">
          <Search size={16} aria-hidden="true" />
          本機篩選
        </span>
      </div>
      <p className="sr-only" aria-live="polite">顯示 {visibleEntries.length} 筆黑名單</p>
      <div className="grid gap-3">
        {visibleEntries.map((entry) => (
          <div key={entry.id} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-slate-950">{entry.identifier}</h2>
                <Badge tone={entry.isActive ? "orange" : "gray"}>{entry.isActive ? "封鎖中" : "已解除"}</Badge>
                <Badge tone="blue">{entry.identifierType}</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-600">{entry.reason}</p>
              <p className="mt-1 text-xs text-slate-400">建立：{formatDateTime(new Date(entry.createdAt))}</p>
            </div>
            {entry.isActive ? (
              <form action={unblockBlacklistAction}>
                <input type="hidden" name="_csrf" value={csrfToken} />
                <input type="hidden" name="id" value={entry.id} />
                <button className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">解除封鎖</button>
              </form>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
