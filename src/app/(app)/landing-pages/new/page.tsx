import { LandingPageWorkspace } from "@/components/landing-page-workspace";
import { requireVendorManagerContext } from "@/lib/auth";
import { getSalesProjectScope } from "@/lib/sales-project-scope";
import { getDb } from "@/lib/db";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
export default async function NewLandingPage() {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) return <p>請先選擇一個銷售專案，再建立一頁式網站。</p>;
  const forms = await getDb().registrationForm.findMany({ where: { vendorId: vendor.id, projectId: scope.projectId, isActive: true }, select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } });
  const lives = await getDb().live.findMany({ where: { vendorId: vendor.id, projectId: scope.projectId, status: { in: ["scheduled", "live", "ended"] } }, select: { id: true, slug: true, title: true, scheduledAt: true, status: true } });
  return <LandingPageWorkspace forms={forms} lives={lives.map((live) => ({ ...live, status: live.status as "scheduled" | "live" | "ended", scheduledAt: live.scheduledAt.toISOString(), timezone: vendor.timezone }))} csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} />;
}
