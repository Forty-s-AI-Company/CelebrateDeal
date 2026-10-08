"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { PrivateInstructorConversations, PrivateInstructorConversationsResponse } from "@/lib/live-private-chat-contract";
import { LivePrivateConversationPanel } from "./live-private-conversation-panel";
type Page = z.infer<typeof PrivateInstructorConversations>;
type Props = { vendorId: string; liveId: string; initialPage: Page };
export function LiveInstructorPrivateChat(props: Props) {
  return <Inbox key={JSON.stringify([props.vendorId, props.liveId])} {...props} />;
}
function Inbox({ liveId, initialPage }: Props) {
  const [page, setPage] = useState(initialPage);
  const [selected, setSelected] = useState<string | null>(initialPage.conversations[0]?.submissionId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const active = useRef(false), alive = useRef(false), expanded = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const cancelRequest = useCallback(() => { ++revision.current; controller.current?.abort(); }, []);
  const load = useCallback(async (cursor?: string) => {
    if (active.current || !alive.current) return;
    active.current = true; setLoading(true);
    const sequence = ++revision.current;
    const current = new AbortController(); controller.current = current;
    const timeout = window.setTimeout(() => current.abort(), 8_000);
    try {
      const query = new URLSearchParams({ liveId, ...(cursor ? { cursor } : {}) });
      const response = await fetch(`/api/live-chat/instructor?${query}`, { headers: { "X-CelebrateDeal-Client": "web" }, credentials: "same-origin", cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error("conversation-access-denied");
      const parsed = PrivateInstructorConversationsResponse.safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid-conversations");
      if (alive.current && sequence === revision.current) {
        expanded.current = Boolean(cursor);
        setPage(previous => ({ conversations: cursor
          ? [...previous.conversations, ...parsed.data.conversations.filter(row => !previous.conversations.some(existing => existing.submissionId === row.submissionId))]
          : parsed.data.conversations, nextCursor: parsed.data.nextCursor }));
        if (!cursor) setSelected(previous => parsed.data.conversations.some(row => row.submissionId === previous) ? previous : parsed.data.conversations[0]?.submissionId ?? null);
        setError(null);
      }
    } catch {
      if (alive.current && sequence === revision.current) { setPage({ conversations: [], nextCursor: null }); setSelected(null); setError("無法讀取對話，請重新確認權限或稍後重試。"); }
    } finally { window.clearTimeout(timeout); active.current = false; if (alive.current) setLoading(false); }
  }, [liveId]);
  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => { if (!expanded.current && document.visibilityState === "visible") void load(); }, 15_000);
    return () => { alive.current = false; cancelRequest(); window.clearInterval(timer); };
  }, [cancelRequest, load]);
  return <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
    <aside aria-label="觀眾私訊對話" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-bold">觀眾對話</h2>
      <button type="button" disabled={loading} onClick={() => void load()} className="my-3 min-h-11 text-sm underline">{loading ? "更新中…" : "更新對話"}</button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {page.conversations.length === 0 ? <p className="text-sm text-slate-500">目前沒有觀眾私訊。</p>
        : <ul className="space-y-2">{page.conversations.map(row => <li key={row.submissionId}>
          <button type="button" aria-pressed={selected === row.submissionId} onClick={() => setSelected(row.submissionId)} className="min-h-11 w-full rounded-lg border p-2 text-left aria-pressed:bg-slate-100">{row.displayName}</button>
        </li>)}</ul>}
      {page.nextCursor ? <button type="button" disabled={loading} onClick={() => void load(page.nextCursor ?? undefined)} className="mt-3 min-h-11 text-sm underline">載入更多對話</button> : null}
    </aside>
    {selected ? <LivePrivateConversationPanel mode="instructor" liveId={liveId} submissionId={selected} /> : <p className="p-4 text-sm text-slate-500">選擇觀眾即可讀取與回覆私訊。</p>}
  </div>;
}
