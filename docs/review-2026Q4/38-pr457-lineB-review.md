# PR #457 獨立審查：Line B 資料／migration（F-064、F-070、F-072、F-073）

- 分支：`codex/beta-l1c-lineB-data`（HEAD `ce7c833c`，4 個 commit），範圍 `git diff origin/master..HEAD`
- 背景：`docs/review-2026Q4/14-data-migration.md` B04-10、B04-17、B04-19、B04-20
- 審查者：reviewer（Opus），2026-10-21；只回報 findings，沒有修改程式

## 實際執行的驗證

| 項目 | 結果 |
|---|---|
| 一次性 loopback PostgreSQL 18.4（scratchpad 內 initdb，`celebratedeal_test`）`prisma migrate deploy` | 116 個 migration 全部套用 |
| 本 PR 的 5 個 DB 測試加 9 個相關 unit 測試（共 14 檔，設定與 CI 相同的 `CSRF_SECRET`／`JOB_SECRET`） | 187/188 通過；唯一失敗見 N2（PG18 才會出現） |
| `node --test scripts/production-migrate.test.mjs scripts/staging-migrate.test.mjs` | 22/22 |
| `scheduled-jobs-runner.test.mjs`、`migration-order-check.test.mjs` | 21/21；`migration-order-check.mjs` ok |
| `api-contract-registry.test.ts`、`prisma-invariant-inventory.test.ts` | 2/2 |
| `npm run typecheck`、對變更檔跑 eslint | 通過 |
| `prisma migrate diff`（DB 對 schema） | 本 PR 碰到的表（LandingPage、FunnelVisit、FunnelSubmission、PaymentAccount）沒有新增 drift |
| `vitest.g7-finance-db.config.ts`（`actions.payout-db.test.ts`） | **本機沒有跑成**：非 public schema 會撞上既有的 pg_trgm migration 問題（B04-21），只能靠 CI |
| 交易內鎖觀察（見 m1） | 同一交易內 `VALIDATE` 時，`FunnelVisit` 與 `LandingPage` 都還持有 `AccessExclusiveLock` |
| CI `quality` | push run 39495173977 **失敗**：tracking browser gate 回報 `expected 0`，Playwright 一個測試都沒跑，根因沒有確認。PR run 39495181733 審查時仍在跑 |

## Findings

| # | 等級 | 位置 | 失敗情境 | 建議修正 |
|---|---|---|---|---|
| M1 | MAJOR | `src/lib/vendor-payout-account.ts:22,132,141`；`src/app/(app)/billing/payouts/actions.ts:33` | 商家一儲存，新帳號就直接是 `active`，原本 `pending`／`verified` 的帳號也會被改成 `active`，同時換掉銀行資料。`createPayoutBatchAction`（`src/app/actions.ts:1933`）下一批就會照新帳號撥款。以前只有平台人員能用 SQL 寫入，所以 `verified` 實際上代表「平台確認過的帳號」。現在 owner 換掉資料後狀態仍算有效，平台端完全看不出帳號最近改過。MFA 只在 session 層級驗證一次：被偷走的 session（之前已驗過 MFA）或被接管的 owner 帳號，就能把撥款改到攻擊者的戶頭。不需要再輸入 TOTP，系統不會通知其他 owner，也沒有冷卻期。程式註解自己也寫了「Redirecting payouts is the main goal of an account takeover」。 | 任選其一，或組合使用：(a) 新建或變更帳號一律回到 `pending`（或新的 `pending_verification`），平台在後台核可後才變 `active`；(b) 保留自助啟用，但表單要求當下重新輸入 TOTP（step-up）、寄通知給所有 owner 與平台、記錄 `bankAccountChangedAt`，N 天內的撥款批次要求平台確認或先暫緩。不論選哪個，都不要把 `verified` 自動升成 `active`。補 DB 測試：變更後不會立刻符合 `selectPayoutAccount`，或批次會被擋下。 |
| m1 | MINOR | `prisma/migrations/20261021130100_landing_page_archive_restrict_funnel/migration.sql:12-16,19,39-40`；`20261021130000_.../migration.sql:16-18,38`；`docs/production-database-runbook.md:191`；`docs/operations/prisma-migration-guards-runbook.md:165` | Prisma 會把整份 migration 當成一個隱含交易執行（runbook §5.2 自己也這樣寫）。`ADD COLUMN`、`DROP CONSTRAINT`、`ADD CONSTRAINT … NOT VALID` 取得的 ACCESS EXCLUSIVE 鎖會一直持有到 commit，所以同一個檔案裡的 `VALIDATE` 仍然在 ACCESS EXCLUSIVE 下掃整張 FunnelVisit／FunnelSubmission。我實測時 pg_locks 顯示 `FunnelVisit`、`LandingPage` 都還有 `AccessExclusiveLock`。掃描期間公開 `/lp` 讀取 LandingPage、寫入造訪都會被擋住，最長可到 60 秒 statement_timeout。目前資料量小，影響有限，但 runbook §5.3 把這個錯誤寫成往後大表變更的規則。 | PR 還沒合併，可以趁現在把兩個 `VALIDATE` 移到另一個時間戳較晚的 migration，讓它在獨立交易執行。修正兩個 migration 註解與兩份 runbook 的鎖說明：必須「另開 migration 才能 VALIDATE」。 |
| m2 | MINOR | migration 順序：`20261021130000`（依資料內容可能 RAISE）排在 `20261021130100`（新增程式必須用到的 `archivedAt`）之前；`scripts/production-migrate.mjs` | 第一個 migration 遇到明文資料時用 `RAISE EXCEPTION` 擋下，不會跳過，這是正確的 fail-closed 行為，preflight 也只回報筆數。不過一旦觸發，就會停在 P3009，後面的 `archivedAt` 也不會套用。master 上的程式（`publicLandingPageCandidateWhere`、funnel runtime、checkout、編輯器）全都查 `archivedAt`：如果 app 已經部署，`/lp`、funnel 結帳、Funnel 編輯會一起出現 column does not exist。要恢復還得先跑 backfill 再 `migrate resolve`，而 workflow 沒有提供這兩條路徑。 | 合併前調換兩個 migration 的時間戳，讓不依賴資料的 archive migration 先跑；或在 `production-migrate.mjs` 的 deploy 前加一個唯讀 preflight（只回傳 count），不為 0 時就不 deploy。runbook 要寫明「先 migrate 成功，才 promote app」。 |
| m3 | MINOR | `src/app/api/cron/data-retention/route.ts:26-35`；`.github/workflows/scheduled-jobs.yml`（data-retention step） | 「預設關閉」只靠 workflow 的 `if` 判斷 `vars.SCHEDULED_JOBS_ENABLE_DATA_RETENTION`。route 本身沒有開關：`workflow_dispatch job=data-retention` 刻意不檢查 opt-in；持有 `CRON_SECRET` 或 `JOB_SECRET` 的任何呼叫，也都會直接刪資料（AnalyticsEvent 會實際刪除）。隱私權政策目前還寫著「沒有依時間自動刪除的機制」。驗證本身沒問題：GET 驗 `CRON_SECRET`、POST 驗 `JOB_SECRET`。刪除範圍也沒問題：WebhookEvent 只移除 `raw`／`diagnostics`，保留列、冪等鍵與 `normalized`。我查過退款證明（`payuni-pending-refund-proof.ts`）、retry 與 wp4，都只讀 `normalized`。 | route 加上伺服器端開關，例如 `DATA_RETENTION_ENABLED=true`；沒開時回 200 加 `skipped`，或回 503，都不寫資料，並補測試。可另外考慮把 `failed` 狀態且尚待人工對帳的 webhook 也排除在 raw 清除之外。 |
| m4 | MINOR | `scripts/anonymize-customer.ts:52-56` | 環境 guard 可以被繞過：在本機設定 `GITHUB_ACTIONS=true PERSONAL_DATA_REQUEST_WORKFLOW=true`，再搭配正式環境的 `DATABASE_URL`，就會通過檢查。真正擋住的是正式環境憑證的保管，不是這段程式。而且這個「核准的 workflow」根本還不存在。`--execute` 也不像 backfill 那樣要求確認字串。預設 dry-run 這點確認正確。 | workflow 建立之前，直接拒絕 `workflow` 分支；或改為檢查 `GITHUB_WORKFLOW_REF` 等於指定的 workflow 檔加上 `@refs/heads/master`。`--execute` 另外要求 `ANONYMIZE_CUSTOMER_CONFIRM=<固定字串>`。runbook 要老實寫明：guard 只防誤用，不防刻意繞過。 |
| m5 | MINOR | `scripts/anonymize-customer.ts:146-149`；`docs/operations/personal-data-request-runbook.md:48,67` | (1) `CommerceOrder` 只用 `automationCustomerKeyHash` 比對。這個欄位可以是 NULL，2026-09-08 以前的舊訂單也沒有值，而且不像報名、預約那樣會掃舊資料，所以舊訂單會被靜默漏掉，dry-run 顯示 0 筆。(2) `Blacklist.identifier` 存的是明文 Email，工具沒處理，runbook 也沒列。(3) runbook 說執行後再跑 dry-run「應全部為 0」，但 posts／replies 保留了 `customerKeyHash`，CRM 筆記也是用 hash 找的，這幾類會一直不是 0，處理人員會誤以為失敗。(4) runbook 說假名表「無法再與姓名或 Email 連結」：只要有 app 金鑰和 Email，就能重算 hash 連回去，所以這些是假名化資料，不是匿名資料。保留假名表的理由（學習紀錄與權益仍要運作）可以接受，但說法要改。另外確認過：覆寫欄位不會碰到唯一鍵（Email 每列唯一，`checkoutIdentityHash` 沒有 unique），金額與財務列也都保留。 | 舊訂單改為解密 buyer envelope 比對，或至少輸出 `legacyOrdersUnscanned` 筆數；Blacklist 一併處理，或寫進「需人工確認」；修正 runbook 這兩句。 |
| m6 | MINOR | `scripts/production-migrate.mjs:95-120` | 備份 run 驗證確實會呼叫 GitHub API `/actions/runs/{id}` 查這個 run，並檢查 path、`head_branch=master`、`completed/success`，以及是否在 24 小時內完成。但它不檢查這個 run 備份的是不是 Production：如果備份 workflow 有 target 參數，一個成功的 staging 備份也會過關。它也不檢查有沒有產出備份 artifact，而 `PRODUCTION_BACKUP_WORKFLOW_PATH` 只是 repo 變數。目前 repo 還沒有備份 workflow，所以 deploy 一律 fail closed。其他設定沒問題：`permissions` 只有 `contents: read`、`actions: read`；有 `environment: production`；`github.ref_protected`；用固定 SHA 的 actions；secret 只交給子程序（`GITHUB_TOKEN` 不會傳下去）。 | 備份 workflow 建好後，再驗證 run 的 `display_title` 或 input 指向 production，或用 API 確認有指定名稱的 artifact；`PRODUCTION_BACKUP_WORKFLOW_PATH` 改放 `production` environment 的變數。 |
| N1 | NIT | `prisma/seed.ts`、`src/app/actions.payout-db.test.ts`、`scripts/backfill-bank-account-encryption.ts`、`src/lib/payout-account.ts` | 這 4 個檔案從 LF 被改成 CRLF（HEAD blob 分別有 717、640、348、46 個 `\r`），整份檔案都變成 diff，掩蓋了實際只有 7 到 250 行的改動，blame 也會壞掉。 | 轉回 LF 再 push。 |
| N2 | NIT | `src/lib/landing-page-archive.db.test.ts:140` | 斷言寫死 `P2003`。PostgreSQL 18 對 RESTRICT 回的是 SQLSTATE 23001，Prisma 會包成 Unknown error，所以在 PG18 一定失敗。CI 用 PG16 會過；Supabase 以後升級時會出問題。 | 改成比對 constraint 名稱，或同時接受 23503 與 23001。 |
| N3 | NIT | `prisma/migrations/20261021130000_.../migration.sql:35` | `LIKE '****%'` 允許 `****` 後面接完整帳號；legacy 戶名欄位也完全沒有約束。 | 之後另開 migration，收緊成 `~ '^\*{4}[0-9]{0,4}$'`。 |
| N4 | NIT | `scripts/production-migrate.mjs`（`FIXED_PRODUCTION_REF`） | 正式環境的 project ref 寫死在公開 repo。不過 master 的 `src/lib/database-identity.test.ts` 和 docs 早就有這個值，本 PR 沒有增加暴露。寫死反而能防止 secret 被指到別的專案。 | 可以保留。建議 owner 確認 Supabase 已開 network restrictions 與 SSL enforcement。 |
| N5 | NIT | `src/lib/landing-page-service.ts`（封存） | 封存頁會一直佔用 slug，並繼續以 Restrict 參照 form、live 與版本，而且沒有 UI 可以查看或還原。目前沒有刪除 form／live 的 app 路徑，所以沒有實際影響。 | 這是產品決策，在 runbook 記一筆即可。 |

## 各重點的結論

1. **撥款帳號**：授權順序正確：`assertServerActionSecurity` → `requireVendorOwnerFinance`（要求 finance 角色加 owner，`requireAuth` 會擋未驗證的 MFA）→ `mfaFactor` 必須存在。vendorId 只從 session 取得，`updateMany` 同時比對 id、vendorId、mode，跨租戶測試也有涵蓋。envelope 的 AAD 綁定 `vendor:<id>` 加版本加 keyId。legacy 欄位只寫入 `maskBankAccount` 的結果，audit 只記末四碼，也測過 CHECK 會擋明文。CHECK 的 preflight 遇到明文資料會 **RAISE，不會跳過**（見 m2）。把 pending／verified 改成 active 的問題見 **M1**。
2. **頁面封存**：CHECK 只作用在新欄位，既有資料都能通過；RESTRICT 也實測過：Vendor 刪除仍會經由 vendorId 串聯刪掉（測試清理有跑到）。公開查詢方面，`/lp`、`/lp/[slug]/[stepPath]`、`play` route、funnel runtime、checkout 與報名提示都會排除封存頁。另外 CHECK 保證封存頁不可能是 published，所有要求 `status=published` 的查詢在 DB 層就已經排除封存頁。repo 裡沒有 sitemap 和公開 preview 路由。全 repo 只剩 `deleteLandingPage` 一條刪除路徑，現在會先判斷要封存還是刪除，有 Serializable 加 revision CAS，DB 的 RESTRICT 是最後一道防線。
3. **去識別化與保存期限**：預設是 dry-run，guard 可以被繞過（m4），覆寫的欄位不會破壞財務資料或唯一鍵，假名表的理由可以接受但說法要修正（m5）。cron 只在 workflow 層級預設關閉（m3），會驗證 secret，刪除範圍沒有包含退款證明。
4. **Production migrate**：權限、environment、protected branch、timeout 與輸出允許清單都正確；備份 run 確實有向 API 查詢存在與成功（缺口見 m6）；寫死 project ref 的部分見 N4。
5. **測試與 gate 固定數**：inventory、contract registry、migration-order 都通過，PRISMA_INVARIANTS 記錄的 150 models／116 migrations 與實際套用的數量一致。CI `quality` 的 push run 失敗，tracking browser gate 一個測試都沒跑，根因未確認，必須等 PR run 轉綠。

## 結論

M1 和 m1 都牽涉到合併後就很難回頭的東西：M1 是金流的政策行為，m1 是已合併 migration 的鎖行為。m2 也最好趁還沒合併時調整 migration 順序。另外 CI 目前還沒過。

需修正後再審
