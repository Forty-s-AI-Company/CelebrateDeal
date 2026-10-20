# Goal：封測前準備（2026-10-20 → 2026-11-01）

只有主對話編輯本檔。依據 `docs/ROADMAP-v2.md` §3 與 `docs/DECISIONS-2026Q4.md`。owner 2026-10-19 指示：全部採主對話判斷、不停下、需手動的事集中到 `OWNER-ACTIONS.md`。

## 狀態

- STATUS：IN_PROGRESS
- 基線：`origin/master@78621ca3`
- 審查 PR：#445（docs，待 CI）；接手 PR：#436（WP-10 admin MFA，CONFLICTING，由工作線 A 處理）
- 工作線與 worktree（各自 `npm ci`＋`prisma generate`）：
  - A `codex/beta-lineA-auth-payments` → `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineA`（engineer-hard＋reviewer）
  - B `codex/beta-lineB-data-ops` → `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineB`（engineer-hard＋reviewer）
  - C `codex/beta-lineC-first-success` → `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineC`（engineer）
- 檔案鎖：`src/app/actions.ts` 只有工作線 C（C4）可寫；`vercel*.json` 只有工作線 B 可寫；`src/lib/auth.ts` 只有工作線 A 可寫；`prisma/schema.prisma` 與 migrations 需先在本檔登記。

## 已採用的決策（預設 A，依 DECISIONS-2026Q4）

D-01 Sandbox 封測；D-02 前端隱藏＋不開權限；D-06 Vercel Cron 為主（方案不足則 GitHub Actions 暫代）；D-09 不用瀏覽器直播；D-10 虛擬使用者不計入觀眾端在線人數；D-11 隱藏彈幕與暖場控制台；D-12 腳本改選配；D-13 保留雙重確認並補「前往直播間」；D-14 封測不設庫存上限；D-15 同時在線 ≤20；D-16 不鎖月結不撥款；D-17 夥伴入口不授權外部人；D-19 hnd1＋Skew Protection；D-21 治理設定同意；D-29 商家 MFA 不強制。
D-05：#436 經 rebase、QA 帳號 TOTP、reviewer 通過、CI 綠後由主對話合併（owner 已授權「需要修改就改」）；owner 仍需讓平台管理員登記 TOTP（O-3）。

## 環境事實（2026-10-19 主對話唯讀查證）

- Supabase：staging 專案 `CelebrateDeal Staging`（ref `ocbugvgojrunvenozsbx`，ap-northeast-1 東京，PG 17.6）；production 專案 `CelebrateDeal`（ref `awigitueyqdqaqwbjdgu`，**ap-south-1 孟買**，不在東京）。
- B1 RLS 唯讀查證（staging，2026-10-19，只查中繼資料）：public 表 149 張，其中 70 張未開 RLS、policy 0 條；但 `anon` 與 `authenticated` 對任何表都沒有 SELECT 或其他 grant。結論：Data API 預設拒絕有效，**不是封測阻擋**；對全部表開 RLS 的 forward migration 降為 L1 防禦縱深。DB TimeZone = UTC。
- Vercel staging 專案：函式區域 hnd1、無 crons、Skew Protection 未設、fork protection 開；env 名稱含 `JOB_SECRET`、`CRON_SECRET`（preview）。Vercel production 專案與團隊方案：主對話的唯讀查詢被權限分類器擋下（Production Reads），列入 O-6。
- GitHub：repo 設定為 admin，目前允許 merge commit 與 rebase、不自動刪分支；secret scanning／push protection／Dependabot／fork PR 核准／環境保護的變更被權限分類器擋下（Account & Standing-Rule），全部列入 O-5 由 owner 在 GitHub 設定頁完成。環境 `Preview – celebrate-deal-staging` 的 secret 名稱：JOB_SECRET、PAYUNI_QA_FINANCE_EMAIL／PASSWORD、PAYUNI_SANDBOX_*、PAYUNI_TEST_*、STAGING_DATABASE_URL、VERCEL_TOKEN；`Production` 環境沒有 secret。

## 工作項目

| WP | 狀態 | 分支／PR | 備註 |
|---|---|---|---|
| P-1 文件 PR | DONE | #445 | PRODUCT.md、domain-workflows.md 已含 |
| P-2 STATE.md | DONE | 本檔 | |
| P-3 prisma generate | DONE | 主目錄與三個 worktree | |
| P-4／D1 CSRF_SECRET 說明 | DONE（待審） | B，PR #447 `99c2990b` | |
| A1 staging QA 帳號 TOTP | IN_REVIEW | A，PR #448 `29705acc` | runner 遇 `/mfa/setup` 明確失敗，需先帶 seed 跑 bootstrap；bootstrap workflow 多注入 `CSRF_SECRET`；**owner 需新增 `PAYUNI_QA_FINANCE_TOTP_SECRET`（O-14）** |
| A2 #436 rebase＋MFA | IN_REVIEW | A，PR #448 `fbd090fb` | 取代 #436；合併後關閉 #436 |
| A3 PayUni TradeStatus | IN_REVIEW | A，PR #448 `84f22d38` | 待 Sandbox 樣本驗證：TradeStatus 4／9、外層 Status、`Credit=1`、Apple／Google Pay 的 PaymentType；B03-13 未做 |
| A4 註冊同意紀錄 | IN_REVIEW | A，PR #448 `82f09e08` | 新 model `UserPolicyConsent`＋migration `20261019120000`；條款文字仍等 O-11 |
| B1 RLS 查證 | IN_PROGRESS | 主對話 | |
| B2 排程 | IN_REVIEW | B，PR #447 `ad199160` | 改以 GitHub Actions 每 5 分鐘為唯一路徑：Preview 專案不觸發 Vercel Cron、staging 是 Hobby；6 個端點排程，billing-cycle 與 electronic-invoices 每日；tracking-deliveries 未排（需 vendorId） |
| B3 區域與連線池 | IN_REVIEW | B，PR #447 `ee6d082c` | regions hnd1；preflight 只警告。**跨區待 owner 決定（O-15）** |
| B4 備份還原演練 | 準備完成（待審）／演練 BLOCKED_OWNER | B，PR #447 `9663d543` | runbook、`pg_trgm` 修正已驗證；真實演練等 O-4 |
| C1 結帳頁內部備註 | IN_REVIEW | C，PR #449 `71235e6a` | |
| C2 時區與 404 | IN_REVIEW | C，PR #449 `f7c2224e` | 依 Next 16.3.8 文件用 `retry` |
| C3 虛擬使用者角色與不標示 | IN_REVIEW | C，PR #449 `55b7d4e3` | 播放頁揭露語改「部分互動」未移除，待律師（O-11） |
| C4 Slug | IN_REVIEW | C，PR #449 `55041c53` | |
| C5 腳本改選配 | IN_REVIEW | C，PR #449 `2caf9cbc` | |
| C6 Sentry 個資過濾 | IN_REVIEW | C，PR #449 `fb66c229` | 含 F-098 取樣率 |

## 每日摘要

- 10-19：Goal 啟動。三個 worktree 建立中；OWNER-ACTIONS.md 建立。
