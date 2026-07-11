import { notFound, redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { writeAuditLog } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { canViewCourseEnrollmentPii } from "@/lib/vendor-capabilities";

export default async function CourseEnrollmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);
  const vendorId = auth.vendor?.id;
  if (!vendorId) notFound();
  if (!canViewCourseEnrollmentPii(auth.member?.role)) {
    await writeAuditLog({
      vendorId,
      actorId: auth.user.id,
      actorLabel: auth.member?.role,
      action: "course_enrollment_pii_access_denied",
      targetType: "Course",
      targetId: id,
    });
    redirect("/courses?error=course_enrollment_access_denied");
  }
  const course = await getDb().course.findFirst({
    where: { id, vendorId },
    include: { enrollments: { include: { session: true, affiliate: true }, orderBy: { enrolledAt: "desc" } } },
  });
  if (!course) notFound();
  await writeAuditLog({
    vendorId,
    actorId: auth.user.id,
    actorLabel: auth.member?.role,
    action: "course_enrollment_pii_viewed",
    targetType: "Course",
    targetId: course.id,
    after: { enrollmentCount: course.enrollments.length },
  });
  return (
    <>
      <PageHeader title={`${course.title} 報名名單`} description="Enrollment 是名單／報名狀態，不代表付款或外部商城成交。" />
      {course.enrollments.length === 0 ? <EmptyState title="尚無報名者" description="公開課程頁完成報名後，名單會顯示在這裡並排入通知 outbox。" /> : (
        <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">報名者</th><th className="px-5 py-3">場次</th><th className="px-5 py-3">來源</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">報名時間</th></tr></thead><tbody className="divide-y divide-border">{course.enrollments.map((enrollment) => <tr key={enrollment.id}><td className="px-5 py-4"><p className="font-semibold text-slate-900">{enrollment.name}</p><p className="text-xs text-slate-500">{enrollment.email}{enrollment.phone ? ` · ${enrollment.phone}` : ""}</p></td><td className="px-5 py-4">{enrollment.session?.title ?? "未指定"}</td><td className="px-5 py-4"><p>{enrollment.affiliate?.name ?? enrollment.source}</p><p className="text-xs text-slate-500">{enrollment.referralCode ?? "-"}</p></td><td className="px-5 py-4"><Badge tone={enrollment.status === "confirmed" ? "green" : "gray"}>{enrollment.status}</Badge></td><td className="px-5 py-4 text-slate-500">{formatDateTime(enrollment.enrolledAt)}</td></tr>)}</tbody></table></div></Card>
      )}
    </>
  );
}
