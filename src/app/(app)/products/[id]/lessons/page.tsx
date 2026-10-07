import { notFound } from "next/navigation";
import { saveCourseLessonAction } from "@/app/actions/course-curriculum-actions";
import { CsrfField } from "@/components/csrf-field";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function CourseLessonsPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const query = await searchParams;
  const product = await getDb().product.findFirst({ where: { id, vendorId: vendor.id, fulfillmentType: "course" }, include: { courseLessons: { orderBy: { position: "asc" } } } });
  if (!product) notFound();
  const lessons = [...product.courseLessons, null];
  return <>
    <PageHeader title={`${product.name}：課程內容`} description="新增單元並發布後，具有購買權益的學員即可從學員中心學習。取消發布會停止該單元的存取，已存進度會保留。" action={<ButtonLink href={`/products/${encodeURIComponent(id)}/edit`} tone="secondary">回到商品</ButtonLink>} />
    {query.error ? <p role="alert" className="mb-4 text-red-700">{query.error === "conflict" ? "內容已變更或無法存取，請重新整理後再儲存。" : "請確認章節、名稱、影片網址與秒數；發布單元必須提供 HTTPS 影片。"}</p> : null}
    {query.saved ? <p role="status" className="mb-4 text-green-700">課程單元已儲存。</p> : null}
    <div className="space-y-5">{lessons.map((lesson) => <form key={lesson?.id ?? "new"} action={saveCourseLessonAction} className="space-y-4 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-bold">{lesson ? `單元 ${lesson.position + 1}` : "新增單元"}</h2>
      <CsrfField /><input type="hidden" name="productId" value={id} /><input type="hidden" name="revision" value={product.revision} />
      {lesson ? <input type="hidden" name="lessonId" value={lesson.id} /> : null}
      <label className="block">章節<input className="mt-1 block w-full rounded border p-2" name="chapterTitle" required maxLength={120} defaultValue={lesson?.chapterTitle ?? ""} /></label>
      <label className="block">單元名稱<input className="mt-1 block w-full rounded border p-2" name="title" required maxLength={180} defaultValue={lesson?.title ?? ""} /></label>
      <label className="block">影片網址<input className="mt-1 block w-full rounded border p-2" name="videoUrl" type="url" maxLength={2048} placeholder="https://" defaultValue={lesson?.videoUrl ?? ""} /></label>
      <label className="block">影片秒數<input className="mt-1 block w-full rounded border p-2" name="durationSeconds" type="number" required min={0} max={86400} step={1} defaultValue={lesson?.durationSeconds ?? 0} /></label>
      <label className="flex gap-2"><input name="published" type="checkbox" defaultChecked={Boolean(lesson?.publishedAt)} />發布，讓有權益的學員可以學習</label>
      <button type="submit" className="rounded bg-blue-700 px-4 py-2 font-semibold text-white">{lesson ? "儲存單元" : "新增單元"}</button>
    </form>)}</div>
  </>;
}
