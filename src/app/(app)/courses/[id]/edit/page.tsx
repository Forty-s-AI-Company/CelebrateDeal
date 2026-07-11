import { notFound, redirect } from "next/navigation";
import { ExternalLink, Users } from "lucide-react";
import { upsertCourseLessonAction, upsertCourseSessionAction } from "@/app/actions";
import { CourseForm } from "@/components/course-form";
import { CsrfField } from "@/components/csrf-field";
import { Badge, ButtonLink, Card, Field, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageCourses } from "@/lib/vendor-capabilities";

const errorMessages: Record<string, string> = {
  publication_incomplete: "發布前需要綁定報名表，並至少有一個已發布單元或未取消場次。",
  ownership_mismatch: "選擇的影片、直播、商品或表單不屬於目前工作區。",
  conflict: "排序或 Slug 已被使用，請調整後重試。",
  invalid_lesson: "單元內容格式不正確。",
  invalid_session: "場次時間或容量格式不正確。",
};

function localDateTime(value: Date | null) {
  if (!value) return "";
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default async function EditCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const [{ id }, query, auth] = await Promise.all([params, searchParams, requireAuth()]);
  if (!auth.vendor || !canManageCourses(auth.member?.role)) redirect("/courses?error=course_manager_required");
  const [course, forms, products, videos, lives] = await Promise.all([
    getDb().course.findFirst({
      where: { id, vendorId: auth.vendor.id },
      include: {
        lessons: { orderBy: { sortOrder: "asc" } },
        sessions: { orderBy: { startsAt: "asc" } },
        _count: { select: { enrollments: true } },
      },
    }),
    getDb().registrationForm.findMany({ where: { vendorId: auth.vendor.id, isActive: true }, orderBy: { name: "asc" } }),
    getDb().product.findMany({ where: { vendorId: auth.vendor.id, isActive: true }, orderBy: { name: "asc" } }),
    getDb().video.findMany({ where: { vendorId: auth.vendor.id }, orderBy: { createdAt: "desc" } }),
    getDb().live.findMany({ where: { vendorId: auth.vendor.id }, orderBy: { scheduledAt: "desc" } }),
  ]);
  if (!course) notFound();

  return (
    <>
      <PageHeader
        title={`編輯 ${course.title}`}
        description="課程設定、影片單元與直播場次共用既有內容資產；發布不會改寫原本直播流程。"
        action={<div className="flex flex-wrap gap-2"><ButtonLink href={`/courses/${course.id}/enrollments`} tone="secondary"><Users size={16} />報名名單 ({course._count.enrollments})</ButtonLink>{course.status === "published" ? <ButtonLink href={`/course/${course.slug}`} tone="secondary"><ExternalLink size={16} />公開頁</ButtonLink> : null}</div>}
      />
      {query.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">課程內容已更新。</p> : null}
      {query.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[query.error] ?? "課程更新失敗，請檢查資料。"}</p> : null}

      <CourseForm course={course} forms={forms} products={products} />

      <Card className="mt-5">
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-950">影片單元</h2><p className="mt-1 text-sm text-slate-500">已發布單元才會出現在公開頁；預覽單元可直接播放。</p></div><Badge tone="blue">{course.lessons.length} 單元</Badge></div>
        <div className="grid gap-3">
          <LessonForm courseId={course.id} videos={videos} nextOrder={course.lessons.length + 1} />
          {course.lessons.map((lesson) => <LessonForm key={lesson.id} courseId={course.id} lesson={lesson} videos={videos} nextOrder={lesson.sortOrder} />)}
        </div>
      </Card>

      <Card className="mt-5">
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-950">課程場次</h2><p className="mt-1 text-sm text-slate-500">場次可綁定既有直播；容量會在 Enrollment transaction 內鎖定檢查。</p></div><Badge tone="blue">{course.sessions.length} 場</Badge></div>
        <div className="grid gap-3">
          <SessionForm courseId={course.id} lives={lives} />
          {course.sessions.map((session) => <SessionForm key={session.id} courseId={course.id} session={session} lives={lives} />)}
        </div>
      </Card>
    </>
  );
}

function LessonForm({ courseId, lesson, videos, nextOrder }: { courseId: string; lesson?: { id: string; videoId: string | null; title: string; description: string | null; sortOrder: number; status: string; isPreview: boolean }; videos: Array<{ id: string; title: string }>; nextOrder: number }) {
  return (
    <form action={upsertCourseLessonAction} className="grid gap-3 rounded-md border border-border bg-slate-50/60 p-3 lg:grid-cols-[72px_1fr_1fr_130px_100px_auto] lg:items-end">
      <CsrfField /><input type="hidden" name="courseId" value={courseId} />{lesson ? <input type="hidden" name="id" value={lesson.id} /> : null}
      <Field label="排序" name="sortOrder" type="number" required defaultValue={lesson?.sortOrder ?? nextOrder} />
      <Field label={lesson ? "單元名稱" : "新增單元"} name="title" required defaultValue={lesson?.title} placeholder="單元名稱" />
      <SelectField label="影片" name="videoId" defaultValue={lesson?.videoId}><option value="">尚未綁定</option>{videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}</SelectField>
      <SelectField label="狀態" name="status" defaultValue={lesson?.status ?? "draft"}><option value="draft">草稿</option><option value="published">發布</option></SelectField>
      <label className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700"><input name="isPreview" type="checkbox" defaultChecked={lesson?.isPreview} className="h-4 w-4 accent-blue-600" />可預覽</label>
      <SubmitButton>{lesson ? "更新" : "新增"}</SubmitButton>
      <input type="hidden" name="description" value={lesson?.description ?? ""} />
    </form>
  );
}

function SessionForm({ courseId, session, lives }: { courseId: string; session?: { id: string; liveId: string | null; title: string; startsAt: Date; endsAt: Date | null; status: string; capacity: number | null }; lives: Array<{ id: string; title: string }> }) {
  return (
    <form action={upsertCourseSessionAction} className="grid gap-3 rounded-md border border-border bg-slate-50/60 p-3 lg:grid-cols-[1fr_1fr_180px_120px_120px_auto] lg:items-end">
      <CsrfField /><input type="hidden" name="courseId" value={courseId} />{session ? <input type="hidden" name="id" value={session.id} /> : null}
      <Field label={session ? "場次名稱" : "新增場次"} name="title" required defaultValue={session?.title} placeholder="場次名稱" />
      <SelectField label="綁定直播" name="liveId" defaultValue={session?.liveId}><option value="">不綁定</option>{lives.map((live) => <option key={live.id} value={live.id}>{live.title}</option>)}</SelectField>
      <Field label="開始時間" name="startsAt" type="datetime-local" required defaultValue={session ? localDateTime(session.startsAt) : ""} />
      <SelectField label="狀態" name="status" defaultValue={session?.status ?? "scheduled"}><option value="scheduled">預定</option><option value="live">進行中</option><option value="ended">結束</option><option value="canceled">取消</option></SelectField>
      <Field label="容量" name="capacity" type="number" defaultValue={session?.capacity} placeholder="不限" />
      <SubmitButton>{session ? "更新" : "新增"}</SubmitButton>
      <input type="hidden" name="endsAt" value={session ? localDateTime(session.endsAt) : ""} />
    </form>
  );
}
