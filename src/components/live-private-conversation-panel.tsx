"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PrivateChatMessage, PrivateChatResponse, type PrivateChatMessageDto } from "@/lib/live-private-chat-contract";

type Props = { liveId: string } & ({ mode: "viewer"; vendorId: string } | { mode: "instructor"; submissionId: string });
type View = { identity: string; messages: PrivateChatMessageDto[]; nextCursor: string | null; csrfToken: string; conversationBinding: string };
const clientHeaders = { "X-CelebrateDeal-Client": "web", "Content-Type": "application/json" };

/** Scope changes remount the whole conversation, including draft and retry ID.
 * Private messages remain in this component's memory, never browser storage. */
export function LivePrivateConversationPanel(props: Props) {
  const scope = JSON.stringify([props.mode, props.liveId, props.mode === "viewer" ? props.vendorId : props.submissionId]);
  return <PrivateConversation key={scope} {...props} />;
}
function PrivateConversation(props: Props) {
  const [cursor, setCursor] = useState<string | null>(null);
  const query = new URLSearchParams({ liveId: props.liveId,
    ...(props.mode === "viewer" ? { vendorId: props.vendorId } : { submissionId: props.submissionId }),
    ...(cursor ? { cursor } : {}),
  });
  const endpoint = props.mode === "viewer" ? "/api/live-chat/private" : "/api/live-chat/instructor";
  const url = `${endpoint}?${query}`;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const retry = useRef<{ body: string; clientMessageId: string } | null>(null);
  const mounted = useRef(false);
  const writeLock = useRef(false);
  const conversationIdentity = useRef<string | null>(null);
  const visible = view?.identity === url ? view : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; writeRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    let disposed = false, loading = false;
    const load = async () => {
      if (disposed || loading || writeLock.current || document.visibilityState === "hidden") return;
      loading = true;
      const sequence = ++revision.current;
      const controller = new AbortController(); request.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(url, { headers: clientHeaders, credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (disposed || sequence !== revision.current) return;
        if (!response.ok) {
          setView(null);
          setError(response.status === 403 ? "請先完成驗證，或重新確認此對話的存取權限。" : "暫時無法讀取私訊，請稍後再試。");
          return;
        }
        const parsed = PrivateChatResponse.safeParse(await response.json());
        if (!parsed.success) throw new Error("invalid-private-chat-response");
        if (!disposed && sequence === revision.current) {
          if (conversationIdentity.current && conversationIdentity.current !== parsed.data.conversationBinding) {
            setDraft(""); retry.current = null; setCursor(null);
          }
          conversationIdentity.current = parsed.data.conversationBinding;
          setView({ identity: url, ...parsed.data }); setError(null);
        }
      } catch {
        if (!disposed && sequence === revision.current) { setView(null); setError("暫時無法讀取私訊，請稍後再試。"); }
      } finally { window.clearTimeout(timeout); loading = false; }
    };
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => { if (!cursor) void load(); }, 10_000);
    const visible = () => { if (!cursor && document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; request.current?.abort(); window.clearTimeout(initial); window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [cursor, refresh, url]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.normalize("NFKC").trim();
    if (!visible || cursor || writeLock.current || !body || Array.from(body).length > 1_000) return;
    writeLock.current = true; setWriting(true); setError(null);
    ++revision.current; request.current?.abort();
    if (!retry.current || retry.current.body !== body) retry.current = { body, clientMessageId: crypto.randomUUID() };
    const controller = new AbortController(); writeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const payload = { liveId: props.liveId, ...retry.current, csrfToken: visible.csrfToken, conversationBinding: visible.conversationBinding,
        ...(props.mode === "viewer" ? { vendorId: props.vendorId } : { submissionId: props.submissionId }) };
      const response = await fetch(endpoint, { method: "POST", headers: clientHeaders, credentials: "same-origin", cache: "no-store", body: JSON.stringify(payload), signal: controller.signal });
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status === 403) {
          setView(null); setDraft(""); retry.current = null; conversationIdentity.current = null;
          setCursor(null); setRefresh(value => value + 1);
        }
        setError(response.status === 403 ? "此對話暫時無法傳送，請重新確認權限。" : "訊息未確認送達，請重試。");
        return;
      }
      const parsed = PrivateChatMessage.safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid-private-chat-response");
      if (mounted.current) { setDraft(""); retry.current = null; setRefresh(value => value + 1); }
    } catch { if (mounted.current) setError("訊息未確認送達，請重試；系統會使用同一筆訊息識別碼。"); }
    finally { window.clearTimeout(timeout); writeLock.current = false; if (mounted.current) setWriting(false); }
  }

  return <section aria-label="講師私訊" className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-950">
    <h3 className="font-bold">講師私訊</h3>
    <p className="mt-1 text-xs text-slate-500">只有這位觀眾與授權講師可以讀取此對話。</p>
    <div aria-live="polite" className="mt-3 max-h-64 overflow-y-auto">
      {!visible ? <p className="text-sm">{error ? "目前無法開啟對話。" : "正在確認私訊權限…"}</p>
        : visible.messages.length === 0 ? <p className="text-sm">尚無私訊。</p>
          : <ol className="space-y-3">{visible.messages.map(message => <li key={message.id}>
            <p className="text-xs font-bold">{message.source === "instructor" ? "講師" : "觀眾"}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
          </li>)}</ol>}
    </div>
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
    <div className="mt-3 flex gap-3 text-sm">
      {visible?.nextCursor ? <button type="button" disabled={writing} onClick={() => setCursor(visible.nextCursor)}>較早訊息</button> : null}
      {cursor ? <button type="button" disabled={writing} onClick={() => setCursor(null)}>回到最新</button> : null}
      <button type="button" disabled={writing} onClick={() => setRefresh(value => value + 1)}>重新確認</button>
    </div>
    <form onSubmit={send} className="mt-3 grid gap-2">
      <label className="text-sm font-medium">私人訊息<textarea aria-label="私人訊息" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2_000}
        disabled={!visible || Boolean(cursor) || writing} className="mt-1 block min-h-20 w-full rounded-lg border border-slate-300 p-2 disabled:opacity-50" /></label>
      <button type="submit" disabled={!visible || Boolean(cursor) || writing || !draft.trim()} className="min-h-11 rounded-lg bg-slate-950 px-4 text-white disabled:opacity-50">{writing ? "傳送中…" : "傳送私訊"}</button>
    </form>
  </section>;
}
