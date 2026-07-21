import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function LivePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const live = await getDb().live.findFirst({ where: { id, vendorId: vendor.id }, include: { products: { include: { product: true } }, form: true, video: true, messageTemplate: true, interactionScript: true } });
  if (!live) notFound();

  return (
    <>
      <PageHeader title="直播預覽" description="確認公開頁資訊，並取得可分享連結。" action={<ButtonLink href={`/live/${live.slug}`} tone="cta">開啟公開頁</ButtonLink>} />
      <Card>
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="aspect-video rounded-lg bg-slate-100 bg-cover bg-center" style={{ backgroundImage: live.heroImageUrl ? `url(${live.heroImageUrl})` : undefined }} />
            <h2 className="mt-4 text-xl font-semibold text-slate-950">{live.title}</h2>
            <p className="mt-2 text-sm text-slate-500">{live.description}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700">公開連結</p>
            <Link className="mt-2 block break-all text-primary" href={`/live/${live.slug}`}>/live/{live.slug}</Link>
            <p className="mt-5 text-sm font-semibold text-slate-700">綁定內容</p>
            <ul className="mt-2 space-y-2 text-sm text-slate-600">
              <li>影片：{live.video?.title ?? "未綁定"}</li>
              <li>串流模式：{live.streamMode}</li>
              <li>Cloudflare Live Input：{live.cloudflareLiveInputUid ?? live.video?.cloudflareLiveInputUid ?? "未設定"}</li>
              <li>表單：{live.form?.name ?? "未綁定"}</li>
              <li>通知模板：{live.messageTemplate?.name ?? "未綁定"}</li>
              <li>互動腳本：{live.interactionScript?.name ?? "未綁定"}</li>
              <li>商品：{live.products.map((item) => item.product.name).join("、") || "未綁定"}</li>
            </ul>
          </div>
        </div>
      </Card>
    </>
  );
}
