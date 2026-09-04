/** 商業階段說明不取代伺服器政策，也不隱藏既有帳務。 */
export function MvpBillingNotice({ kind }: { kind: "usage" | "commission" }) {
  return (
    <aside aria-label="首發收費範圍" className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
      {kind === "usage"
        ? "首發不新增用量超額費用。方案額度用完會阻擋新增用量，請升級方案；查單、退款與客服仍可使用。既有帳單與應付款項保留。"
        : "聯盟推廣與團隊分潤已啟用。新佣金會在付款成功後寫入帳本；退款沖回、爭議及應付款項仍依原權限處理。"}
    </aside>
  );
}
