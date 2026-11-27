# 封測前 Goal：需要 owner 親自處理的事項

## 2026-11-23 owner 決定與完成事項

- **B-1 排程 Worker**：`celebratedeal-scheduler-staging` 已部署（workers.dev 子網域已建、`workers_dev = false`），每 5 分鐘呼叫 staging，四個 job 回 200。`JOB_SECRET` 換新，同步於 Vercel Preview、GitHub repo secret、GitHub 環境 `Preview – celebrate-deal-staging` 的環境 secret、Worker；GitHub scheduled-jobs run 45111114556 成功。
- **B-2**：Dependency graph、Private vulnerability reporting 已開啟；security-audit run 45111473386 成功；dependency-review 重跑成功。
- **O-14 與 B-3**：staging 環境 secret 都已存在（LINE、`CSRF_SECRET`、`CRON_SECRET`、`PAYUNI_QA_FINANCE_TOTP_SECRET`、PayUni 測試卡）。LINE E2E 失敗在 runner 內 `PRISMA_INIT_FAILED`，不是缺 secret，由 #693 處理。
- **B-4**：`VERCEL_TOKEN`（新 token `github-staging-ci`，一年）與 `OPS_SMOKE_SECRET` 已換新；舊 Vercel token 未刪（沒有外洩，只是權限不足）。
- **O-16／B-5**：封測期間 staging 維持 Hobby，正式上線前與 Production 一起升 Pro。
- **O-17／B-6**：沿用 Sentry `celebratedeal` 專案預設的「high priority issues → Email」規則，不另建。
- **O-7**：**否**。`carry-digital-nomad.in.net` 的 NS 在 Spaceship，A 記錄直指 Vercel，Cloudflare 帳號內沒有網域。Cloudflare WAF rate rule 不適用，改由應用層處理（work-queue A4-03）。
- **Stream 簽章金鑰**：staging 已設 `CLOUDFLARE_STREAM_SIGNING_KEY_ID`、`CLOUDFLARE_STREAM_SIGNING_KEY_PEM`（Preview），`CLOUDFLARE_STREAM_CUSTOMER_CODE` 未設（選填）。建立過程多建了一把未使用的 key，之後輪替時一併 `DELETE /stream/keys/{id}`。尚未鎖定任何影片。**2026-11-26：鎖定後 Cloudflare 回 401 failed to verify signature，KEY_ID 與 PEM 不成對；已回滾，請執行 `scripts/staging-stream-signing-key-reset.ps1` 重建（id 與 pem 同一次回應一起寫入）。** **2026-11-26 更新：owner 已重建金鑰；staging 重新鎖定 WP4 合成商家影片，修正續期未套用新 token 的 bug（#725）後 run 45731280971 full PASS。Cloudflare 現有 2 把未使用的 Stream key（原本多建的一把＋重建時失敗那次留下的一把），之後輪替時一併刪除。Production 尚未鎖定，鎖定前需再問 owner。**
- **B-8**：Cloudflare AI 金鑰暫緩到 AI 助理動工。
- **D 段十項決定全部照建議**：R-10 刪除模式同意但先備份；做折扣碼，佣金以折扣後實付金額計算；Email 序列寄送上限待第一個商家開通前再定；常青場課後信只寄給看過的人；不綁直播的序列與 LINE 步驟、多方案／買家訂閱、自訂網域都等封測後；安全警示先用 GitHub 通知信；買家可見的 AI 內容加標示；正式站自動補單先在 staging Sandbox 實測成功再開；本機 `celebratedeal_test` 已重建（2026-11-23，空資料庫，下次使用時再 migrate）。

## 2026-11-10 owner 決定（已定案）

- **O-1 PayUni 信用卡約定 Token**：Sandbox 測試站沒有這項功能，改用正式站。staging 繼續關閉「平台服務綁卡」與依賴綁卡的 Funnel 發布（O-23 不再等 O-1）；約定 Token 的第一次驗證在 PayUni 正式站以真實小額交易進行，屬正式金流操作，執行前需 owner 另外授權。
- **政策（採主對話建議）**：
  - 全額退款：撤銷該訂單所交付商品的存取權，但不登出整個學員帳號、不影響其他已付款商品；部分退款不撤銷。
  - 商家凍結期間：`/support` 保留已付款買家的交付連結。
  - 黑名單 Email：不能申請學員登入連結，回應不透露是否在黑名單。
  - ✅ 已完成：#560（`36a1299e`，2026-11-10 合併）實作並補回歸測試 `src/lib/owner-learner-access-policy.db.test.ts`（全額退款只撤銷該筆訂單的存取、凍結期間 `/support` 保留已付款買家交付連結、黑名單 Email 不能申請登入連結）；規則寫在 `docs/domain-workflows.md`「商家凍結」與「學員 portal session 撤銷」。連結：https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/560
- **O-15 跨區**：選 A，正式上線前（還原演練通過後）把 Supabase 正式專案遷到東京。
- **B-1 外部排程**：選方案 B（Cloudflare Worker cron），密鑰留在 owner 的 Cloudflare 帳號、之後可延伸到 Production；heartbeat 保留作備援。可部署的 Worker 已在 `ops/cloudflare/scheduled-jobs-worker/`；owner 在該資料夾依其 `README.md`（或 `docs/launch/scheduled-jobs-external-trigger.md` §5）執行 `npx wrangler login`、`npx wrangler secret put JOB_SECRET`、`npx wrangler deploy` 即可。
- **O-21 個資保存期限**：先採預設（WebhookEvent payload 180 天、AnalyticsEvent 365 天、AuditLog IP 365 天），律師意見回來後再調整；開啟排程另開工作。
- **staging 合成資料（#543）**：封測期間不刪除。盤點的 4 個商家（含封測用的 Wuhe Select、Merchant2 測試商店）與 9 支 Stream 影片保留在各自租戶內；封測客戶一律新建商家帳號（BETA-OPS (b)(c)）。正式上線前再依盤點決定刪除範圍，屆時先備份、經 owner 同意、用腳本執行並留收據。

## 2026-11-17 新增 owner 動作

- **GitHub Dependency graph**：Settings → Code security 開啟 Dependency graph，Dependency review 檢查（`.github/workflows/dependency-review.yml`）才會生效；同一頁開啟 **Private vulnerability reporting**，讓外部回報安全問題有私下管道（`SECURITY.md`）。
- **手動觸發一次 `security-audit.yml`**：Actions → Security audit (weekly) → Run workflow，確認 workflow 能成功跑完；有 high／critical advisory 時會開一個 `security-audit` issue，沒有時不開 issue（這是正常結果）。

## 2026-11-28 新增 owner 動作

- **O-26 測試站 R2 圖片上傳的 CORS 設定**：2026-11-28 的 staging 實跑（run 46044199230）確認，在瀏覽器上傳圖片時，取得上傳許可成功，但送到 R2 時被瀏覽器以 CORS 拒絕（`put_failure:ERR_FAILED`、`console_cors:1`、`console_csp:0`）。影響範圍不只示範腳本：測試站所有從瀏覽器上傳圖片的地方（直播海報、商品圖等）目前都會失敗。主對話沒有 Cloudflare 權限。做法：Cloudflare 後台 → R2 → bucket `celebrate-deal-staging` → Settings → CORS Policy → Add CORS policy（若已有規則，把 Origin 加進既有規則即可），貼上：

  ```json
  [
    {
      "AllowedOrigins": ["https://celebrate-deal-staging.carry-digital-nomad.in.net"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["content-type"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

  回報「設了」，主對話會重跑示範場次確認海報與前導影片。正式站更新（D-46）前，正式 bucket 也要對正式網址 `https://celebratedeal.carry-digital-nomad.in.net` 加同樣規則。

## 待 owner 決定

- **R-10 刪除模式（首次成功 runner 的合成商家）**：首次成功路徑 runner 每次執行會留下一個 `cdfs-` 合成商家。runner workflow 結束後會自動「停用」它（凍結，不刪資料；email job 不再寄提醒信），這部分照常自動執行。停用滿 7 天的商家可由 `staging-first-success-cleanup.yml` 以 `mode=delete` 刪除；依 #543「staging 合成資料封測期間不刪除、要刪先備份並經 owner 同意」的政策，**第一次執行刪除模式前需要 owner 同意，並決定是否先備份**。刪除只認 runner 自己的 Email 與 slug，有訂單、帳務紀錄或多了成員的商家一律跳過；上方 #543 盤點的 4 個商家不受影響。做法與範圍見 `docs/launch/staging-first-success-runner.md`。回報：同意與否、是否先備份。

## 2026-11-06 待 owner 處理（彙整）

GitHub environment `Preview – celebrate-deal-staging`：

- 補 secret：`LINE_STAGING_DATABASE_URL`、`CSRF_SECRET`、`CRON_SECRET`、`LINE_STAGING_MESSAGING_CHANNEL_ID`、`LINE_STAGING_MESSAGING_CHANNEL_SECRET`、`LINE_STAGING_MESSAGING_ACCESS_TOKEN`、`LINE_STAGING_USER_ID`
- 補 variable：`LINE_STAGING_DATABASE_IDENTITY_SHA256`
- 補 secret：`PAYUNI_QA_FINANCE_TOTP_SECRET`（O-14）
- 確認 `PAYUNI_SANDBOX_ONETIME_CARD_NO`、`PAYUNI_TEST_EXPIRY`（MM/YY）、`PAYUNI_TEST_CVV` 仍有效

其他：

- `VERCEL_TOKEN`：換一組有 alias 讀取權限的 token。
- 輪替 `OPS_SMOKE_SECRET`（值曾出現在工作對話中），Vercel Preview 與 GitHub environment 需同時更新。
- Production environment：secret `PRODUCTION_DATABASE_URL`（pooler）、variable `PRODUCTION_BACKUP_RECIPIENT_SHA256`，並確認持有對應的 age 私鑰（O-20b）。
- Production 必須明確設定 `AFFILIATE_PAYOUTS_DISABLED`（true／false），否則 preflight 會 FAIL。
- Cloudflare Stream signing key（啟用 #538 的簽章播放網址）。
- Cloudflare WAF：對 `/api/security/csp-report` 設 rate rule。
- 外部排程觸發：2026-11-10 已選方案 B（Cloudflare Worker），owner 依 `docs/launch/scheduled-jobs-external-trigger.md` §5 部署。
- ~~staging 合成資料清理範圍決定（#543）~~：2026-11-10 決定封測期間不刪。
- production 訂單 hash 回填授權（#550，runbook §9.3）。
- 既有待辦 O-3、O-4、O-6、O-7、O-9～O-13、O-17、O-19 等仍待處理，內容見下方原表，此處不重複（O-1、O-15、O-21 已於 2026-11-10 定案）。

~~待 owner 決定的政策~~：2026-11-10 已定案，見最上方。

更新：2026-10-25（主對話維護）。owner 指示「不要停下，手動部分集中成報告」，所以這份清單是 owner 回來時唯一要看的東西。每項都寫清楚：做什麼、在哪裡做、做完要回報什麼、沒做會怎樣。**不要把任何金鑰、密碼、Token 貼到對話裡。**

狀態說明：⏳ 等 owner、✅ 已完成、⚠️ 逾期會影響封測。

## 本週（10-24 前）

| # | 狀態 | 動作 | 在哪裡做 | 做完回報什麼 | 沒做的後果 | 對應 |
|---|---|---|---|---|---|---|
| O-1 | ✅ | **2026-11-10 owner：Sandbox 沒有此功能，改在正式站驗證（需另外授權），staging 維持關閉綁卡。**原說明：**PayUni Sandbox 商店是否開通「信用卡約定 Token」**：登入 PayUni Sandbox 後台，看商店「賀成交AI x CelebrateDeal」的功能列表 | PayUni 後台 | 回「已開通」「未開通」或「不確定」三選一 | 未開通則封測隱藏 Funnel 綁卡與依賴綁卡的發布（已預設如此） | D-03、T1 |
| O-2 | ✅ | **跑一筆 Sandbox 測試付款**：**2026-10-25 完成兩筆**（CD-261025-GQNTR9NNRJB9FK 經 TESTP1、CD-261025-WNZT87JQZ5AWHA 經 TESTP2，皆已付款且佣金正確入帳；LINE 內建瀏覽器那次尚未做，可併入 O-12）。原說明：主對話會在 staging 建一筆合成訂單並給你付款頁連結，你只要輸入 PayUni 公開的測試卡號；建議順便在 LINE 內建瀏覽器開一次 | staging 付款頁（連結由主對話提供） | 回「付了」即可；工程端會從 staging 稽核紀錄取去識別化的回呼樣本 | 付款判斷修正（F-037）只能依文件寫，10-30 才能驗證 | D-04、T2 |
| O-3 | ✅（2026-11-25 已登記） | **平台管理員全部登記 TOTP**：所有 `platform_admin` 帳號登入後到 `/mfa/setup` 完成登記；bootstrap 管理員換掉初始密碼 | staging 與（若有）Production 的 `/mfa/setup` | 回「都登記了」 | #436 合併後，沒登記的管理員下次進財務後台會被導去登記頁（不會被鎖死，只是多一步） | D-05 |
| O-4 | ⏸ | **2026-11-20 owner：暫不升級，之後再決定。**原說明：**Supabase 升級與備份**：封測資料所在的 Supabase 專案升到 Pro、開每日備份；並告訴主對話「哪一個專案是 staging」（專案名稱即可） | Supabase Dashboard → Billing、Backups | 回專案名稱與「已升級」 | 沒有備份就沒有還原演練，封測出事資料救不回（BLOCKER F-058） | D-07 |
| O-5 | ✅ | **GitHub 安全設定（2026-10-27 owner 同意後由主對話以 gh 設定完成）**：secret scanning、push protection、Dependabot security updates 已開；fork PR workflow 改為所有外部貢獻者都需核准；只允許 squash merge、合併後自動刪分支；`Preview – celebrate-deal-staging` 原本就只允許受保護分支；`Production` 加上只允許受保護分支（master）與 required reviewer（a25814740）。原說明：**GitHub 安全設定**（若主對話用 CLI 權限不足會在下方註明哪些沒做成）：Settings → Code security：secret scanning、push protection、Dependabot security updates；Actions：fork PR 需核准改為「所有外部貢獻者」；General：只允許 squash merge、自動刪分支；Environments：staging 與 production 只允許 `master` 部署，production 加 reviewer | GitHub repo Settings | 回「設了」 | 公開 repo 的 secret 洩漏偵測全關；曾貢獻過的外部帳號可直接跑 workflow | D-08、D-22 |
| O-6 | ⏳ | **Vercel 三件事**：(a) 看方案是 Hobby 還是 Pro（影響 cron 次數上限）；(b) 看 Production 與 Preview 環境的 `JOB_SECRET` 是不是同一個值（只需回「相同／不同」，不要貼值；相同就換掉 Production 的）；(c) 在 claude.ai 連接器設定重新授權 Vercel connector（目前對 staging 讀取回 403） | Vercel Dashboard → Settings；claude.ai → Connectors | 回方案名稱、相同／不同、已重新授權 | (a) 排程設定可能超過方案上限；(b) Preview 外洩等於 Production 跨租戶寫入權限外洩 | D-06、D-18、D-21 |
| O-14 | ✅ | **2026-11-23：secret 已存在且財務帳號雙重驗證已實測可用。**原說明：**新增 GitHub environment secret `PAYUNI_QA_FINANCE_TOTP_SECRET`**（環境 `Preview – celebrate-deal-staging`）：值是一組 base32 的 TOTP seed，用任何 TOTP 產生器或 `node -e "console.log(require('crypto').randomBytes(20).toString('base64'))"` 轉 base32 皆可；主對話沒有權限新增 secret。工作線 A 的 runner 會用它讓 staging 財務 QA 帳號通過雙重驗證 | GitHub → Settings → Environments → Preview – celebrate-deal-staging → Add secret | 回「加了」 | #436 合併後，PayUni 退款自動化 runner 會卡在 `/mfa/setup` | A1、F-168 |
| O-15 | ✅ | **2026-11-10 owner 選 A。**原說明：**資料庫與主機跨區二選一**：Supabase 正式專案「CelebrateDeal」在孟買（ap-south-1），Vercel 函式設在東京（hnd1），正式上線會跨區、後台容易逾時。A（建議）：正式上線前把 Supabase 正式專案遷到東京（等還原演練通過後再做，主對話會備好步驟）；B：Vercel Production 改設孟買 `bom1`。封測跑 staging（兩邊都在東京），所以不急，但要在正式上線前決定 | 回「A」或「B」 | 回「A」或「B」 | 正式環境後台逾時 | B3、F-090、D-19 |
| O-16 | ✅ | **2026-11-23：封測期間維持 Hobby。**原說明：**Vercel staging 專案是 Hobby 方案**：GitHub Actions 排程每 5 分鐘呼叫 staging，每天約 290 筆 deployment／function 紀錄；若 Hobby 的用量上限被撞到，排程會失敗。建議把 staging 專案升 Pro，或接受較低頻率（主對話會先用 5 分鐘觀察一週） | Vercel Dashboard | 回「升了」或「維持」 | 排程可能被限流 | B2、F-042 |
| O-17 | ✅ | **2026-11-23：沿用預設 high priority 告警規則。**原說明：**Sentry 告警規則**：在 Sentry 的 staging 專案建立 alert rule：事件 tag 或 message 含 `webhook-retry exhausted` 或 `InventoryUnavailableError` 時，以 Email（或 LINE Notify 替代管道）通知你；另外確認 Sentry 專案已連到正確的 DSN 環境 | Sentry Dashboard → Alerts | 回「建了」 | 付款通知重試失敗或超賣時沒人知道（B03-07） | B2、M2 |
| O-18 | ✅ | **固定 staging 網址已切到與 master 相同的部署（2026-10-25 主對話完成）**：`celebrate-deal-staging.carry-digital-nomad.in.net` 現在指向 `dpl_2NRwSRDjhhXNGKX216BrKgzCwKQ7`（commit `585385cc`，tree 與 master `a9291147` 完全相同，包含 #484 邀請制註冊與 #485 CSRF 金鑰分離修正）；上一個目標 `dpl_FPzL7VRCHnCgeJQhmTdzHj6f4XYQ` 保留作為回滾選項。Smoke 通過：`/api/health` 200 且 db ok、`/login` 顯示「受邀商家註冊」、`/register` 顯示邀請制說明。**之後每次合併都要再切一次**：staging 是只有 preview 部署的專案（沒有 master／production 部署），合併後必須把 alias 指到 tree 與 master 相同的部署，staging 才會更新。Production（`celebratedeal.carry-digital-nomad.in.net`，Vercel 專案 `celebrate-deal`）仍是 2026-07-24 的 build，**刻意不更新**：它的資料庫 migration 必須先完成 O-4 備份與還原演練、O-19 RLS 前置查詢、O-20 production migration 設定；Production 目前不服務封測商家 | — | 無需動作 | — | B2 證據、STATE |
| O-19 | ⏳ | **RLS migration 部署前置查詢（Production 才需要）**：PR #452 會對全部資料表啟用 RLS，執行 migration 的角色必須是每張表的 owner 或可繼承的成員。staging 已由主對話唯讀查證通過（postgres 是 prisma 的成員）；Production 專案主對話無法讀取，請在正式部署前依 `docs/operations/prisma-migration-guards-runbook.md` 的前置 SQL 查一次並回報「通過」 | Supabase SQL editor（Production 專案） | 回「通過」或貼出 owner 清單（不含資料） | migration 在 Production 會整批 RAISE 停止，不會部分成功，但部署會失敗 | B04-08、PR #452 |
| O-20 | ⏳（a ✅） | **Production migration 的前置（PR #457 之後）**：(a) 已於 2026-10-27 設定（GitHub `Production` environment：required reviewer a25814740、只允許 master）；剩 (b)。原說明：(a) GitHub `production` environment 設定 required reviewers（你自己）；(b) **2026-11-03 更新**：`.github/workflows/production-backup.yml` 已建立（路徑寫死在 `scripts/production-migrate.mjs`，不再需要 `PRODUCTION_BACKUP_WORKFLOW_PATH` 變數）。它掛在同一個 `production` environment，只用你在該 environment 設定的 secret `PRODUCTION_DATABASE_URL`（與 `production-migrate.yml` 共用），以 repo 內的公鑰 `ops/backup/keys/production-backup.agepub` 加密。你要做的：① 確認 `PRODUCTION_DATABASE_URL` 已設定；② 確認手上有這把公鑰對應的 age 私鑰（`age-keygen -y <私鑰檔>` 的輸出要等於檔案中的 `age1…` 行；沒有就無法還原，需開 PR 換公鑰）；③ **在 `production` environment 新增 variable `PRODUCTION_BACKUP_RECIPIENT_SHA256`**，值是公鑰檔的 SHA-256，用 `git show origin/master:ops/backup/keys/production-backup.agepub | sha256sum` 自行計算（在 Git Bash、Linux 或 macOS 執行，取輸出的前 64 個字元；不要用 PowerShell 轉存檔案再算，換行可能被改成 CRLF 而得到不同值）。未設定或與檔案不符時備份一律拒絕（防止有人用 PR 偷換公鑰）；④ Run workflow 並核准一次，再依 `docs/operations/production-backup-restore-runbook.md` §4 做還原演練並記 RTO。`production-migrate` 的 `backup_run_id` 只接受這個 workflow 24 小時內在 master 成功、且有 `production-database-backup-<run id>` artifact 的 run，沒有就一律拒絕部署，這是刻意的；正式上線前仍要先完成 O-4 的備份與還原演練 | GitHub Settings → Environments；Actions → Production backup | 回「設了」與第一次備份的 run ID | 正式 migration 無法執行（封測不受影響，封測跑 staging） | F-064、D-41 |
| O-21 | ✅ | **2026-11-10 owner：先採預設，律師意見後再調；開啟排程另開工作。**原說明：**個資保存期限定案**：`/api/cron/data-retention` 預設關閉，期限預設 WebhookEvent payload 180 天、AnalyticsEvent 365 天、AuditLog IP 365 天，請依律師建議回「採預設」或改數字；定案後主對話再開啟排程 | 回覆即可 | 回「採預設」或數字 | 保存期限未定前不清理（只影響儲存量） | F-070、D-38 |
| O-22 | ✅ | **2026-11-25 owner：每家封測商家用 Growth（每月 90,000 分鐘），開通時套用。**原說明：**直播分鐘額度即將第一次真正生效**：審查發現 master 上的用量心跳從 #136 起每次都 500，帳本是空的，所以「方案分鐘額度」從未擋過任何人。PR #461 合併後額度會真的生效。封測前請確認每個封測商家的方案額度足夠（或先設為不限），並在封測說明中告知「超過額度播放會暫停」 | 商家後台方案設定 | 回「確認了」 | 封測客戶直播到一半被暫停 | R461-02 |
| O-23 | ✅ | **封測商家功能授權**：**2026-10-25 已設定**：Wuhe Select、Merchant2 測試商店開啟課程、平台方案／帳單、諮詢預約、瀏覽器直播、彈幕；「平台服務綁卡」在 staging 維持關閉（O-1：Sandbox 無約定 Token），正式站開通時再開。新封測商家開通時再逐一設定。原說明：PR #465 之後課程、billing、Funnel 綁卡、諮詢預約、瀏覽器直播、彈幕六個模組在伺服器端預設關閉，只有平台管理員能在 `/admin/vendor-features` 逐商家開啟。封測前請為每位封測商家決定要開哪些（預設全關；顧問型客戶可開諮詢預約） | staging `/admin/vendor-features` | 回「設了」 | 封測商家看不到這些模組（這是預設行為） | F-001、D-02 |
| O-24 | ⏳ | **Vercel Hobby build 速率上限**：10-22 PR #465 的兩個 Vercel preview 檢查因 build-rate-limit 失敗（非程式問題，`quality` 綠）。切 alias（O-18）或之後自動部署若再遇到，等一小時重試；或與 O-6 一併評估升 Pro | Vercel | 無需立即動作 | 只影響 preview 部署時效 |
| O-7 | ✅ | **2026-11-23：否，正式網域不經 Cloudflare；限流改由應用層處理（A4-03）。**原說明：**Cloudflare**：正式網域是否全程經 Cloudflare 代理（橘雲）且沒有其他直連入口 | Cloudflare DNS | 回「是／否」 | 否則限流可被偽造標頭繞過，要多修 1～1.5 人日 | D-20 |

## 封測前（10-27～10-29）

| # | 狀態 | 動作 | 截止 | 對應 |
|---|---|---|---|---|
| O-8 | ✅ | **LINE 官方帳號方案（2026-10-27 owner 確認：平台官方帳號本來就是輕用量，不需異動；不受 11-01 中／高用量調價影響）**：**主對話建議（2026-10-27）：平台自己的官方帳號用「輕用量」（免費、每月 200 則）**。理由：程式中平台本身不發任何 LINE 推播（封測商家用自己的官方帳號，D-23 A），平台帳號只做客服與公告；11-01 起中用量與高用量方案調漲（金額以 LINE 官方公告為準；原文的金額在先前編輯時因 `$` 被取代而遺失），10-27 後仍停在中／高用量視為同意新價。若目前是中／高用量且沒有大量群發需求，今天降成輕用量；之後真的需要群發再升級（維護期 10-28～11-02 之後）。原說明：10-27 前決定平台自己的官方帳號用哪個方案；10-28 到 11-02 是 LINE 維護期，不要異動。封測商家用自己的官方帳號推播，平台不代付（已預設） | **10-27** | D-23 |
| O-9 | ⏸ | **2026-11-20 owner：暫緩。定案時要同時把政策頁的聯絡信箱（`publicSupportContact.email`，目前是個人 Gmail）換成新信箱。**原說明：**政策頁法定資料**：目前政策頁的營運者顯示為「Carry Digital Nomad 凱瑞數位」、聯絡信箱是個人 Gmail（`src/lib/public-policy-content.ts` 的 `publicSupportContact`），沒有法定名稱、統編或負責人、地址。原說明：營運者法定名稱、統編或負責人姓名、營業地址；建議申請專用網域信箱取代個人 Gmail。給主對話文字即可，會由 docs 改到政策頁 | 10-29 | D-24 |
| O-10 | ✅ | **2026-11-20 owner：條款 OK**（主對話已在 staging 逐頁確認 `/policies/terms`、`/policies/privacy`、`/policies/refunds` 內容完整）。原說明：**#435 條款簽核**：看過 staging 的服務條款、隱私權政策、退款政策頁後，回「條款 OK」，主對話會記進 STATE.md | 10-29 | D-25 |
| O-11 | ✅ | **2026-11-20 owner：採方案 B，每位封測商家簽封測協議。** 同日 owner 在對話中選定：第 8 條賠償上限「新台幣 3,000 元」；第 1 條封測期間「從同意日起到正式上線」，結束時平台以 Email 通知；並要求改為**網頁內勾選同意（clickwrap）取代 Email 回信**（商家 owner 進後台前在彈窗閱讀全文並勾選，系統記錄帳號、商家、協議版本與時間，條文以 `src/lib/beta-agreement-content.ts` 為準，版本 `beta-2026.11.20`）。**2026-11-24 owner 決定第 11 條第 1 項管轄法院改為臺灣臺中地方法院，協議版本換成 `beta-2026.11.24`，已同意舊版的商家下次進後台要重新同意。** 可簽版本：[beta-merchant-agreement.md](beta-merchant-agreement.md)（未經律師審閱；正式上線前仍建議律師審閱商家服務條款）。原說明：**律師**：商家服務條款（虛擬使用者責任歸屬、不標示版的公平法風險）、七日猶豫期告知文字、個資告知簡版。來不及就改成每位封測商家另簽一份封測協議（主對話會先備好草稿） 備案草稿已備好：[beta-merchant-agreement-draft.md](beta-merchant-agreement-draft.md)（須律師或你本人審閱後才能使用）。 | 10-29 | D-26～D-28 |
| O-12 | ⏳ | **10-30 完整付款演練**：再輸入一次測試卡號，工程端跑成功、失敗、重複通知、部分與重複退款 | 10-30 | D-04 |
| O-13 | ⏳ | **10-31 Go／No-Go**：以封測客戶身分走一次首次成功路徑（註冊、建商品、建表單、建直播、發布、報名、觀看、Sandbox 結帳），回「Go」或列出卡住的地方。註冊要先用 O-25 產生自己的邀請連結 | 10-31 | ROADMAP §3.1 |
| O-25 | ⏳ | **封測商家改為邀請制註冊（2026-10-25 owner 核准）**：`ai/invite-only-registration` 合併並部署後，`/register` 預設只接受平台邀請連結，沒有連結的人只會看到「封測期間僅限受邀商家註冊」。**前置條件（未全部滿足前不要發出第一個邀請）**：CSRF 金鑰分離修正 PR #485（`ai/fix-csrf-kdf-key-separation`）已合併，**且** staging 固定網址已切到包含 #485 的部署（O-18，2026-10-25 已完成），**且** Production 開始服務商家之前，必須已在跑包含 #485 的版本（目前 Production 不服務商家，見 O-18）。修正前的漏洞可為任何用途衍生金鑰，未部署 #485 的環境簽出的邀請可被偽造。撤銷注意：撤銷擋不住已送出、正在處理中的註冊；撤銷後請確認清單上該筆不是「已註冊」，若是，需另行停用該帳號。做法：(1) 用平台管理員帳號（需已登記 TOTP，見 O-3）登入 staging，左側選單「平台營運 → 商家邀請」（`/admin/merchant-invitations`）；(2) 輸入封測商家的 Email，按「產生邀請連結」（產生與撤銷都需要 15 分鐘內完成 MFA 驗證，頁面會提示）；(3) 按「複製邀請連結」，自己寄給對方本人。系統**不會**自動寄信；連結 14 天內有效，拿到連結的人都能用這個 Email 註冊，所以只寄給本人；過期就再產生一次；寄錯就在清單上按「撤銷」。清單只顯示遮罩後的 Email，請自行記錄寄給了誰。(4) Vercel staging 與 Production **不要**設定 `REGISTRATION_MODE`（未設定＝邀請制）；商家 Email 驗證已實作（見 O-27），只有正式公開註冊、且 O-26 的 Turnstile 金鑰設定完成後，才把它設成 `open`（沒設 Turnstile 或寄信設定就設 `open`，部署的 preflight 會失敗） | 每位封測商家開通前 | 回「邀請寄出了」即可 |
| O-26 | ⏳（staging ✅） | **staging 已於 2026-10-25 設定完成並實測，剩正式環境**；建立 Cloudflare Turnstile widget 並設定兩個環境變數（公開註冊前必做；封測邀請制下可稍後）**：程式已就緒（`ai/merchant-email-verification`），沒有金鑰時 Turnstile 停用、註冊照常可用。做法：(1) Cloudflare Dashboard → Turnstile → Add widget，模式選 Managed；Hostname 加入 `celebrate-deal-staging.carry-digital-nomad.in.net` 與 `celebratedeal.carry-digital-nomad.in.net`（也可 staging、正式各建一個 widget）；(2) 把 Site Key 設成 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`、Secret Key 設成 `TURNSTILE_SECRET_KEY`，staging 設在 Vercel `celebrate-deal-staging` 專案的 Preview 環境，正式設在 `celebrate-deal` 專案的 Production 環境；(3) 重新部署（staging 依 O-18 再切一次 alias），用固定網址開 `/register` 確認看得到「確認你是真人」元件。兩個值**必須同時設定**，只設一個會讓註冊與重新寄送驗證信全部失敗、preflight 也會失敗。用 `*.vercel.app` 的 preview 網址測試時，要把該 hostname 加進 widget，否則驗證會失敗（伺服器也會核對 Cloudflare 回傳的 hostname，只接受該環境的網址；要額外接受的網域可列在 `TURNSTILE_ALLOWED_HOSTNAMES`）。Cloudflare 文件上的測試金鑰（`1x0000…AA` 等）在 Vercel 上一律拒絕，請用真正的 widget 金鑰。不要把金鑰貼到對話 | Cloudflare Dashboard → Turnstile；Vercel → Settings → Environment Variables | 回「設了」與環境（staging／正式） | 註冊與重新寄送驗證信沒有機器人防護（邀請制下可接受）；無法把 `REGISTRATION_MODE` 設成 `open` | 2026-10-25 owner 決策 |
| O-27 | ⏳ | **商家 Email 驗證上線後的告知（`ai/merchant-email-verification` 合併並部署後）**：新註冊的商家會收到驗證信（24 小時有效）；既有帳號（含你自己的測試商家）**不會被鎖住**，登入後只會看到「請先驗證 Email」提示，可到 `/verify-email` 重新寄送。未驗證的商家不能做**新的**「不需發布專案就公開」名單型網站發布（已公開的頁面不受影響、可重新發布；專案內的網站不受影響）。邀請連結不算驗證信箱，用邀請註冊的商家也要收信驗證；接受成員邀請或完成密碼重設的帳號會自動視為已驗證。請在封測說明中提醒商家收信（看垃圾郵件匣）。staging 必須能寄信（`RESEND_API_KEY`、`EMAIL_FROM` 本來就是必要設定） | 封測說明文件 | 回「知道了」 | 商家不知道為什麼名單型網站無法發布 | 2026-10-25 owner 決策 |

## 封測後再處理

- 會計師：手續費、扣繳、二代健保、發票開立主體（第一次撥款前，最早 12 月初）。
- 律師意見書：聯盟是否觸及多層次傳銷、金流定性（聯盟開放出款前）。
- 舊 worktree 移除、`prisma/dev.db` 與 `error.log` 刪除、docs 歸檔。

## 主對話代為決定並已執行的事（owner 回來後只需知道）

- DECISIONS-2026Q4 的 D-01、D-02、D-06、D-09～D-17、D-19、D-21、D-29 全部採預設建議 A；D-06 排程平台以 Vercel Cron 為主，若方案上限不足則用 GitHub Actions 排程暫代。
- 封測範圍：直播／預錄場、互動腳本與虛擬使用者（不標示版）、商品結帳（只用台幣、Sandbox）、報名表單、漏斗頁、LINE／Email、Meta 追蹤（預設關）、聯盟只累計不出款、CRM／客服；隱藏課程、billing、Funnel 綁卡、諮詢預約、瀏覽器直播、彈幕。每場同時在線 20 人以下，不鎖月結、不撥款。
- 三條工作線已在獨立 worktree 開工：`codex/beta-lineA-auth-payments`、`codex/beta-lineB-data-ops`、`codex/beta-lineC-first-success`。
