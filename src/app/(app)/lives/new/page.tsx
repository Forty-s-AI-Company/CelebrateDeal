import { LiveStepperForm } from "@/components/live-stepper-form";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

const publicationErrors: Record<string, string> = {
  vod_video_required: "公開 VOD 直播前必須選擇一支影片。",
  vod_video_not_ready: "選擇的影片尚未 ready，請等待 Cloudflare Stream 處理完成。",
  live_input_required: "公開 Live 模式前必須建立並綁定 Cloudflare Live Input UID。",
  live_input_mapping_required: "Live Input 必須透過 Stream 操作工具建立並綁定播放映射，不能只手動填 UID。",
};

export default async function NewLivePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
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
      <PageHeader title="建立直播間" description="用八個步驟串起媒體、商品、名單、互動、自動化與發布規則。" />
      {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{publicationErrors[params.error] ?? "直播間尚未符合發布條件。"}</p> : null}
      <LiveStepperForm videos={videos} products={products} forms={forms} templates={templates} scripts={scripts} affiliates={affiliates} csrfToken={csrfToken} />
    </>
  );
}
