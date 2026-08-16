"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

import type { ScheduledRuntimeMessage, ViewerRuntimeMessage } from "@/lib/live-chat-contract";

const CHAT_ENDPOINT = "/api/live-chat/messages";
const CHAT_POLL_INTERVAL_MS = 3_000;
const CHAT_BODY_MAX_LENGTH = 1_000;
const CLIENT_HEADERS = {
  "Content-Type": "application/json",
  "X-CelebrateDeal-Client": "web",
};

type AdmissionStatus = "checking" | "admitted" | "blocked";
type ViewerReason = "verification_required" | "blocked" | null;
type ViewerState = {
  canPost: boolean;
  displayName: string | null;
  reason: ViewerReason;
};
type PendingIntent = {
  clientMessageId: string;
  body: string;
  status: "sending" | "retryable";
};

export type LiveChatPanelProps = {
  enabled: boolean;
  admissionStatus: AdmissionStatus;
  vendorId: string;
  liveId: string;
  scheduledMessages: ScheduledRuntimeMessage[];
  onAdmissionInvalid?: () => void;
};

type ChatListPayload = {
  messages: ViewerRuntimeMessage[];
  viewer: ViewerState;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseViewerRuntimeMessage(value: unknown): ViewerRuntimeMessage | null {
  if (!isObject(value) || value.source !== "viewer") return null;
  if (typeof value.id !== "string" || !value.id || value.id.length > 128) return null;
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return null;
  if (typeof value.body !== "string" || !value.body.trim() || Array.from(value.body).length > CHAT_BODY_MAX_LENGTH) return null;
  if (!isObject(value.actor) || typeof value.actor.name !== "string" || !value.actor.name.trim()) return null;

  return {
    id: value.id,
    source: "viewer",
    createdAt: value.createdAt,
    body: value.body,
    actor: { name: value.actor.name },
  };
}

export function parseChatListPayload(value: unknown): ChatListPayload | null {
  if (!isObject(value) || !Array.isArray(value.messages) || !isObject(value.viewer)) return null;
  const messages = value.messages.map(parseViewerRuntimeMessage).filter((message): message is ViewerRuntimeMessage => message !== null);
  if (messages.length !== value.messages.length) return null;
  if (typeof value.viewer.canPost !== "boolean") return null;
  const displayName = value.viewer.displayName;
  const reason = value.viewer.reason;
  if (displayName !== null && typeof displayName !== "string") return null;
  if (reason !== null && reason !== "verification_required" && reason !== "blocked") return null;
  return { messages, viewer: { canPost: value.viewer.canPost, displayName, reason } };
}

export function mergeViewerMessages(
  current: ViewerRuntimeMessage[],
  incoming: ViewerRuntimeMessage[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  ));
}

export function sortScheduledMessages(messages: ScheduledRuntimeMessage[]) {
  return [...messages].sort((left, right) => left.triggerSec - right.triggerSec || left.id.localeCompare(right.id));
}

export function isRetryableChatStatus(status: number) {
  return status === 429 || status >= 500;
}

function readonlyMessage(reason: ViewerReason) {
  if (reason === "verification_required") return "請先完成 Email 驗證，驗證後即可留言。";
  if (reason === "blocked") return "目前無法使用留言功能。";
  return "留言功能目前為唯讀。";
}

export function postErrorMessage(status: number | "keyword" | "rate_limited" | "retryable" | "generic") {
  if (status === 422 || status === "keyword") return "留言包含目前無法使用的文字，請修改後再送出。";
  if (status === 429 || status === "rate_limited") return "留言送得太快，請稍後重試。";
  if (status === 409 || status === "generic") return "留言送出狀態不確定，請確認內容後再次送出。";
  if (status === "retryable" || (typeof status === "number" && status >= 500)) return "留言暫時送不出去，請重試。";
  return "留言無法送出，內容仍為你保留。";
}

export function LiveChatPanel(props: LiveChatPanelProps) {
  // A live identity change must create a fresh state boundary. This prevents
  // messages, permissions, drafts, and late async work from crossing sessions.
  return <LiveChatSession key={`${props.vendorId}:${props.liveId}`} {...props} />;
}

function LiveChatSession({
  enabled,
  admissionStatus,
  vendorId,
  liveId,
  scheduledMessages,
  onAdmissionInvalid,
}: LiveChatPanelProps) {
  const [viewerMessages, setViewerMessages] = useState<ViewerRuntimeMessage[]>([]);
  const [viewer, setViewer] = useState<ViewerState>({ canPost: false, displayName: null, reason: "verification_required" });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const [paused, setPaused] = useState(false);
  const [pollMessage, setPollMessage] = useState<string | null>(null);
  const [postMessage, setPostMessage] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const postControllerRef = useRef<AbortController | null>(null);

  const visibleScheduledMessages = useMemo(() => sortScheduledMessages(scheduledMessages), [scheduledMessages]);
  const canPost = enabled && admissionStatus === "admitted" && !paused && viewer.canPost && pending === null;

  useEffect(() => () => postControllerRef.current?.abort(), []);

  useEffect(() => {
    if (admissionStatus === "admitted") return;
    const reset = window.setTimeout(() => setPaused(false), 0);
    return () => window.clearTimeout(reset);
  }, [admissionStatus]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (!enabled || admissionStatus !== "admitted" || paused) return;

    let disposed = false;
    let inFlight = false;
    let controller: AbortController | null = null;

    const poll = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const query = new URLSearchParams({ vendorId, liveId });
      try {
        const response = await fetch(`${CHAT_ENDPOINT}?${query.toString()}`, {
          headers: CLIENT_HEADERS,
          signal: controller.signal,
        });
        if (disposed || generationRef.current !== generation) return;
        if (response.status === 403) {
          setPaused(true);
          setPollMessage("直播連線或留言資格已失效，請重新進入直播或完成信件驗證。");
          onAdmissionInvalid?.();
          return;
        }
        if (!response.ok) {
          setPollMessage("留言暫時無法更新，系統會自動重試。");
          return;
        }
        const payload = parseChatListPayload(await response.json());
        if (!payload) {
          setPollMessage("留言暫時無法更新，系統會自動重試。");
          return;
        }
        setViewer(payload.viewer);
        setViewerMessages((current) => mergeViewerMessages(current, payload.messages));
        setPollMessage(null);
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
          setPollMessage("留言暫時無法更新，系統會自動重試。");
        }
      } finally {
        inFlight = false;
        controller = null;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), CHAT_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [admissionStatus, enabled, liveId, onAdmissionInvalid, paused, vendorId]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const closeToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 96;
    if (closeToBottom) log.scrollTop = log.scrollHeight;
  }, [pending, viewerMessages.length, visibleScheduledMessages.length]);

  const sendIntent = useCallback(async (intent: PendingIntent) => {
    if (!enabled || admissionStatus !== "admitted" || paused || !viewer.canPost) return;
    const controller = new AbortController();
    postControllerRef.current?.abort();
    postControllerRef.current = controller;
    setPending({ ...intent, status: "sending" });
    setPostMessage(null);
    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: CLIENT_HEADERS,
        body: JSON.stringify({ vendorId, liveId, clientMessageId: intent.clientMessageId, body: intent.body }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 403) {
        setPaused(true);
        setPending(null);
        setPostMessage("直播連線或留言資格已失效，草稿已保留。");
        onAdmissionInvalid?.();
        return;
      }
      if (!response.ok) {
        setPostMessage(postErrorMessage(response.status));
        setPending(isRetryableChatStatus(response.status) ? { ...intent, status: "retryable" } : null);
        return;
      }
      const message = parseViewerRuntimeMessage(await response.json());
      if (!message) {
        setPending({ ...intent, status: "retryable" });
        setPostMessage("留言送出狀態不確定，請重試。");
        return;
      }
      setViewerMessages((current) => mergeViewerMessages(current, [message]));
      setPending((current) => current?.clientMessageId === intent.clientMessageId ? null : current);
      setDraft((current) => current.normalize("NFKC").trim() === intent.body ? "" : current);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setPending({ ...intent, status: "retryable" });
      setPostMessage("留言暫時送不出去，請重試。");
    } finally {
      if (postControllerRef.current === controller) postControllerRef.current = null;
    }
  }, [admissionStatus, enabled, liveId, onAdmissionInvalid, paused, vendorId, viewer.canPost]);

  const submitDraft = useCallback(() => {
    const body = draft.normalize("NFKC").trim();
    if (!canPost || !body || Array.from(body).length > CHAT_BODY_MAX_LENGTH) return;
    const intent: PendingIntent = { clientMessageId: crypto.randomUUID(), body, status: "sending" };
    void sendIntent(intent);
  }, [canPost, draft, sendIntent]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submitDraft();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitDraft();
  }

  return (
    <section aria-label="直播聊天室" className="flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="直播留言"
        className="min-h-[13rem] flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {visibleScheduledMessages.length === 0 && viewerMessages.length === 0 && !pending ? (
          <p className="py-8 text-center text-sm text-white/55">直播開始後，留言會顯示在這裡。</p>
        ) : null}

        {visibleScheduledMessages.map((message) => (
          <article key={`scheduled:${message.id}`} className={message.actor.presentationRole === "official" ? "rounded-2xl border border-amber-300/30 bg-amber-300/10 p-3" : "rounded-2xl bg-white/5 p-3"}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-bold text-white/85">
                {message.actor.name}
                <span className="ml-2 text-white/55">{message.actor.label}</span>
                {message.actor.presentationRole === "official" ? <span className="ml-2 rounded-full border border-amber-200/40 px-2 py-0.5 text-[10px]">官方</span> : null}
              </span>
              <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/60">預設腳本</span>
            </div>
            <p className="mt-1 break-words text-sm leading-6 text-white/85">{message.body}</p>
          </article>
        ))}

        {viewerMessages.map((message) => (
          <article key={`viewer:${message.id}`} className="rounded-2xl bg-white/5 p-3">
            <span className="text-xs font-bold text-white/70">{message.actor.name}</span>
            <p className="mt-1 break-words text-sm leading-6 text-white/85">{message.body}</p>
          </article>
        ))}

        {pending ? (
          <article className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-3 opacity-80">
            <span className="text-xs font-bold text-white/70">{viewer.displayName ?? "我"}</span>
            <p className="mt-1 break-words text-sm leading-6 text-white/85">{pending.body}</p>
            <p className="mt-1 text-xs text-white/55">{pending.status === "sending" ? "傳送中…" : "尚未送出"}</p>
          </article>
        ) : null}
      </div>

      {pollMessage ? <p role={paused ? "alert" : "status"} className="mx-4 mb-2 rounded-xl bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{pollMessage}</p> : null}
      {postMessage ? <p role="alert" className="mx-4 mb-2 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{postMessage}</p> : null}

      {enabled ? (
        <form onSubmit={onSubmit} className="border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {admissionStatus !== "admitted" || paused ? (
            <p role="status" className="mb-2 text-xs text-white/65">直播連線尚未就緒，目前無法留言。</p>
          ) : !viewer.canPost ? (
            <p role="status" className="mb-2 text-xs text-white/65">{readonlyMessage(viewer.reason)}</p>
          ) : null}
          <label htmlFor="live-chat-message" className="sr-only">輸入直播留言</label>
          <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
            <textarea
              id="live-chat-message"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (!pending) setPostMessage(null);
              }}
              onKeyDown={onComposerKeyDown}
              disabled={!enabled || admissionStatus !== "admitted" || paused || !viewer.canPost || pending !== null}
              maxLength={CHAT_BODY_MAX_LENGTH}
              rows={2}
              placeholder="輸入留言…"
              className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-55"
            />
            {pending?.status === "retryable" ? (
              <div className="flex min-h-11 gap-2">
                <button type="button" onClick={() => void sendIntent(pending)} className="min-h-11 rounded-xl bg-amber-300 px-4 text-sm font-black text-slate-950">重試</button>
                <button
                  type="button"
                  onClick={() => {
                    setPending(null);
                    setPostMessage(null);
                  }}
                  className="min-h-11 rounded-xl border border-white/20 px-3 text-sm font-bold text-white"
                >
                  修改留言
                </button>
              </div>
            ) : (
              <button type="submit" disabled={!canPost || !draft.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-45">
                <Send className="h-4 w-4" aria-hidden="true" />
                {pending?.status === "sending" ? "送出中" : "送出"}
              </button>
            )}
          </div>
        </form>
      ) : null}
    </section>
  );
}
