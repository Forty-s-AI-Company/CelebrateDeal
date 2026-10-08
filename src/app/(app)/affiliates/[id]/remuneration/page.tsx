import { formatAffiliateRemuneration } from "@/lib/affiliate-remuneration-format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { getAffiliateRemunerationDashboard } from "@/lib/affiliate-remuneration-dashboard";
import { approveAffiliatePayeeProfileAction } from "@/app/actions/affiliate-remuneration-actions";
import { AffiliateRemunerationSummary } from "@/components/affiliate-remuneration-summary";
import { ButtonLink, PageHeader } from "@/components/ui";
export default async function AffiliateRemunerationManagerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cursor?: string; error?: string; saved?: string }> }) {
  const { id: affiliateId } = await params, query = await searchParams;
  const path = `/affiliates/${encodeURIComponent(affiliateId)}/remuneration`;
  const { vendor, auth } = await requireVendorManagerContext(path);
  const current = await getAffiliateRemunerationDashboard(getDb(), { userId: auth.user.id }, { vendorId: vendor.id, affiliateId }, "manager", query.cursor);
  if (!current) notFound();
  const csrf = await getCsrfToken(), profile = current.profile;
  return <><PageHeader title={`${current.affiliate.name}：提領核准`} description="核對收款人的扣繳分類與憑證後核准精確資料版本，再匯出已簽署的提領。匯出不會執行付款。" action={<ButtonLink href={`/affiliates/${encodeURIComponent(affiliateId)}`}>回到夥伴</ButtonLink>} />
    {query.error === "conflict" ? <p role="alert">資料、權限或版本已變更，請重新確認後再送出。</p> : null}
    {query.saved === "1" ? <p role="status">資料已儲存。</p> : null}
    <section aria-label="收款分類核准" className="mb-6 rounded border p-4"><h2 className="text-xl font-bold">收款分類核准</h2>{profile ? <>
      <dl className="my-4 grid grid-cols-2 gap-2"><dt>資料版本</dt><dd>{profile.revision}</dd><dt>收款人分類</dt><dd>{{ resident_individual: "境內居住個人", nonresident_individual: "非境內居住個人", domestic_invoice_business: "境內開立發票事業" }[profile.recipientType] ?? "未知分類"}</dd><dt>健保適用</dt><dd>{{ subject_execution_business: "適用執行業務補充保費", documented_exemption: "有證明的免扣取資格", not_insured: "非健保保險對象", not_applicable_business: "事業不適用" }[profile.nhiTreatment] ?? "未知分類"}</dd><dt>免扣取證明編號</dt><dd>{profile.exemptionReference ?? "無"}</dd><dt>發票憑證編號</dt><dd>{profile.invoiceReference ?? "無"}</dd></dl>
      <p>銀行與稅籍已加密保存。本頁不顯示原值；請依商家留存憑證核對居住身分、健保資格及發票適用性，不能只依夥伴的聲明核准。</p>
      {profile.approvedRevision === profile.revision ? <p role="status">此版本已核准。</p> : <form action={approveAffiliatePayeeProfileAction} className="mt-4 space-y-3"><input type="hidden" name={CSRF_FIELD_NAME} value={csrf} /><input type="hidden" name="affiliateId" value={affiliateId} /><input type="hidden" name="expectedRevision" value={profile.revision} /><label className="flex min-h-11 items-center gap-2"><input name="reviewConfirmed" type="checkbox" required />我已核對本版本分類與相關憑證。</label><button className="min-h-11 rounded bg-blue-700 px-4 text-white">核准此收款資料版本</button></form>}
    </> : <p>夥伴尚未提交收款資料。</p>}</section>
    <section aria-label="已簽署提領匯出"><h2 className="text-xl font-bold">已簽署提領匯出</h2>{!current.payouts.length ? <p>尚無結算提領。</p> : current.payouts.map(payout => { const quote = payout.remunerationSnapshots[0]; return <article key={payout.id} className="my-4 rounded border p-4"><h3 className="font-bold">{payout.monthKey} 提領</h3>{payout.status === "paid" && payout.paidNetAmountCents != null ? <p>已記錄實領金額：{formatAffiliateRemuneration(payout.paidNetAmountCents)}</p> : null}{quote ? <><AffiliateRemunerationSummary quote={quote} /><p>狀態：{payout.status === "paid" ? "商家已記錄付款" : quote.status === "signed" ? "已簽署" : quote.status === "exported" ? "已匯出，尚不代表付款" : quote.status === "invalidated" ? "已失效" : "待簽署"}</p>
      {payout.status === "pending" && ["signed", "exported"].includes(quote.status) && current.policy?.enabled ? <form method="post" action={`/api/affiliates/${encodeURIComponent(affiliateId)}/remuneration/${encodeURIComponent(quote.id)}/export`} className="mt-3"><input type="hidden" name={CSRF_FIELD_NAME} value={csrf} /><button className="min-h-11 rounded border px-4">下載私有提領 CSV</button></form> : null}
    </> : <p>夥伴尚未取得報價。</p>}</article>; })}{current.nextCursor ? <Link className="block min-h-11 underline" href={`${path}?cursor=${encodeURIComponent(current.nextCursor)}`}>下一頁提領</Link> : null}</section>
    <Link className="mt-5 inline-block min-h-11 underline" href="/affiliates/payout-policy">管理提領費用</Link>
  </>;
}
