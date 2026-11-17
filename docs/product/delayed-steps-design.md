# 延遲步驟：Email 追銷序列與自動化多步驟的共用設計

狀態：F-3（Email 追銷序列）定案，依本文拆 PR 實作；PR 1 與 PR 2（「買了就停」）已完成。F-4（自動化多步驟與延遲）範圍 owner 已確認；第一個 PR（第 8 節「一併要修的既有缺口」）、第二個 PR（延遲步驟，第 8 節「做法」）與第三個 PR（接上 `payment_paid`，只有立即動作，第 8 節「F-4 PR 3」）已完成；`payment_paid` 的延遲步驟已在 Q-09 完成（第 8 節「Q-09」）；「到現在還沒買」條件留到之後的 PR。
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
- `vendorId`、`name`、`liveId`（複合外鍵到 `Live`，Cascade）、`status`（`draft`、`active`、`paused`）、`activatedAt?`、`stopOnPurchase`（預設 true，第二個 PR 起生效，見下方「實作狀態與決定（F-3 PR 2）」）、`version`（樂觀鎖）。
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
2. **PR 2**（已完成，分支 `ai/sequence-stop-on-purchase`）：`stopOnPurchase`。到點時查同一個 `subjectKeyHash` 在這個商家有沒有已付款訂單，有就停止。只讀付款資料，仍需獨立審查。
3. **之後**：不綁直播的序列（漏斗的名單表單）、其他起點（付款後、沒到場）、LINE 步驟。

### 實作狀態與決定（F-3 PR 2「買了就停」）

現行規則見 `docs/domain-workflows.md`「Email 追銷序列」的「買了就停」，資料層說明見 `docs/codex-goal/PRISMA_INVARIANTS.md` 2026-11-17 一節。上面「到點時查有沒有已付款訂單」沒有說時間範圍與哪些訂單算數，實作時的決定：

1. **購買的範圍**：同一商家、同一個 `subjectKeyHash`（＝訂單的 `automationCustomerKeyHash`，報名與訂單同一套正規化）的任何商品，不限序列綁的直播或專案（訂單與直播之間沒有可靠的關聯，而且「買了」對收件人來說是對這個商家）。
2. **時間**：只算這筆報名建立（`FormSubmission.createdAt`）之後付款的訂單。報名前的舊訂單不算，否則老客戶報名新直播時會無聲地收不到任何追銷；用建立時間而不是驗證時間（`anchorAt`），是為了讓報名後、驗證前就付款的人也停止。`paidAt` 是金流回報的付款時間。
3. **訂單狀態**：`paid`、`partially_refunded`、`refunded` 都算（付款發生過），測試訂單不算。退款不恢復：已停止的 run 不會改回 active，而且退款發生在下一步之前也照樣停止，所以結果不取決於退款與 job 的先後。
4. **判斷點**：worker 到點時（只要還有下一步，建信之前）與寄送前（`dispatchEmailDelivery` 與 `isCurrentSequenceEmailDelivery`）。原本第 5 節表格的「送出前：—」改成「查」：不查的話，job 在付款 commit 前一刻建好的那一封、以及最後一步（run 已 completed）的那一封都會寄出。
5. **不在付款當下主動停止**：付款流程（webhook 交易、after hook）完全不動，避免這個 PR 碰到付款路徑；worker 與寄送前檢查已足以保證不寄。代價是後台的「因購買停止」要等下一步到點才出現。
6. **停止的寫入**與其他依步驟計算的寫入一樣走 `commitWithDefinition`（序列列 `FOR SHARE`＋`version`），商家同時關掉開關時以存檔為準。
7. **後台**：序列表單加「買了就停」勾選（預設勾選，附說明）；表單另帶 `stopOnPurchaseShown`，沒有這個欄位（部署前開著的舊頁面）時視為開啟。列表顯示每條序列的設定與「其中因購買停止 N 人」。寄送紀錄新增 `sequence_recipient_purchased` 的說明。
8. **沒有 migration**：欄位與 `purchased` 停止原因在 PR 1 已建立；查詢用既有的 `CommerceOrder (vendorId, automationCustomerKeyHash, status)` 索引。

## 5. 停止條件的檢查位置

| 條件 | 加入時 | 步驟到點時 | 送出前 |
|---|---|---|---|
| 退訂 | 查 | 查 | 既有流程會查 |
| 黑名單 | 查 | 查 | 新增檢查 |
| 流程暫停或刪除 | — | 查 | 新增檢查 |
| 已購買（PR 2） | — | 查 | 查（序列信；PR 2 實作時加上） |
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
4. **起點**：`anchorAt` 用觸發事件第一次執行紀錄的 `createdAt`，重送或重領都不會改變起點。立即動作完成或失敗都建 run（延遲步驟到點時會重新檢查一切）；條件不符（`skipped`）不建。第一步的到期時間在交易內先 `FOR SHARE` 規則列、再依當下啟用中的步驟計算（審查 m1：事件開始時讀到的延遲可能已被改掉），規則已停用就不建。
5. **刪除與停用規則**：有 run 的規則一定有執行紀錄，依 #599 不能刪，只能停用。停用（`/settings/automations` 與漏斗編輯器兩條路徑）在同一個交易內先 `FOR UPDATE` 規則列，再把這條規則所有 active run 標成 `cancelled / definition_paused`，所以停用後在下一步到期前又啟用也不會繼續（審查 M1；鎖的順序與 worker、儲存步驟、建立 run 相同，都是先鎖規則）。worker 遇到停用的規則也照樣停止（直接改資料庫等其他路徑）。刪除交易內另外數一次 run 作為防禦。能刪的規則（無紀錄、無 run）連同步驟 cascade。worker 遇到規則或對象消失只停止那一個 run，不影響同一輪的其他 run。執行步驟前（建立或續跑執行紀錄之前）worker 在短交易內再 `FOR SHARE` 規則列，確認規則仍啟用、run 仍 active；在那之後才停用的，那一步的信在寄送前被擋下（規則已停用或 run 已 cancelled 就 `superseded`；第二輪 MINOR-3）。
6. **冪等**：每一步一筆 `AutomationExecutionLog`，id 與冪等鍵由 `(vendorId, runId, stepId)` 決定。動作沒辦法和推進游標放在同一個資料庫交易（LINE、折價券等沿用 `executeAction`，它要求一般 client），所以改成「先執行動作、再在交易內推進游標」：中途死掉或租約過期時，重領會找到同一筆紀錄，已完成就只推進游標，失敗或執行中就重跑，所有產出都由紀錄 id 與動作序號決定（折價券 id 與 bearer、LINE 冪等鍵、Email id），不會重複。第一次執行時把動作清單快照存在執行紀錄的 `actionResults.actions`，重跑一律用快照（審查 m2：商家中途調換動作順序時，用新清單的序號會讓 LINE 與 Email 對不上而重發）；立即動作的冪等鍵與 `actionResults` 格式不變。改延遲的步驟保留 id，所以 #598 審查 B1 的情況（已執行的步驟被移到後面）只會推進游標。續跑時快照無法解析就把那一步記為失敗（`snapshot_invalid`），不改用目前的動作，第一次遇到時保留租約、租約過期後再試一次，第二次仍無法解析才把 run 標成 `cancelled / failed`、送一次監控（`source: "delayed_step_run"`、`operation: "automation_step_snapshot_invalid"`，不含任何 id），不再重試（Q-12：同一版程式重試幾次結果都相同，原本重試 5 次只會浪費每輪額度；保留一次重試是因為部署交接或回滾期間，舊程式可能讀不懂新程式寫的快照，獨立審查 MINOR-1。因此**動作 schema 的擴充需要兩段式部署**：先部署能接受新欄位的程式，確認不會回滾到更舊的版本後，再部署開始寫入新欄位的程式）；這一輪的額度判斷也以快照的 Email 數為準（第二輪 MINOR-2），所以商家刪掉 Email 後、沒有寄信服務時也不會建信。延遲步驟信的冪等鍵改成 `automation-step-email/{執行紀錄 id}/{序號}`，寄送前檢查靠它找回規則與 run。
7. **推進游標與商家儲存**：推進時在交易內先 `FOR SHARE` 規則列、再依當下的步驟算下一步；商家儲存步驟時 `FOR UPDATE` 同一列並重新排定 run，所以兩者不會互相蓋掉（取代序列的 version 比對；規則的 `version` 是立即執行冪等鍵的一部分，不能拿來代表步驟版本）。
8. **Email 額度**：延遲步驟的信用新的 `automation_step` trigger，與序列信共用寄送額度（每輪 20 封）、佇列上限與商家公平分配；一步的 Email 數量放不進剩下的額度就整步等下一輪（`waiting_capacity`，不計重試次數）。沒有 Email 的步驟不受額度與寄信服務影響（審查 M3）：公平分配那一段結束後（額度用完、或根本沒有額度、或沒有設定寄信服務時），worker 再撈「下一步沒有 Email 動作」的到期自動化 run，用剩下的 run 預算執行（每輪最多 `EMAIL_FREE_SCAN_LIMIT` 200 筆），在商家之間輪流（Q-12，比照 #613 補跑與 #623：每家最早到期的一筆先，接著每家的第二筆……；同一輪次內依到期時間），這一輪已處理過的 run 不再處理。佇列一直消化不完時，含 Email 的步驟會一直等，晚超過 24 小時就被 skipStale 跳過、那一步對那個人不會再執行。寄送前另有 6 小時逾時、黑名單與授權檢查。
9. **收件人**：延遲步驟只寄給已確認的地址（審查 M2）。報名要已完成 Email 驗證；諮詢預約的地址是公開表單填的，沒人驗證過，所以要本商家有同一個 Email 的已驗證報名（以 `automationCustomerKeyHash` 的正規化比對：trim、小寫）才寄。沒確認時 Email 動作記為 `skipped / recipient_unverified`，其他動作照做；立即動作的行為不變。`consultation_booked` 的 run 在預約被取消或標成未出席時停止（`subject_gone`），已完成的預約繼續（諮詢後追蹤）；`consultation_no_show` 的 run 從未出席的預約開始，這個狀態之後沒有動作會再改（取消只能從預定中），所以只有預約被刪除才停止。退訂不停止自動化 run（只略過之後的 Email），所以自動化 run 不存 `recipientHash`。比對是完全相等：`lower(btrim(email))` 等於預約地址正規化後的值（第二輪 MINOR-1，不用模糊比對與筆數上限）。這個比對原本沒有索引可用，報名多的商家會全表掃描 `FormSubmission`；Q-12 加了 partial expression index `FormSubmission_verified_email_normalized_idx`（`lower(btrim("email")) WHERE "verificationStatus" = 'VERIFIED'`，migration `20261117130000_form_submission_verified_email_index`），查詢的運算式與條件必須維持一字不差才用得到它。
10. **條件**：沿用現有 condition schema，不新增語法。三個可用 trigger 的事件沒有金額或觀看秒數，所以目前延遲步驟只會用到「事件發生時」；「到現在還沒買」等條件與 `payment_paid` 一起在下一個 PR。
11. **後台**：每條規則下方列出延遲步驟（新增、修改、刪除；單位只有小時與天），顯示進行中／完成／停止人數；執行日誌標出延遲步驟。沒有改成可編輯規則的立即動作（原本就只能在建立時設定），也沒有做視覺化編輯器。
12. **模組循環**：自動化引擎經由 `email-delivery-immediate` 會載入 `email-delivery.ts`，而它 import `delayed-step-runs.ts`，所以 `delayed-step-runs.ts` 不能 import 自動化的程式（`scripts/architecture-boundaries.test.ts` 禁止 src 內的執行期循環；動態 import 在 Playwright 測試程序裡又解析不到 `@/` 別名）。做法是注入：`processDueDelayedStepRuns` 多一個 `automation` 參數，沒有傳時只撈序列 run；`automation-delayed-steps.ts` 的 `runDelayedStepWorker` 帶著自動化處理器呼叫它，job route 改用 `runDelayedStepWorker`，序列與自動化在同一輪、同一個額度。`email-delivery.ts` 在載入時需要的 trigger 常數放在不依賴任何模組的 `automation-email-trigger.ts`（`delayed-step-runs.ts` 照舊 re-export `SEQUENCE_EMAIL_TRIGGER`）。
13. **未做與已知限制**：同一人前一封延遲步驟信還在佇列時，下一步不等（序列的 `waiting_previous` 沒有套用）。~~「不含 Email 的補跑」不在商家之間輪流~~（第二輪審查 NIT；Q-12 已改成商家間輪流，見第 8 點）。商家刪掉 Email 動作、但續跑中的快照仍含 Email 時，這個 run 每一輪會被補跑撈到、判斷放不下而交還租約，直到有寄送額度。~~建立 run 的交易 `lock_timeout` 2 秒，逾時只回報監控、那個事件不會有 run。~~（Q-13 已改成由 job 補建，見第 17 點。）
14. **封測開關**（審查 M3）：`automation_delayed_steps` 是獨立的 beta 授權，預設關閉，由平台在 `/admin/vendor-features` 對個別商家開通（允許值由 `20261114090200_automation_delayed_steps_grant` 加入）。沒有授權：規則頁不顯示延遲步驟區塊、三個步驟 Server Action 在伺服器端拒絕（`FeatureDisabledError`）、事件不建立 run、worker（公平分配、無 Email 補跑、逾期跳過）都不撈該商家的自動化 run。授權收回後既有 run 保留不執行，已排隊還沒寄出的延遲步驟信在寄送前 `superseded`（與序列收回授權相同）。開放給一般商家前，owner 仍需決定第 9 節第 5、7 點（job 頻率與額度）。
15. **部署與回滾**（審查 m3）：三條 migration 先於程式部署。回滾到本 PR 之前的程式時，舊的 worker 不認得自動化 run：同時持有 `email_sequences` 授權的商家，其到期的自動化 run 會被舊 worker 撈到、讀不到序列而標成 `cancelled / definition_deleted`（不會寄信或執行動作，但進度不會恢復，重新部署後也不會復活）；沒有 `email_sequences` 授權的商家，舊 worker 不撈，進度原封不動。舊 worker 不看 `automation_delayed_steps` 授權，所以收回這個授權擋不住；回滾時接受這些進度被停止，或先暫時收回相關商家的 `email_sequences` 授權。
16. **連帶撤回（Q-12）**：寄送前檢查原本把任何 `cancelled` 的 run 已排隊、還沒寄出的延遲步驟信都略過，所以後面某一步重試 5 次失敗（`cancelled / failed`）時，前面步驟還在佇列的信也被撤回。這不是設計意圖：MINOR-3 要擋的是「規則停用、對象消失、觸發條件被隱藏」這類關於規則或對象的停止；`failed` 只代表後面那一步跑不下去，與已經排隊的信無關，而且這些信通常在建立的那一輪就寄出，撤回只會讓結果取決於佇列快慢。現在 `failed` 的 run 已排隊的信照寄（包括失敗那一步自己第一次執行時排的信，與立即動作「後面的動作丟錯，前面已排隊的信照寄」一致）；失敗那一步與之後的步驟不會再排新的信，因為 run 不會再推進。其他停止原因（`definition_paused`、`definition_deleted`、`subject_gone`）照舊撤回。代價（獨立審查 NIT-1）：run 變成 `failed` 或 `completed` 之後，對象的變化（例如預約被取消、報名者已看過直播）不會再被偵測，已排隊的信照寄；退訂、黑名單、規則停用與 6 小時逾時在寄送前仍會擋下。序列信（F-3）的同一個行為不在這次範圍，沒有改：序列進度 `failed` 後已排隊的信仍會撤回。
17. **鎖等待逾時的補建（Q-13）**：PostgreSQL 重現（`src/lib/automation-delayed-step-start-lock.db.test.ts`）確認兩種情形。(a) 商家存檔在事件開始前就鎖住規則列（`FOR UPDATE`）：寫執行紀錄的外鍵檢查（對規則列 `FOR KEY SHARE`）就會等，整個事件等存檔 commit 後才繼續，run 正常建立；代價是報名或預約的 request 被存檔卡住（存檔交易最多 15 秒）。(b) 存檔在執行紀錄寫入之後、立即動作執行期間才鎖住規則列並持有超過 2 秒：建立 run 的 `FOR SHARE` 在 2 秒後放棄，事件照常完成、立即動作都做了，但沒有 run，也沒有任何補建（只有同一事件重送才會補，報名與預約不會重送）。修法：執行紀錄新增 `delayedStepsPendingSubjectId`（對象的報名或預約 id，不是個資），和執行紀錄的完成狀態同一次寫入，表示「這個事件還欠一個 run」；寫入前先讀商家的 `automation_delayed_steps` 授權與停權狀態，沒有授權或已停權就不寫（獨立審查 MINOR-2：之後重新開通也不會回頭補建）。建立 run 的交易成功（或確定不需要：對象不存在、規則已停用、沒有啟用中的步驟）時在同一個交易內清掉；建 run 時對象剛被刪除（外鍵錯誤）則在交易外補清一次（NIT-1）。鎖等待放棄時保留標記並送一次 warning 監控（`source: "automation_delayed_steps"`、`operation: "start_run_deferred"`，不含 id），其他錯誤照舊回報 `start_run`。Email job（`/api/jobs/email-deliveries`）每輪在序列補漏之後、worker 之前呼叫 `startPendingAutomationRuns`：撈完成時間在 2 分鐘到 48 小時前、仍有標記、商家未停權且有 `automation_delayed_steps` 授權的執行紀錄（`form_no_show` 另需 `automation_form_no_show`，與 `isAutomationTriggerAvailableForVendor` 相同，NIT-3；partial index `AutomationExecutionLog_delayed_steps_pending_idx`），每輪最多 50 筆、商家間輪流，同一商家內先排失敗次數少的、再排舊的（MINOR-1）。這一段自己的上限是 `min(這輪截止, 開始後 20 秒)`，連續 3 筆等鎖逾時就停止本輪（NIT-2）。逐筆走與事件相同的 `startDelayedSteps`（鎖規則列、依當下步驟算第一步），起點用執行紀錄的 `createdAt`（事件時間），所以已到期的步驟在同一輪由 worker 執行，晚超過 24 小時的照常跳過。冪等靠既有 unique `(vendorId, automationRuleId, sourceExecutionLogId)`。補建因等鎖以外的錯誤失敗時，`delayedStepsPendingAttempts` 加 1（等鎖逾時不算）；第 5 次失敗時同一個 UPDATE 清掉標記，並送一次 `start_run_abandoned` 監控（只有 `source`／`operation`，MINOR-1），那個事件就不會有 run。事件重新被重領執行時嘗試次數歸零。job 回應的 `automationPendingRunsStarted` 只算這一輪實際新建的 run（`createMany` 的 count，NIT-5）。取捨：(1) 不把事件端的等待拉長或在 request 內重試，報名路徑最多仍只為建 run 等 2 秒；(2) 不改成「沒鎖就先建 run、之後再重排」，因為 run 對規則有外鍵，存檔持有 `FOR UPDATE` 時插入一樣會等；(3) 只補「事件當時就該有 run」的紀錄，不掃所有沒有 run 的執行紀錄，所以規則之後才加步驟、商家之後才開通授權都不會回頭讓舊事件加入；(4) 標記在完成時先寫、成功才清，所以 process 在兩者之間被終止也會補建。已知限制：job 停擺超過 48 小時的標記不再處理（之後的步驟仍可能還沒到期，但不補）；事件之後（標記已寫入）才被停權或收回授權的商家不處理也不清除，48 小時內恢復就會補建；情形 (a) 的 request 等待時間沒有改（不在本項範圍）。

### 實作狀態與決定（F-4 PR 3，分支 `ai/f4-automation-payment-paid`）

接上 `payment_paid`。現行規則見 `docs/domain-workflows.md`「自動化規則」的「付款完成」，應用層不變式見 `docs/codex-goal/PRISMA_INVARIANTS.md` 2026-11-14 F-4 PR 3 一節。實作時的決定：

1. **只做立即動作，延遲步驟延後**：`DelayedStepRun` 的 CHECK 要求自動化 run 的對象是報名或預約恰好一個，`payment_paid` 的對象是訂單。要支援就得加 `commerceOrderId`（含 vendorId 的複合外鍵、CHECK 改成三選一、`NOT VALID` 加 `VALIDATE` 分檔），到點時重讀訂單（全額退款或取消就停止）、解密買家 Email 並決定它算不算已確認。這些和付款流程的接線放在同一個 PR 會讓需要獨立審查的範圍加倍，所以拆開：本 PR 新增 `DELAYED_STEP_AUTOMATION_TRIGGERS`（報名與兩個諮詢 trigger），`payment_paid` 規則在後台不顯示延遲步驟區塊、步驟 Server Action 回 `steps_unsupported`、不建 run、worker 遇到就停止。之後做的時候，買家 Email 建議比照諮詢預約：本商家有同一個地址的已驗證報名才算已確認（付款不證明地址屬於本人，付款收據寄到哪裡也沒有回饋）。→ **已做（Q-09，分支 `ai/payment-paid-delayed-steps`）**，見下方「實作狀態與決定（Q-09）」。
2. **觸發點**：所有讓 canonical 訂單變成已付款的正式路徑都經過 `processPaymentWebhookOnce` 交易內的 `reconcileCommerceOrderPaymentTransition`，只有它回 `changed: true, status: "paid"`（第一次轉成已付款）時觸發。PayUni 的 return 與 notify 在同一個交易狀態收斂成同一個 `WebhookEvent`，webhook-retry job 與平台管理員的重跑也走同一個函式。庫存到期對帳 job 的補轉、平台訂閱扣款（沒有 `CommerceOrder`）、測試訂單、凍結中的商家都不觸發。沒有買家端的訂閱續扣，也沒有零元訂單或後台手動標記已付款的流程。
3. **失敗隔離**：交易 commit 之後才呼叫，放在電子發票與 audit 之後的 `finally`（它們丟錯時付款仍已 commit，重送只會看到 `changed: false`，所以這裡不觸發就永遠不會觸發）。request 內只註冊 `after()`（Next.js 允許巢狀 `after`，規則自己的 Email 立即寄送也是 `after()`），webhook 先回應；request 外就地執行並最多等 15 秒。呼叫永不丟錯，錯誤只回報監控（context 只有監控白名單內的 `source: "payment_paid_automation"` 與 `operation`，審查 MINOR-1）。原本 `dispatchPaymentPaidAutomation` 在規則失敗時 throw、`dispatchPaymentPaidAutomationByOrder` 在來源不明時 throw，兩個都沒有呼叫端，已刪除，改成 `src/lib/payment-paid-automation.ts`。
4. **重試**：不自動重試。依原設計「同一事件再次送進來才重領」，但付款只在第一次轉成已付款時觸發，之後的通知不會重跑失敗的規則（若改成每次已付款通知都重跑，商家在付款後才建立的規則會被重複通知觸發，違反「重複的已付款通知不觸發」）。after hook 沒跑完（平台在回應後終止 function）時那筆訂單的自動化也會遺漏。若要補跑，建議之後在 job 加一段：掃最近 N 小時第一次付款、規則建立早於付款時間、沒有成功執行紀錄的訂單，用同一個冪等鍵重跑。→ **已做（Q-10，分支 `ai/payment-paid-catchup`）**：`/api/jobs/webhook-retry` 每輪最後呼叫 `src/lib/payment-paid-automation-catchup.ts`，現行規則見 `docs/domain-workflows.md`「付款完成」的「補跑」。決定：(a) N 是 10 分鐘到 48 小時（付款時間與入帳時間都要在內）；下界＝webhook-retry 的 `maxDuration` 300 秒加上執行紀錄 5 分鐘的重領門檻。(b) 「規則建立早於付款時間」改成更嚴的「`updatedAt` 不晚於入帳時間」，因為付款時停用、之後才重新啟用的規則（例如 `20261114120000` 停用後商家重新啟用）也不該回頭跑。(c) 「沒有成功執行紀錄」限縮成：沒有紀錄、超過 5 分鐘的 `running`，或第一次執行就 `failed / action_failed` 且從沒被重領（`startedAt = createdAt`）、結束超過 10 分鐘。重領會更新 `startedAt`，所以不加次數欄位也只重試一次（獨立審查 MAJOR-1 採方案 a）；其他 errorCode（例如 `unsubscribe_url_unavailable`）是設定問題，不重試。補跑只 dispatch 掃描挑中的規則（`onlyRuleIds`），不順便重領其他規則的失敗紀錄。(d) 每輪 20 筆、商家間輪流；截止 `min(60 秒, 100 秒 − route 已用時間)`，route 已用 60 秒就跳過（排程端 120 秒逾時）；補跑失敗不讓 job 回 503；不加 migration，只用既有索引。
5. **冪等**：沿用執行紀錄的 `order:{orderId}:version:{n}` 鍵（`eventId` = `payment-paid:{orderId}`）。規則版本目前不會變（立即動作建立後不能改），所以同一筆訂單同一條規則最多一筆執行紀錄。
6. **資料來源**：回應後重新讀訂單（綁商家、`paid`、未退款、非測試、商家未凍結），條件金額用 `paidAmountCents`，客戶鍵用 `automationCustomerKeyHash`，Email 收件人是解密的買家 Email（立即動作，與其他立即規則相同不要求已驗證；仍查退訂與黑名單、附退訂連結）。先查有沒有啟用中的 `payment_paid` 規則，沒有就不讀訂單、不解密（審查 NIT）。
7. **後台**：觸發條件下拉多了「訂單付款完成」，門檻欄位改成「付款金額門檻（元）」；劇本「高客單 VIP 自動尊榮升級」恢復。
8. **部署時停用既有規則**（審查 MAJOR-1）：#599 隱藏 trigger 時沒有停用既有的 `payment_paid` 規則，畫面只標「目前不會執行」。我們查不到正式資料庫裡有沒有這種規則，所以用資料 migration `20261114120000_pause_payment_paid_rules` 保守處理：部署時把所有仍啟用的 `payment_paid` 規則改成停用，商家要用時在 `/settings/automations` 自行重新啟用（照一般停用規則顯示與啟用）。這些規則在部署前從未執行過，所以這只是維持現狀。
9. **其他已知限制**（審查 NIT，不改）：退款與規則動作之間沒有鎖（讀訂單之後才退款，那次動作照樣完成）；直接寫進資料庫的 `payment_paid` 步驟會留在資料庫但不會執行；庫存到期對帳 job 的補轉不觸發（第 2 點）。

### 實作狀態與決定（Q-09，分支 `ai/payment-paid-delayed-steps`）

`payment_paid` 規則也能有延遲步驟。現行規則見 `docs/domain-workflows.md`「付款完成」的「延遲步驟」，資料庫約束見 `docs/codex-goal/PRISMA_INVARIANTS.md` 2026-11-17 Q-09 一節。實作時的決定：

1. **資料模型**：`DelayedStepRun.commerceOrderId`（複合外鍵 `(vendorId, commerceOrderId) → CommerceOrder(vendorId, id)`，`ON DELETE CASCADE`）與 `(vendorId, commerceOrderId)` 索引。自動化 run 的對象改成「報名、預約、訂單恰好一個」，只有自動化 run 能填預約或訂單。比照 F-4 PR 2 分兩個 migration：`20261117170000` 新增欄位、索引，新 CHECK 與外鍵都 `NOT VALID`（外鍵放最後一句，`CommerceOrder` 的 SHARE ROW EXCLUSIVE 只在 commit 前一刻取得）；`20261117170100` `VALIDATE` 兩者、刪掉 F-4 的對象 CHECK，再把新 CHECK 改名回 `DelayedStepRun_automation_reference_check`（名稱維持指同一條規則，既有測試與文件的引用不變）。
2. **建立時機**：不另開入口。`payment_paid` 加進 `DELAYED_STEP_AUTOMATION_TRIGGERS`，`eventCanStartDelayedSteps` 依 trigger 決定事件對象的種類（`payment_paid` 是 `buyer_order`，其他是 `buyer_registration`），`startDelayedSteps` 以 `id + vendorId` 讀訂單、只有仍算購買（`paymentPaidRunOrderCounts`）才建 run。即時路徑與 #613 補跑本來就經過同一個 `dispatchPaymentPaidAutomationForOrder` → `dispatchAutomationEvent`，所以兩者建 run 的時機、起點（執行紀錄的 `createdAt`）與冪等（unique `(vendorId, automationRuleId, sourceExecutionLogId)`）完全相同；#631 的補建標記存訂單 id，`startPendingAutomationRuns` 不用改（它讀 `DELAYED_STEP_AUTOMATION_TRIGGERS`）。補跑時起點是補跑執行的時間，不是付款時間：與「事件第一次執行的時間」的既有定義一致，補跑通常在付款後 10–15 分鐘內，差距小於 job 精度。**補跑不讓付款之後才新增或修改的步驟回頭套用**（獨立審查 MINOR-1）：補跑的 `rulesUnchangedSince`（付款入帳時間）只看規則的 `updatedAt`，而新增或修改步驟不會更新它，所以另外檢查步驟：補跑另外帶 `stepsUnchangedSince`（同一個付款入帳時間；`AutomationDispatchOptions` 的新欄位，只有 `payment_paid` 補跑會帶），只要規則有任何啟用中的步驟 `createdAt` 或 `updatedAt` 晚於它，就不建 run（立即動作照常；比較嚴的做法，連「只改了某一步的延遲」也算）。檢查做兩次：讀規則時（`_count` 篩選）與 `startDelayedSteps` 交易內鎖住規則列（`FOR SHARE`）之後（`stepsUnchangedSince`），所以剛好同時存檔的步驟也看得到。補跑也不留補建標記、並清掉先前嘗試留下的標記：job 的補建會用那時的步驟，不是付款時的步驟。代價：補跑建 run 剛好遇到商家存檔鎖住規則超過 2 秒時，那筆付款就沒有延遲步驟（只回報 `start_run_deferred` warning）；會鎖住規則的存檔多半就是在改步驟，依上面的規則本來也不建 run。即時路徑與重送不受這條限制（它們不帶 `stepsUnchangedSince`）。`form_no_show` 的 job 也帶 `rulesUnchangedSince`（場次結束時間），但不帶 `stepsUnchangedSince`，所以它的延遲步驟與補建標記維持原狀（直接沿用 `rulesUnchangedSince` 會讓場次結束後才加的步驟永遠不建 run，並取消它的補建標記；DB 測試 `form-no-show-automation.db.test.ts` 抓到這個差異）。
3. **到點時重讀訂單**：`readSubject` 的 `payment_paid` 分支以 `id + vendorId` 讀訂單。全額退款（狀態 `refunded`，或退款總額已達付款金額）、取消、測試單 → `subject_gone`；**部分退款繼續**（保守：購買仍成立）。共用判斷放在不依賴其他模組的 `src/lib/payment-paid-run-order.ts`，建立 run、worker 與寄送前檢查三處共用（寄送端 `delayed-step-runs.ts` 不能 import 自動化程式，見第 12 點）。商家停權：worker 本來就不撈；停權剛好落在領租約之後時交還租約（不扣次數、不執行、不停止 run），與「停權保留 run」一致。規則停用照舊 `definition_paused`。
4. **寄送前**：`isCurrentAutomationStepEmailDelivery` 讀 run 時一併讀 `commerceOrderId`，有值就重讀訂單，不再算購買就 `superseded`。這擋住「這一步已排信、下一步到點前就全額退款」的那一封；與其他停止原因一致（不是 `failed`）。
5. **收件者 Email**（保守）：每一步重新解密訂單的買家 Email，run 不存地址。付款只證明買家完成結帳，不證明 Email 屬於本人，所以只有兩種情況算已確認：本商家有 `lower(btrim(email))` 完全相同的 `VERIFIED` 報名（沿用 `hasVerifiedRegistration`，走 Q-12 的 partial index），或本商家寄到這個地址的學員專區登入連結**送達並被抓取過**（`StudentPortalAccessToken` 有 `purpose = magic_link`、`consumedAt` 有值、`customerKeyHash = automationCustomerKeyHash(vendorId, email)` 的列。登入連結在 GET 時就被兌換，所以信件掃描器或連結預覽預先抓取連結也會被算進去：這證明信寄到了一個收得到信的信箱，不證明本人打開過；`checkout_redirect` 是結帳成功頁直接給的，不證明信箱，不算）。學員登出、被撤銷或商家停權時這些列會被刪除，之後就不再算（保守方向）。都不成立時 Email 動作記 `skipped / recipient_unverified`（沿用 #601 諮詢的作法），其他動作照做。解密失敗分兩種（獨立審查 MINOR-2）：部署本身無法加解密（金鑰沒設定或無法使用：對探測值做一次加密再解密失敗）時是平台的問題，丟 `SequenceConfigurationError`，worker 依既有規則再探測一次、交還租約、不扣重試次數並停止這一輪，這一步什麼都不做；worker 每輪開始時本來就會探測金鑰，所以這只發生在一輪進行中金鑰才消失的情況。只有這一筆訂單的密文解不開（損壞，或用金鑰庫已移除的舊金鑰加密）才把 Email 動作記為 `recipient_not_linked` 並回報 `buyer_email`（只有 `source`／`operation`），其他動作照做；這種情況不交還租約，所以單一筆壞資料不會卡住整個 worker。
6. **事件內容**：worker 重建的事件 `subjectType` 依對象而定（訂單是 `buyer_order`），所以 LINE 找綁定這筆訂單的 LINE 身分，與立即動作相同；`orderAmountCents`／`currency` 取訂單的 `paidAmountCents`／`currency`，只用於步驟條件（後台新增的步驟條件一律「事件發生時」，直接寫入的金額條件才會讀到）。派券金額照規則設定。
7. **後台**：`payment_paid` 規則顯示延遲步驟區塊，區塊內另有一段說明：起點、「全額退款或取消後不再執行（部分退款仍會繼續）」、Email 只寄給已驗證報名或登入過學員專區的買家。建立規則的說明拿掉「「訂單付款完成」除外」。`steps_unsupported` 保留作防禦（目前所有可用 trigger 都能加步驟），訊息改成不指名 trigger。
8. **未做與已知限制**：退款與正在執行的那一步之間沒有鎖（讀訂單之後才退款，那一步的動作照樣完成；已排隊的信在寄送前會被擋）。補跑的起點是補跑時間（第 2 點）。學員專區登入只看「現在還有沒有被兌換過的登入連結列」：信件掃描器預先抓取也算，登出就不算。補跑遇到鎖等待時不建 run（第 2 點）。用已移除的舊金鑰加密的訂單，Email 會被當成單筆密文問題略過（第 5 點）。兩筆部分退款加總到全額：付款端不接受「用完剩餘可退金額」的 `partially_refunded` 事件，剩下的金額一定以 `refunded` 事件進來，訂單轉成全額退款，到點的步驟停止（獨立審查 NIT-2，DB 測試涵蓋）。沒有「到現在還沒買」或「買了別的就停」的條件。
9. **部署與回滾**：兩條 migration 先於程式。舊程式不讀新欄位；它寫入的 run（報名、預約）符合新 CHECK。
   **回滾 runbook**：回滾到本 PR 之前的程式時，舊 worker 遇到 `payment_paid` 的 run 會因 trigger 不在舊清單而把它**永久**標成 `cancelled / definition_paused`：不執行任何動作，但之後重新部署本 PR 也不會恢復（沒有任何路徑把 `cancelled` 改回 `active`），那些買家剩下的延遲步驟就不會再執行。舊事件端也不再建這種 run；舊的寄送前檢查不讀訂單，已排隊的這種信照舊規則寄送。若要保住進度，回滾前先暫時收回有 `payment_paid` 延遲步驟的商家的 `automation_delayed_steps` 授權（回滾目標的 worker 只撈持有這個授權的商家），重新部署本 PR 後再開通；代價是那段期間這些商家所有的自動化延遲步驟都暫停（逾期 24 小時的步驟之後會被跳過）。否則就接受這些進度被停止。兩條 migration 不需要回滾（舊程式不讀新欄位）。

### 一併要修的既有缺口

三項都已在 F-4 第一個 PR 完成（分支 `ai/f4-automation-gaps`），現行規則見 `docs/domain-workflows.md`「自動化規則」。

1. **已完成**：自動化寄的信沒有退訂連結，也不查黑名單。只要它會被延遲步驟拿來追銷，就屬於行銷信，必須補上。→ 一律附退訂連結（與序列信同一套）；建立時查本商家退訂與 Email 黑名單，命中就略過並記在執行紀錄；送出前另查黑名單（`recipient_blacklisted`）。
2. **已完成**：四個 trigger 沒有呼叫端。`payment_paid` 是追銷最需要的起點，接上它會碰付款流程，需要獨立審查；其餘三個建議先從後台隱藏，等真的接上再放出來。→ 四個都先隱藏（含 `payment_paid`）；伺服器端拒絕新建、套用劇本與重新啟用；既有規則仍列出、可停用與刪除。`payment_paid` 已在 F-4 PR 3 接上付款流程並放回 `AVAILABLE_AUTOMATION_TRIGGERS`（見上方「實作狀態與決定（F-4 PR 3）」）；`form_no_show` 已在 Q-11 接上 Email job（見 `docs/domain-workflows.md`「報名後未出席直播」：新增 `LiveRegistrationAttendance` 觀看紀錄、場次結束 30 分鐘後判斷、事件 id 綁報名與場次、可加延遲步驟、部署時停用既有規則；獨立審查 M-1 後放在 `automation_form_no_show` 封測授權後面）；其餘兩個仍隱藏。
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
