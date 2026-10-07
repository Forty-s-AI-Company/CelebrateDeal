import { formatAffiliateRemuneration } from "@/lib/affiliate-remuneration-format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { getAffiliateRemunerationDashboard } from "@/lib/affiliate-remuneration-dashboard";
import { createAffiliateRemunerationQuoteAction, signAffiliateRemunerationQuoteAction, submitAffiliatePayeeProfileAction } from "@/app/actions/affiliate-remuneration-actions";
import { AffiliateRemunerationSummary } from "@/components/affiliate-remuneration-summary";
export default async function AffiliateRemunerationPage({ params, searchParams }: { params: Promise<{ vendorSlug: string; affiliateId: string }>; searchParams: Promise<{ cursor?: string; error?: string; saved?: string }> }) {
  const { vendorSlug, affiliateId } = await params, query = await searchParams;
  const path = `/affiliate-portal/${encodeURIComponent(vendorSlug)}/${encodeURIComponent(affiliateId)}/remuneration`;
  const auth = await requireAuth({ nextPath: path });
  const vendor = await getDb().vendor.findUnique({ where: { slug: vendorSlug }, select: { id: true } });
  if (!vendor) notFound();
  const current = await getAffiliateRemunerationDashboard(getDb(), { userId: auth.user.id }, { vendorId: vendor.id, affiliateId }, "affiliate", query.cursor);
  if (!current) notFound();
  const csrf = await getCsrfToken();
  const identity = <><input type="hidden" name={CSRF_FIELD_NAME} value={csrf} /><input type="hidden" name="vendorSlug" value={vendorSlug} /><input type="hidden" name="affiliateId" value={affiliateId} /></>;
  const approved = current.profile && current.profile.approvedRevision === current.profile.revision;
  return <main className="mx-auto max-w-3xl space-y-6 p-6"><h1 className="text-2xl font-bold">{current.affiliate.name}：佣金提領</h1>
    {query.error === "conflict" ? <p role="alert">資料、權限或版本已變更，請重新確認後再送出。</p> : null}
    {query.saved === "1" ? <p role="status">資料已儲存。</p> : null}
    <section aria-label="收款資料"><h2 className="text-xl font-bold">收款資料</h2><p className="my-3">{current.profile ? `目前資料版本 ${current.profile.revision}，${approved ? "商家已核准" : "待商家核准"}。` : "請先提交收款與扣繳資料，經商家核准後才能簽署提領。"}修改資料會撤銷舊核准與待處理簽署。銀行帳號與稅籍以加密方式保存，這裡不回填原值。</p>
      <form action={submitAffiliatePayeeProfileAction} className="space-y-4">{identity}<input type="hidden" name="expectedRevision" value={current.profile?.revision ?? 0} />
        <label className="block">戶名<input name="accountName" required maxLength={120} autoComplete="off" className="block min-h-11 w-full rounded border px-3" /></label>
        <label className="block">銀行代碼<input name="bankCode" required pattern="[0-9]{3}" maxLength={3} inputMode="numeric" className="block min-h-11 w-full rounded border px-3" /></label>
        <label className="block">收款帳號<input name="accountNumber" type="password" required pattern="[0-9]{6,20}" maxLength={20} autoComplete="off" inputMode="numeric" className="block min-h-11 w-full rounded border px-3" /></label>
        <label className="block">稅籍識別碼<input name="taxIdentity" type="password" required minLength={6} maxLength={32} autoComplete="off" className="block min-h-11 w-full rounded border px-3" /></label>
        <label className="block">收款人分類<select name="recipientType" defaultValue={current.profile?.recipientType ?? "resident_individual"} className="block min-h-11 rounded border"><option value="resident_individual">境內居住個人</option><option value="nonresident_individual">非境內居住個人</option><option value="domestic_invoice_business">境內開立發票事業</option></select></label>
        <label className="block">健保適用<select name="nhiTreatment" defaultValue={current.profile?.nhiTreatment ?? "subject_execution_business"} className="block min-h-11 rounded border"><option value="subject_execution_business">適用執行業務補充保費</option><option value="documented_exemption">有證明的免扣取資格</option><option value="not_insured">非健保保險對象</option><option value="not_applicable_business">事業不適用</option></select></label>
        <label className="block">免扣取／非保險對象證明編號<input name="exemptionReference" maxLength={160} defaultValue={current.profile?.exemptionReference ?? ""} className="block min-h-11 w-full rounded border px-3" /></label>
        <label className="block">事業發票憑證編號<input name="invoiceReference" maxLength={160} defaultValue={current.profile?.invoiceReference ?? ""} className="block min-h-11 w-full rounded border px-3" /></label>
        <p>分類與證明須由商家核對，填寫聲明本身不代表已取得免扣繳資格。</p><button className="min-h-11 rounded bg-blue-700 px-4 text-white">提交收款資料</button>
      </form>
    </section><section aria-label="提領與簽署"><h2 className="text-xl font-bold">提領與簽署</h2>
      {!current.policy?.enabled ? <p>商家尚未啟用提領費用政策。</p> : null}
      {!current.payouts.length ? <p>尚無已結算的佣金提領。</p> : current.payouts.map(payout => { const quote = payout.remunerationSnapshots[0]; return <article key={payout.id} className="my-4 rounded border p-4"><h3 className="font-bold">{payout.monthKey} 提領</h3><p>結算狀態：{payout.status}{payout.heldAmountCents > 0 ? "，有爭議款項暫停提領" : ""}</p>
        {payout.status === "paid" && payout.paidNetAmountCents != null ? <p>已記錄實領金額：{formatAffiliateRemuneration(payout.paidNetAmountCents)}</p> : null}{quote ? <><AffiliateRemunerationSummary quote={quote} /><p>簽署狀態：{payout.status === "paid" ? "商家已記錄付款" : quote.status === "signed" ? "已簽署" : quote.status === "exported" ? "商家已匯出，尚不代表付款" : quote.status === "invalidated" ? "已失效，請重新報價" : "待簽署"}</p></> : null}
        {payout.status === "pending" && !payout.heldAmountCents && approved && current.policy?.enabled ? <form action={createAffiliateRemunerationQuoteAction}>{identity}<input type="hidden" name="payoutId" value={payout.id} /><button className="min-h-11 rounded border px-4">取得最新提領報價</button></form> : null}
        {quote?.status === "quoted" && approved && current.policy?.enabled ? <form action={signAffiliateRemunerationQuoteAction} className="mt-3 space-y-3">{identity}<input type="hidden" name="snapshotId" value={quote.id} /><input type="hidden" name="expectedRevision" value={quote.revision} /><label className="flex min-h-11 items-center gap-2"><input name="consent" type="checkbox" required />我確認本次佣金、扣繳、補充保費、費用與實領金額，並同意簽署。</label><button className="min-h-11 rounded bg-blue-700 px-4 text-white">簽署本次提領</button></form> : null}
      </article>; })}
      {current.nextCursor ? <Link className="block min-h-11 underline" href={`${path}?cursor=${encodeURIComponent(current.nextCursor)}`}>下一頁提領</Link> : null}
    </section><Link className="block min-h-11 underline" href={path.replace(/\/remuneration$/u, "")}>回到佣金帳本</Link>
  </main>;
}
