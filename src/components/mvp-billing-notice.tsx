/** 商業階段說明不取代伺服器政策，也不隱藏既有帳務。 */
export function MvpBillingNotice({ kind }: { kind: "usage" | "commission" }) {
  return (
    <aside aria-label="首發收費範圍" className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
      {kind === "usage"
        ? "用量超額計費已正式啟用。新產生的月結帳單會依方案費率計入觀看分鐘、活動、推廣者與儲存分鐘的超額費用；歷史帳單維持原始金額，不會回溯重算。"
        : "聯盟推廣與團隊分潤已啟用。新佣金會在付款成功後寫入帳本；退款沖回、爭議及應付款項仍依原權限處理。"}
    </aside>
  );
}
