# 訂單統計失效：交易相容性檢查

狀態：設計中，未實作、未驗收。

## 已確認來源
- src/lib/payment-webhooks.ts:1237 使用 Serializable；commerce-shipping-action.ts:34 同樣使用 Serializable。
- 20261014120000_live_metric_evidence/migration.sql 的 version guard 拒絕非 Read Committed 更新。
- 同 migration 的 report create/claim/finish 先鎖 LiveMetricVersion FOR UPDATE，再修改 report。
- readMetricOrderPage 讀取 CommerceOrder.status/createdAt/vendorId/primaryPaymentTransactionId，以及 PaymentTransaction.vendorId/metadata 的 formSubmissionId/sourceLiveId/billingPurpose。

## 不可直接沿用的做法
在付款 trigger 更新 LiveMetricVersion.sourceRevision 會經過其 Read Committed guard，因此不能直接搬用。只更新已存在報表也不足以證明與新報表建立、舊快照 finish 之間沒有競態。不能降低付款 isolation 或吞掉失效寫入失敗。

## 下一個實作方向與待證明事項
使用獨立訂單來源 generation，付款來源變更與 generation 更新須同一交易；報表建立、snapshot 與 finish 均比較或鎖定同一 generation。獨立 generation 不修改收集版本啟停政策。先確定 vendor/live 粒度、初次建列競態與跨來源轉移的舊新 scope，再實作 migration。需要先審查鎖順序：付款列/訂單列 -> generation，報表 generation -> report，讀報表不得反向鎖付款列。這是候選設計，尚未證明無死鎖。

## 必須涵蓋的變更
訂單新增、刪除、draft 轉有效、取消與撤銷取消、createdAt/付款連結/vendor 變動；付款歸因三個 metadata 欄位與 vendor 變動、刪除。舊與新 scope 都必須失效。無關金額或描述變動不應無條件掃描全部租戶。

## 必要測試（均尚未執行）
1. Read Committed 與 Serializable 付款更新皆可完成，舊結果拒絕 finish。
2. finish 先提交與付款變更先提交兩種順序；報表建立並行；第一次 generation 建立並行。
3. 取消、draft 轉有效、歸因搬移、刪除、其他 vendor 隔離。
4. 付款 rollback 不產生失效 generation；重試不遺失變更。
5. 既有付款整合測試與獨立深度 Migration/Payment 審查。

安全範圍：只在獨立 worktree 設計及 disposable PostgreSQL 使用合成資料驗證；未操作正式資料或部署。
