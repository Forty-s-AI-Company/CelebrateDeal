# 聯盟佣金與月結撥款（F-044／B03-08，D-31）

## 現行規則（D-31 A：商家自付）

- 聯盟佣金由**商家自己付給推廣夥伴**，再在後台「佣金結算」回報結果（`recordAffiliatePayoutOutcomeAction`）。
- 平台月結（`calculateSettlement`，`src/lib/billing.ts`）**不從商家撥款扣除佣金**。撥款金額（platform 收款模式）＝營收 − 退款 − 金流手續費 − 平台交易手續費 ＋ 前期結轉，佣金不在公式內。
- 佣金照常累計：付款通知在同一交易內寫 `AffiliateCommission` 與 accrual ledger，退款寫負向 reversal；月結時加總當月 ledger，以 `affiliateCommissionCents` 回傳供顯示與對帳，**只回報、不扣除**。
- 跨月退款的佣金 reversal（負數）是商家向夥伴追回的款項，不會讓平台多撥給商家，也不會進入商家的撥款結轉。
- 回歸測試：`src/lib/settlement-affiliate-commission.db.test.ts`（有佣金的月份撥款＝營收−退款−手續費、跨租戶不互相影響）、`src/lib/settlement-carry-forward.db.test.ts`（跨月退款只結轉買家退款）。

## 封測期間

- 佣金只累計、不出款（ROADMAP 第 8 列）。平台本身沒有任何撥款給夥伴的路徑：`AffiliatePayout.payoutItemId` 從未被寫入。
- 封測期間維持「不鎖月結、不撥款」（D-16）。

## 若 D-31 改為 B（平台代扣代付）會影響什麼

改成 B 不是只把扣除加回來；在補齊下列項目前，**不要**恢復扣除，否則商家會被扣兩次（平台扣一次、商家自己付一次）或款項沒有出口：

1. 月結公式：把當月佣金 ledger 加總從撥款中扣除（即本次移除的那一項），並保留 `affiliateCommissionCents` 讓商家看得到扣了多少。
2. 出款路徑：為每位夥伴建立平台 `PayoutItem`，寫入 `AffiliatePayout.payoutItemId`，鎖定月結時一起產生，出款結果回寫到佣金。
3. 停用商家自行「標記已出款」：平台代付後，商家不能再對同一筆 `AffiliatePayout` 回報 paid，否則重複付款。
4. 扣繳與二代健保：平台成為給付人，需要扣繳快照、申報與憑單（`withholdingTaxCents`、`nhiSupplementaryTaxCents` 等欄位目前只在商家政策啟用時使用）。
5. 跨月退款：已出款的佣金遇到退款，要決定由平台向夥伴追回或在下期扣抵（D-32 只處理商家負餘額）。
6. 法遵：平台代收代付可能落入第三方支付登錄範圍，需律師意見（D-31 說明）。
7. 既有月份：切換前已鎖定的月份不可重算；切換後第一個月份要在 runbook 註明生效月，並補 DB 回歸測試（有佣金的月份撥款＝營收−退款−手續費−佣金，且夥伴 PayoutItem 金額＝佣金）。
