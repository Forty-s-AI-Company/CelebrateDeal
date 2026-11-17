import { notFound } from "next/navigation";
import { FormSubmitButton } from "@/components/form-submit-button";
import { deleteCourseChapterAction, moveCourseChapterAction, moveCourseLessonAction, renameCourseChapterAction, saveCourseLessonAction } from "@/app/actions/course-curriculum-actions";
import { CsrfField } from "@/components/csrf-field";
import { ButtonLink, DangerButton, Field, FormErrorSummary, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { lessonChapterTitle, managerChapterGroups } from "@/lib/course-learning";
import { getDb } from "@/lib/db";
import { requireFeatureOrNotFound } from "@/lib/feature-gates";

const CHAPTER_ERRORS: Record<string, string> = {
  invalid: "章節名稱需要 1 到 120 個字。",
  duplicate: "這門課已經有同名的章節，請換一個名稱。",
  notEmpty: "這個章節還有單元，請先把單元搬到其他章節，再刪除章節。",
};

export default async function CourseLessonsPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; chapterError?: string; chapter?: string; chapterSaved?: string; chapterMoved?: string; chapterDeleted?: string; lessonMoved?: string }>;
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
  // Same membership rule as the learner player (lessonChapterTitle): a lesson sits
  // under the chapter its chapterTitle names, whatever its chapterId says. Lessons
  // whose title names no chapter row yet (pre-F-5 writes) are listed after.
  const { chapters, unlinked } = managerChapterGroups(product.courseChapters, product.courseLessons);
  const chapterError = query.chapterError ? CHAPTER_ERRORS[query.chapterError] ?? CHAPTER_ERRORS.invalid : null;

  const lessonForm = (lesson: Lesson | null) => <form key={lesson?.id ?? "new"} action={saveCourseLessonAction} aria-labelledby={lesson ? undefined : "new-lesson-heading"} className="space-y-4 rounded-xl border bg-white p-5">
    {lesson ? <h3 className="text-lg font-bold">{`單元 ${lesson.position + 1}`}</h3> : null}
    <CsrfField /><input type="hidden" name="productId" value={id} /><input type="hidden" name="revision" value={product.revision} />
    {lesson ? <input type="hidden" name="lessonId" value={lesson.id} /> : null}
    <label className="block">章節<input className="mt-1 block w-full rounded border p-2" name="chapterTitle" required maxLength={120} defaultValue={lesson?.chapterTitle ?? ""} /></label>
    <label className="block">單元名稱<input className="mt-1 block w-full rounded border p-2" name="title" required maxLength={180} defaultValue={lesson?.title ?? ""} /></label>
    <label className="block">影片網址<input className="mt-1 block w-full rounded border p-2" name="videoUrl" type="url" maxLength={2048} placeholder="https://" defaultValue={lesson?.videoUrl ?? ""} /></label>
    <label className="block">影片秒數<input className="mt-1 block w-full rounded border p-2" name="durationSeconds" type="number" required min={0} max={86400} step={1} defaultValue={lesson?.durationSeconds ?? 0} /></label>
    <label className="flex gap-2"><input name="published" type="checkbox" defaultChecked={Boolean(lesson?.publishedAt)} />發布，讓有權益的學員可以學習</label>
    <FormSubmitButton pendingChildren="儲存中…" pendingMessage="正在儲存，請勿重複送出。" className="min-h-11 rounded bg-blue-700 px-4 py-2 font-semibold text-white">{lesson ? "儲存單元" : "新增單元"}</FormSubmitButton>
  </form>;

  const moveForm = (lesson: Lesson) => {
    const targets = chapters.filter((chapter) => chapter.title !== lessonChapterTitle(lesson));
    if (!targets.length) return null;
    return <form action={moveCourseLessonAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed bg-white p-4">
      <CsrfField /><input type="hidden" name="productId" value={id} /><input type="hidden" name="revision" value={product.revision} /><input type="hidden" name="lessonId" value={lesson.id} />
      <SelectField label={`把「${lesson.title}」搬到章節`} name="targetChapterId" defaultValue={targets[0]!.id} hint="會放在該章節的最後面，學習進度不受影響。">
        {targets.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
      </SelectField>
      <SubmitButton pendingChildren="搬移中…" pendingMessage="正在搬移，請勿重複送出。">搬移單元</SubmitButton>
    </form>;
  };
  const lessonBlock = (lesson: Lesson) => <div key={lesson.id} className="space-y-2">{lessonForm(lesson)}{moveForm(lesson)}</div>;

  return <>
    <PageHeader title={`${product.name}：課程內容`} description="單元依章節分組。新增單元並發布後，具有購買權益的學員即可從學員中心學習。取消發布會停止該單元的存取，已存進度會保留。" action={<ButtonLink href={`/products/${encodeURIComponent(id)}/edit`} tone="secondary">回到商品</ButtonLink>} />
    {query.error ? <p role="alert" className="mb-4 text-red-700">{query.error === "conflict" ? "內容已變更或無法存取，請重新整理後再儲存。" : "請確認章節、名稱、影片網址與秒數；發布單元必須提供 HTTPS 影片。"}</p> : null}
    {query.saved ? <p role="status" className="mb-4 text-green-700">課程單元已儲存。</p> : null}
    {query.chapterSaved ? <p role="status" className="mb-4 text-green-700">章節名稱已更新，學員端會看到新名稱。</p> : null}
    {query.chapterMoved ? <p role="status" className="mb-4 text-green-700">章節順序已更新，學員端會依新順序顯示。</p> : null}
    {query.chapterDeleted ? <p role="status" className="mb-4 text-green-700">空章節已刪除。</p> : null}
    {query.lessonMoved ? <p role="status" className="mb-4 text-green-700">單元已搬到新章節，學習進度不變。</p> : null}
    <div className="mb-5"><ButtonLink href={`/products/${encodeURIComponent(id)}/community`} tone="secondary">學員討論管理</ButtonLink></div>
    <div className="space-y-8">
      {chapters.map((chapter, index) => {
        const error = query.chapter === chapter.id ? chapterError : null;
        return <section key={chapter.id} id={`chapter-${chapter.id}`} aria-labelledby={`chapter-heading-${chapter.id}`} className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2">
            <h2 id={`chapter-heading-${chapter.id}`} className="text-xl font-semibold text-slate-950 [overflow-wrap:anywhere]">{chapter.title}</h2>
            <span className="text-sm text-slate-600">{chapter.lessons.length} 個單元</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[{ direction: "up", label: "上移", disabled: index === 0 }, { direction: "down", label: "下移", disabled: index === chapters.length - 1 }].map((step) => <form key={step.direction} action={moveCourseChapterAction}>
              <CsrfField /><input type="hidden" name="productId" value={id} /><input type="hidden" name="chapterId" value={chapter.id} /><input type="hidden" name="revision" value={product.revision} /><input type="hidden" name="direction" value={step.direction} />
              <FormSubmitButton disabled={step.disabled} aria-label={`${step.label}章節「${chapter.title}」`} pendingChildren="移動中…" pendingMessage="正在移動，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{step.label}</FormSubmitButton>
            </form>)}
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
          {chapter.lessons.length ? null : <form action={deleteCourseChapterAction} className="flex flex-wrap items-center gap-3">
            <CsrfField /><input type="hidden" name="productId" value={id} /><input type="hidden" name="chapterId" value={chapter.id} /><input type="hidden" name="revision" value={product.revision} />
            <DangerButton>刪除空章節</DangerButton>
            <span className="text-sm text-slate-600">只能刪除沒有單元的章節；刪除不影響任何單元或學習進度。</span>
          </form>}
          {chapter.lessons.length ? chapter.lessons.map(lessonBlock) : <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-slate-600">這個章節目前沒有單元，學員端不會顯示。</p>}
        </section>;
      })}
      {unlinked.map(({ title, lessons }) => <section key={`unlinked:${title}`} aria-labelledby={`unlinked-${lessons[0]!.id}`} className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 id={`unlinked-${lessons[0]!.id}`} className="text-xl font-semibold text-slate-950 [overflow-wrap:anywhere]">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">這些單元還沒有對應的章節，儲存單元後會自動歸入同名章節。</p>
        </div>
        {lessons.map(lessonBlock)}
      </section>)}
      <section aria-labelledby="new-lesson-heading" className="space-y-4">
        <h2 id="new-lesson-heading" className="border-b border-border pb-2 text-xl font-semibold text-slate-950">新增單元</h2>
        {lessonForm(null)}
      </section>
    </div>
  </>;
}
