# Goal：封測前準備（2026-10-20 → 2026-11-01）

只有主對話編輯本檔。依據 `docs/ROADMAP-v2.md` §3 與 `docs/DECISIONS-2026Q4.md`。owner 2026-10-19 指示：全部採主對話判斷、不停下、需手動的事集中到 `OWNER-ACTIONS.md`。

## 狀態

- 2026-10-22 22:00：L1 全部合併，loop 停止；等待 owner 動作（OWNER-ACTIONS.md）與 10-31 Go／No-Go 檢查。

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

## 合併紀錄

- #445 審查與市場研究文件（10-19）
- #447 工作線 B：排程、區域、備份準備（10-19，reviewer 兩輪後可合併）
- #446 Goal 狀態文件（10-20）
- #448 工作線 A：PayUni 交易狀態、財務後台 MFA、QA TOTP、註冊同意（10-20，reviewer 三輪後可合併；CI 擋下 backup blob 白名單、tracking gate 的 src→scripts import、subscription gate 固定總數三個問題後通過）；#436 已關閉並由其取代
- #449 工作線 C：結帳頁備註、台灣時區與繁中 404、虛擬使用者不標示版、直播網址、腳本選配、Sentry 個資過濾（10-20，reviewer 兩輪後可合併；CI 擋下 secret scan 假金鑰、strict-index、slug 預檢順序、actions.ts 行數上限、e2e 404 標題與文案、g7 契約文案六個問題後通過）

- #452 第二批 B：全表 RLS migration、RLS 目錄測試、migration 順序與 drift 檢查（10-20，reviewer 三輪後可合併）
- #466 第六批 C：表單欄位錯誤與聚焦、直播草稿衝突明確選項、架構宣稱與 runbook 更正（10-22，reviewer 一輪可合併；CI 一次因 master 的帳號限流測試時間抖動失敗，重跑通過；無 migration）
- #467 帳號限流鎖定起點截到毫秒（10-22，CI 抖動根因修正；reviewer 可合併；無 migration）
- #465 第六批 A：伺服器端封測功能閘門（Vendor.betaFeatureGrants、/admin/vendor-features）、月結不扣聯盟佣金 D-31 A（10-22，reviewer 三輪：BLOCKER 夾具授權、MAJOR courses 關閉仍可結帳、複審 e2e 夾具模組開關、CI WP-88 守門清單；migration `20261021171100` 已套 staging）
- staging：10-20 以 `staging-migrate.yml`（deploy）套用 master 的 migration 兩次（註冊同意表、全表 RLS）；alias 切換仍待 O-18

**第二批（L0 可繞過＋L1）**：#452、#454（10-20）、#453（10-21）全部合併。累計合併 PR：#445、#446、#447、#448、#449、#452、#453、#454。

**L0 核心 18 項狀態（10-20）**：A1、A2、A3（待 Sandbox 樣本驗證）、A4、B2、B3、C1～C6、D1 已合併；B1 唯讀查證完成（非阻擋）；B4 真實還原演練等 O-4 Supabase 升級。

## 每日摘要

- 10-23（深夜）：**O-1 結論**：PayUni Sandbox 商店四個分頁都沒有信用卡約定 Token（綁卡）項目，視為未開通，封測維持隱藏綁卡；owner 另提供正式商店頁供唯讀查看：國內卡 2.5%、國外卡 3.5%、銀聯 2.8%、自動請款、3D 全啟用、同樣沒有 Token 項目；程式預設費率 2.8% 與正式不同，已列 O-26。結帳頁修正 PR #471 送獨立審查中。
- 10-23（晚）：**O-2 完成**：owner 在 staging 以 NT$1 合成商品完成 PayUni Sandbox 付款，訂單與交易 `paid`、回呼 1 筆 `processed`；實際回呼為 `Status=SUCCESS`、`TradeStatus=1`、`PaymentType=1`，與 F-037 一致（證據 `evidence/O-2-…`）。owner 同時發現結帳頁兩個問題並交付修正：①發票類型／載具下拉一切換就誤報錯且舊錯誤不清除；②收件資料缺「同購買人」勾選（工作線 B，分支 `codex/beta-checkout-form-fixes`，屬 checkout 需獨立審查）。
- 10-23：owner 開始執行 O-18／O-3。**O-18 完成**：staging 固定網址切到 `celebrate-deal-staging-qytj0bbdk`（commit a8c07b01，= master 少 #467），排程 workflow 手動跑成功。發現 staging 平台管理員的 7 月驗證器資料因 `CSRF_SECRET` 之後被換過而無法解密（登入後 `/mfa/verify` 解密失敗），經 owner 同意刪除該帳號驗證器與備援碼，待其重新登記（O-3）。Owner 兩項產品決策：①一般用戶密碼改 8 碼＋常見密碼清單，管理員維持 12 碼（PR #468，reviewer 兩輪後可合併；複審 MINOR 待辦：NFKC 展開可繞過長度下限、少數弱密碼如 `1qaz2wsx!`、`Pa$$w0rd` 仍通過）；②雙重驗證頁改「第一步、第二步」白話教學（PR #469；`settings/security` 頁雙重驗證區塊文案待 #468 合併後補，並同步 `tests/e2e/accessibility.spec.ts:87,95`、`src/app/actions.test.ts:3898`）。**新阻擋**：今天公布 next 16.0.0–16.4.0 與 @sentry/nextjs ≤10.75.1 的嚴重漏洞，CI 的 `npm audit` 失敗擋住所有 PR；暴露面：圖片優化已關閉、無 `use cache`，Server Actions DoS 適用；已派 engineer-hard 做 `codex/beta-security-deps-upgrade`，完成後審查並合併，再讓 #468／#469 同步 CI。
- 10-22（晚）：#465 合併並套用 staging migration（累計 22 個 PR，含 #460 文件）。**L1 48 項全部進 master；OWNER-ACTIONS 只剩 owner 本人項目，Goal 自動推進 loop 依停止條件結束**。Go／No-Go 摘要見 GO-NO-GO.md §0。殘餘（封測後或 owner 決策）：F-093 Stream 簽章網址只完成評估，實作等 Cloudflare 設定；F-091 (2) 與 F-134 其餘 action 矩陣列 L2；Vercel Hobby build 速率上限 10-22 觸發一次（O-24）。
- 10-22（傍晚）：#467 合併（累計 21 個 PR）。#465 同步 master 後 CI 在 Release browser gates 掛一個 Playwright 斷言，交回工作線 A 查根因。
- 10-22（下午）：#466（第六批 C）合併（累計 20 個 PR）。#465 經 reviewer 兩輪：BLOCKER（夾具缺 browser_live 授權）、MAJOR（courses 關閉仍可結帳課程商品、商家不能下架）、複審 BLOCKER（e2e 夾具授權未同步開啟商家模組開關）皆已修，等 CI 完整跑綠後三審。CI 揭露 master 既有的帳號限流 3601 秒抖動，根因是 `now()` 微秒寫進 TIMESTAMP(3) 四捨五入；開 #467 修正（截到毫秒＋回歸測試），reviewer 可合併，等 CI。
- 10-19：Goal 啟動。三條工作線完成實作並開 PR #447／#448／#449；每個 PR 經 reviewer 一到三輪（A 兩個 MAJOR＋一個 MAJOR、B 兩個 MAJOR、C 一個 BLOCKER 皆已修）；#447 合併。CI 擋下的問題：secret scan 誤判測試 URL／假金鑰、API contract registry 未登記、strict-index typecheck、backup blob 白名單、slug 預檢順序，全部修正。工作線 A 曾因 Opus 額度中斷一次，10-20 重跑完成。
- 10-22（續）：#464（第六批 B：兩租戶 action 矩陣、CI 收斂）合併（累計 19 個 PR）；#465（第六批 A：伺服器端功能閘門、月結不扣佣金）審查中；第六批 C 實作中。
- 10-22：#462（第五批 A）合併並套用 staging migration；第五批全部進 master（累計 18 個 PR）。第六批（L1 最後一批）開工：A（F-001／F-002 伺服器端功能閘門、F-044 月結不扣佣金 D-31 A）、B（F-134 兩租戶 action 矩陣、F-147 CI 收斂）、C（F-117 表單欄位錯誤與聚焦、F-017／F-076 文件更正、B07-20 草稿衝突最小方案）。
- 10-21 深夜：#463（第五批 C：metadata、工程詞彙表與掃描、互動台收合、焦點與控件）合併；#462（第五批 A：step-up MFA、帳號限流、邀請 token）解衝突並修瀏覽器 gate fixture 後等 CI。累計 17 個 PR 進 master。
- 10-21 傍晚：#461（第五批 B：用量心跳計數列、簽章 pass、/lp proxy）合併並套用 staging migration；**直播分鐘額度自此第一次真正生效（O-22）**。#462 與 master 衝突且 tracking 瀏覽器 gate 因 step-up 失敗，交回處理；#463 審查通過等 CI；#460 等 CI。
- 10-21 下午：#459（第四批 C）合併，第四批全部進 master（累計 14 個 PR）。第五批 B 開 PR #461（用量心跳計數列、輪詢可見性與簽章 pass、/lp proxy、Stream 簽章評估）審查中，與 master 有衝突待審後解；第五批 C 開工（metadata、工程詞彙表、互動台收合、T6 剩餘、onboarding 單一來源）。
- 10-21 中午：#458（第四批 A，月結兩個 BLOCKER）合併並套用 staging migration；#457（第四批 B）解衝突後合併並套用 staging migration；#459 同步中。第五批開工：A（F-027 高風險操作 MFA step-up、F-028 帳號層限流）、B（F-091 入場可見性閘門與簽章 token、F-015 /lp 併發量測、F-093 Stream 簽章網址評估）。
- 10-21 上午：#451 文件 PR 合併。第四批三個 PR 都已通過 reviewer（A #458 三輪、B #457 兩輪、C #459 兩輪），CI 修正（gate 固定數 89／68、funnel 封存 e2e、手機導覽 smoke 契約）已推上，等 CI 綠燈合併。子代理曾於 06:50 前撞到額度限制，重置後重派。
- 10-21（續）：#456 合併；第三批全部進 master。第四批開工：A（F-038、F-039 月結 BLOCKER、F-047、F-003、F-055、F-146）、B（F-073 撥款帳號、F-072 頁面封存、F-070 個資處理、F-064 正式 migrate workflow）、C（F-142 readiness、F-120、F-128／127／121、F-118、F-126、F-133、F-122／123）。
- 10-21：#455（第三批 A：訂單號唯一、退款共用後處理、不明退款人工釋放、大額調整覆核、手續費依費率）合併並套用 staging migration；#456（第三批 C）審查通過等 CI；#451 文件 PR 等 CI。owner 啟動每 30 分鐘的 /loop 自動推進。
- 10-20：#446、#448、#449 合併。三條工作線全部進 master（`bd85be87`）。**staging 尚未更新**：固定網址仍指向 10-18 的舊部署 `celebrate-deal-staging-iczhm0bi7`；staging 專案的 production 部署自 8 月起失敗，master 合併不會自動部署；主對話切 alias 被權限擋下，改列 O-18（目標部署 `2opyiacfr`，tree 已驗證等於 master）。B2 排程證據：GitHub Actions 已自動執行 4 次，`email-deliveries`、`webhook-retry` 回 200，`line-notifications` 回 405（舊部署沒有 GET 入口，切 alias 後應轉綠）。另推了 `codex/staging-release-20261020b`（= master）讓 Vercel 建一個乾淨 preview 備用。下一步：staging 自動部署後確認 GitHub Actions 排程實際呼叫端點（B2 證據）、owner 待辦 O-1～O-17、L0 可繞過項（§3.3）與 L1 排程。
