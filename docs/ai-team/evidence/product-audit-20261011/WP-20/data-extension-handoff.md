# WP-20 尚缺資料的落地提案

> 2026-10-14 最新決策：使用者於確認「照完整統計提案直接做」後明確回覆「核准」。M-1 全部公式與 M-2 必要紀錄、身分串接及 additive persistence 已核准在非正式環境實作及合成資料驗證。下文的 DRAFT／WAITING_AUTHORIZATION 為歷史提案文字，不再阻擋此範圍；D-2～D-6、正式資料收集、正式保存政策與正式部署仍未核准。測試資料於隔離環境 teardown 清除，不自行設定正式保存期限。實作與驗收尚未完成。

狀態：DRAFT / WAITING_AUTHORIZATION。這是可審查範圍，不是實作或資料追蹤授權。既有非 Production 執行授權仍有效，不需再次核准跑測試或部署 Preview。D-2～D-6 保留延後。

## 已確認與尚待決定

已核准並有純函式驗證：不重複實際播放區間達影片90%算完看；首次完看後7天內成立且未取消的訂單算符合下單条件，不代表付款。

未決業務語意仍是 metrics-contract-proposal.md 的其餘 M-1：報名率採不重複瀏覽器、到場率採報名 cohort、平均時長採同人牆鐘區間聯集，以及直播/重播時間窗。這些不應被執行環境的概括授權替代。

M-2 是新增資料蒐集與保存契約；原 WP-20 明列不改事件寫入。資料保存多久、追蹤告知和同人連接需人類決定，其中告知與 D-5 有關。不得用合成事件灌入正式 read model 宣稱實現。

## 現有來源與缺口

- AnalyticsEvent 只記 admitted session identity；play_progress 僅允許30/60/120/300/600秒。
- live-playback.tsx 依目前播放位置送 checkpoint；快轉也可能跨過 checkpoint，不能證明連續觀看。
- LiveViewerSession 沒有穩定 FormSubmission identity；多 session 不能當多個人，也不能自行合併。
- 現有資料不足以確定首次90%時刻；不能用事件接收時間或最後一筆checkpoint冒充。
- StreamUsageLedgerEntry 是成本用量帳，不改寫成個人行為分析來源。

## 建議的精確工作分割（尚未實作）

| 工作 | ownership / 候選檔案 | 行為與驗收 | 依賴 / 審查 |
| --- | --- | --- | --- |
| M2-A 身分與影片版本契約 | root：src/lib/live-quota-admission.ts、src/app/api/live-admission/route.ts、prisma/schema.prisma；對應 tests | 由既有驗證資格取得同租戶報名識別；由伺服器決定影片版本、長度；缺失保持 unavailable，不能相信 client supplied personId/vendorId | M-2、D-5；Auth/Permission/Migration 獨立深度審查 |
| M2-B 播放區間事件 | root：src/components/live-playback.tsx、src/app/api/analytics/route.ts、新增 src/lib/live-viewing-evidence.ts 及 tests | 固定上限的小批次實際播放區間；seek/pause/buffer/replay/速率變更分段；伺服器驗證 active session、版本、單調序號、範圍、總量與重送冪等；以播放器回報表示暴露量，不宣稱真人注意力 | M2-A；Auth/Permission 獨立深度審查 |
| M2-C additive persistence | root：prisma/schema.prisma、核准後新建單一 migration；disposable DB test | 分開存內容版本、受驗證session與去重interval，複合租戶外鍵；舊資料不得補猜；伺服器接收時間與播放器時間分開，精度界限明示 | M-2保留期限與時間精度決定；Migration 獨立深度審查 |
| M1/M2-D read model | root：新增 src/lib/live-core-metrics-read-model.ts、lives/[id]/analytics/page.tsx 與 tests | 輸出每項available/unavailable/not_applicable與分母/視窗；同人同版本區間聯集；下單只唯讀已成立狀態及取消狀態；不改 Payment/Billing 寫入 | M-1剩餘公式與M2-A～C；一般審查，若改權限或訂單行為則重新切scope |
| M2-E 報名頁分母 | root：analytics route與報名元件的精確入口在核准後展開 | 第一方瀏覽器去重與驗證後連接；不能把跨装置等同同人；不把admitted page_view當報名前流量 | M-1瀏覽器分母、M-2、D-5；涉及身分連接獨立深度審查 |

此表不是任意修改整個目錄的許可。每段開始前須列具體檔名、鎖定單一writer、產生snapshot並由router選模型，不固定實作模型。付款路由、既有发布閘門和正式資料都不在範圍。

## 驗收與回滾

全以合成資料驗證：同租戶/跨租戶、同人多session、重疊裝置、seek跳段、重播不增覆蓋、倍速牆鐘、內容換版、零分母、缺資料、重送及延遲事件、90%邊界、首次完看前訂單、7天邊界、取消、觀察未滿7天。期間與去重規則未決前不得將預期值寫成已核准。

資料新增前預設不收集；完成核准後先在disposable PostgreSQL驗证migration及rollback，Preview只用合成fixture。回滾先停新增收集入口，再精確回復該scope的code；不drop既有資料、不逆轉其他WP或用全域Git restore。任何正式部署/資料處理仍另需授權。

## 本輪可完成部分

分析頁顯示已核准90%與7天規則，移除過時「完看標準尚未就緒」描述；5項數值仍如實顯示尚不可計算。這只完成規則呈現子項，不代表五項指標整包完成。Evidence在rule-display/。
