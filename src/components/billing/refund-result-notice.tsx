"use client";

import { useSearchParams } from "next/navigation";

export function RefundResultNotice() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  if (error !== "refund_already_processed" && error !== "refund_reconciliation_required") return null;

  const requiresReconciliation = error === "refund_reconciliation_required";

  return (
    <p
      role="alert"
      data-testid={requiresReconciliation ? "billing-refund-reconciliation-required" : "billing-refund-already-processed"}
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
    >
      {requiresReconciliation
        ? "付款服務結果尚未確認。系統已保留退款 reservation 並停止重送，請使用該交易的退款終態對帳。"
        : "此交易已完成退款，系統沒有再次送出退款請求。"}
    </p>
  );
}
