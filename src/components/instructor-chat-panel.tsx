"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { parseViewerRuntimeMessage } from "@/components/live-chat-panel";
import type { ViewerRuntimeMessage } from "@/lib/live-chat-contract";

const endpoint = "/api/live-chat/instructor";
const headers = { "Content-Type": "application/json", "x-celebratedeal-client": "web" };
type Conversation = { id: string; name: string };

export function InstructorChatPanel({ liveId }: { liveId: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const loading = useRef(false);
  const load = useCallback(async (cursor?: string) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const query = new URLSearchParams({ liveId, ...(cursor ? { conversationCursor: cursor } : {}) });
      const response = await fetch(`${endpoint}?${query}`, { headers, cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setConversations(current => cursor ? [...current, ...data.conversations] : data.conversations);
      setAfter(data.nextConversationCursor);
      setError(false);
    } catch { setError(true); } finally { loading.current = false; }
  }, [liveId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  return <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
    <aside className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-bold">觀眾對話</h2>
      <button type="button" className="min-h-11 text-sm underline" onClick={() => void load()}>重新整理名單</button>
      {error ? <p role="alert">無法讀取名單，請重試。</p> : null}
      <ul className="max-h-80 overflow-y-auto">
        {conversations.map(row => <li key={row.id}><button type="button" aria-pressed={selected?.id === row.id}
          className="min-h-11 w-full rounded-lg px-3 text-left aria-pressed:bg-slate-100" onClick={() => setSelected(row)}>{row.name}</button></li>)}
      </ul>
      {after ? <button type="button" className="min-h-11 underline" onClick={() => void load(after)}>更多觀眾</button> : null}
    </aside>
    {selected ? <InstructorConversation key={`${liveId}:${selected.id}`} liveId={liveId} conversation={selected} />
      : <p className="p-4">請選擇一名觀眾，開始私密對話。</p>}
  </div>;
}

function InstructorConversation({ liveId, conversation }: { liveId: string; conversation: Conversation }) {
  const [messages, setMessages] = useState<ViewerRuntimeMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [older, setOlder] = useState<ViewerRuntimeMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const intent = useRef<{ body: string; clientMessageId: string } | null>(null);
  const mounted = useRef(true);
  const sending = useRef(false);
  const historyLoaded = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const query = new URLSearchParams({ liveId, submissionId: conversation.id });
        const response = await fetch(`${endpoint}?${query}`, { headers, cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          if (response.status === 403 && mounted.current) { setMessages([]); setOlder([]); }
          throw new Error();
        }
        const data = await response.json();
        if (!mounted.current) return;
        setMessages(data.messages.map(parseViewerRuntimeMessage).filter(Boolean));
        if (!historyLoaded.current) setCursor(data.nextCursor);
      } catch { if (mounted.current) setError("對話暫時無法更新，系統會自動重試。"); }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { mounted.current = false; controller.abort(); clearInterval(timer); };
  }, [liveId, conversation.id]);
  async function history() {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const query = new URLSearchParams({ liveId, submissionId: conversation.id, cursor });
      const response = await fetch(`${endpoint}?${query}`, { headers, cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (mounted.current) { historyLoaded.current = true; setOlder(current => [...data.messages, ...current]); setCursor(data.nextCursor); }
    } catch { if (mounted.current) setError("歷史訊息讀取失敗，請重試。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.normalize("NFKC").trim();
    if (!body || sending.current) return;
    sending.current = true;
    setBusy(true);
    // A network retry retains the same id; changing the draft creates a new intent.
    if (intent.current?.body !== body) intent.current = { body, clientMessageId: crypto.randomUUID() };
    try {
      const response = await fetch(endpoint, { method: "POST", headers,
        body: JSON.stringify({ liveId, submissionId: conversation.id, ...intent.current }) });
      if (!response.ok) throw new Error();
      const message = parseViewerRuntimeMessage(await response.json());
      if (!message) throw new Error();
      if (!mounted.current) return;
      setMessages(current => [...current.filter(row => row.id !== message.id), message]);
      setDraft(""); intent.current = null; setError(null);
    } catch { if (mounted.current) setError("回覆未確認送達，請重試；重試不會重複送出。"); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  }
  const all = [...new Map([...older, ...messages].map(row => [row.id, row])).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return <section aria-label={`與 ${conversation.name} 的私密對話`} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
    <h2 className="font-bold">回覆 {conversation.name}</h2>
    <p className="text-sm text-slate-500">只有這位觀眾會收到回覆。</p>
    <div role="log" aria-live="polite" className="my-4 max-h-[55dvh] min-h-48 space-y-3 overflow-y-auto">
      {cursor ? <button type="button" disabled={busy} className="min-h-11 underline" onClick={() => void history()}>載入較早訊息</button> : null}
      {all.map(row => <article key={row.id} className="rounded-lg bg-slate-50 p-3">
        <strong className="text-xs">{row.source === "instructor" ? "講師" : row.actor.name}</strong>
        <p className="whitespace-pre-wrap break-words">{row.body}</p>
      </article>)}
    </div>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <form onSubmit={send} className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1">私人回覆<textarea aria-label="私人回覆" value={draft} onChange={event => setDraft(event.target.value)}
        disabled={busy} maxLength={1000} rows={3} className="block w-full rounded-lg border p-3 text-base" /></label>
      <button type="submit" disabled={busy || !draft.trim()} className="min-h-11 rounded-lg bg-slate-900 px-4 text-white disabled:opacity-50">{busy ? "處理中" : "送出回覆"}</button>
    </form>
  </section>;
}
