import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { saveMerchantAffiliatePayoutPolicyAction } from "@/app/actions/merchant-affiliate-payout-policy-actions";
import { ButtonLink, PageHeader } from "@/components/ui";
export default async function AffiliatePayoutPolicyPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { vendor } = await requireVendorManagerContext("/affiliates/payout-policy");
  if (!["affiliate_program", "tax_remuneration"].every(feature => vendor.enabledFeatureModules.includes(feature))) notFound();
  const current = await getDb().merchantAffiliatePayoutPolicy.findUnique({ where: { vendorId: vendor.id }, select: { revision: true, bankFeeCents: true, enabled: true } });
  const query = await searchParams;
  return <><PageHeader title="聯盟提領費用" description="設定商家佣金提領的轉帳費用。政策修改後，待處理的報價與簽署須重新確認；此頁不執行付款。" action={<ButtonLink href="/affiliates">回到聯盟夥伴</ButtonLink>} />
    {query.error === "conflict" ? <p role="alert" className="mb-4">資料無效或版本已變更，請重新確認目前設定後儲存。</p> : null}
    {query.saved === "1" ? <p role="status" className="mb-4">提領政策已儲存。</p> : null}
    <p className="mb-4">{current ? `目前版本：${current.revision}，${current.enabled ? "已啟用" : "已停用"}` : "尚未設定，暫不接受提領報價與匯出。"}</p>
    <form action={saveMerchantAffiliatePayoutPolicyAction} className="max-w-xl space-y-5">
      <input type="hidden" name={CSRF_FIELD_NAME} value={await getCsrfToken()} />
      <input type="hidden" name="expectedRevision" value={current?.revision ?? 0} />
      <label className="block">每筆轉帳費用（分，100 分＝NT$1）<input className="mt-2 block min-h-11 w-full rounded border px-3" type="number" name="bankFeeCents" min={0} max={2_147_483_647} step={1} required defaultValue={current?.bankFeeCents ?? ""} /></label>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="enabled" defaultChecked={current?.enabled ?? false} />啟用提領報價與匯出</label>
      <button className="min-h-11 rounded bg-blue-700 px-4 text-white">儲存提領政策</button>
    </form><Link className="mt-6 inline-block min-h-11 underline" href="/affiliates/policy">查看聯盟佣金政策</Link>
  </>;
}
