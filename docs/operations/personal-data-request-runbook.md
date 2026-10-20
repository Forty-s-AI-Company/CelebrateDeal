# 個資請求處理 runbook

適用：F-070（B04-17）。最後更新：2026-10-21。

隱私權政策（`src/lib/public-policy-content.ts`「保存期間與保護」「使用者權利」）承諾以人工方式處理查詢、更正、停止利用與刪除請求。本文件是處理流程；去識別化工具是 `scripts/anonymize-customer.ts`。

> 保存期限（下文第 6 節）與「哪些資料依法必須保留」需要 owner 依律師建議定案。定案前，本文件的期限與範圍都是暫定值。

## 1. 受理與身分確認

1. 請求只從客服信箱受理（政策公布的 `publicSupportContact.email`）。記錄收件日期，依個資法須在法定期限內回覆（查詢／閱覽 15 日、更正／刪除 30 日，必要時可延長並通知理由）。
2. 確認身分：只要求處理範圍必要的資訊。請求者必須能以**申請時使用的 Email 收信**（寄一封確認信，請對方回覆）。不要要求身分證影本。
3. 確認範圍：哪個商家（vendor）、要查詢、更正、停止利用還是刪除。CelebrateDeal 是商家的受託處理者，報名與訂單資料屬於商家的客戶；刪除請求應同步通知該商家，並確認商家沒有依法保留的需求。
4. 在工單記錄：請求類型、商家 ID、收件與回覆日期、處理人。**不要在工單、Slack 或 commit 中寫入請求者的姓名、Email、電話或 customerKeyHash。**

## 2. 定位資料

- 每位客戶在每個商家都有一個不可逆的識別碼 `customerKeyHash`＝`HMAC-SHA256(vendorId + "\n" + 小寫 Email)`（`automationCustomerKeyHash`，金鑰由 app 的 sensitive-data key 衍生）。同一個 Email 在不同商家的 hash 不同，因此一次只處理一個商家。
- 工具會用 hash 找到：`FormSubmission`、`CommerceOrder`（`automationCustomerKeyHash`）、`ConsultationBooking`、`CourseCommunityPost`／`Reply`、`CustomerCrmRecord` 的顧問筆記、`StudentPortalAccessToken`；再由報名紀錄找到 `LiveChatMessage`、`LivePrivateChatMessage`。舊資料若 `customerKeyHash` 為 NULL，工具會以 Email 重新計算 hash 比對。
- 計算 hash 不需要把 Email 寫在指令列：用環境變數 `ANONYMIZE_CUSTOMER_EMAIL` 傳入，工具在程序內計算後即丟棄。

## 3. 先 dry run

工具只接受兩種目標，其餘一律在連線前拒絕：

- loopback 上的 `celebratedeal_*` 白名單庫（演練用）。
- 經核准的 GitHub Actions workflow：`GITHUB_ACTIONS=true` 且 `PERSONAL_DATA_REQUEST_WORKFLOW=true`。Production 只能走這條路，需 owner 核准；workflow 尚未建立，第一次處理正式請求前由 owner 決定是否建立，或改由 owner 在受控環境手動執行。

```bash
# 預設 dry run：只輸出各表筆數，不改資料
ANONYMIZE_CUSTOMER_EMAIL='<請求者 Email>' \
  npx tsx scripts/anonymize-customer.ts --vendor-id <vendorId>
# 或已知 hash 時
npx tsx scripts/anonymize-customer.ts --vendor-id <vendorId> --customer-key-hash <hash>
```

輸出只有筆數，例如 `{"mode":"dry-run","target":"loopback","formSubmissions":2,"commerceOrders":1,...,"personalDataEmitted":false}`。把筆數記到工單。全部為 0 時，確認 Email 拼字與商家是否正確，必要時請請求者提供訂單編號，再由訂單反查商家。

## 4. 執行去識別化

確認 dry run 筆數合理、商家已知悉後執行：

```bash
ANONYMIZE_CUSTOMER_EMAIL='<請求者 Email>' \
  npx tsx scripts/anonymize-customer.ts --vendor-id <vendorId> --execute
```

全部在一個 Serializable 交易內完成，失敗會整批回滾，可直接重跑。完成後再跑一次 dry run，應全部為 0（hash 連結已清除）。

### 會被覆寫的欄位

| 資料 | 處理 |
|---|---|
| `FormSubmission` | 姓名改為「已去識別化」、Email 改為每列唯一的 `anonymized+<id>@redacted.invalid`、電話與自訂答案清空、`customerKeyHash` 清空 |
| `LiveChatMessage` | 顯示名稱與內容改為固定文字 |
| `LivePrivateChatMessage` | 以原本的加密範圍重新加密固定文字 |
| `CommerceOrder` | 買家 envelope 以固定文字重新加密；遮罩姓名／Email 改為「已去識別化」；電話、收件 envelope 與摘要、追蹤 context 清空；`checkoutIdentityHash` 改為去識別後的指紋；`automationCustomerKeyHash` 清空 |
| `ConsultationBooking` | 姓名、Email、電話、答案、會議連結改寫或清空，`customerKeyHash` 清空 |
| `CourseCommunityPost`／`Reply` | 作者名稱與內容改為固定文字（保留列，避免討論串斷裂） |
| `ConsultantNote` | 筆記內容改為固定文字 |
| `StudentPortalAccessToken` | 刪除（登出學員入口） |

### 刻意保留（依法或財務需要）

- 訂單金額、狀態、品項、付款、退款、佣金、結算、撥款：會計與稅務紀錄（商業會計法、稅捐稽徵法），不刪除。
- 電子發票與 `invoiceRequestEncryptedEnvelope`：發票資料依稅法保存。
- 以 hash 為鍵的假名資料：`CustomerTagAssignment`、`CustomerCrmRecord`（狀態）、`SalesProjectCustomer`、`CourseLessonProgress`、`LearnerNotificationPreference`、`AutomationVoucherGrant`、`CourseCommunityReaction`。這些表只有 hash，沒有直接識別資料；由於報名與訂單上的 hash 已清空，無法再與姓名或 Email 連結。若請求者要求連同學習紀錄一起刪除，需另外由 owner 決定是否刪除課程權益。

### 工具不處理、需人工確認

- `EmailDelivery`、LINE 綁定與通知紀錄、`TrackingDelivery` payload、`AnalyticsEvent`（`visitorId`）、`AuditLog`（第 6 節的保存期限清理會逐步處理後兩者）。
- 商家自行匯出到系統外的名單（CSV、廣告平台受眾）：通知商家自行刪除。
- 備份：邏輯備份中的舊資料會依備份保存期限自然汰換；不從備份中逐筆刪除，但還原時必須重跑本工具（在還原紀錄中記下已處理的請求清單）。

## 5. 回覆與結案

- 回覆請求者：已處理的範圍、依法保留的資料類別與理由。不要附上任何資料內容。
- 查詢／閱覽請求：在商家後台的客戶頁（`/customers/<customerKeyHash>`，目前沒有匯出功能）檢視該客戶的報名與訂單摘要，整理成文字後經 owner 檢查再寄出；不要直接給資料庫內容。
- 更正請求：請商家在後台更正，或由請求者重新報名；工具不處理更正。
- 工單記錄 dry run／execute 的筆數輸出、執行日期與執行人，結案。

## 6. 保存期限（自動清理）

`/api/cron/data-retention`（排程見 `docs/launch/scheduled-jobs-runbook.md`）每日處理：

| 資料 | 動作 | 預設期限 | 環境變數 |
|---|---|---|---|
| `WebhookEvent` 原始 payload | 移除 `raw`、`diagnostics`；保留列、冪等鍵與已遮罩的 `normalized`（退款證明與重試告警會用到） | 180 天 | `DATA_RETENTION_WEBHOOK_PAYLOAD_DAYS` |
| `AnalyticsEvent` | 刪除（`TrackingDelivery` 串聯刪除） | 365 天 | `DATA_RETENTION_ANALYTICS_EVENT_DAYS` |
| `AuditLog` IP | `ipAddress` 清空，保留稽核列與 user agent | 365 天 | `DATA_RETENTION_AUDIT_LOG_IP_DAYS` |

- 天數必須是 30–3650 的整數；設定不合法時 endpoint 回 503，不做任何清理。
- 預設期限是暫定值。**owner 依律師建議定案後**：設定上述環境變數、開啟 `SCHEDULED_JOBS_ENABLE_DATA_RETENTION`，並同步修改隱私權政策「目前沒有依時間自動刪除的機制」這句。
- `received`、`retrying` 狀態的 webhook 事件不論多舊都不處理。
- 每類每次最多處理 20 批 × 1000 列；回應 `remaining=true` 表示還有剩，隔天會接續。

## 7. 中期改善（未在本次處理）

- `FormSubmission` 的姓名、Email、電話改為加密欄位，搜尋改用 HMAC（B04-17 建議）。
- 建立 `personal-data-request.yml` workflow（`workflow_dispatch`、`production` environment 審核、只輸出筆數），讓 Production 請求不必人工連線資料庫。
