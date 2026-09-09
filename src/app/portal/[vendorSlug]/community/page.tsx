import Link from "next/link";
import { notFound } from "next/navigation";
import { createCommunityCommentAction, createCommunityPostAction, toggleCommunityLikeAction } from "@/app/actions/community-actions";
import { CsrfField } from "@/components/csrf-field";
import { requirePaidCommunityMember } from "@/lib/community";
import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

export const dynamic = "force-dynamic";

export default async function CommunityPage({ params, searchParams }: {
  params: Promise<{ vendorSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { vendorSlug } = await params;
  const { session, vendor } = await requireStudentPortalSession(vendorSlug);
  const db = getDb();
  try { await requirePaidCommunityMember(db, session); } catch { notFound(); }
  const query = await searchParams ?? {};
  const postId = query.post;
  const beforeId = query.before;
  // A cursor belongs to one tenant-qualified post; never accept an arbitrary offset.
  const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
  if ((postId !== undefined && !validId(postId)) || (beforeId !== undefined && (!validId(beforeId) || !postId))) notFound();
  const cursor = beforeId ? await db.communityComment.findFirst({
    where: { id: beforeId, postId: postId as string, vendorId: session.vendorId },
    select: { id: true, createdAt: true },
  }) : null;
  if (beforeId && !cursor) notFound();
  const commentWhere = {
    vendorId: session.vendorId,
    ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
  };
  const posts = await db.communityPost.findMany({
    where: { vendorId: session.vendorId, ...(postId ? { id: postId as string } : {}) }, orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }], take: 50,
    include: {
      comments: { where: commentWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 },
      _count: { select: { comments: { where: commentWhere } } },
      reactions: { select: { customerKeyHash: true } },
    },
  });
  if (postId && posts.length === 0) notFound();

  return <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-4xl">
      <Link href={`/portal/${encodeURIComponent(vendorSlug)}`} className="text-sm font-bold text-blue-700">← 返回學員中心</Link>
      <header className="mt-5"><p className="text-sm font-bold text-blue-700">{vendor.name}</p><h1 className="mt-1 text-3xl font-black tracking-tight">學員交流社群</h1><p className="mt-2 text-slate-600">分享進度、提問，也替一起努力的同學按個讚。</p></header>
      <form action={createCommunityPostAction} className="mt-7 rounded-2xl bg-white p-5 shadow-sm">
        <CsrfField/><input type="hidden" name="vendorSlug" value={vendorSlug}/>
        <label htmlFor="community-author" className="text-sm font-bold">顯示名稱</label><input id="community-author" name="authorName" maxLength={60} required className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3"/>
        <label htmlFor="community-body" className="mt-4 block text-sm font-bold">今天學到了什麼？</label><textarea id="community-body" name="body" maxLength={5000} required rows={4} className="mt-2 w-full rounded-xl border border-slate-300 p-3"/>
        <button className="mt-3 min-h-11 rounded-xl bg-blue-700 px-5 font-bold text-white">發布心得</button>
      </form>
      <section className="mt-7 space-y-4" aria-label="社群貼文">{posts.map((post) => <article key={post.id} className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{post.authorName}</h2>{post.isPinned ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">置頂精華</span> : null}{post.isAnnouncement ? <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-900">公告</span> : null}</div>
        <p className="mt-3 whitespace-pre-wrap break-words leading-7">{post.body}</p>
        <form action={toggleCommunityLikeAction} className="mt-4"><CsrfField/><input type="hidden" name="vendorSlug" value={vendorSlug}/><input type="hidden" name="postId" value={post.id}/><button className="min-h-10 rounded-full border border-slate-300 px-3 text-sm font-bold">{post.reactions.some((reaction) => reaction.customerKeyHash === session.customerKeyHash) ? "已讚" : "讚"} · {post.reactions.length}</button></form>
        <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">{[...post.comments].reverse().map((comment) => <div key={comment.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm font-bold">{comment.authorName}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{comment.body}</p></div>)}</div>
        <nav aria-label="留言分頁" className="mt-3 flex flex-wrap gap-4 text-sm font-bold text-blue-700">
          {post._count.comments > post.comments.length && post.comments.length > 0 ? <Link href={`/portal/${encodeURIComponent(vendorSlug)}/community?post=${encodeURIComponent(post.id)}&before=${encodeURIComponent(post.comments[post.comments.length - 1]!.id)}`}>較舊留言</Link> : null}
          {beforeId ? <Link href={`/portal/${encodeURIComponent(vendorSlug)}/community?post=${encodeURIComponent(post.id)}`}>返回最新留言</Link> : null}
          {postId ? <Link href={`/portal/${encodeURIComponent(vendorSlug)}/community`}>所有貼文</Link> : null}
        </nav>
        <form action={createCommunityCommentAction} className="mt-3 flex flex-col gap-2 sm:flex-row"><CsrfField/><input type="hidden" name="vendorSlug" value={vendorSlug}/><input type="hidden" name="postId" value={post.id}/><input name="authorName" maxLength={60} required placeholder="顯示名稱" className="min-h-11 rounded-xl border border-slate-300 px-3 sm:w-36"/><input name="body" maxLength={2000} required placeholder="寫下回覆…" className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3"/><button className="min-h-11 rounded-xl bg-slate-900 px-4 font-bold text-white">回覆</button></form>
      </article>)}</section>
    </div>
  </main>;
}
