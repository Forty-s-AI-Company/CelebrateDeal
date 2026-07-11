import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { canManageCourses } from "@/lib/vendor-capabilities";

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const auth = await requireAuth();
  const vendorId = auth.vendor?.id;
  if (!vendorId) return null;
  const courses = await getDb().course.findMany({
    where: { vendorId },
    include: { _count: { select: { lessons: true, sessions: true, enrollments: true } } },
    orderBy: { createdAt: "desc" },
  });
  const canManage = canManageCourses(auth.member?.role);

  return (
    <>
      <PageHeader title="課程與銷講" description="用既有影片、直播、報名表與商品組合課程或活動銷講頁。" action={canManage ? <ButtonLink href="/courses/new"><Plus size={16} />新增課程</ButtonLink> : undefined} />
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{params.error === "course_manager_required" ? "只有 owner 或 admin 可以管理與發布課程。" : "課程操作失敗，請檢查輸入與關聯資料。"}</p> : null}
      {courses.length === 0 ? (
        <EmptyState title="尚未建立課程" description="先建立草稿，再加入至少一個已發布單元或可報名場次。" action={canManage ? <ButtonLink href="/courses/new">建立課程草稿</ButtonLink> : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            canManage ? <Link key={course.id} href={`/courses/${course.id}/edit`} className="overflow-hidden rounded-lg border border-border bg-white shadow-sm transition hover:border-blue-200 hover:shadow-md">
              <div className="aspect-[16/7] bg-slate-100 bg-cover bg-center" style={{ backgroundImage: course.coverImageUrl ? `url(${course.coverImageUrl})` : undefined }} />
              <div className="p-4">
                <div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-slate-950">{course.title}</h2><Badge tone={course.status === "published" ? "green" : course.status === "draft" ? "blue" : "gray"}>{course.status}</Badge></div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-500">{course.description ?? "尚未填寫說明"}</p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-slate-500"><span><b className="block text-base text-slate-900">{course._count.lessons}</b>單元</span><span><b className="block text-base text-slate-900">{course._count.sessions}</b>場次</span><span><b className="block text-base text-slate-900">{course._count.enrollments}</b>報名</span></div>
                <p className="mt-4 text-xs text-slate-400">更新 {formatDateTime(course.updatedAt)}</p>
              </div>
            </Link> : <article key={course.id} className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
              <div className="aspect-[16/7] bg-slate-100 bg-cover bg-center" style={{ backgroundImage: course.coverImageUrl ? `url(${course.coverImageUrl})` : undefined }} />
              <div className="p-4">
                <div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-slate-950">{course.title}</h2><Badge tone={course.status === "published" ? "green" : course.status === "draft" ? "blue" : "gray"}>{course.status}</Badge></div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-500">{course.description ?? "尚未填寫說明"}</p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs text-slate-500"><span><b className="block text-base text-slate-900">{course._count.lessons}</b>單元</span><span><b className="block text-base text-slate-900">{course._count.sessions}</b>場次</span></div>
                <p className="mt-4 text-xs text-slate-400">此角色僅能查看課程摘要，不可讀取報名者資料。</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
