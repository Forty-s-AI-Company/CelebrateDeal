"use client";

import { portalText } from "@/lib/student-portal-translations";
import type { StudentPortalLocale } from "@/lib/student-portal-locale";
import { useRef, useState, type FormEvent } from "react";
import type { CommunityMutationInput, getCourseCommunity, getCourseCommunityReplies } from "@/lib/course-community";
type Feed = NonNullable<Awaited<ReturnType<typeof getCourseCommunity>>>;
type Thread = NonNullable<Awaited<ReturnType<typeof getCourseCommunityReplies>>>;
const field = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2";
const button = "min-h-11 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50";
function DiscussionForm({
  postId,
  submit,
  locale
}: {
  locale: StudentPortalLocale;
  postId?: string;
  submit: (input: CommunityMutationInput) => Promise<boolean>;
}) {
  const t = (text: string) => portalText(locale, text);
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
      const content = {
        requestKey: key.current,
        authorName: String(data.get("authorName") ?? ""),
        body: String(data.get("body") ?? "")
      };
      const accepted = await submit(postId ? {
        operation: "reply",
        postId,
        ...content
      } : {
        operation: "post",
        ...content
      });
      if (accepted) {
        form.reset();
        key.current = null;
      }
    } finally {
      setPending(false);
    }
  };
  return <form aria-label={postId ? t("\u56DE\u8986\u8A0E\u8AD6") : t("\u767C\u5E03\u5FC3\u5F97")} onSubmit={onSubmit} className="mt-4 grid gap-3"><label>{t("\u986F\u793A\u540D\u7A31")}<input name="authorName" maxLength={60} required disabled={pending} className={field} /></label><label>{postId ? t("\u56DE\u8986\u5167\u5BB9") : t("\u5206\u4EAB\u5B78\u7FD2\u5FC3\u5F97")}<textarea name="body" maxLength={postId ? 2000 : 5000} required disabled={pending} className={`${field} min-h-24`} /></label><button disabled={pending} className={button}>{pending ? t("\u6B63\u5728\u9001\u51FA\u2026") : postId ? t("\u9001\u51FA\u56DE\u8986") : t("\u767C\u5E03\u5FC3\u5F97")}</button></form>;
}

/** Plain text remains escaped by React; request UUID is retained on failure so
 * retrying an uncertain response cannot duplicate a post or reply. */
export function CourseCommunity({
  endpoint,
  initialFeed,
  csrfToken,
  locale = "zh-TW"
}: {
  locale?: StudentPortalLocale;
  endpoint: string;
  initialFeed: Feed;
  csrfToken: string;
}) {
  const t = (text: string) => portalText(locale, text);
  const [feed, setFeed] = useState(initialFeed);
  const [thread, setThread] = useState<Thread | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const csrf = useRef(csrfToken);
  async function read(query = "") {
    const response = await fetch(`${endpoint}${query}`, {
      cache: "no-store",
      headers: {
        "x-celebratedeal-client": "web"
      }
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("unavailable");
    const data = await response.json();
    csrf.current = data.csrfToken;
    return data;
  }
  async function submit(input: CommunityMutationInput) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    const send = () => fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-celebratedeal-client": "web",
        "x-csrf-token": csrf.current
      },
      body: JSON.stringify(input)
    });
    try {
      let response = await send();
      if (response.status === 403) {
        await read();
        response = await send();
      }
      if (!response.ok) throw new Error(response.status === 409 ? "conflict" : "unavailable");
      // The write was acknowledged. A refresh failure must not turn it into an
      // uncertain mutation: clear this form's UUID and allow manual reload.
      try {
        // Refresh the already loaded range, rather than dropping later pages.
        const fresh: Feed = await read();
        while (fresh.nextCursor && fresh.posts.length < feed.posts.length + (input.operation === "post" ? 1 : 0)) {
          const next: Feed = await read(`?cursor=${encodeURIComponent(fresh.nextCursor)}`);
          fresh.posts.push(...next.posts);
          fresh.nextCursor = next.nextCursor;
        }
        setFeed(fresh);
        if (thread) {
          const current: Thread = await read(`?postId=${encodeURIComponent(thread.post.id)}`);
          const target = thread.replies.length + (input.operation === "reply" ? 1 : 0);
          while (current.nextCursor && current.replies.length < target) {
            const next: Thread = await read(`?postId=${encodeURIComponent(thread.post.id)}&cursor=${encodeURIComponent(current.nextCursor)}`);
            current.replies.push(...next.replies);
            current.nextCursor = next.nextCursor;
          }
          setThread(current);
        }
        setMessage(t("\u5DF2\u5132\u5B58\u3002"));
      } catch {
        setMessage(t("\u5167\u5BB9\u5DF2\u5132\u5B58\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u67E5\u770B\u6700\u65B0\u8A0E\u8AD6\u3002"));
      }
      return true;
    } catch (error) {
      setMessage(error instanceof Error && error.message === "conflict" ? t("\u9019\u6B21\u8ACB\u6C42\u5DF2\u4F7F\u7528\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u78BA\u8A8D\u5148\u524D\u5167\u5BB9\u3002") : t("\u7121\u6CD5\u9001\u51FA\uFF0C\u8ACB\u78BA\u8A8D\u767B\u5165\u8207\u8AB2\u7A0B\u6B0A\u76CA\u5F8C\u91CD\u8A66\u3002"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (busy || !feed.nextCursor) return;
    setBusy(true);
    try {
      const next: Feed = await read(`?cursor=${encodeURIComponent(feed.nextCursor)}`);
      setFeed(current => ({
        ...next,
        posts: [...current.posts, ...next.posts.filter(post => !current.posts.some(item => item.id === post.id))]
      }));
    } catch {
      setMessage(t("\u7121\u6CD5\u8F09\u5165\u66F4\u591A\u8A0E\u8AD6\u3002"));
    } finally {
      setBusy(false);
    }
  }
  async function openThread(postId: string, cursor?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const next: Thread = await read(`?postId=${encodeURIComponent(postId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      setThread(current => cursor && current?.post.id === postId ? {
        ...next,
        replies: [...current.replies, ...next.replies]
      } : next);
    } catch {
      setMessage(t("\u7121\u6CD5\u8F09\u5165\u9019\u5247\u8A0E\u8AD6\uFF0C\u8ACB\u78BA\u8A8D\u8AB2\u7A0B\u6B0A\u76CA\u3002"));
    } finally {
      setBusy(false);
    }
  }
  return <div className="mt-6 grid gap-5">{message ? <p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-900">{message}</p> : null}<section className="rounded-2xl bg-white p-5"><h2 className="text-xl font-bold">{t("\u767C\u5E03\u5FC3\u5F97")}</h2><DiscussionForm locale={locale} submit={submit} /></section>{feed.posts.length === 0 ? <p>{t("\u9084\u6C92\u6709\u8A0E\u8AD6\uFF0C\u6B61\u8FCE\u5206\u4EAB\u7B2C\u4E00\u5247\u5B78\u7FD2\u5FC3\u5F97\u3002")}</p> : null}{feed.posts.map(post => <article key={post.id} className="rounded-2xl bg-white p-5"><h2 className="font-bold">{post.authorName}{post.isAnnouncement ? t(" \xB7 \u516C\u544A") : ""}{post.isPinned ? t(" \xB7 \u7F6E\u9802") : ""}</h2><p className="mt-3 whitespace-pre-wrap break-words">{post.body}</p><div className="mt-4 flex flex-wrap gap-3"><button disabled={busy} className="min-h-11 rounded-xl border px-3" onClick={() => void submit({
          operation: "reaction",
          postId: post.id,
          liked: !post.liked
        })}>{post.liked ? t("\u53D6\u6D88\u8B9A") : t("\u8B9A")}（{post.likeCount}）</button><button disabled={busy} className="min-h-11 rounded-xl border px-3" onClick={() => void openThread(post.id)}>{t("\u67E5\u770B\u8A0E\u8AD6\uFF08")}{post.replyCount}）</button></div>{post.replies.slice().reverse().map(reply => <p key={reply.id} className="mt-3 border-l-2 pl-3"><strong>{reply.authorName}</strong>：{reply.body}</p>)}</article>)}{feed.nextCursor ? <button disabled={busy} className={button} onClick={() => void more()}>{t("\u8F09\u5165\u66F4\u591A\u5FC3\u5F97")}</button> : null}{thread ? <section aria-label={t("\u5B8C\u6574\u8A0E\u8AD6")} className="rounded-2xl border border-blue-200 bg-white p-5"><h2 className="text-xl font-bold">{thread.post.authorName}{t("\u7684\u8A0E\u8AD6")}</h2><p className="mt-3 whitespace-pre-wrap break-words">{thread.post.body}</p>{thread.replies.map(reply => <article key={reply.id} className="mt-4 border-t pt-4"><h3 className="font-bold">{reply.authorName}</h3><p className="mt-2 whitespace-pre-wrap break-words">{reply.body}</p></article>)}{thread.nextCursor ? <button disabled={busy} className={`${button} mt-4`} onClick={() => void openThread(thread.post.id, thread.nextCursor ?? undefined)}>{t("\u8F09\u5165\u66F4\u591A\u56DE\u8986")}</button> : null}<DiscussionForm locale={locale} key={thread.post.id} postId={thread.post.id} submit={submit} /><button className="mt-4 min-h-11 underline" onClick={() => setThread(null)}>{t("\u95DC\u9589\u8A0E\u8AD6")}</button></section> : null}</div>;
}
