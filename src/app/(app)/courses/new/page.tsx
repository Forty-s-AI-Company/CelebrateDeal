import { redirect } from "next/navigation";
import { CourseForm } from "@/components/course-form";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageCourses } from "@/lib/vendor-capabilities";

export default async function NewCoursePage() {
  const auth = await requireAuth();
  if (!auth.vendor || !canManageCourses(auth.member?.role)) redirect("/courses?error=course_manager_required");
  const [forms, products] = await Promise.all([
    getDb().registrationForm.findMany({ where: { vendorId: auth.vendor.id, isActive: true }, orderBy: { name: "asc" } }),
    getDb().product.findMany({ where: { vendorId: auth.vendor.id, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="新增課程" description="先建立草稿，再加入影片單元或直播場次後發布。" />
      <CourseForm forms={forms} products={products} />
    </>
  );
}
