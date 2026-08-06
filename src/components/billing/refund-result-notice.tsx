"use client";

import { useSearchParams } from "next/navigation";

export function RefundResultNotice() {
  const searchParams = useSearchParams();

  if (searchParams.get("error") !== "refund_already_processed") return null;

  return (
    <p
      role="alert"
      data-testid="billing-refund-already-processed"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
    >
      此交易已完成退款，系統沒有再次送出退款請求。
    </p>
  );
}
