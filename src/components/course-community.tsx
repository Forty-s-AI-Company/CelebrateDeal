"use client";

import { useRef, useState, type FormEvent } from "react";
import type { CommunityMutationInput, getCourseCommunity, getCourseCommunityReplies } from "@/lib/course-community";

type Feed = NonNullable<Awaited<ReturnType<typeof getCourseCommunity>>>;
type Thread = NonNullable<Awaited<ReturnType<typeof getCourseCommunityReplies>>>;
const field = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2";
const button = "min-h-11 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50";

function DiscussionForm({ postId, submit }: { postId?: string; submit: (input: CommunityMutationInput) => Promise<boolean> }) {
  const [pending, setPending] = useState(false);
  const key = useRef<string | null>(null);
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    key.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const content = { requestKey: key.current, authorName: String(data.get("authorName") ?? ""), body: String(data.get("body") ?? "") };
      const accepted = await submit(postId ? { operation: "reply", postId, ...content } : { operation: "post", ...content });
      if (accepted) { form.reset(); key.current = null; }
    } finally { setPending(false); }
  };
  return <form aria-label={postId ? "回覆討論" : "發布心得"} onSubmit={onSubmit} className="mt-4 grid gap-3"><label>顯示名稱<input name="authorName" maxLength={60} required disabled={pending} className={field} /></label><label>{postId ? "回覆內容" : "分享學習心得"}<textarea name="body" maxLength={postId ? 2000 : 5000} required disabled={pending} className={`${field} min-h-24`} /></label><button disabled={pending} className={button}>{pending ? "正在送出…" : postId ? "送出回覆" : "發布心得"}</button></form>;
}

/** Plain text remains escaped by React; request UUID is retained on failure so
 * retrying an uncertain response cannot duplicate a post or reply. */
export function CourseCommunity({ endpoint, initialFeed, csrfToken }: { endpoint: string; initialFeed: Feed; csrfToken: string }) {
  const [feed, setFeed] = useState(initialFeed);
  const [thread, setThread] = useState<Thread | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const csrf = useRef(csrfToken);
  async function read(query = "") {
    const response = await fetch(`${endpoint}${query}`, { cache: "no-store", headers: { "x-celebratedeal-client": "web" } });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("unavailable");
    const data = await response.json(); csrf.current = data.csrfToken; return data;
  }
  async function submit(input: CommunityMutationInput) {
    if (busy) return false;
    setBusy(true); setMessage("");
    const send = () => fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-celebratedeal-client": "web", "x-csrf-token": csrf.current }, body: JSON.stringify(input) });
    try {
      let response = await send();
      if (response.status === 403) { await read(); response = await send(); }
      if (!response.ok) throw new Error(response.status === 409 ? "conflict" : "unavailable");
      // The write was acknowledged. A refresh failure must not turn it into an
      // uncertain mutation: clear this form's UUID and allow manual reload.
      try {
        // Refresh the already loaded range, rather than dropping later pages.
        const fresh: Feed = await read();
        while (fresh.nextCursor && fresh.posts.length < feed.posts.length + (input.operation === "post" ? 1 : 0)) {
          const next: Feed = await read(`?cursor=${encodeURIComponent(fresh.nextCursor)}`);
          fresh.posts.push(...next.posts); fresh.nextCursor = next.nextCursor;
        }
        setFeed(fresh);
        if (thread) {
          const current: Thread = await read(`?postId=${encodeURIComponent(thread.post.id)}`);
          const target = thread.replies.length + (input.operation === "reply" ? 1 : 0);
          while (current.nextCursor && current.replies.length < target) {
            const next: Thread = await read(`?postId=${encodeURIComponent(thread.post.id)}&cursor=${encodeURIComponent(current.nextCursor)}`);
            current.replies.push(...next.replies); current.nextCursor = next.nextCursor;
          }
          setThread(current);
        }
        setMessage("已儲存。");
      } catch { setMessage("內容已儲存，請重新整理查看最新討論。"); }
      return true;
    } catch (error) { setMessage(error instanceof Error && error.message === "conflict" ? "這次請求已使用，請重新整理確認先前內容。" : "無法送出，請確認登入與課程權益後重試。"); return false; }
    finally { setBusy(false); }
  }
  async function more() {
    if (busy || !feed.nextCursor) return;
    setBusy(true);
    try { const next: Feed = await read(`?cursor=${encodeURIComponent(feed.nextCursor)}`); setFeed((current) => ({ ...next, posts: [...current.posts, ...next.posts.filter((post) => !current.posts.some((item) => item.id === post.id))] })); }
    catch { setMessage("無法載入更多討論。"); } finally { setBusy(false); }
  }
  async function openThread(postId: string, cursor?: string) {
    if (busy) return;
    setBusy(true);
    try { const next: Thread = await read(`?postId=${encodeURIComponent(postId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); setThread((current) => cursor && current?.post.id === postId ? { ...next, replies: [...current.replies, ...next.replies] } : next); }
    catch { setMessage("無法載入這則討論，請確認課程權益。"); } finally { setBusy(false); }
  }
  return <div className="mt-6 grid gap-5">{message ? <p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-900">{message}</p> : null}<section className="rounded-2xl bg-white p-5"><h2 className="text-xl font-bold">發布心得</h2><DiscussionForm submit={submit} /></section>{feed.posts.length === 0 ? <p>還沒有討論，歡迎分享第一則學習心得。</p> : null}{feed.posts.map((post) => <article key={post.id} className="rounded-2xl bg-white p-5"><h2 className="font-bold">{post.authorName}{post.isAnnouncement ? " · 公告" : ""}{post.isPinned ? " · 置頂" : ""}</h2><p className="mt-3 whitespace-pre-wrap break-words">{post.body}</p><div className="mt-4 flex flex-wrap gap-3"><button disabled={busy} className="min-h-11 rounded-xl border px-3" onClick={() => void submit({ operation: "reaction", postId: post.id, liked: !post.liked })}>{post.liked ? "取消讚" : "讚"}（{post.likeCount}）</button><button disabled={busy} className="min-h-11 rounded-xl border px-3" onClick={() => void openThread(post.id)}>查看討論（{post.replyCount}）</button></div>{post.replies.slice().reverse().map((reply) => <p key={reply.id} className="mt-3 border-l-2 pl-3"><strong>{reply.authorName}</strong>：{reply.body}</p>)}</article>)}{feed.nextCursor ? <button disabled={busy} className={button} onClick={() => void more()}>載入更多心得</button> : null}{thread ? <section aria-label="完整討論" className="rounded-2xl border border-blue-200 bg-white p-5"><h2 className="text-xl font-bold">{thread.post.authorName}的討論</h2><p className="mt-3 whitespace-pre-wrap break-words">{thread.post.body}</p>{thread.replies.map((reply) => <article key={reply.id} className="mt-4 border-t pt-4"><h3 className="font-bold">{reply.authorName}</h3><p className="mt-2 whitespace-pre-wrap break-words">{reply.body}</p></article>)}{thread.nextCursor ? <button disabled={busy} className={`${button} mt-4`} onClick={() => void openThread(thread.post.id, thread.nextCursor ?? undefined)}>載入更多回覆</button> : null}<DiscussionForm key={thread.post.id} postId={thread.post.id} submit={submit} /><button className="mt-4 min-h-11 underline" onClick={() => setThread(null)}>關閉討論</button></section> : null}</div>;
}
