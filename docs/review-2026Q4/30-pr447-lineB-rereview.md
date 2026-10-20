# PR #447 複審：工作線 B 修正（接續 `30-pr447-lineB-review.md`）

- 修正 commit：59490dc3、091a604c、134e0ca7、65128280、33a02322。修正範圍是 `git diff 99c2990b..HEAD`。主對話給的 `ad199160..HEAD` 會連原本的 ee6d082c～99c2990b 一起算進去，所以修正部分以 99c2990b 為基準看，整體則另外快速看過 `78621ca3..HEAD`
- 審查者：reviewer 子代理（Opus），2026-10-19，只做唯讀檢查
- 這份複審另存為新檔案，沒有追加到原報告：本代理的寫檔權限只允許新建報告檔，不允許修改既有檔案

## 已執行的驗證

| 指令 | 結果 |
|---|---|
| `node --import tsx --test scripts/scheduled-jobs-runner.test.mjs scripts/staging-backup-recovery.test.mjs scripts/staging-backup-recovery-workflow.test.mjs` | 20/20 通過 |
| `npx vitest run src/app/api/cron src/app/api/jobs src/lib/deployment-topology.test.ts src/lib/webhook-retry.test.ts` | 12 個檔案、89 個測試通過 |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint`（只跑變更的檔案） | exit 0 |
| `npx vitest run src/lib/payment-webhooks.test.ts` | **沒有驗證到**：這個檔案需要本機 PostgreSQL，本機沒有起 DB，48 個測試全部在 8 秒逾時。這次 PR 對它只改了一行斷言（多一個 `inventoryUnavailable: false`），請在有 DB 的 CI（`quality`）確認 |

`git status` 在跑完後仍是乾淨的。

## 重點確認

1. **M1 旗標同時擋住兩條路徑**：`scheduled-jobs.yml` 的 billing-cycle `if` 是 `(schedule == '22 17 * * *' && vars.SCHEDULED_JOBS_ENABLE_BILLING_CYCLE == 'true') || (workflow_dispatch && (job == 'billing-cycle' || (job == 'all' && vars.… == 'true')))`。每日排程和 `all` 都需要旗標，只有單選 `billing-cycle` 會直接執行。契約測試會同時斷言兩個 opt-in 子字串，也斷言不會出現沒加條件的 `inputs.job == 'all' ||`。
2. **M2 的 Sentry 事件不含 PII**：`reportWebhookRetryAlert` 只送固定的 message，tags 是 `source`、`reason`、`provider`，extra 只有 `eventId` 和 `orderNumber`。兩者都要通過 `^[A-Za-z0-9_.:@+-]{1,128}$`，否則換成 `unavailable`；payload、買家資料與 provider 訊息都不會送出。測試用帶有 `buyerEmail` 的 payload 確認沒有外洩，也測了不安全的 orderNumber 會被換成 placeholder。`InventoryUnavailableError` 會原樣穿過 `withPaymentWebhookStage` 和 `processPaymentWebhook` 的重試迴圈（兩者都是 rethrow 原錯誤），所以 `instanceof` 判斷有效。
3. **Actions 在 exhausted>0 時標紅**：route 的回應多了頂層的 `exhausted` 和 `inventoryUnavailable` 計數。runner 只在 2xx 時讀 body，只抽這兩個非負整數，其中任一大於 0 就回 `needs_attention`；`main()` 遇到非 `ok` 時 `exitCode = 1`，該 step 會是 failure，最後的檢查步驟就會讓整個 run 失敗。runner 測試確認輸出那一行只有計數，不含 eventId 或 email；非 2xx 的 body 不會被讀取。
4. **pg_trgm 依 archive DDL 判斷**：staging runner（`archiveTrigramSchema`）和 PowerShell helper（`Get-CelebrateDealTrigramSchema`）都只認 `<schema>.(gin|gist)_trgm_ops`。`public` 和 `extensions` 兩種情況都有單元測試；同時引用兩個 schema 時拒絕；schema 名稱不安全時拒絕；沒有 trigram index 時預設用 `extensions`。`pg_dump` 會把 `search_path` 設為空，opclass 一定帶 schema 前綴，所以不會因為沒寫前綴而誤判。loopback 收據（`reports/review-2026Q4/B-line-B4-loopback-receipt.md`）在兩種放置方式下，對 runner 與 helper 都有修正前失敗、修正後成功的對照。staging 實際位置（`public`）已由主對話唯讀查證。

## 逐條對照

| ID | 狀態 | 說明 |
|---|---|---|
| M1 | 已解決 | 見上面第 1 點。runbook 已寫明這個 job 會開立帳單並標記逾期；「開立當下就逾期」列為另案處理。 |
| M2 | 已解決（依原建議範圍） | Sentry error 告警加上 Actions 標紅，runbook §3.1 寫明處理方式，並把 B03-07 列為 Production 硬性 gate。B03-07 本身仍未修，這是預期的。**尚待 owner**：在 staging 的 Sentry 為 `webhook_retry_requires_attention` 建告警規則。 |
| m1 | 已解決 | concurrency 依觸發來源分組，每日排程改為 `22 17`，測試斷言分鐘數不是 5 的倍數。 |
| m2 | 已解決 | 以設定檔的 `regions` 為準，`EXPECTED_FUNCTION_REGION` 只用來驗證，不一致就警告，`DATABASE_REGION` 改用設定檔的區域比對；原本把誤判當成預期的測試已改正；文件已改。 |
| m3 | 已解決（文件 gate） | 文件寫明 Production 上線前 `DATABASE_REGION` 必須是 PASS，以及只改 Dashboard 會被設定檔蓋掉。是否升為 FAIL 交給 owner 決定。 |
| m4 | 已解決 | 新增 §B 第 0 步：備份當下產生彙總快照，第 5 步改成和這份快照比對。 |
| m5 | 已解決（文件） | 改為需要 owner 授權，預設只在 staging 加合成資料上做，不起整個 app，並列出必須清空的 provider env。單欄位解密腳本還沒建立，列為待辦。 |
| m6 | 已解決 | 補上 Invoice、AffiliateCommission、AffiliatePayout、CoursePayout、PayoutItem、WebhookEvent，Settlement 依是否鎖定分組。欄位都對照過 `schema.prisma`，存在；收據顯示在套用 108 條 migration 的空 DB 上 exit 0。加總數字本身尚未驗證，收據已誠實註明。 |
| m7 | 部分 | 有收據，涵蓋 helper、參數和兩種放置方式。`Invoke-…RestoreDrill.ps1 -Execute` 的完整路徑（age 與 SecretManagement）以及 staging runner 的 Docker 路徑都沒有跑，收據已明確寫出。可接受，第一次真實演練時補上。 |
| m8 | 已解決 | staging 已查證 `pg_trgm` 在 `public`；runner 改為依 archive DDL 建立；更正了先前「受 blob 白名單保護」的錯誤說法（白名單只鎖備份端的檔案，我核對 `APPROVED_BACKUP_BLOBS` 確認屬實）。 |
| n1 | 已解決 | 新增 `VERCEL_CONFIG_FILE`，只接受白名單內的檔名，staging 的 buildCommand 會帶這個值。 |
| n2 | 已解決 | 新增 `SCHEDULER_SECRET_SEPARATION` 檢查，結果只是 WARN，不印出值。 |
| n3 | 已解決 | 兩份文件都改成「以查證結果為準」。 |
| n4 | 部分 | 已寫進 runbook，待 owner 新增專屬 environment，workflow 目前沒改。 |
| n5 | 已解決 | live-media 測試改用真實的 `api-security` 加 `vi.stubEnv`，GET 和 POST 兩個方向都有斷言。 |

## 複審新發現

| ID | 嚴重度 | 檔案:行號 | 情境 | 建議 |
|---|---|---|---|---|
| R-n1 | NIT | `src/lib/webhook-retry.ts`（`SAFE_ALERT_IDENTIFIER`） | 白名單允許 `@`，所以如果某筆 payload 的 `orderNumber` 本身是 email 形式（例如 `buyer@example.test`），它會原樣送進 Sentry extra。正常的 orderNumber 由伺服器產生，實際發生機率很低。 | 從字元集移除 `@`，或只接受站內 orderNumber 的固定格式。 |
| R-n2 | NIT | `src/lib/webhook-retry.ts`（只在重試路徑告警） | 第一次送達的 paid 若遇到售完，只會留下一筆 failed 事件，要等約 15 分鐘後第一次重試才會告警並讓 Actions 標紅。 | 可接受。若要更即時，在 `/api/webhooks/payments` 遇到 `InventoryUnavailableError` 時也呼叫 `reportWebhookRetryAlert`。 |
| R-n3 | NIT | `src/lib/payment-webhooks.test.ts:1737` | 這是 DB 測試，本機沒有驗證到。 | 以 `quality` CI 的結果為準。 |

整體 `78621ca3..HEAD` 快速看過，沒有發現新的 BLOCKER、MAJOR 或 MINOR。金額來源、租戶邊界、auth 與 migration 都沒有新的變更。runner 現在會讀 2xx 的 body，但只抽兩個整數計數，不會輸出其他內容。

各嚴重度數量（未解決與新發現）：BLOCKER 0、MAJOR 0、MINOR 0（m7 標為部分，可接受）、NIT 4（n4 待 owner，以及 R-n1～R-n3）。

可合併。
