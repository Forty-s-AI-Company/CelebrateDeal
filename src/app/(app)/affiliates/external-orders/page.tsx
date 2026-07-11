import { FileCheck2 } from "lucide-react";
import { submitExternalOrderEvidenceAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, EmptyState, Field, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { requireVendorOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "confirmed") return "green" as const;
  if (status === "pending_review") return "orange" as const;
  return "gray" as const;
}

export default async function ExternalOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireVendorOwner();
  const [affiliates, products, evidence] = await Promise.all([
    getDb().affiliate.findMany({ where: { vendorId: auth.vendor.id, isActive: true }, orderBy: { name: "asc" } }),
    getDb().product.findMany({ where: { vendorId: auth.vendor.id, checkoutMode: "external", isActive: true }, orderBy: { name: "asc" } }),
    getDb().externalOrderEvidence.findMany({
      where: { vendorId: auth.vendor.id },
      include: { affiliate: true, product: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const canSubmit = affiliates.length > 0 && products.length > 0;

  return (
    <>
      <PageHeader title="外部訂單證據" description="外部商城點擊不等於成交。提交訂單證據後，必須由平台管理員審核才能建立佣金。" />
      {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">訂單證據已送出審核。</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">訂單證據無法送出，請檢查訂單編號、金額與關聯資料是否正確。</p> : null}

      <div className="grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><FileCheck2 size={18} />提交證據</h2>
          <p className="mt-1 text-sm text-slate-500">推薦碼與佣金比例會在提交時凍結，審核前不會計入成交或佣金。</p>
          {canSubmit ? (
            <form action={submitExternalOrderEvidenceAction} className="mt-4 grid gap-4">
              <CsrfField />
              <SelectField label="推廣者" name="affiliateId">{affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.id}>{affiliate.name} · {affiliate.code}</option>)}</SelectField>
              <SelectField label="商品" name="productId">{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectField>
              <Field label="外部訂單編號" name="externalOrderReference" required placeholder="EX-ORDER-001" />
              <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                <Field label="成交金額（分）" name="amountCents" type="number" required />
                <Field label="幣別" name="currency" defaultValue="TWD" required />
              </div>
              <SubmitButton>送出審核</SubmitButton>
            </form>
          ) : <p className="mt-4 rounded-md border border-border bg-slate-50 p-4 text-sm text-slate-600">請先建立啟用中的推廣者與外部商城商品。</p>}
        </Card>

        {evidence.length === 0 ? (
          <EmptyState title="尚無訂單證據" description="只有經平台管理員確認的外部訂單，才會建立 approved 佣金。" />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold text-slate-950">最近提交</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">訂單</th><th className="px-5 py-3">推廣者</th><th className="px-5 py-3">商品</th><th className="px-5 py-3">金額</th><th className="px-5 py-3">比例</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">提交時間</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {evidence.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-4 font-mono text-xs">{item.externalOrderReference}</td>
                      <td className="px-5 py-4"><p className="font-semibold text-slate-900">{item.affiliate.name}</p><p className="text-xs text-slate-500">{item.referralCode}</p></td>
                      <td className="px-5 py-4">{item.product.name}</td>
                      <td className="px-5 py-4">{formatCurrency(item.amountCents, item.currency)}</td>
                      <td className="px-5 py-4">{item.commissionRateBps / 100}%</td>
                      <td className="px-5 py-4"><Badge tone={statusTone(item.status)}>{item.status}</Badge></td>
                      <td className="px-5 py-4 text-slate-500">{formatDateTime(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
