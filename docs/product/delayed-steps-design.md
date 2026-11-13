# 延遲步驟：Email 追銷序列與自動化多步驟的共用設計

狀態：F-3（Email 追銷序列）定案，依本文拆 PR 實作。F-4（自動化多步驟與延遲）範圍 owner 已確認；第一個 PR（第 8 節「一併要修的既有缺口」）與第二個 PR（延遲步驟，第 8 節「做法」）已完成，接上 `payment_paid` 在下一個 PR。
日期：2026-11-13。對應 `docs/fable-queue.md` 的 F-3、F-4。

## 1. 要解決的問題

現在所有的信都是「某個事件發生，寄一封」。唯一的延遲機制是 `LiveNotificationRule`，它綁在直播的時間上（開播前後 N 分鐘），不是綁在每個人自己的進度上。所以做不到：

- 報名後第 1、3、5 天各寄一封（追銷序列）。
- 自動化規則「貼標籤，等 2 天，還沒買就寄折價券」。

兩件事需要的是同一個東西：**每個對象各自有一條時間線，到點執行下一步，可以中途停止**。本文只做一套，兩邊共用。

## 2. 現況事實（2026-11-13 盤點）

- 沒有通用的延遲工作表。各領域各自有 outbox（`EmailDelivery`、`LineDelivery` 等），都由 `/api/jobs/email-deliveries` 這支 job 推動。
- job 的頻率：staging 由 GitHub Actions heartbeat 每 5 分鐘呼叫一次；production 的排程平台尚未決定（`DECISIONS-2026Q4.md` D-06），runbook 的提案是每小時，Pro 方案可到 5 分鐘。
- 自動化（`src/lib/automation-workflow.ts`）在觸發的 request 內同步跑完所有 action，沒有延遲。7 個 trigger 中，`payment_paid`、`form_no_show`、`viewer_watch_progress`、`webinar_attended_duration_gte` 找不到正式的呼叫端，實際會觸發的只有 `form_registered` 與兩個諮詢 trigger。
- 自動化寄的信（`trigger: "automation"`）文案寫死，沒有退訂連結，建立時也不查黑名單。只有送出時會被退訂名單擋下。
- 退訂是每個商家各自一份（`EmailSuppression`），黑名單也是（`Blacklist`）。沒有 bounce 或 complaint 的處理。
- 沒有任何 Email 用量上限或計量。
- 沒有 Contact 或名單 model。有明文 Email 的來源是 `FormSubmission.email`；訂單買家 Email 是加密的。

## 3. 共用機制：`DelayedStepRun`

一列代表「一個對象在一條流程上的進度」。

| 欄位 | 說明 |
|---|---|
| `id`、`vendorId` | 租戶欄位，`@@unique([vendorId, id])` |
| `emailSequenceId?` | 複合外鍵 `(vendorId, emailSequenceId)`，Cascade |
| `automationRuleId?` | F-4 的 PR 才加這欄與外鍵；屆時加 CHECK：兩者恰好一個有值 |
| `formSubmissionId?` | 對象是報名者時填。外鍵 Cascade；查詢一律加 `form: { vendorId }` |
| `subjectKeyHash` | 對象的 `customerKeyHash`，用來查「買了沒」與去重 |
| `anchorAt` | 時間線的起點（報名驗證時間、事件發生時間） |
| `cursorDelayMinutes` | 已處理到的步驟延遲值，起始為 -1 |
| `nextRunAt?` | 下一步到期時間；沒有下一步時為 null |
| `status` | `active`、`completed`、`cancelled` |
| `cancelReason?` | `unsubscribed`、`blacklisted`、`purchased`、`definition_paused`、`definition_deleted`、`subject_gone`、`failed` |
| `claimedAt?`、`attemptCount` | 租約與重試，做法比照 `EmailDelivery` |
| `createdAt`、`updatedAt` | |

索引與約束：
- `@@unique([vendorId, emailSequenceId, formSubmissionId])`：同一人在同一條序列只會有一列，重複報名驗證不會重複加入。
- `@@index([status, nextRunAt])`：job 撈到期的列。
- 不存 Email 明文、姓名或任何 token。執行時再從來源（報名）讀。

### 步驟的定位方式

每個步驟的延遲都是「從 `anchorAt` 起算幾分鐘」，不是「距上一步多久」。同一條流程裡延遲值不可重複。下一步＝延遲值大於 `cursorDelayMinutes` 的啟用中步驟裡最小的那個。

這樣定的好處是商家在有人跑到一半時改步驟，行為仍然確定：
- 新增比游標早的步驟：已經跑過那個時間點的人不補寄。
- 刪除或停用步驟：直接跳到下一個。
- 改某一步的延遲：還沒到的人照新時間。

### Worker：`processDueDelayedStepRuns`

掛在既有的 `/api/jobs/email-deliveries`，排在 `processDueEmailDeliveries` 之前，這一輪建立的信同一輪就能送。

每一輪：
1. 撈 `status = active`、`nextRunAt <= now`、商家未停權的列，依 `nextRunAt` 排序，上限 100。
2. 逐列以 CAS（`updatedAt` 加 `cursorDelayMinutes`）取得租約。
3. 檢查停止條件（第 5 節）。成立就標 `cancelled` 並寫原因。
4. 找出下一步並執行。執行與「推進游標、算出新的 `nextRunAt`」在同一個交易內。
5. 沒有下一步就標 `completed`。

規則：
- **一輪一人最多一步。** job 停擺後恢復時，不會一次把累積的三封信一起寄出。
- **逾期超過 24 小時的步驟跳過不寄**，只推進游標。常數具名並寫註解。
- 每一步的產出用決定性 id：`hash(vendorId, runId, stepId, 模板內容)`。重跑同一步只會撞到 unique，不會寄第二封。
- 租約 10 分鐘過期可重領，重試上限 5 次，超過標 `cancelled`（`cancelReason: "failed"`）並 `captureOperationalError`。

### 吞吐量（PR 1 審查 S1、第二輪 MAJOR 1–3）

- 序列相關工作排在 job 每一輪的**最後**（所有有時效的信、LINE、學員通知、清理之後），順序是補漏 → worker → 寄序列信。這一輪跑超過 60 秒才輪到序列時整段跳過（並送出一筆 `email_sequences_skipped` 監控事件）、留給下一輪；序列工作在這一輪開始後 100 秒停止接新的項目，已開始的寄送最多再 10 秒，所以整輪約 110 秒內結束，早於排程 runner 的 120 秒逾時（`scripts/scheduled-jobs-runner.mjs`）；route 的 `maxDuration` 300 秒只是平台上限。寄序列信這一段最多 20 秒。
- 寄送：有時效的信沿用每輪 20 封；序列信另用每輪 20 封（`SEQUENCE_EMAIL_DISPATCH_LIMIT`），兩者的回收卡住租約也各算各的。
- 建信：worker 每輪最多建「20 封減去還在佇列（排隊、重試中、寄送中）的序列信」，所以佇列中的序列信不會超過一輪能寄的量；同一人前一封還在佇列時，下一步會等。積壓留在 run 上，延遲一律從步驟自己的到期時間算，晚超過 24 小時的步驟在 worker 開始前就以一次更新整批跳過（不佔名額；更新前先對涉及的序列取 `FOR SHARE`，不會蓋掉商家同時存好的步驟）。序列信建立後 6 小時仍未寄出，寄送前會被略過，**那一步對那個人不會再寄**（游標已經推進）。沒有設定寄信服務（API key 與可解析的寄件者）、網址或金鑰時，worker 這一輪不建任何信、run 原封不動，每輪只回報一筆監控事件。
- 公平：起始商家每輪隨機（另加一個依時間均勻分布的位移，就算亂數一直相同也不會固定漏掉同一家）；每一家的份額在輪到它時重算＝「剩下的額度 ÷ 剩下的商家數」（至少 1），用不完的自然流給後面的商家；第一圈跑完若還有額度，再分給用完份額、仍有到期 run 的商家（最多兩圈）。商家數比額度多時，每家平均約「商家數 ÷ 額度」輪會輪到一次。
- 因此全平台的序列信上限約為「每輪 20 封 × job 頻率」：每 5 分鐘一輪是每小時 240 封，每小時一輪是每小時 20 封。一場 500 人的直播，同一步要花很多輪才寄完，排在後面的人可能晚數小時，超過 24 小時的會被跳過。**開放給一般商家前，owner 需決定 job 頻率與這些額度（見第 9 節第 7 點）。**

### 時間精度

精度等於 job 的頻率。production 若是每小時跑一次，「10 分鐘後」的步驟實際可能晚 50 分鐘。因此 UI 的延遲單位只提供小時與天（最小 1 小時），不提供分鐘。

## 4. F-3：Email 追銷序列

### 資料模型

`EmailSequence`
- `vendorId`、`name`、`liveId`（複合外鍵到 `Live`，Cascade）、`status`（`draft`、`active`、`paused`）、`activatedAt?`、`stopOnPurchase`（預設 true，第二個 PR 才生效）、`version`（樂觀鎖）。
- 第一版一條序列綁一場直播；對象是這場直播已驗證 Email 的報名者。

`EmailSequenceStep`
- `vendorId`、`emailSequenceId`（複合外鍵，Cascade）、`delayMinutes`、`messageTemplateId`（複合外鍵，Restrict）、`isActive`。
- `@@unique([vendorId, emailSequenceId, delayMinutes])`。
- CHECK：`delayMinutes` 介於 60 與 129600（90 天）。

`MessageTemplate.trigger` 新增允許值 `sequence_email`。變數沿用現有 6 個；因為序列綁直播，`live_title`、`live_url`、`live_start_at` 都有值（常青場與指定場次的 `live_start_at` 依既有規則處理）。

三張新表都啟用 RLS、不寫 policy，登記到 `PRISMA_INVARIANTS.md`。migration 手寫、只新增、`lock_timeout 5s`。

### 加入序列

- 時機：報名的 Email 驗證成功時（`src/app/api/form-submissions/verify/route.ts`，和確認信同一段）。加入失敗不影響驗證結果，只記錄錯誤。
- 補漏：job 每輪掃過去 48 小時內驗證、該直播有啟用中序列、卻沒有 run 的報名，補建。
- 只加入 `verifiedAt >= activatedAt` 的報名。啟用序列不會回頭寄給以前的報名者。
- 加入當下就被退訂、在黑名單或 Email 無法使用的人不會開始收信：寫一筆 `cancelled` 的 run（`unsubscribed`／`blacklisted`／`subject_gone`），補漏因此不會每輪重掃他們；之後重新訂閱或解除封鎖也不會自動復活（PR 1 審查 S2）。
- 同一個 Email 透過不同表單報名同一場直播，同一條序列只收一份：`(vendorId, emailSequenceId, recipientHash)` unique，第二筆報名寫 `cancelled`／`duplicate`、不存 recipientHash，不算在人數裡（M3）。

### 寄信

每一步建立一筆 `EmailDelivery`，`trigger: "sequence_email"`，之後完全走既有的寄信流程（claim、重試、送出前檢查）。

- 一律加退訂 footer（`ensureEmailUnsubscribeFooter`）。這是行銷信。
- 步驟到點時查退訂與黑名單，命中就把 run 標 `cancelled`、不建信（實作與原設計不同：不另建 `suppressed` 的寄送紀錄）。
- 同一人同一步最多一封：步驟改延遲時保留步驟 id，worker 建信前也會查這個 run 的這一步有沒有任何一封信（任何狀態），有就只推進游標（PR 1 審查 B1）。被移到某人目前進度之前的步驟，他不會補收。
- 模板：寄送中的序列正在用的模板，模板編輯頁不能停用或改觸發條件；仍遇到不可用的模板（例如暫停時改過、恢復後到點）時不推進游標、約 5 分鐘後重試，逾期 24 小時才跳過。只改內容時，已排隊還沒寄出的那一封在寄送前被略過，不改寄新版本。
- 寄送前另外檢查：商家仍有 `email_sequences` 授權、這封信建立未超過 6 小時。
- `isCurrentEmailDeliverySnapshot` 加一段 `sequence_email` 的檢查：run 仍是 `active` 或 `completed`、序列必須是 `active`（暫停或草稿都不寄）、步驟仍啟用、模板仍啟用且內容與 id 相符、收件人不在黑名單。不符就 `superseded`。
- 退訂 API 目前會把該收件人排隊中的信轉成 `suppressed`；另外要把他在這個商家所有 `active` 的 run 標 `cancelled`。

### 停止條件（第一個 PR）

退訂、黑名單、序列被暫停或刪除、報名被刪除。暫停的序列恢復後，run 不會自動復活（避免商家不知情地補寄）。

### 權限、開關與上限

- 管理權限：`requireVendorManager`（owner 與 admin），和訊息模板一致。
- 以 beta 開關 `email_sequences` 上線，預設關閉，由平台對個別商家開通。
- 每個商家最多 5 條啟用中的序列，每條最多 10 步。伺服器端檢查，數字設成具名常數。
- 目前沒有 Email 計量。第一版不做計費，只靠上面的上限與 job 每輪的預算控制量。計量併入 billing 模組再處理。

### 後台

`/messages/sequences`：列表、建立、編輯（一般表單，欄位錯誤用 U4 的共用 API）、啟用與暫停、每條序列的進行中／完成／停止人數。直播編輯頁加一個入口連過來。

### PR 拆分

1. **PR 1**：三張表與 migration、worker、加入與補漏、寄信與送出前檢查、退訂連動、後台 CRUD、beta 開關。完成標準：報名驗證後第 N 個延遲點寄出第 N 封，含 db test 與 e2e。需獨立審查（migration 加寄信）。
2. **PR 2**：`stopOnPurchase`。到點時查同一個 `subjectKeyHash` 在這個商家有沒有已付款訂單，有就停止。只讀付款資料，仍需獨立審查。
3. **之後**：不綁直播的序列（漏斗的名單表單）、其他起點（付款後、沒到場）、LINE 步驟。

## 5. 停止條件的檢查位置

| 條件 | 加入時 | 步驟到點時 | 送出前 |
|---|---|---|---|
| 退訂 | 查 | 查 | 既有流程會查 |
| 黑名單 | 查 | 查 | 新增檢查 |
| 流程暫停或刪除 | — | 查 | 新增檢查 |
| 已購買（PR 2） | — | 查 | — |
| 商家停權 | — | 不撈，run 保留 | 既有流程不送 |

## 6. 冪等與併發

- 加入：`(vendorId, emailSequenceId, formSubmissionId)` unique。驗證路由與補漏 job 同時建立時，後者撞 unique 視為已存在。
- 執行：CAS 取得租約；步驟產出的 id 是決定性的；推進游標和建立產出在同一交易。
- 兩個 job 實例同時跑：只有一個拿得到租約。

## 7. 跨租戶

- 每張表都有 `vendorId`，子表以複合外鍵指向父表。
- 所有輸入的 id（序列、步驟、模板、直播）在最後的 DB 操作綁目前商家。
- worker 不接受外部傳入的 id；它從 run 讀 `vendorId`，之後每個查詢都帶這個值。
- 測試必須涵蓋：A 商家的序列不會加入 B 商家的報名者；A 的模板 id 不能掛到 B 的步驟。

## 8. F-4：自動化規則的多步驟與延遲

### 做法

- 現有 `AutomationRule.actions` 維持「事件發生當下執行」的語意，不動既有資料。
- 新增 `AutomationRuleStep`：`vendorId`、`ruleId`（複合外鍵）、`delayMinutes`（60 以上）、`condition`、`actions`（沿用現有的 schema 與上限）。
- 事件觸發時，立即的 actions 跑完後，如果規則有延遲步驟，就建一列 `DelayedStepRun`（`automationRuleId` 有值，`anchorAt` 為事件時間）。
- run 只存對象的參照（`formSubmissionId` 或訂單 id、`subjectKeyHash`、來源 `AutomationExecutionLog` id），不存事件 payload 裡的個資。每一步執行時重新讀取收件人，並重新評估該步的 condition（例如「到現在還沒買」）。
- 每一步的執行寫一筆 `AutomationExecutionLog`，冪等鍵加上步驟 id。
- 不做視覺化流程編輯器。規則編輯頁改成「立即執行」加一個可增減的延遲步驟清單。

### 實作狀態與決定（F-4 PR 2，分支 `ai/f4-automation-delayed-steps`）

上面「做法」已完成，現行規則見 `docs/domain-workflows.md`「自動化規則」，資料庫約束見 `docs/codex-goal/PRISMA_INVARIANTS.md` 2026-11-14 一節。實作時的決定：

1. **資料模型**：`AutomationRuleStep`（複合外鍵指向規則、Cascade；延遲 60–129600 分鐘；同一規則延遲不重複；每條最多 10 步，具名常數 `MAX_AUTOMATION_RULE_STEPS`）。`DelayedStepRun` 加 `automationRuleId`、`sourceExecutionLogId`、`consultationBookingId`（三個都是含 vendorId 的複合外鍵），CHECK 換成「`emailSequenceId` 與 `automationRuleId` 恰好一個有值」：新 CHECK 與外鍵先 `NOT VALID`，第二個 migration 才 `VALIDATE` 並刪掉舊 CHECK（Prisma 每個 migration 是一個交易，拆兩個檔才真的縮短鎖）。
2. **對象的參照**：三個可用 trigger 盤點後，`form_registered` 的 `subjectId` 是報名（`FormSubmission`，有 Email），兩個諮詢 trigger 的是預約（`ConsultationBooking`，有 `clientEmail` 與 `meetingUrl`），都能在之後可靠地重新讀到收件人，所以 run 存 `formSubmissionId` 或新的 `consultationBookingId`，不存事件 payload。`payment_paid`（訂單）下一個 PR 再加。
3. **去重**：`(vendorId, automationRuleId, sourceExecutionLogId)` unique。執行紀錄本身已依「規則＋事件對象＋規則版本」唯一，所以一個事件一條規則只有一列 run；與序列的兩個 unique 因為 NULL 不受 unique 限制而互不干擾。
4. **起點**：`anchorAt` 用觸發事件第一次執行紀錄的 `createdAt`，重送或重領都不會改變起點。立即動作完成或失敗都建 run（延遲步驟到點時會重新檢查一切）；條件不符（`skipped`）不建。
5. **刪除規則**：有 run 的規則一定有執行紀錄，依 #599 不能刪，只能停用；停用後 run 在下一步停止（`definition_paused`），重新啟用不復活（與序列暫停相同）。刪除交易內另外數一次 run 作為防禦。能刪的規則（無紀錄、無 run）連同步驟 cascade。worker 遇到規則或對象消失只停止那一個 run，不影響同一輪的其他 run。
6. **冪等**：每一步一筆 `AutomationExecutionLog`，id 與冪等鍵由 `(vendorId, runId, stepId)` 決定。動作沒辦法和推進游標放在同一個資料庫交易（LINE、折價券等沿用 `executeAction`，它要求一般 client），所以改成「先執行動作、再在交易內推進游標」：中途死掉或租約過期時，重領會找到同一筆紀錄，已完成就只推進游標，失敗或執行中就重跑，所有產出都由紀錄 id 決定（折價券 id 與 bearer、LINE 冪等鍵、Email id），不會重複。改延遲的步驟保留 id，所以 #598 審查 B1 的情況（已執行的步驟被移到後面）只會推進游標。
7. **推進游標與商家儲存**：推進時在交易內先 `FOR SHARE` 規則列、再依當下的步驟算下一步；商家儲存步驟時 `FOR UPDATE` 同一列並重新排定 run，所以兩者不會互相蓋掉（取代序列的 version 比對；規則的 `version` 是立即執行冪等鍵的一部分，不能拿來代表步驟版本）。
8. **Email 額度**：延遲步驟的信用新的 `automation_step` trigger，與序列信共用寄送額度（每輪 20 封）、佇列上限與商家公平分配；一步的 Email 數量放不進剩下的額度就整步等下一輪（不計重試次數）。佇列滿時沒有 Email 的步驟（只貼標籤、LINE）這一輪也會等，最多晚到佇列消化為止。寄送前另有 6 小時逾時與黑名單檢查。
9. **收件人**：報名尚未完成 Email 驗證時，延遲步驟不寄 Email（記為 `recipient_not_linked`），其他動作照做；立即動作的行為不變。`consultation_booked` 的預約被商家取消後停止（`subject_gone`）。退訂不停止自動化 run（只略過之後的 Email），所以自動化 run 不存 `recipientHash`。
10. **條件**：沿用現有 condition schema，不新增語法。三個可用 trigger 的事件沒有金額或觀看秒數，所以目前延遲步驟只會用到「事件發生時」；「到現在還沒買」等條件與 `payment_paid` 一起在下一個 PR。
11. **後台**：每條規則下方列出延遲步驟（新增、修改、刪除；單位只有小時與天），顯示進行中／完成／停止人數；執行日誌標出延遲步驟。沒有改成可編輯規則的立即動作（原本就只能在建立時設定），也沒有做視覺化編輯器。
12. **模組循環**：worker（`delayed-step-runs.ts`）要用自動化引擎，而引擎經由 `email-delivery-immediate` 又會載入 `email-delivery.ts`，它再 import `delayed-step-runs.ts`，形成循環。`email-delivery.ts` 在模組載入時需要的 trigger 常數因此移到不依賴任何模組的 `automation-email-trigger.ts`（`delayed-step-runs.ts` 照舊 re-export `SEQUENCE_EMAIL_TRIGGER`），循環中的其他模組在載入時只定義函式。曾試過動態 import，但 Playwright 測試程序裡動態載入的模組解析不到 `@/` 路徑別名，所以改回靜態 import。
13. **未做**：寄信服務未設定時整個 worker 不跑（沿用 F-3 的探測），只有 LINE／標籤的延遲步驟也會等；同一人前一封延遲步驟信還在佇列時，下一步不等（序列的 `waiting_previous` 沒有套用，因為自動化信的冪等鍵不含 run id）。

### 一併要修的既有缺口

三項都已在 F-4 第一個 PR 完成（分支 `ai/f4-automation-gaps`），現行規則見 `docs/domain-workflows.md`「自動化規則」。

1. **已完成**：自動化寄的信沒有退訂連結，也不查黑名單。只要它會被延遲步驟拿來追銷，就屬於行銷信，必須補上。→ 一律附退訂連結（與序列信同一套）；建立時查本商家退訂與 Email 黑名單，命中就略過並記在執行紀錄；送出前另查黑名單（`recipient_blacklisted`）。
2. **已完成**：四個 trigger 沒有呼叫端。`payment_paid` 是追銷最需要的起點，接上它會碰付款流程，需要獨立審查；其餘三個建議先從後台隱藏，等真的接上再放出來。→ 四個都先隱藏（含 `payment_paid`，接上付款流程的 PR 會放回 `AVAILABLE_AUTOMATION_TRIGGERS`）；伺服器端拒絕新建、套用劇本與重新啟用；既有規則仍列出、可停用與刪除。
3. **已完成**：`/settings/automations` 只有 owner 能用，漏斗內的自動化 admin 也能用。建議統一成 owner 與 admin。→ 頁面與所有 Server Action 改用 `requireVendorManagerMember`。

## 9. 需要 owner 確認的事

F-3 會照下列預設值直接做；有不同想法再調整。F-4 等確認後才開工。

1. **F-3 第一版的範圍**：序列綁一場直播、以 Email 驗證時間為起點、延遲最小 1 小時、每商家 5 條、每條 10 步。
2. **啟用序列不回頭寄給舊報名者。**
3. **「買了就停」預設開啟**（PR 2）。
4. **F-4 的範圍**：照第 8 節——延遲步驟、不做視覺化編輯器、補退訂與黑名單、接上 `payment_paid`、隱藏另外三個沒接上的 trigger、權限統一成 owner 與 admin。
5. **production 排程頻率**（D-06）：這會決定延遲步驟的準時程度。每小時一次的話，所有步驟最多晚一小時。
6. **Email 用量**：序列會明顯增加寄信量。要不要在開放給一般商家前先做計量或每日上限？
7. **序列信吞吐量**：目前每輪最多寄 20 封序列信、建信量不超過寄送量、各商家平分（第 3 節「吞吐量」）。開放給一般商家前要決定 job 頻率與這個額度，大場次才不會讓後面的人晚到被跳過。
8. **重新報名不再進同一條序列**：同一個 Email 在同一條序列只會有一份進度。例如常青場幾週後同一人再報名同一場，不會從頭再收一次這條序列（已退訂或已完成的也一樣）。這是否符合預期？若要「重新報名就重新開始」，需要改去重的方式。
9. **開放給一般商家前的兩個限制**：worker 每輪最多考慮 500 家有到期 run 的商家；待送額度（每輪 20 封）是全平台共用的，商家在寄送紀錄手動重排已失敗的序列信也會佔用它（之後可改成每家上限）。
