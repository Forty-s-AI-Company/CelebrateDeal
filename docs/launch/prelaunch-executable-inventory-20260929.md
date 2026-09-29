# 首發前可執行工程清單

更新：2026-09-29（Asia/Taipei）。基底為 `origin/master` `bdbae2f53491afd518b97ee597e117d6a585b55c`；固定 staging 應用來源仍為 `5d5b814681525427ae8f787a75b7ef27fa64ed29`。本清單是工作入口，不是上線核准。首發假設為受邀商家、小規模付費、一次付款。

工程候選的完成結果、測試與剩餘阻擋見 [prelaunch-engineering-receipt-20260929.md](prelaunch-engineering-receipt-20260929.md)；表格保留原始盤點與驗收目標，不能用本機通過取代固定 Staging 收據。

## 判讀方式與現有收據

- `已驗證`：精確來源與範圍有可追溯成功收據。
- `已實作未驗證`：程式或 SOP 存在，但缺這次首發所需的實際收據。
- `尚未實作`：必要流程或保護邊界缺程式。
- `外部阻擋`：需本人、供應商或正式環境操作才能解除；不阻擋其他項目。
- `尚未整合`：舊分支有候選實作，但目前 master 未接收。
- `尚未盤點`：尚無足夠證據判定實作或風險。

已重新核對 GitHub run 狀態與下載的去識別 artifact：核心桌面／手機 [36410155519](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36410155519)、R2 [36410321901](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36410321901)、一般 PayUni Sandbox 付款 [36416149015](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36416149015)、Stream [36496147482](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36496147482) 均為 completed/success。四份 artifact 的 `sourceSha` 均為 `5d5b8146`。付款 artifact 的 `refundCompleted`、`reconciled` 是 false；Stream artifact 的 `accountCredentialIsolation`、`nonProductionScope` 是 `UNVERIFIED`。此處不重跑已成功的外部副作用。

## 依賴順序

| ID／狀態 | 來源及實際影響 | 依賴與下一個可自主動作 | 驗收標準 |
| --- | --- | --- | --- |
| WP2-A 付款方式 setup：**共通候選已實作並通過離線測試；PayUni adapter 未實作** | 本候選新增短效 consent intent、租戶／actor 綁定、nonce 摘要、一次性 callback 消耗與限定 UPP 目的地；獨立複審無 finding。`src/lib/payment-providers/payuni.ts` 仍缺三個 setup 方法，固定站尚無真實綁卡收據。商家無法取得真實 verified reference，專案發布仍受阻。 | 取得可核對的官方 UPP／Token 欄位與 Sandbox merchant 核准後才接 PayUni adapter。欄位不明處維持 fail closed。 | 7 檔 31 項離線／disposable PostgreSQL 測試與 80 筆 migration 部署通過；未核准或未簽章不能寫入 verified reference；真實 provider callback 與綁卡收據仍缺。一般付款收據不得充當綁卡收據。 |
| WP2-B PayUni Token／幕後授權：**外部阻擋** | [官方契約盤點](payuni-token-contract-20260929.md)：功能與 IP 核准狀態不確定，首次交易與 `CreditHash` 欄位契約未完全確認。不能猜測零元 setup，也不能進行綁卡交易。 | 本人向 PayUni 確認 Sandbox 商店功能、申請表、IP 及首次交易／callback 欄位；工程仍可完成共通邊界。 | 官方非敏感回覆或後台狀態收據，清楚標出商店、環境、功能、IP、必要欄位與首次交易條件。 |
| WP3-A 專案正常發布：**已實作未驗證** | `src/app/actions/sales-workspace-actions.ts` 正常 action 檢查有效價格商品、Funnel、直播／可預約諮詢與有效 verified payment method；[固定站唯讀診斷](CURRENT.md)的合成專案仍為 DRAFT，公開頁 NOT_FOUND。 | 逐步核對建立、編輯、保存與前置條件。WP2-B 未解除前，保留發布驗證，不直接改 DB 狀態。 | 以正常 action 發布具備合法依賴的合成專案；同一來源的匿名 desktop/mobile 公開內容、表單與非付款 checkout 階段通過。未取得 verified reference 時只能回報精確阻擋。 |
| WP3-B Funnel／表單／checkout 非付款階段：**已實作未驗證** | [NEXT-CYCLE](NEXT-CYCLE.md) 記錄建立、模板、編輯、儲存、Funnel 發布成功，但完整匿名旅程、表單提交與 checkout 非付款階段缺固定站收據。 | 使用離線合成測試先找可重現缺陷；固定站只用已確認隔離的合成 vendor。 | 建立、保存、公開渲染、表單與 checkout admission 各有明確結果；本機測試與固定站結果分開記錄。 |
| WP3-C 訂單交付權限：**已實作未驗證** | `src/lib/commerce-order-fulfillment.ts`、`src/lib/commerce-orders.db.test.ts` 有交付與全額退款撤權邏輯；一般 Sandbox 付款收據只證明 paid order 持久化。 | 檢查 paid、partially_refunded、refunded 的實際 entitlement 與租戶邊界；使用合成／disposable DB。 | 可追溯的交付權限測試與必要 staging 唯讀收據；退款後不能保留不應有的數位存取。 |
| WP4-A 退款狀態邊界：**已實作未驗證** | `src/lib/commerce-order-domain.ts` 與退款流程已有金額上限及冪等保護；舊 [Sandbox WP-103/104/105](../operations/payment-refund-support-incident-sop.md) 收據支持部分情境，但不是目前來源的完整矩陣。 | 針對全額、部分、重複、超額、逾時及結果不明檢查程式與離線測試；重用既有付款收據。 | 同一候選快照的合成測試、拒絕及 fail-closed 路徑通過；不發新付款、不退款、不重送舊不明交易。 |
| WP4-B 付款／退款對帳：**已實作未驗證** | 一般付款 artifact 的 `reconciled=false`；[solo founder 標準](solo-founder-launch-standard.md)要求可信的 provider／local 金額、狀態、reference 一致性。 | 先分析去識別既有收據，再做受控唯讀核對；必要外部欄位或權限獨立列出。 | provider 與本地訂單、交易、退款狀態及 reference 一致；UNKNOWN／MISMATCH 不能標為 ready。 |
| WP5-A migration 與備份還原：**已實作未驗證** | [staging 備份還原設計](staging-backup-recovery.md)限 `public` schema；既有 runner／workflow 已存在，但目前來源、受保護 artifact 與新 staging 密鑰需重新核對。 | 先做 SQL／ACL／RLS 靜態盤點，再用 disposable PostgreSQL 演練 migration 與還原；不碰正式資料。 | 目前候選的 migration 相容性、應用 schema 還原及回復點有去識別實測收據；完整平台／媒體／設定復原另外列界線。 |
| WP5-B 固定 staging 更新：**已驗證舊來源；新候選未驗證** | 現有 alias 及核心／R2／付款／Stream 收據都綁 `5d5b8146`，不能沿用到新應用 SHA。 | 只有候選需要部署時才先證明 Preview 身分、來源、資料隔離、migration 相容性與回復點，再切換。 | 切換前後同一候選的 lineage、alias、核心桌面／手機與受影響旅程通過；Production 仍不執行。 |
| WP6-A 工作排程／通知：**已實作未驗證** | `src/app/api/jobs/email-deliveries`、`webhook-retry`、LINE notifications 等已有程式；[staging cron 說明](staging-cron-operations.md)指出 Preview 未註冊 Cron，實際排程與寄送收據未齊。 | 審查去重、失敗重試、耗盡告警與合成測試；不向真實使用者寄信。 | 合成事件可驗證唯一投遞、有限重試、exhausted 可觀察；排程與正式送達需另外收據。 |
| WP6-B 客服／退款／資料請求 SOP：**已實作未驗證** | [付款退款事件 SOP](../operations/payment-refund-support-incident-sop.md)是本機草案；[政策 review matrix](cat10-policy-review-matrix-20260821.md)尚待真人決定。 | 補充具體入口、停止條件、角色與去識別回覆模板；準備 owner 可直接審的欄位。 | SOP 可按 P0/P1/P2 與資料請求情境執行演練；真人接受與政策生效保持 `PENDING_HUMAN`。 |
| WP6-C 政策文字：**已實作未驗證** | `src/lib/public-policy-content.ts` 有公開文字；退款、隱私保存期限、商家責任及適用範圍尚無真人確認。 | 整理完整草稿與待決欄位，不宣稱法律核准。 | Terms、Privacy、Refund、retention/data request 各有版本草稿、待決欄位與 owner 決議位置。 |
| Stream 帳戶隔離：**外部阻擋** | [Stream 收據](stream-resource-receipt-20260929.md)資源旅程 PASS，但同一已見 library 含 Production 命名資源；帳戶／憑證隔離未證實。 | 本人或 Cloudflare 管理者提供專用非正式帳戶及權限範圍的去識別證據。不讀取既有 library，不重跑成功資源旅程。 | `accountCredentialIsolation`、`nonProductionScope` 由可審查帳戶與憑證權限證據轉成 VERIFIED。 |
| #210／#211 額外產品：**尚未整合** | [差異盤點](integration-inventory-20260924.md)顯示學員入口、LINE 圖文選單、聯盟入口等尚未逐項移植；首發未承諾完整自助能力。 | 僅在首發依賴成立時比較 master 替代實作與必要差異；不整包合併。 | 每個需要移植的垂直切片有功能、schema、權限、測試與獨立審查；其餘保留決策點。 |
| 其他商家日常操作與外部服務：**尚未盤點** | 目前證據主要集中核心瀏覽、R2、付款及 Stream；不能從舊 readiness 分數推論所有服務已通過。 | 按首發流程逐段盤點，新增有來源的缺口；不為未選首發功能建立假 blocker。 | 每個首發必要路徑都有來源、可重現影響、依賴、責任與可驗收結果。 |

## 既有 CI 與不可逾越邊界

`.github/workflows/ci.yml` 已在每次 push 執行 `npm run lint`、`npm run test:coverage` 及其他檢查；本輪沿用，不新增重複 workflow。所有新程式須檢查安全、效能、可讀性與可維護性，且不降低 assertion、coverage、fail-on-flaky 或驗證強度。

正式部署、正式資料、付款、退款、綁卡交易、正式寄信與不可逆外部操作不在本次授權。`ENGINEERING_READY`、`CORE_STAGING_READY` 與正式上線完成分開判斷。
