"use client";

import { useMemo, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { formatCurrency } from "@/lib/format";

type RefundOption = {
  id: string;
  providerName: string;
  eventIdentity: string;
  amountCents: number;
};

export function SupportRefundSelection({
  refunds,
  requestedAmountCents,
  currency,
}: {
  refunds: RefundOption[];
  requestedAmountCents: number;
  currency: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedTotal = useMemo(() => {
    const selected = new Set(selectedIds);
    return refunds.reduce((sum, refund) => selected.has(refund.id) ? sum + refund.amountCents : sum, 0);
  }, [refunds, selectedIds]);
  const exactMatch = selectedIds.length > 0 && selectedTotal === requestedAmountCents;

  function toggleRefund(id: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? [...current, id]
      : current.filter((selectedId) => selectedId !== id));
  }

  return (
    <>
      <fieldset aria-describedby="support-refund-selection-status" className="grid gap-2">
        <legend className="text-sm font-semibold text-slate-900">選擇已處理的 canonical refunds</legend>
        <p className="text-sm text-slate-600">
          可選一筆或多筆，合計必須精確等於 {formatCurrency(requestedAmountCents, currency)}。
        </p>
        {refunds.map((refund) => (
          <label key={refund.id} className="flex items-start gap-3 rounded-md border border-slate-200 p-3 text-sm text-slate-800">
            <input
              type="checkbox"
              name="completedRefundIds"
              value={refund.id}
              checked={selectedIds.includes(refund.id)}
              onChange={(event) => toggleRefund(refund.id, event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
            />
            <span>
              <span className="block font-medium">{formatCurrency(refund.amountCents, currency)} · {refund.providerName}</span>
              <span className="mt-1 block break-all text-xs text-slate-500">{refund.eventIdentity}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p
        id="support-refund-selection-status"
        role="status"
        aria-live="polite"
        className={exactMatch ? "text-sm font-medium text-emerald-700" : "text-sm text-slate-600"}
      >
        已選 {selectedIds.length} 筆，合計 {formatCurrency(selectedTotal, currency)}。
        {exactMatch ? " 金額符合，可以完成交接。" : " 請調整到申請金額。"}
      </p>
      <SubmitButton disabled={!exactMatch} pendingChildren="核對中…" pendingMessage="正在核對退款明細，請勿重複送出。">
        以所選 canonical refunds 完成交接
      </SubmitButton>
    </>
  );
}
