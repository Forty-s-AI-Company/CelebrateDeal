import { notFound } from "next/navigation";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CsrfField } from "@/components/csrf-field";
import { ButtonLink, PageHeader } from "@/components/ui";
import { moderateCourseCommunityAction } from "@/app/actions/course-community-actions";

/** This bounded management feed never returns learner identity hashes. */
export default async function CourseCommunityManagement({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ cursor?: string; saved?: string; error?: string }>;
}) {
  const vendor = await requireVendorManager();
  const { id } = await params; const query = await searchParams;
  const course = await getDb().product.findFirst({ where: { id, vendorId: vendor.id, fulfillmentType: "course" }, select: { name: true } });
  if (!course) notFound();
  const where = { vendorId: vendor.id, productId: id };
  const anchor = query.cursor ? await getDb().courseCommunityPost.findFirst({ where: { ...where, id: query.cursor }, select: { id: true, createdAt: true } }) : null;
  if (query.cursor && !anchor) notFound();
  const posts = await getDb().courseCommunityPost.findMany({ where: { ...where, ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, select: { id: true, revision: true, authorName: true, body: true, isPinned: true, isAnnouncement: true, hiddenAt: true } });
  return <>
    <PageHeader title={`${course.name}：學員討論管理`} description="將學員心得設為置頂或公告，也可以隱藏不適合公開的內容。" action={<ButtonLink href={`/products/${encodeURIComponent(id)}/lessons`} tone="secondary">回到課程</ButtonLink>} />
    {query.saved ? <p role="status">討論設定已儲存。</p> : null}{query.error ? <p role="alert">內容已變更或無法更新，請重新整理後再試。</p> : null}
    {posts.slice(0,20).map(post => <form key={post.id} aria-label={`管理 ${post.authorName}`} action={moderateCourseCommunityAction} className="mb-5 space-y-4 rounded-xl border bg-white p-5">
      <CsrfField /><input type="hidden" name="productId" value={id} /><input type="hidden" name="postId" value={post.id} /><input type="hidden" name="expectedRevision" value={post.revision} />
      <h2 className="font-bold">{post.authorName}</h2><p className="whitespace-pre-wrap break-words">{post.body}</p>
      <label className="mr-4"><input type="checkbox" name="isPinned" defaultChecked={post.isPinned} />置頂</label>
      <label className="mr-4"><input type="checkbox" name="isAnnouncement" defaultChecked={post.isAnnouncement} />公告</label>
      <label><input type="checkbox" name="hidden" defaultChecked={Boolean(post.hiddenAt)} />隱藏</label>
      <button className="block rounded bg-blue-700 px-4 py-2 text-white">儲存討論設定</button>
    </form>)}
    {posts.length > 20 ? <ButtonLink href={`/products/${encodeURIComponent(id)}/community?cursor=${encodeURIComponent(posts[19]!.id)}`}>下一頁討論</ButtonLink> : null}
  </>;
}
