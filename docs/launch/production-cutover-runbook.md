# Production 正式切換 Runbook

- 日期：2026-11-03
- 性質：操作計畫。本文件沒有執行任何 Production 操作；每一步要由指定的人在指定的地方執行，並留下驗收證據。
- 依據來源：`AGENTS.md`；`docs/goal-beta-prep-2026Q4/GO-NO-GO.md`（§0、§2）與 `OWNER-ACTIONS.md`（O-4、O-15、O-19、O-20、O-26）；`docs/staging-production-env-vars.md`（§2、§6、§7）；`docs/operations/prisma-migration-guards-runbook.md`（§1、§4、§6）；`docs/production-database-runbook.md`（§5.1、§5.2、§7）；`docs/production-backup-restore-runbook.md`（§A～§E）；`docs/launch/scheduled-jobs-runbook.md`；`docs/launch/payuni-payment-callback-runbook.md`；`.github/workflows/production-migrate.yml`、`staging-migrate.yml`、`staging-backup-recovery.yml`；`scripts/production-migrate.mjs`；`next.config.ts`；`vercel.json`。
- 配套文件：[production-env-checklist.md](production-env-checklist.md)、[subdomain-inventory.md](subdomain-inventory.md)、[scheduled-jobs-external-trigger.md](scheduled-jobs-external-trigger.md)、[payuni-tradestatus-mapping.md](payuni-tradestatus-mapping.md)。

## 0. 現況與原則

| 項目 | 現況（依 GO-NO-GO §0 與 O-18，2026-10-25 紀錄） |
|---|---|
| Vercel 專案 | `celebrate-deal`（Production）仍是 2026-07-24 的舊 build，**刻意沒有更新** |
| 公開網址 | `celebratedeal.carry-digital-nomad.in.net`、`celebrate-deal.vercel.app` 的 alias 已移除（回 404）；舊部署網址都在 Vercel Authentication 之後 |
| 資料庫 | Supabase 正式專案「CelebrateDeal」在孟買（`ap-south-1`）；函式區域 `hnd1`（東京），跨區未決（O-15） |
| 封測 | 只跑 staging；Production 不服務任何商家 |
| 程式 | master 已含 PR #485（`b5ccee8c`，CSRF 金鑰分離）、#484、#486、#487 |

**不可違反的不變量**

1. **舊 build 不得重新公開。** 任何公開網址或 alias 在指向 Production 部署之前，該部署必須已含 #485。需要回滾時，只能回滾到含 #485 的 build，絕不把 2026-07-24 的部署（`dpl_no9wQ7yn22bPjia7PKThhPoEWM3h`）重新掛上網域（`staging-production-env-vars.md` §7）。
2. **先套 migration，再部署程式。** 新程式每個已登入的請求都會讀 `User.emailVerifiedAt`，程式先上線會讓所有登入頁出錯；反過來舊程式跑在新 schema 上是安全的。
3. **最後一步才公開 alias。** 在 S11 之前，Production 不能有任何可公開連線的入口。
4. **禁止輪替有資料環境的 `CSRF_SECRET`。** 它是資料加密根金鑰（`staging-production-env-vars.md` §7 第 1、2 點）。見 S8 對「首次設定」與「輪替」的區分。
5. **不讀、不貼任何 `.env*`、金鑰、連線字串。** 回報只寫「設了／通過」與環境名稱。
6. **Production 部署、正式資料庫操作、正式付款與寄信，每一項都需要 owner 在對話中另外明確授權**（AGENTS.md）。本 runbook 的「owner」欄代表需要 owner 親自動手或明確授權。

**角色**

- owner：a25814740（GitHub `Production` environment 的 required reviewer；Vercel、Supabase、Cloudflare、PayUni、Resend、Sentry 帳號持有者）。
- 主對話：Claude 主對話。不輸入、不產生、不經手任何 secret；可唯讀查證、啟動 workflow（需核准者由 owner 按）、寫文件、驗收 smoke。
- 工程：由主對話派給 `engineer-hard`（Opus）並經 `reviewer` 審查的 PR（Fable 不寫程式）。

**GitHub Production environment 的核准點（owner 必須按 Approve）**

`production-migrate.yml` 的 job 掛在 `environment: production`（workflow 檔寫小寫；OWNER-ACTIONS 稱 `Production`，以 GitHub Settings 實際名稱為準，**待 owner 確認兩者是同一個 environment**）。依 O-20(a)，2026-10-27 已設定 required reviewer 為 a25814740 並限制只允許 `master`。每次 Run workflow 都會停在「Waiting for review」，owner 要在 Actions 頁面按 Approve。本 runbook 用【核准】標出。預計的核准次數：`production-backup.yml` 的 `backup` job 也掛在 `production` environment，每次備份核准一次（S2 第一次備份、S6 第 1 步重新備份各一次）；S6 的 migration 再三次（status、deploy、再 status）。

## 1. 步驟總覽

| 步驟 | 內容 | 誰做 | 核准點 |
|---|---|---|---|
| S0 | 切換前的工程 gate 與決策 | 主對話、owner | 無 |
| S1 | O-19：Production RLS 前置查詢 | owner | 無 |
| S2 | O-20(b)：Production 備份 workflow | 工程（PR）、owner | 【核准】×1 |
| S3 | 還原演練與 RTO 記錄 | owner、主對話 | 無 |
| S4 | O-15：跨區決定（A 或 B） | owner | 無 |
| S5 | 填齊 Production 環境變數 | owner | 無 |
| S6 | 套用 migration | owner、主對話 | 【核准】×4（重新備份 1 次＋migration 3 次） |
| S7 | 部署含 #485 的 master（不掛公開 alias） | owner 授權、主對話或 owner 執行 | 無 |
| S8 | 設定 Production 專屬根金鑰與衍生金鑰 | owner、主對話 | 無 |
| S9 | 平台管理員重新登記 MFA | owner、operator | 無 |
| S10 | Smoke | 主對話、owner | 無 |
| S11 | 公開 alias | owner | 無 |

順序理由：備份與還原演練必須在動資料庫之前；跨區決定會影響連線字串與區域設定，必須在填環境變數之前；migration 在程式之前；根金鑰在公開之前；MFA 在根金鑰換過之後；smoke 通過才公開。

**O-15 選 A（遷到東京）時的連動**：`scripts/production-migrate.mjs` 把 Production 專案 ref 寫死在程式裡（`FIXED_PRODUCTION_REF`），備份 workflow 也只備份那個專案。遷到新專案代表換 ref，S1～S3 對舊專案做的查詢、備份與演練都要對新專案重做，並需要一個小 PR 更新固定 ref。**建議 owner 在開始 S1 之前先決定 A 或 B**，正式紀錄仍放在 S4。

---

## S0　切換前的工程 gate 與決策

**誰做**：主對話查證；owner 決定。**在哪裡**：本 repo、`docs/launch/`。

| gate | 說明 | 狀態 |
|---|---|---|
| G-0.1 | 要部署的 master 含 #485（`git merge-base --is-ancestor b5ccee8c <部署 SHA>`） | 已成立（撰寫時 master `6f3de05e` 為後代） |
| G-0.2 | B03-07：付款事實先記帳、庫存不足標記超賣並建立退款或工單；`TradeLExpireSec` ≤ 保留 TTL。完成前**不得在 Production 啟用 webhook-retry 排程**（`scheduled-jobs-runbook.md` §3.1）。程式送出的 `TradeLExpireSec` 為 600 秒（`payuni.ts`） | 文件仍標「Production 上線前硬性 gate」，本次未找到已完成證據，**待主對話在切換前重新查證** |
| G-0.3 | RR-03（人工對帳結案工具）與 R448-03（UPP 回呼不得讀 `VendorId`／`VendorSlug`／`ReferralCode`）：`payuni-payment-callback-runbook.md` §4 標為「正式收款前必修」 | 同上，**待查證**；未完成時 Production 不開放真實結帳 |
| G-0.4 | `PRODUCTION_DATABASE_URL` 與備份 workflow 指向的專案 ref 與 O-15 的決定一致 | 待 S4 |
| G-0.5 | Production 資料庫現況：是否有需要保留的加密欄位、雜湊索引或 MFA；有哪些 `platform_admin`；`BillingPlan`（`starter`、`growth`、`team-pro`）是否存在。主對話無法讀取 Production | **待 owner 以唯讀連線查詢並回報筆數**（只回數字，不回個資） |

驗收證據：在 `docs/launch/` 新增 `production-cutover-receipt-<日期>.md`，逐項寫「通過／未通過」與日期（不寫值）。
回滾：不適用（尚未動任何環境）。

---

## S1　O-19：Production RLS 前置查詢

- **誰做**：owner。
- **在哪裡**：Supabase Dashboard → Production 專案 → SQL editor（唯讀）。
- **做什麼**：以 **migration 角色**（`DIRECT_URL` 的使用者）執行 `prisma-migration-guards-runbook.md` §1.1 的兩段查詢，預期都回 0 列：
  1. 待處理表 owner 檢查（`pg_has_role(current_user, tableowner, 'USAGE')`）。
  2. 應用程式角色 owner／`BYPASSRLS` 檢查。
- **同時做的前置查詢**（同一份回報；全部只回數量）：
  - §4 重複訂單號（`duplicate_groups` 必須 0；Production 欄位在該文件表格仍是「待執行」）。
  - §6 撥款帳號明文列（`plaintext_rows`；不為 0 要先 backfill，需 owner 授權）。
  - `payuni-payment-callback-runbook.md` §3 舊格式 PayUni paid 事件查詢（應 0 列）。
  - `pg_trgm` 所在 schema（`production-backup-restore-runbook.md` §D：Production 尚未查證）。
  - `_prisma_migrations` 中 `finished_at is null and rolled_back_at is null` 的列數：確認沒有卡住的 failed migration。
- **驗收證據**：owner 回覆「通過」或貼出 owner 清單（不含資料）；主對話把日期與結果補進 guards runbook §4 與 §6 的表格（Production 列）與 `production-cutover-receipt`。
- **回滾**：唯讀查詢，無需回滾。查詢不通過時依 runbook 指示處理，**不要部署**。

## S2　O-20(b)：Production 備份 workflow

- **現況**：workflow 已建立（`.github/workflows/production-backup.yml` ＋ `scripts/production-backup.mjs`，PR `ai/production-backup-workflow`），步驟、失敗代碼與還原演練見 `docs/operations/production-backup-restore-runbook.md`。`scripts/production-migrate.mjs` 不讀 `PRODUCTION_BACKUP_WORKFLOW_PATH`，備份 workflow 路徑寫死為 `.github/workflows/production-backup.yml`；`verifyBackupRun` 檢查該 run 的 `path`、同一個 repository、`master` 上的 `workflow_dispatch` 或 `schedule`、`head_sha` 在 master 歷史上、`backup` job 成功、`completed`／`success`、24 小時內，以及 artifact `production-database-backup-<run id>` 存在且未過期。沒有這樣的 run 時，`deploy` 一律在連資料庫之前停止（fail closed）。
- **誰做**：
  1. 工程：已完成（`engineer-hard` 實作、`reviewer` 審查）。workflow 分成沒有 environment 的 `contract` job（`npm ci` 與契約測試）與掛 `production` environment 的 `backup` job（不裝 npm 套件）；artifact 只含 age 密文、`SHA256SUMS` 與不含資料的 receipt。本機 PowerShell 備份（`ops/backup`）不會產生 GitHub artifact，不能滿足 gate。若 owner 改用 Supabase 的受管備份（Pro 的每日備份或 PITR），仍需由這個 workflow 產生 artifact。
  2. owner：在 GitHub `production` environment 確認或設定，**只由 owner 輸入**：
     - secret `PRODUCTION_DATABASE_URL`（Supavisor pooler 連線字串，與 `production-migrate.yml` 共用）；
     - variable `PRODUCTION_BACKUP_RECIPIENT_SHA256`：`ops/backup/keys/production-backup.agepub` 的 SHA-256，在 Git Bash／Linux／macOS 以 `git show origin/master:ops/backup/keys/production-backup.agepub | sha256sum` 自行計算（取前 64 個字元）。未設定或與檔案不符時備份一律拒絕，防止有人用 PR 偷換公鑰；
     - 確認手上有這把公鑰對應的 age 私鑰（`age-keygen -y <私鑰檔>` 的輸出要等於檔案中的 `age1…` 行），私鑰離線保管。沒有私鑰就無法還原，需開 PR 換公鑰並同步更新 variable。
     Production 的 Supabase 方案若仍是 Free（無受管備份），本步驟是唯一的備份來源；Pro 的設定見 `production-backup-restore-runbook.md` §A（O-4 的 Production 版本，費用由 owner 決定）。
  3. owner：Actions → `Production backup` → Run workflow（`master`）→【核准】。
- **在哪裡**：GitHub → Settings → Environments → `production`；GitHub → Actions → `Production backup`；Supabase Dashboard（若升級）。
- **驗收證據**：手動 Run workflow 一次成功，run ID 記入 receipt；用 `gh run view <id>` 確認 artifact 名稱為 `production-database-backup-<id>`，log 的 `PRODUCTION_BACKUP_ARCHIVE_SHA256` 與 artifact 內 `SHA256SUMS` 第一行相同；receipt 的 `dump.trigramOperatorSchema` 記錄 Production 的 `pg_trgm` 位置（F-074）；`contract` job 的契約測試通過。
- **回滾**：刪除 workflow 檔或 environment 的 secret／variable；備份 artifact 30 天後自動過期（只含密文）。不影響任何現有環境。

## S3　還原演練

- **誰做**：owner 授權並簽核；主對話整理收據。
- **在哪裡**：隔離環境，**絕不覆寫 Production**。依 `production-backup-restore-runbook.md` §B：
  1. 備份當下產生 §C 的帳務彙總快照並加密保存（S2 的 workflow 已在同一個 snapshot 自動產生 `production-aggregates-<run id>.txt.age`）。
  2. 還原到 loopback PostgreSQL 17 或獨立的 `restore-drill` Supabase 專案。
  3. 驗證結構與筆數、§C 彙總逐列一致、**加密欄位可讀**（需用對應版本的 `CSRF_SECRET`，只在 owner 授權的環境、以合成資料或 staging 備份做；Production 備份的解密驗證另行授權）。
  4. 記錄 RTO（初始目標 60 分鐘）到 §B 的 RTO 表格。
- **前置**：staging 的演練已有 workflow（`staging-backup-recovery.yml`，只收受保護的 staging 備份 run；`recoverability=PROVEN_ISOLATED` 不等於 migration 授權）。Production 用 S2 的 `Production backup` artifact，依 `docs/operations/production-backup-restore-runbook.md` §4 演練：下載並核對 `SHA256SUMS` → 解密 → 還原到隔離目標（可用 `ops/backup/Invoke-CelebrateDealRestoreDrill.ps1`，`-DryRun` 先、再 `-Execute -Confirmation RESTORE-TO-ISOLATED-TARGET`；或手動 `pg_restore`）→ 只拿 receipt 與解密後的彙總比對，不連 Production。`pg_trgm` 位置以 receipt 的 `dump.trigramOperatorSchema` 與 S1 查到的為準（`-TrigramExtensionSchema auto` 會依 archive DDL 處理）。
- **驗收證據**：RTO 表格有一列完整資料（結構一致、帳務彙總一致、加密欄位可讀三欄都是 PASS）、簽核者；把 `CSRF_SECRET` 版本代號對應到該份備份（只記代號）。GO-NO-GO §1 的 F-058、F-074 才能勾選。
- **回滾**：刪除隔離資料庫與暫存檔（§B 第 7 步）。

## S4　O-15：跨區決定

- **誰做**：owner。**在哪裡**：回覆「A」或「B」。
- **A（建議）**：把 Supabase 正式專案遷到東京（`ap-northeast-1`）。遷移本身等於一次完整的備份＋還原，所以排在 S3 通過之後；會換專案 ref、`DATABASE_URL`、`DIRECT_URL`、`PRODUCTION_DATABASE_URL`，並需要工程 PR 更新 `FIXED_PRODUCTION_REF` 與備份 workflow（見上方連動說明）。完成後 `DATABASE_REGION` 可留空（由 pooler 主機名稱推得 `ap-northeast-1`），與 `vercel.json` 的 `hnd1` 同區。
- **B**：Production 函式改設孟買 `bom1`。**只改 Vercel Dashboard 無效**，因為 `vercel.json` 的 `regions: ["hnd1"]` 會覆蓋；必須讓 Production 讀另一份設定檔。目前 `VERCEL_CONFIG_FILE` 只接受 `vercel.json`、`vercel.staging.json`（`src/lib/deployment-topology.ts`），所以 B 需要工程 PR（新增 Production 專用設定檔並加入白名單，或調整 `vercel.json` 並讓 staging 維持自己的檔），含測試。
- **驗收證據**：Vercel build log 的 preflight 出現 `[PASS] FUNCTION_REGION`、`[PASS] DATABASE_REGION`（`staging-production-env-vars.md` §6：Production 上線前 `DATABASE_REGION` 必須是 PASS）。
- **回滾**：A 的舊專案保留到新專案驗收後再處置（不得刪除）；B 還原設定檔 PR 即可。

## S5　填齊 Production 環境變數

- **誰做**：owner（所有值）；主對話只對照清單驗收。
- **在哪裡**：Vercel → `celebrate-deal` → Settings → Environment Variables → **Production** 環境；GitHub `production` environment 的 secret。逐項清單見 [production-env-checklist.md](production-env-checklist.md)。
- **重點**：`PAYUNI_ENV=production` 與正式商店三件組、Resend 正式寄件網域、Sentry production、`RATE_LIMIT_PROVIDER` 非 `memory`、Turnstile 正式金鑰（O-26）、Cloudflare Stream 正式 token；`JOB_SECRET`、`CRON_SECRET`、`CSRF_SECRET` 三者互不相同，且都與 staging 不同（O-6(b)：Production 與 Preview 的 `JOB_SECRET` 必須不同）。**`REGISTRATION_MODE` 不要設定**（未設定＝邀請制）。
- **驗收證據**：S7 的 Production build log 中 `scripts/preflight.ts` 沒有任何 `[FAIL]`（build 在 preflight 失敗時直接中止）；清單每一項勾選。
- **回滾**：環境變數變更只對**之後的部署**生效，不影響現有舊部署；改錯就改回並重新部署。

## S6　套用 migration

- **誰做**：主對話啟動 workflow；owner 按【核准】。
- **在哪裡**：GitHub → Actions → `Production migrate` → Run workflow（branch 必須是 `master`，且 `github.ref_protected`）。
- **步驟**：
  1. 在 24 小時內再跑一次 S2 的備份 workflow。【核准】。記下 `backup_run_id`（超過 24 小時為 `BACKUP_RUN_TOO_OLD`）。
  2. 先確認 staging 已套用同一批 migration（`staging-migrate.yml` 的 `status` 回「up to date」）。
  3. `mode=status`、`backup_run_id=<id>`。【核准】。輸出應只列出預期的 pending migration（Production 是 07-24 起的舊狀態，pending 會很多，含 `20261020090000_enable_rls_all_tables`、`20261021110100_payment_order_number_unique`、`20261021140200`／`140300`、`20261025120000_user_email_verified_at`，以及之後所有 migration）。
  4. `mode=deploy`，同一個 `backup_run_id`。【核准】。腳本依序驗證 URL 與專案 ref → 驗證備份 run → `migrate status` → 歷史乾淨才 `migrate deploy`；連線固定 `lock_timeout=5s`、`statement_timeout=60s`、`sslmode=require`。
  5. `mode=status`。【核准】。輸出應為 `Database schema is up to date!`。
- **時段**：低流量；部署前用 `pg_stat_activity` 確認沒有長交易（guards runbook §1.2）。Production 目前不服務流量，風險低，但仍照做。
- **驗收證據**：第三次 `status` 的 run ID；Supabase SQL editor 唯讀查詢 `select count(*) from pg_tables where schemaname='public' and not rowsecurity` = 0；`BillingPlan` 三個方案存在（見 S0 G-0.5；Production 沒有 seed 路徑，缺的話要走經 PR 審查的 forward migration 或 owner 授權的受控 SQL，見 `production-database-runbook.md` §6.2）。
- **回滾**：
  - 失敗（P3009、`PRODUCTION_HISTORY_DIVERGED`、`55P03`、`57014`）：**停止，不要重跑 deploy**，依 `production-database-runbook.md` §5.2 的 SOP（確認物件不存在 → 處理原因 → `prisma migrate resolve --rolled-back <name>` → 重新備份 → 重新 `status`／`deploy`）。`resolve` 由 owner 在受控環境執行。
  - migration 已成功但後續出問題：**不做反向 migration**；優先 forward fix。破壞財務資料才從 migration 前的備份還原到新 Supabase 專案（`production-database-runbook.md` §8）。

## S7　部署含 #485 的 master（尚不公開）

- **誰做**：owner 明確授權後，由 owner 或主對話（Vercel 連接器）執行。
- **在哪裡**：Vercel → `celebrate-deal`。`vercel.json` 的 `git.deploymentEnabled` 已關掉 `master` 的自動部署，所以要手動建立 Production 部署。
- **做什麼**：
  1. 取 master 目前的 HEAD（須已含 `b5ccee8c`，且所有 migration 已在 S6 套用完畢）。
  2. 建立 Production 部署，**必須是「不自動指派網域」的方式**：Vercel 對 Production 部署預設會把專案的 Production 網域（含 `*.vercel.app`）自動指向新部署，這會直接公開。用 CLI 的 `--skip-domain`（`vercel deploy --prod --skip-domain`，確切旗標以 `vercel deploy --help` 為準，**待操作者確認**），或在 Vercel 設定關閉自動指派。
  3. 部署完立刻從外部確認 `celebratedeal.carry-digital-nomad.in.net`、`celebrate-deal.vercel.app` 仍回 404、新部署網址仍在 Vercel Authentication 之後（403／302）。
- **驗收證據**：部署 READY；build log 的 preflight 全 PASS（含 `DATABASE_REGION`），沒有 `[FAIL]`；部署的 git SHA 在 receipt；上述網址的外部探測結果。
- **回滾**：這個部署還沒有任何 alias，刪除或不理會即可；不需要動 DNS。**絕不**把舊的 07-24 部署重新掛網域。

## S8　設定 Production 專屬根金鑰與衍生金鑰

**這一步最容易和「禁止輪替 `CSRF_SECRET`」混淆，請先讀這一段。**

- `staging-production-env-vars.md` §7 第 7 點「production 必做」：Production 的舊 build 曾有公開的 CSRF fingerprint oracle，且 Production 與 staging 是否共用根金鑰值不明，所以 Production 的所有衍生金鑰要視為可能外洩；**依用途改名對 Production 不夠**，服務任何人之前要由 owner 設一個新的、與 staging 不同的 `CSRF_SECRET`（至少 32 bytes 隨機值）。
- 同一節第 1、2 點禁止在**已有資料**的環境輪替或補設根金鑰。兩者不衝突的條件是：**Production 資料庫沒有任何需要保留的加密欄位、雜湊索引或 MFA**（§7 production 必做第 3 步）。這一步其實是「Production 服務第一個人之前的首次設定」，不是對運作中資料的輪替。
- **因此本步驟有一個前置 gate（S0 G-0.5）：owner 唯讀確認 Production 沒有需要保留的加密資料。若有，停止，改由 owner 與主對話另行決定；不得為了趕進度而換根金鑰。**
- 一旦 Production 開始服務（有資料）之後，`CSRF_SECRET` 與（退回用的）`JOB_SECRET` 永遠不再變動；後續需要換金鑰時，只能走 `DERIVED_KEY_ROTATIONS` 的「依用途輪替」。

**步驟**（依 §7 的順序）

1. 確認 S7 的部署沒有任何公開入口、所有舊部署仍無法公開連線。
2. owner 在 Vercel Production 環境設定新的 `CSRF_SECRET`（Claude 不輸入、不產生、不經手）；`JOB_SECRET` 若曾是退回用的根金鑰，一併由 owner 更換；`CRON_SECRET` 與前兩者都不同。
3. 重新部署 Production（沿用 S7 的不掛網域方式），讓新值生效。
4. 在密碼管理器記錄「此日之後的備份對應新根金鑰」，舊備份對應舊根金鑰；金鑰與備份分開保管。
5. 既有衍生用途（`DERIVED_KEY_ROTATIONS` 內各個 `…:r2:…` 名稱，含 `csrf-hmac:r2:…`、`merchant-registration-invite:r2:…`、`merchant-email-verification:r2:…`）都由 Production 自己的新根金鑰衍生，因此自動與 staging 獨立；不需要改程式。舊用途的「舊鑰後備驗證」只服務過去簽發的 token，Production 從未服務過新 build，沒有這類 token。
- **驗收證據**：新部署的 `/api/admin/preflight`（Bearer，不貼值）回 `ok`，`CSRF_SECRET` 項為 pass；owner 回報「Production 的 `CSRF_SECRET` 與 staging 不同且已記錄備份對應」。
- **回滾**：新根金鑰一旦有資料寫入就不能退回舊值。若在公開前發現設定錯誤，在**尚未有資料寫入**時可重設；已有資料寫入後只能 forward fix。因此 S8 與 S9 之間不要建立任何真實帳號資料。

## S9　平台管理員重新登記 MFA

- **誰做**：owner 授權；operator 執行資料庫刪除；每位平台管理員本人重新登記。
- **在哪裡**：Production 資料庫（一次性受控 SQL）；部署網址的 `/mfa/setup`（用 Vercel 授權過的網址）。
- **為什麼**：換根金鑰後，舊 MFA secret 無法解密，管理員無法通過 `/mfa/verify`。目前沒有「管理員重設他人 MFA」的功能（`startMfaEnrollment` 遇到既有 factor 回 `mfa_exists`），所以要由 operator 在 owner 授權下刪除該使用者的 `UserMfaFactor` 與 `UserRecoveryCode` 列，再由本人到 `/mfa/setup` 重新註冊並保存新的復原碼（`admin-mfa-recovery-sop.md`、§7 第 6 點）。
- **前置**：S0 G-0.5 的 `platform_admin` 清單；Production 是否已有可登入的平台管理員帳號（`prisma/seed.ts` 在遠端被守門擋住，首位管理員需 bootstrap 流程）——**待 owner 說明 Production 現有管理員帳號與初始密碼處理方式**。O-3 的「換掉 bootstrap 密碼」在 Production 也要做。
- **驗收證據**：每位管理員通過 `/mfa/verify` 並能進入 `/admin/finance`；`AuditLog` 有 MFA 登記紀錄；復原碼已由本人保存（不貼到任何地方）。
- **回滾**：被刪除的 MFA 資料無法還原（也不需要還原）；若本人無法登記，走 recovery SOP，由 operator 再次在 owner 授權下清除該使用者的 factor。

## S10　Smoke（仍不公開）

- **誰做**：主對話執行並記錄；owner 處理需要帳號的項目。
- **在哪裡**：S7／S8 的 Production 部署網址（在 Vercel Authentication 之後；主對話可透過 Vercel 連接器取得存取）。
- **項目與驗收**：

| 項目 | 通過標準 |
|---|---|
| `/api/health` | 200，`db` ok |
| `/api/admin/preflight`（Bearer `JOB_SECRET`，不貼值） | `ok: true`、`all_passed: true`；`rateLimit` 不是 `memory`；Cloudflare 診斷 ready |
| 回應標頭 | `Strict-Transport-Security: max-age=63072000; includeSubDomains`、`X-Frame-Options: DENY`、CSP report-only 存在 |
| `/login`、`/register` | `/register` 顯示邀請制說明（`REGISTRATION_MODE` 未設定） |
| `/policies*` | 無占位字樣、營運者資料正確（O-9） |
| 平台管理員登入＋MFA | 能進後台；`/admin/merchant-invitations` 可用 |
| Resend | 寄一封測試信到受控信箱，SPF／DKIM／DMARC 通過（`SMOKE_TEST_EMAIL`） |
| Sentry | production 專案出現一筆測試事件，tag `environment=production` |
| PayUni | 路由存在（`HEAD /api/webhooks/payments` 回 405 並帶 `Allow: POST`）。**不做真實付款**，除非 owner 另行明確授權並採 `payuni-live-one-time-probe.md` 的受控流程；若 G-0.2／G-0.3 未完成，Production 不開放商家結帳 |
| 排程 | Production 目前沒有任何排程（`scheduled-jobs.yml` 只打 staging）。公開前要決定 Production 的排程來源，見 [scheduled-jobs-external-trigger.md](scheduled-jobs-external-trigger.md)；webhook-retry 受 G-0.2 限制 |
| `OPS_SMOKE_SECRET` | 另一條線正在新增獨立的維運 smoke 密鑰，名稱與用法**待該 PR 合併後確認**後再納入 |

- **驗收證據**：`production-cutover-receipt` 的 smoke 表格（只寫通過／未通過與時間）。
- **回滾**：smoke 不改資料（除測試信與測試事件）。失敗就停在 S11 之前，修正後重做；不需要動 alias。

## S11　公開 alias

- **誰做**：owner。**在哪裡**：Cloudflare DNS（O-7：橘雲代理、無其他直連入口）、Vercel → `celebrate-deal` → Domains。
- **前置（缺一不可）**：
  1. [subdomain-inventory.md](subdomain-inventory.md)（F-157）所有主機名的 HTTPS 與狀態由 owner 核對完畢；HSTS 是兩年且含 `includeSubDomains`，且瀏覽器會記住。
  2. S1～S10 全部有證據。
  3. O-26 Turnstile 正式金鑰已設定並實測；`REGISTRATION_MODE` 仍未設定。
  4. 邀請制：第一個邀請發出前確認跑的是含 #485 的版本（OWNER-ACTIONS O-25）。
  5. GO-NO-GO 的簽收表由 owner 簽 Go。
- **做什麼**：把正式網域（目前記錄的 `celebratedeal.carry-digital-nomad.in.net`；若改用其他正式網域，同步更新 `NEXT_PUBLIC_APP_URL`，它決定信件連結與 PayUni 的 `ReturnURL`／`NotifyURL`）指向 S7／S8 的 Production 部署。
- **驗收證據**：外部以 HTTPS 開啟首頁、`/login`、`/register`；憑證有效；`x-vercel-id` 區域符合 S4 的決定；Turnstile 元件出現；GO-NO-GO §0 的 Production 列由主對話更新。
- **回滾**：移除該網域在 Vercel 的指派（網域回到 404），不涉及資料。**回滾只能退到「沒有公開入口」，不能退到舊 build。**
- 公開後第一週：每日看排程與 Sentry、`needs_manual_reconciliation` 筆數（`payuni-payment-callback-runbook.md` §3）。

---

## 2. 整體回滾速查

| 發生在 | 狀況 | 做法 |
|---|---|---|
| S2／S3 | 備份或演練失敗 | 停止；修備份；不得進 S6 |
| S6 | migration 失敗 | `production-database-runbook.md` §5.2；不做反向 migration |
| S6 後 | 資料被破壞 | 從 migration 前備份還原到**新** Supabase 專案，再換連線字串（需 owner 授權） |
| S7 | 部署有誤 | 刪除該部署；沒有 alias，無需 DNS 變更 |
| S8 | 根金鑰設錯 | 尚無資料寫入時重設；有資料後只能 forward fix |
| S10 | smoke 失敗 | 不進 S11 |
| S11 | 公開後出事 | 移除網域指派，回到無公開入口；事故走 `payment-refund-support-incident-sop.md` |

## 3. 需要 owner 補的資料（彙整）

1. A 或 B（O-15）。
2. Production 資料庫的唯讀查詢結果（S1、S0 G-0.5）：RLS 前置、重複訂單號、明文撥款帳號、`pg_trgm` schema、是否有需保留的加密資料、`platform_admin` 清單、`BillingPlan` 是否存在。
3. Production 的 Supabase 方案（Free 或 Pro）與備份方案（Pro 受管備份、PITR，或自管加密備份）。
4. GitHub environment 名稱（`production` 或 `Production`）是否為同一個。
5. 正式網域（沿用 `celebratedeal.carry-digital-nomad.in.net` 或新網域）與 Cloudflare 的 DNS 清單（見子網域盤點）。
6. Production 現有平台管理員帳號的處置方式（S9）。
7. 是否授權 Production 開放真實付款，以及 G-0.2、G-0.3 的完成證據由誰簽核。
