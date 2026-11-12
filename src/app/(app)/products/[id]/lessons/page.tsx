import { notFound } from "next/navigation";
import { FormSubmitButton } from "@/components/form-submit-button";
import { renameCourseChapterAction, saveCourseLessonAction } from "@/app/actions/course-curriculum-actions";
import { CsrfField } from "@/components/csrf-field";
import { ButtonLink, Field, FormErrorSummary, PageHeader, SubmitButton } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { legacyChapterTitle } from "@/lib/course-learning";
import { getDb } from "@/lib/db";
import { requireFeatureOrNotFound } from "@/lib/feature-gates";

const CHAPTER_ERRORS: Record<string, string> = {
  invalid: "章節名稱需要 1 到 120 個字。",
  duplicate: "這門課已經有同名的章節，請換一個名稱。",
};

export default async function CourseLessonsPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; chapterError?: string; chapter?: string; chapterSaved?: string }>;
}) {
  const vendor = await requireVendorManager();
  requireFeatureOrNotFound(vendor, "courses");
  const { id } = await params;
  const query = await searchParams;
  const product = await getDb().product.findFirst({
    where: { id, vendorId: vendor.id, fulfillmentType: "course" },
    include: {
      courseLessons: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      // Manager order is the chapter's own position (F-5); the learner player keeps
      // ordering chapters by their first published lesson (see courseChapters).
      courseChapters: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, title: true } },
    },
  });
  if (!product) notFound();
  type Lesson = (typeof product.courseLessons)[number];
  const chapters = product.courseChapters.map((chapter) => ({ ...chapter, lessons: product.courseLessons.filter((lesson) => lesson.chapterId === chapter.id) }));
  // Lessons written by code older than F-5 have no chapter yet; saving them links them.
  const unlinked = new Map<string, Lesson[]>();
  for (const lesson of product.courseLessons) {
    if (lesson.chapterId && chapters.some((chapter) => chapter.id === lesson.chapterId)) continue;
    const title = legacyChapterTitle(lesson.chapterTitle);
    unlinked.set(title, [...(unlinked.get(title) ?? []), lesson]);
  }
  const chapterError = query.chapterError ? CHAPTER_ERRORS[query.chapterError] ?? CHAPTER_ERRORS.invalid : null;

  const lessonForm = (lesson: Lesson | null) => <form key={lesson?.id ?? "new"} action={saveCourseLessonAction} className="space-y-4 rounded-xl border bg-white p-5">
    <h3 className="text-lg font-bold">{lesson ? `單元 ${lesson.position + 1}` : "新增單元"}</h3>
    <CsrfField /><input type="hidden" name="productId" value={id} /><input type="hidden" name="revision" value={product.revision} />
    {lesson ? <input type="hidden" name="lessonId" value={lesson.id} /> : null}
    <label className="block">章節<input className="mt-1 block w-full rounded border p-2" name="chapterTitle" required maxLength={120} defaultValue={lesson?.chapterTitle ?? ""} /></label>
    <label className="block">單元名稱<input className="mt-1 block w-full rounded border p-2" name="title" required maxLength={180} defaultValue={lesson?.title ?? ""} /></label>
    <label className="block">影片網址<input className="mt-1 block w-full rounded border p-2" name="videoUrl" type="url" maxLength={2048} placeholder="https://" defaultValue={lesson?.videoUrl ?? ""} /></label>
    <label className="block">影片秒數<input className="mt-1 block w-full rounded border p-2" name="durationSeconds" type="number" required min={0} max={86400} step={1} defaultValue={lesson?.durationSeconds ?? 0} /></label>
    <label className="flex gap-2"><input name="published" type="checkbox" defaultChecked={Boolean(lesson?.publishedAt)} />發布，讓有權益的學員可以學習</label>
    <FormSubmitButton pendingChildren="儲存中…" pendingMessage="正在儲存，請勿重複送出。" className="min-h-11 rounded bg-blue-700 px-4 py-2 font-semibold text-white">{lesson ? "儲存單元" : "新增單元"}</FormSubmitButton>
  </form>;

  return <>
    <PageHeader title={`${product.name}：課程內容`} description="單元依章節分組。新增單元並發布後，具有購買權益的學員即可從學員中心學習。取消發布會停止該單元的存取，已存進度會保留。" action={<ButtonLink href={`/products/${encodeURIComponent(id)}/edit`} tone="secondary">回到商品</ButtonLink>} />
    {query.error ? <p role="alert" className="mb-4 text-red-700">{query.error === "conflict" ? "內容已變更或無法存取，請重新整理後再儲存。" : "請確認章節、名稱、影片網址與秒數；發布單元必須提供 HTTPS 影片。"}</p> : null}
    {query.saved ? <p role="status" className="mb-4 text-green-700">課程單元已儲存。</p> : null}
    {query.chapterSaved ? <p role="status" className="mb-4 text-green-700">章節名稱已更新，學員端會看到新名稱。</p> : null}
    <div className="mb-5"><ButtonLink href={`/products/${encodeURIComponent(id)}/community`} tone="secondary">學員討論管理</ButtonLink></div>
    <div className="space-y-8">
      {chapters.map((chapter) => {
        const error = query.chapter === chapter.id ? chapterError : null;
        return <section key={chapter.id} id={`chapter-${chapter.id}`} aria-labelledby={`chapter-heading-${chapter.id}`} className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2">
            <h2 id={`chapter-heading-${chapter.id}`} className="text-xl font-semibold text-slate-950 [overflow-wrap:anywhere]">{chapter.title}</h2>
            <span className="text-sm text-slate-600">{chapter.lessons.length} 個單元</span>
          </div>
          <details open={Boolean(error)} className="rounded-md border border-border bg-white">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">重新命名章節</summary>
            <form action={renameCourseChapterAction} className="grid gap-3 border-t border-border p-4">
              <FormErrorSummary message={error ? "章節名稱沒有更新。" : null} errors={{ title: error }} />
              <CsrfField /><input type="hidden" name="productId" value={id} /><input type="hidden" name="chapterId" value={chapter.id} /><input type="hidden" name="revision" value={product.revision} />
              <Field label="章節名稱" name="title" defaultValue={chapter.title} required maxLength={120} error={error} hint="這個章節的所有單元會一起改名，學員的學習進度不受影響。" />
              <div><SubmitButton>儲存章節名稱</SubmitButton></div>
            </form>
          </details>
          {chapter.lessons.length ? chapter.lessons.map(lessonForm) : <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-slate-600">這個章節目前沒有單元，學員端不會顯示。</p>}
        </section>;
      })}
      {[...unlinked].map(([title, lessons]) => <section key={`unlinked:${title}`} aria-labelledby={`unlinked-${lessons[0]!.id}`} className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 id={`unlinked-${lessons[0]!.id}`} className="text-xl font-semibold text-slate-950 [overflow-wrap:anywhere]">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">這些單元還沒有對應的章節，儲存單元後會自動歸入同名章節。</p>
        </div>
        {lessons.map(lessonForm)}
      </section>)}
      <section aria-label="新增單元">{lessonForm(null)}</section>
    </div>
  </>;
}
