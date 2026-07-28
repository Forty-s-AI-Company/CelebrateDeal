import { LiveStepperForm } from "@/components/live-stepper-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function NewLivePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const vendor = await requireVendorManager();
  const { error } = await searchParams;
  const [videos, products, forms, templates, scripts, affiliates, csrfToken] = await Promise.all([
    getDb().video.findMany({
      where: { vendorId: vendor.id },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
    getDb().product.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { createdAt: "desc" } }),
    getDb().registrationForm.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { createdAt: "desc" } }),
    getDb().messageTemplate.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { createdAt: "desc" } }),
    getDb().interactionScript.findMany({ where: { vendorId: vendor.id, status: "published" }, orderBy: { createdAt: "desc" } }),
    getDb().affiliate.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { createdAt: "desc" } }),
    getCsrfToken(),
  ]);

  return (
    <>
      <PageHeader title="建立直播間" description="用八個清楚步驟設定基本資料、串流、商品、報名、通知、互動與營運規則。" />
      <LiveStepperForm videos={videos} products={products} forms={forms} templates={templates} scripts={scripts} affiliates={affiliates} csrfToken={csrfToken} error={error} />
    </>
  );
}
