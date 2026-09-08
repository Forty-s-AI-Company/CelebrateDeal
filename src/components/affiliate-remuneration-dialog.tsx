"use client";

import { useRef } from "react";
import { requestAffiliatePayoutAction } from "@/app/actions/affiliate-portal-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { formatCurrency } from "@/lib/format";

type Props = {
  payoutId: string;
  monthKey: string;
  bankLabel: string;
  taxIdentityLabel: string;
  amounts: {
    grossAmountCents: number;
    withholdingTaxCents: number;
    nhiSupplementaryTaxCents: number;
    bankFeeCents: number;
    netPayoutAmountCents: number;
  };
};

export function AffiliateRemunerationDialog({ payoutId, monthKey, bankLabel, taxIdentityLabel, amounts }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" onClick={() => dialogRef.current?.showModal()} className="min-h-11 rounded-md bg-cta px-4 text-sm font-semibold text-white hover:bg-cta-dark">申請提領</button>
    <dialog ref={dialogRef} aria-labelledby={`remuneration-${payoutId}`} className="w-[min(94vw,42rem)] rounded-xl p-0 shadow-2xl backdrop:bg-slate-950/50">
      <form method="dialog" className="flex justify-end p-3"><button type="submit" aria-label="關閉" className="min-h-11 px-3 text-slate-600">關閉</button></form>
      <div className="px-6 pb-6">
        <h2 id={`remuneration-${payoutId}`} className="text-xl font-bold text-slate-950">勞務報酬明細與簽署確認</h2>
        <p className="mt-1 text-sm text-slate-600">所得所屬年月：{monthKey}</p>
        <dl className="mt-5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 rounded-lg bg-slate-50 p-4 text-sm">
          <dt>給付總額</dt><dd>{formatCurrency(amounts.grossAmountCents)}</dd>
          <dt>代扣所得稅額</dt><dd>-{formatCurrency(amounts.withholdingTaxCents)}</dd>
          <dt>代扣二代健保</dt><dd>-{formatCurrency(amounts.nhiSupplementaryTaxCents)}</dd>
          <dt>銀行手續費</dt><dd>-{formatCurrency(amounts.bankFeeCents)}</dd>
          <dt className="font-bold">實領金額</dt><dd className="font-bold text-emerald-700">{formatCurrency(amounts.netPayoutAmountCents)}</dd>
        </dl>
        <p className="mt-4 text-sm text-slate-700">匯款帳戶：{bankLabel}</p>
        <p className="mt-1 text-sm text-slate-700">身分證字號：{taxIdentityLabel}</p>
        <form action={requestAffiliatePayoutAction} className="mt-5 grid gap-4">
          <CsrfField />
          <input type="hidden" name="payoutId" value={payoutId} />
          <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
            <input type="checkbox" required name="remunerationConsent" value="accepted" className="mt-1 h-5 w-5" />
            本人已確認以上勞務報酬金額與身分資料無誤，並同意代扣相關稅費。
          </label>
          <FormSubmitButton pendingChildren="簽署送出中…" pendingMessage="正在保存勞報單簽署與扣繳快照。" className="min-h-11 rounded-md bg-cta px-4 font-semibold text-white hover:bg-cta-dark">確認簽署並申請提領</FormSubmitButton>
        </form>
      </div>
    </dialog>
  </>;
}
