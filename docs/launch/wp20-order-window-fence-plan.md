# WP-20 訂單時間窗來源版本修正

狀態：實作設計，尚未完成；不可標成驗收通過。

## 已定位問題

112 版的 tenant ledger 與既有 vendor/live order ledger 都沒有訂單成立時間。只把 tenant COUNT 改成時間窗查詢仍會被舊 inputOrderRevision 擋住。不得單獨移除其中一道檢查而宣稱解決。

## 預定邊界

- 新 order window event 必須攜帶 vendorId、訂單 createdAt（UTC 時間語意與 CommerceOrder timestamp 一致）；無需客戶或付款內容。
- CommerceOrder INSERT/DELETE/UPDATE 記錄舊及新 vendor/date。draft 轉換、取消、ID、primary payment、日期與租戶移動均須覆蓋。
- PaymentTransaction 變動須找舊/新 payment ID 關聯的全部訂單，為各 affected order 的 vendor/date 記錄事件；metadata 缺失仍須覆蓋，不以 attribution JOIN 篩掉來源。
- 尚未連結訂單的 payment 不屬於已成立訂單全集；後續 order INSERT/link 必須記錄對應時間。此處須兩連線交錯測試，不能只看順序執行。
- 舊 ledger 事件沒有 date，不回填猜測。新時間窗證據使用新版本/新 provenance 欄位或明確失效遷移；所有舊 proof/report 必須維持 unknown/stale，不能把0當歷史完整。
- immutable UPDATE/DELETE、no TRUNCATE、API revoke/RLS沿用；不改為共享 counter UPDATE，以免惡化未通過的 Serializable gate。

## 單一 writer 與原子切換範圍

root sole writer；不部署。需一起更新 order audit context/digest、producer prewrite、coverage guard/reader、report guard/create/claim/finish、completion publish/read、report context/interval/ready及snapshot cache key。每一個窗口必須包含start/end，禁止同一facade跨window重用。

不能繼續同時要求全tenant/scoped order COUNT相等而宣稱window liveness已完成。新舊proof辨識與兼容策略須先明確，沒有可驗證轉換時保守stale。

## 必須保留的驗收

1. 同scope已結束window，持續新增window外訂單，報表仍能create/claim/finish/read ready。
2. window內任一訂單/primary payment/metadata/身份/取消變更，舊proof和ready report失效。
3. createdAt跨邊界，old和new window都失效；vendor移動兩租戶都失效。
4. payment修改與order連結/新增的兩連線交錯不得漏事件。
5. 未歸屬訂單仍可阻止complete；不得僅保留匹配JOIN。
6. 空window、legacy unknown、rollback、idempotence及forced collision保持既有規則。
7. 100k orders/1m events、reader10k audits及原同步Serializable付款gate，均依真實收據驗證。
8. Critical migration/permission/payment獨立審查，未驗證項目不能PASS。

## 目前限制

registration與其他metric sourceRevision亦可能比報表window寬；本設計只處理order來源變動的liveness，不宣稱其他來源的持續流量已解決。修正不得移除來源驗證或縮小使用者完整統計目標。

## 回滾

僅獨立非正式環境，停新publisher，report/proof讀取保守unknown；保留原商業資料與append-only來源。正式資料庫無授權操作。


## 反向 link race 實測缺陷

`order-window-reverse-link-race-failure.json`：payment transaction 已完成 UPDATE/trigger，但尚未 commit；另一連線將 primary payment 由原 window 訂單改連到新 window 並 commit。此時新 window 可見新 link 及舊 payment metadata。之後 payment commit 僅公開先前針對舊 link 記錄的事件，新 window revision 不增加。測試明確在 payment commit 前確認舊 metadata 仍可見，commit 後要求新 window revision 增加而失敗。不能將先前 forward schedule PASS 外推為所有順序安全。

修正需讓 payment 內容提交與 order link 可見性有共同序列化邊界，或讓 revision 額外涵蓋 payment 自身不可變來源版本。不可只多查一次 COUNT 或調整 assertion。候選最小方案為 link 變動時鎖定相關 payment rows，與 metadata UPDATE 的 row lock 衝突；需按固定順序鎖定、限制鎖範圍，並驗證兩向交錯、rollback、deadlock/timeout及原 Serializable gate。此方案尚未實作或核准為正確解答，需比較對 paid checkout 與 existing trigger 的影響。保留 failing regression，未修復前禁止宣稱 window provenance 完整。


### 115 serialization 修正與驗證

已加入 CommerceOrder BEFORE row trigger：INSERT/DELETE 或 vendor/payment/date 變動，依 vendor/payment ID 固定順序 FOR SHARE 鎖定 old/new payment rows，鎖持續至 commit。SHARE 與 payment UPDATE 的 NO KEY UPDATE 衝突，KEY SHARE 不足。無關欄位 UPDATE 不新增此鎖。migration 增加既有 version sourceRevision，防止先前競態簽發的證明繼續有效；有既存資料的 upgrade 演練仍待。

兩真實連線測試改為由 pg_blocking_pids 明確觀察 follower 被 leader 阻擋，再讓 leader commit，最後驗證兩 window revision 與最新 metadata。payment-first 與 relink-first 均 PASS，115 migrations 整合 PASS。舊 failing test 原文保存在 evidence/order-window-reverse-link-race-before-fix.mjs，不能在新增鎖後仍要求 follower 在 leader 未提交時先成功，那正是本次禁止的執行順序。尚未完成多筆交易的deadlock/timeout、原同步Serializable gate、既存資料upgrade及Critical review；不得宣稱全部安全驗收完成。


### 117 升級前 snapshot 修正

116 writer drain實測不足：先開RR payment快照、以115function提交relink、再套用116 lock/function/version bump，舊RR仍成功更新payment且destination window revision不變。receipt `order-upgrade-snapshot-116-failure.json` 保留。

117在同一transaction內drain writers、安裝116同等runtime function，再對所有當下linked payment執行metadata原值UPDATE，建立MVCC version，最後bump LiveMetricVersion。當下unlinked payment不在已成立訂單window；往後link會透過runtime function寫payment並產生order event。新replay protocol實測舊RR收到P2034、無不安全commit。測試以實際117 function/touch及同lock/bump步驟執行於populated disposable DB；不是正式環境升級。117 migrations與callback死鎖/一次帳務/duplicate回歸PASS；整批linked payment write的負載與獨立upgrade review未完成，不宣稱上線準備完成。
