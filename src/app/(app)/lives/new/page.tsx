import { LiveStepperForm } from "@/components/live-stepper-form";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function NewLivePage() {
  const vendor = await requireVendor();
  const [videos, products, forms, templates, scripts, affiliates, csrfToken] = await Promise.all([
    getDb().video.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } }),
    getDb().product.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { createdAt: "desc" } }),
    getDb().registrationForm.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { createdAt: "desc" } }),
    getDb().messageTemplate.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { createdAt: "desc" } }),
    getDb().interactionScript.findMany({ where: { vendorId: vendor.id, status: "published" }, orderBy: { createdAt: "desc" } }),
    getDb().affiliate.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { createdAt: "desc" } }),
    getCsrfToken(),
  ]);

  return (
    <>
      <PageHeader title="建立直播間" description="用四步驟串起直播基本資料、影片、表單與商品。先能跑起完整漏斗，再慢慢加自動化。" />
      <LiveStepperForm videos={videos} products={products} forms={forms} templates={templates} scripts={scripts} affiliates={affiliates} csrfToken={csrfToken} />
    </>
  );
}
