import { notFound } from "next/navigation";
import { AffiliateForm } from "@/components/affiliate-form";
import { Card, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function EditAffiliatePage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
  const { id } = await params;
  const affiliate = await getDb().affiliate.findFirst({ where: { id, vendorId: vendor.id }, include: { clicks: { orderBy: { createdAt: "desc" }, take: 10 } } });
  if (!affiliate) notFound();
  return (
    <>
      <PageHeader title="編輯聯盟夥伴" description="更新推廣碼、來源渠道與佣金設定。" />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <AffiliateForm affiliate={affiliate} />
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">最近來源事件</h2>
          <div className="grid gap-2">
            {affiliate.clicks.map((click) => (
              <div key={click.id} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium text-slate-950">{click.landingPath}</p>
                <p className="mt-1 text-slate-500">{formatDateTime(click.createdAt)} · {click.convertedAt ? "已轉換" : "未轉換"}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
