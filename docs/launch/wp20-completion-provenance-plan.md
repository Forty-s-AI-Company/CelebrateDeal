# WP-20 首次完看紀錄實作契約

狀態：已實作並通過部分整合驗證；獨立深度審查進行中，尚未驗收。單一 writer：root，僅獨立 worktree。

## 已確認缺口

原先 `metricSnapshotInput` 固定輸出 `completions: null`。目前已新增 revision-bound 投影 manifest、隔離計算 worker、受租約保護的寫回與重新載入；只有 coverage 與投遞完整才傳入 durable completions。`orderMetrics` 仍要求持久化紀錄與同一快照的重新計算一致，不能把同一次計算結果複製兩次當對帳。

已完成的證據位於 `docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/`：`completion-nonzero-five-metrics-db.json` 記錄非零五指標整合通過，但整支 runner 的原並行 gate 仍失敗；`completion-expiry-verification.json` 與 `payment-retry-integration.json` 記錄租約到期、worker 接手、候選驗證、來源失效與合成付款重試通過。這些證據不代表 deployed job 或可信 coverage producer 已完成。

## 實作邊界

1. 新增受租戶、場次、內容版本、報名身份、報表時間窗、來源版本約束的完看投影。它是可失效的衍生資料，不能宣稱首次寫入永久正確：延遲到達的區間可能改變首次交點。
2. 投影工作從同一個 read-only RepeatableRead 快照取得完整區間與來源 revision；CPU運算在現有有時限、有記憶體上限的worker進行，不搬回HTTP或主執行緒。
3. 寫回時在ReadCommitted交易鎖定來源版本，核對原revision及目前身份。來源有變就拒絕舊投影。不得將投影自己的寫入加入來源revision，避免自我失效迴圈。
4. 以一份投影manifest證明整個cohort已處理，rows只存真正達門檻者。manifest需包含演算法版本、原sourceRevision、窗起訖、cohort數量、完成狀態。沒有manifest或不完整時仍為null；完整manifest且零rows才是[]。
5. 報表snapshot只讀取同scope、同window、同sourceRevision的完整投影；於計算worker中以原始durable viewing intervals重新驗證交點。來源revision、身份、coverage或投遞完整性失效時不可使用。
6. 日後跨報表window重用不得直接使用window-bound交點；需另定全歷史coverage契約。第一版不冒稱已解決這項語意。

## 驗收與必要測試

- 唯一媒體覆蓋90%，重播不增加、seek不補區間、多裝置重疊與延遲到達仍求最早交點。
- null與已知空集合不同；資料超限、未完整投遞、coverage未知不能產生完整manifest。
- 寫回前來源改變、同時投影、worker中斷、部分rows寫入、重試均不得留下可讀取的部分manifest。
- 跨租戶/場次/版本/身份/window投影拒絕；API角色不得自行寫入或完成manifest。
- 完看後0ms、7天邊界、超過7天、取消訂單、多筆同人訂單對帳。
- 以真實disposable PostgreSQL與隔離worker跑非零五指標整合；所有來源變更令舊投影失效。
- Migration/Permission獨立深度審查及相同snapshot acceptance gate必須通過。

## 回滾與現有阻擋

已新增 completion projection migration、儲存 adapter 與 job 整合；migration 僅在 disposable PostgreSQL 驗證。回滾先停投影 writer、停止傳入 completion executor 並讓輸入回到 null，再移除本 scope 投影物件與 schema 關聯，不能動原始觀看證據或其他 WP 變更。正式環境未授權。
原併發20/20 gate仍FAIL，間歇性SQL錯誤未解，trusted coverage producer與完整worker部署仍待完成；本契約不解除它們。
