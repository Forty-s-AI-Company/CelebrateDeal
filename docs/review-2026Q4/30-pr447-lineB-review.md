# PR #447 獨立審查：工作線 B（排程、區域與連線池、備份還原、CSRF_SECRET 文件）

- 分支：`codex/beta-lineB-data-ops`（worktree `CelebrateDeal-wt-lineB`）
- 範圍：`git diff 78621ca3..HEAD`（ad199160、ee6d082c、9663d543、99c2990b），共 28 個檔案
- 審查者：reviewer 子代理（Opus），2026-10-19；只做唯讀檢查，沒有修改程式

## 已執行的驗證

| 指令 | 結果 |
|---|---|
| `node --import tsx --test scripts/scheduled-jobs-runner.test.mjs` | 7/7 通過 |
| `npx vitest run src/app/api/cron src/app/api/jobs src/lib/deployment-topology.test.ts` | 11 個檔案、70 個測試通過 |
| `pwsh -NoProfile -File ops/backup/tests/Test-BackupTooling.ps1` | `backup_tooling_static_checks_passed`；跑完後 worktree 仍是乾淨的 |
| `npm run typecheck` | 沒有錯誤輸出 |
| `npx eslint`（只跑變更的 TS／MJS 檔） | exit 0 |

沒有跑：`npm run test` 全套、`test:db`、對真實 archive 的 `-Execute` 還原演練，也沒有查詢 staging 或 Production。

## 逐項結論（對應主對話列的 8 個檢查點）

1. **GET 入口**：通過。`requireCronSecret` 走 `isAuthorizedBearer`，比對前先比長度，再用 `timingSafeEqual`；secret 未設或是空字串時回 false（fail-closed），`billing-cycle` 有對應測試。GET 不接受 `JOB_SECRET`，POST 不接受 `CRON_SECRET`。兩個入口共用同一個 handler 函式，`scheduled-jobs-runner.test.mjs` 用 regex 斷言這件事。快取：Next 16 的 Route Handler 預設不快取 GET（`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` §Caching），這些 route 都沒有 export `dynamic`／`revalidate`，`next.config.ts` 也沒開 `cacheComponents`。handler 會讀 request header，回應也沒有 `s-maxage`，所以 Next 和 Vercel CDN 都不會快取。
2. **Workflow**：大致通過。`permissions: contents: read`；runner 只印一行固定格式，不讀 response body；`JOB_SECRET` 只放在 step env，GitHub 會遮蔽，runner 也不印；`continue-on-error` 搭配最後一步檢查 `steps.*.outcome == 'failure'` 會讓 run 標紅，寫法正確；required reviewers 的風險 runbook 已寫明。問題見 m1（共用 concurrency group）和 n4（deployment 紀錄）。
3. **billing-cycle 每日自動執行**：有風險，應預設關閉，見 M1。
4. **webhook-retry 與 B03-07**：排程啟用後，這條路徑就會實際觸發，見 M2。
5. **區域**：Production 還沒部署，owner 決策已列為 O-15，所以 preflight 只發警告可以接受。但 `EXPECTED_FUNCTION_REGION` 的語意會產生誤判的 PASS，見 m2、m3。
6. **`src/lib/db.ts`**：只加註解，沒有改程式行為。topology 檢查只在 `VERCEL_ENV` 是 production 或 preview 時執行，不影響本機開發和測試。
7. **備份還原**：`-DryRun` 在 `-Execute` 之前就 `exit 0`，只呼叫 `Test-Path` 和指令解析，不讀密鑰、不解密、不連資料庫，也不建立目錄（實測 worktree 乾淨）。pg_trgm 準備 SQL 用 `'^[a-z_][a-z0-9_]*$'` 驗證 schema 名稱，here-string 用單引號，`$prepare$` 不會被 PowerShell 展開，loopback 和 Supabase 目標上都合理。runbook 的帳務 SQL 欄位都存在、語法正確，但比對方法有誤，見 m4～m6。
8. **測試**：route 測試確實打到新的 GET／POST 入口，也用了真實的 `api-security`；`live-media` 例外，它 mock 了 `api-security`，改由 runner 的 regex 契約補上。`scheduler-config.test.ts` 只是字串斷言。還原腳本的 `-Execute` 路徑（psql 準備、DDL 偵測、pg_restore）沒有任何自動化測試，見 m7。

## Findings

| ID | 嚴重度 | 檔案:行號 | 情境 | 建議修法 |
|---|---|---|---|---|
| M1 | MAJOR | `.github/workflows/scheduled-jobs.yml:88-94`；`src/lib/billing-cycle-job.ts:66`、`:88-91`；`docs/launch/scheduled-jobs-runbook.md:17` | 合併後每天 01:20（台灣）自動執行 `runBillingCycleJob`，用 `workflow_dispatch` 跑 `all` 時也會執行，而 runbook「恢復」步驟正是叫人跑 `all`。這個 job 不只重算 draft settlement，還會對每個 active `VendorSubscription` upsert `status: "issued"` 的月費 Invoice。因為 `dueAt = invoiceDueAt(...)`，而產生的條件就是 `dueAt <= now`，同一次執行結尾的 `updateMany` 會把它立刻改成 `overdue`。staging 有 PayUni／WP4 QA 留下的訂閱，所以合併後第一次執行就會替 2026-09 補開發票，並直接標成逾期。封測期間 billing 前台隱藏（D-02），owner 決策「不鎖月結、不撥款」（D-16）。自動執行對封測沒有好處，反而會累積「逾期且可付款」的帳單；日後 billing 開放時，商家會看到封測期間的逾期帳單，也可能影響 QA fixture 的帳單狀態。B03-08 的佣金重複扣除問題也會被寫進 draft。它不會上鎖、不會撥款、不會扣款，所以沒有違反 D-16 的字面。runbook 第 17 行只寫「重算 draft 結算」，沒提到開立帳單和標記逾期。 | 比照 `live-media`：排程和 `all` 都要求 `vars.SCHEDULED_JOBS_ENABLE_BILLING_CYCLE == 'true'`，預設關閉；只有單選 `billing-cycle` 的手動 dispatch 可以執行。同步更新 runner 的 `optInVariable`、契約測試與 runbook，runbook 寫明這個 job 會開立帳單並標記逾期。另開 issue 處理「帳單開立當下就逾期」這個既有問題（dueAt 應晚於開立時間）。 |
| M2 | MAJOR | `.github/workflows/scheduled-jobs.yml`（webhook-retry step）；`src/app/api/jobs/webhook-retry/route.ts:45`；`src/lib/inventory-reservations.ts:9`、`:445-455`、`:546-551` | 在這之前沒有排程，過期的保留一直停在 `reserved`，晚到的 paid 會走 `reserved → committed`，交易成功。排程啟用後每 5 分鐘釋放一次，超過 30 分鐘的保留會被改成 `released`、交易改成 `expired`。之後若 PayUni 才送來 paid，而商品已經售完，`reacquired.count !== 1` 會丟出 `InventoryUnavailableError`，整筆交易 rollback，重試 5 次後變成 `exhausted`。B03-07 原文寫「一旦補上排程就會出現」，並要求和 B03-06 一起修，本 PR 只修了 B03-06。webhook-retry 這時仍回 200（結果裡有 `exhausted`），runner 不讀 body，所以 Actions 還是綠的，只有 Sentry 會收到 `webhook_retry_exhausted`。封測用 Sandbox（D-01），而且不設庫存上限（D-14），不會有真實金錢損失，發生機率也低，所以評為 MAJOR 而不是 BLOCKER。 | 封測前至少做到兩點：(a) 確認 staging 的 Sentry 對 `webhook_retry_exhausted` 有告警規則，並在 runbook 寫明處理方式；(b) 在 STATE 把 B03-07 列為 Production 上線前的硬性 gate（paid 一律記帳，庫存不足時標記超賣並建退款或人工工單，UPP 設定 `TradeLExpireSec` ≤ 保留 TTL）。可選：讓 webhook-retry 在出現 `exhausted` 時回非 2xx，或讓 runner 輸出安全的計數，讓 Actions 標紅。 |
| m1 | MINOR | `.github/workflows/scheduled-jobs.yml:12-13`、`:33-35` | `*/5` 和 `20 17` 都會在 17:20 UTC 觸發，而兩次 run 共用 `scheduled-jobs-staging` 這個 group。GitHub 的 concurrency 規則是：同一個 group 只保留一個 pending，新排入的會取消舊的 pending。只要 17:20 那輪還沒跑完（GitHub 排程常延遲、集中觸發），17:25 的 `*/5` 排入時就會取消還在等的每日 run。被取消的 run 顯示 cancelled，不會標紅，月結和電子發票就這樣悄悄少跑一天。 | 依觸發來源拆開 group，例如 `group: scheduled-jobs-staging-${{ github.event.schedule \|\| 'dispatch' }}`，或把每日工作拆成獨立 workflow。每日排程也可以避開 5 的倍數（例如 `22 17 * * *`），同步改 runner 的 `SCHEDULE_DAILY`。 |
| m2 | MINOR | `src/lib/deployment-topology.ts:119`；`src/lib/deployment-topology.test.ts:44-51`；`docs/staging-production-env-vars.md:17` | `expected = EXPECTED_FUNCTION_REGION ?? configuredRegion`：env 會直接覆蓋 `vercel.json`，不會拿兩者比對。如果 Production 設了 `EXPECTED_FUNCTION_REGION=bom1`，但 `vercel.json` 還是 `hnd1`，函式實際仍在 hnd1（`vercel.json` 的 regions 優先於 Dashboard），preflight 卻印出 `FUNCTION_REGION` 和 `DATABASE_REGION` 都 PASS。build 階段通常沒有 `VERCEL_REGION`，抓不到這個落差。現有測試反而把這種誤判寫成預期行為。env 文件第 17 行說「Production 若改用 bom1 就設這個值」，容易讓人以為設 env 就能換區域。 | 兩者都有值又不一致時發出 `FUNCTION_REGION` 警告，並以 `vercel.json` 為準計算 `DATABASE_REGION`。把測試改成斷言警告。文件改寫為：換區域必須改 Production 實際讀取的 Vercel 設定，`EXPECTED_FUNCTION_REGION` 只用來驗證。 |
| m3 | MINOR | `vercel.json:4-6`；`docs/staging-production-env-vars.md:100` | `vercel.json` 的 `regions: ["hnd1"]` 會套用到每個讀這份檔案的專案，並覆蓋 Dashboard 設定。Production 專案讀哪份設定目前還不確定（O-6 的查詢被擋下）。若 owner 選 O-15 B（`bom1`），只改 Dashboard 會被這份檔案蓋掉；目前的狀態則是 hnd1 對孟買資料庫。Production 還沒部署，preflight 有警告，現階段可以接受。 | 在 O-15 和上線檢查清單寫明：Production 上線前 `DATABASE_REGION` 必須是 PASS，若選 B 需要改設定檔（或改用 Production 專屬設定）。之後可以考慮在 `VERCEL_ENV=production` 且跨區時改成 FAIL，但需要 owner 同意，因為會改變 build gate 語意。 |
| m4 | MINOR | `docs/production-backup-restore-runbook.md:75` | §B 第 5 步要求「來源（Production 唯讀連線）與目標各跑一次 §C 的 SQL，必須完全相同」。目標是某個時間點的備份，來源是之後仍在寫入的 Production，只要備份後有任何交易、退款或結算，比對就會失敗。操作者只能每次自己判斷差異是否合理，這個步驟就失去了驗收作用。 | 在備份當下（同一個 `pg_dump` snapshot，或備份後立即以唯讀連線）產生 §C 摘要，和 archive 的 manifest 一起加密保存。還原後拿目標和這份摘要比對。使用 PITR 時，以還原時間點為準。 |
| m5 | MINOR | `docs/production-backup-restore-runbook.md:76` | 第 6 步要「用備份當時版本的 `CSRF_SECRET` 起一個指向隔離目標的本機 app」。這會讓 Production 根金鑰和可解密的正式個資同時出現在開發機上；app 一旦帶到 provider env（LINE、Email、PayUni），解密後的正式憑證可能被用來對外發送。AGENTS 的安全底線要求正式 Secret 與正式客戶資料必須有 owner 另外授權。 | 寫明這一步需要 owner 明確授權，並列出必須清空的 provider env（Email、LINE、PayUni、Sentry DSN）。較好的做法是改用只解密單一欄位、只輸出 PASS／FAIL 的唯讀腳本，不啟動整個 app。 |
| m6 | MINOR | `docs/production-backup-restore-runbook.md`（§C SQL） | 帳務彙總只涵蓋 PaymentTransaction、RefundRecord、Settlement，而且只依 `status` 分組。遺漏了 Invoice（`totalCents`）、AffiliateCommission、AffiliatePayout／PayoutItem、Settlement 的 `lockedAt`（是否鎖定和 `status` 是分開的欄位），以及 WebhookEvent 的狀態計數。佣金或帳單在還原時漏掉，這份 SQL 也不會發現。 | 補上這些表的 count 與金額加總，Settlement 再依 `lockedAt IS NULL` 分組，並維持只輸出聚合值、不含個資。 |
| m7 | MINOR | `ops/backup/Invoke-CelebrateDealRestoreDrill.ps1`（`extension_detection`、`extension_preparation` 區段）；`docs/production-backup-restore-runbook.md`（§C 開頭、§D） | 文件寫「已於 2026-10-19 在 loopback PG17 驗證、對兩種放置方式都重現並驗證修正」，但 PR 沒有附任何收據。`Test-BackupTooling.ps1` 只測 plan-only 和純函式，沒有測 `-Execute` 路徑：psql 準備、`pg_restore --schema-only --file=-` 偵測、pg_trgm 在 `public` 時 `--clean --if-exists --schema=public` 的實際表現。依 AGENTS「沒跑的測試不能說通過」，這兩句目前只是聲明，沒有證據。 | 在 `reports/` 補一份合成資料的 loopback 收據（兩種放置方式各跑一次 `-Execute` 的安全輸出），或把文件改成「待驗證」。可選：加一個只在本機 disposable PG 上跑的 DB 測試。 |
| m8 | MINOR | `docs/launch/staging-backup-recovery.md`（新增段落）；`docs/production-backup-restore-runbook.md:116` | 封測資料在 staging，但 staging 的 GitHub 還原 runner 仍固定在 `extensions` 建立 pg_trgm。staging 實際的 pg_trgm 位置也還沒查。若結果是 `public`，封測要靠的 F-058 還原演練會 `BLOCKED`；本 PR 修的只是 PowerShell 演練這一條路。 | 現在就跑文件裡那條唯讀中繼資料查詢，在 STATE 記下結果。如果是 `public`，把 staging runner 的修正排在 O-4（升級 Pro）之前。 |
| n1 | NIT | `scripts/preflight.ts:49` | preflight 固定讀 `vercel.json`，staging 專案實際用的是 `vercel.staging.json`。目前兩者都是 hnd1，有測試鎖住；只要其中一份改了，staging 的檢查就會讀錯檔案。 | 加一個可選的 `VERCEL_CONFIG_FILE` env，或讓 staging 的 buildCommand 傳入檔名。 |
| n2 | NIT | `src/lib/env.ts:32`、`:94-98` | runbook 寫「`JOB_SECRET` 與 `CRON_SECRET` 必須不同」，但 env 檢查只要求 `CSRF_SECRET` 不等於 `JOB_SECRET`。兩者若相同，GET／POST 的密鑰分離就沒有意義。 | preflight 加一條 `CRON_SECRET !== JOB_SECRET` 的檢查，至少發警告。 |
| n3 | NIT | `docs/launch/staging-backup-recovery.md`（新增段落）vs `docs/production-backup-restore-runbook.md` §D | 前者說 Supabase 預設 `search_path` 會讓 pg_trgm 落在 `public`，後者說「Supabase 慣例放在 `extensions`」，兩份文件互相矛盾。 | 統一寫成「位置不確定，以中繼資料查詢結果為準」。 |
| n4 | NIT | `.github/workflows/scheduled-jobs.yml:42` | `Preview – celebrate-deal-staging` 是 Vercel GitHub 整合使用的 environment 名稱，每 5 分鐘一筆 Actions deployment 紀錄（每天約 290 筆）會把 Vercel 預覽部署的紀錄淹沒。這個 environment 還存著 DB URL、Vercel token、PayUni 等 secret；雖然 workflow 只引用 `JOB_SECRET`，最小權限的做法仍是用專屬 environment。 | 新增只存 `JOB_SECRET`、只允許 `master` 的專屬 environment（例如 `staging-scheduler`），需要 owner 在 GitHub 設定。 |
| n5 | NIT | `src/app/api/cron/live-media/route.test.ts:2` | `live-media` 的測試 mock 掉了 `api-security`，看不出真實的密鑰綁定，只靠 runner 的 regex 契約把關。 | 比照 `billing-cycle`，用 `vi.stubEnv` 加上真實的 `api-security`。 |

## 各嚴重度數量

- BLOCKER：0（沒有發現）
- MAJOR：2（M1、M2）
- MINOR：8（m1～m8）
- NIT：5（n1～n5）

金額、租戶邊界、MFA／admin 路徑與 migration 在本 PR 沒有變更：沒有新的金額來源，沒有新的 ID 輸入，沒有 schema 或 migration 變更，只新增了 cron 與 job 入口，驗證機制沿用既有的 Bearer secret。

需修正後再審。
