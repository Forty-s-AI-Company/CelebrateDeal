# 封測營運手冊（BETA-OPS）

- 版本：2026-10-21，依 `docs/goal-beta-prep-2026Q4/STATE.md`（10-20 狀態）與 `docs/ROADMAP-v2.md` §4 撰寫。
- 性質：操作說明。本文件沒有執行任何環境操作；所有外部動作以 `OWNER-ACTIONS.md` 為準。
- 相關文件：`STATE.md`、`OWNER-ACTIONS.md`、`GO-NO-GO.md`、`BETA-METRICS.md`、`docs/ROADMAP-v2.md` §4、`docs/launch/scheduled-jobs-runbook.md`、`docs/operations/prisma-migration-guards-runbook.md`、`docs/skills-2026Q4/05-execution-playbook.md` §6。

## (a) 環境

- 封測跑 staging：Vercel 專案 `celebrate-deal-staging`、Supabase 專案 `CelebrateDeal Staging`（東京）。
- 固定網址：`https://celebrate-deal-staging.carry-digital-nomad.in.net`。
- 不碰 Production。Production 的 Supabase 在孟買，Production 部署與正式付款需 owner 另行授權（AGENTS.md）。

### 部署與 alias 切換

- master 合併後 staging 不會自動更新：staging 的 production 部署自 8 月起失敗（STATE 10-20）。
- 目前流程：
  1. 確認目標部署的程式樹與 master 相同（STATE 已記錄驗證方式）。
  2. owner 依 `OWNER-ACTIONS.md` O-18 在本機 Vercel CLI 執行 `vercel alias set`。主對話的 alias 指令被權限擋下，無法代跑。
  3. owner 回覆「切了」後，主對話跑 `scheduled-jobs` workflow 與瀏覽器 smoke。
- 注意：目標部署 ID 會隨時間過期。執行前以 O-18 當下內容為準，不沿用舊 ID。
- 長期建議（O-18）：把 staging 的 production branch 改為 master，並修復其 production 部署，之後合併即自動更新。是否採用由 owner 決定。
- 部署會動到資料庫：staging 的 `buildCommand` 會對 staging DB 套用 migration（ROADMAP §0.4）。因此每次部署都是 schema 變更。

### migration 套用

- 規則：只允許向前，不改、不改名已套用的 migration（guards runbook §2）。
- 手動套用：GitHub Actions `staging-migrate.yml`（workflow_dispatch）。
  1. 先選 `mode = status`，唯讀確認待套用清單。
  2. 確認後選 `mode = deploy`，只套用 pending 的 forward migration。
- 封測期間：帶 migration 的 PR 預設不合併。例外僅限 S0／S1 熱修，且需已備份、已通知 owner，並記錄在 STATE。
- 時段：低流量時段部署。部署前以 `pg_stat_activity` 確認沒有長交易（guards runbook §1.2）。
- 全表 RLS migration（`20261020090000_enable_rls_all_tables`）：
  - 執行角色必須是表 owner 或可繼承 owner 權限。staging 已由主對話唯讀查證通過。
  - Production 需 owner 依 O-19 先跑前置查詢，回報「通過」後才能部署。
- 失敗處理：`_prisma_migrations` 會留下 failed 紀錄，之後的 deploy 會被擋住。依 guards runbook §1.2 排除原因後，用 `migrate resolve --rolled-back` 再 deploy。不直接改 migration 檔。
- **`20261025120000_user_email_verified_at` 必須先套用，再上程式**：每個已登入的請求都會讀 `User` 的全部欄位（包含新的 `emailVerifiedAt`），程式比 migration 先上線時，所有登入頁面都會出錯。staging：`staging-migrate.yml` 先跑 `mode = status`、再跑 `mode = deploy`，確認成功後才把 alias 切到新部署（O-18 流程）。Production：同樣先套用 migration（需先完成 O-4、O-19、O-20），之後才部署這版程式。這個欄位只新增、可為 NULL，舊程式在已套用 migration 的資料庫上照常運作，所以「先 migration、後程式」永遠安全。

### 排程 workflow 的觀察與暫停

- Workflow：`.github/workflows/scheduled-jobs.yml`。觸發為每 5 分鐘與每日 01:22（台灣時間）。只在 master 執行，PR 合併後才開始排程。
- 觀察位置：GitHub Actions → `Scheduled background jobs (staging)` → 任一 run。
  - 每個 job 一行：`scheduled-job name=… http=… outcome=…`。
  - Run 的 Summary 有 `success`／`failure`／`skipped` 表。
- 交叉比對：Vercel → `celebrate-deal-staging` → Logs，篩選 POST 與對應路徑，時間應與 Actions run 相符。
- `outcome` 判讀（runbook §3）：
  - `ok`：正常。
  - `unauthorized`：staging 的 `JOB_SECRET` 與 GitHub environment 不一致。
  - `route_missing`：staging 部署沒有該入口，通常是 alias 還沒切。
  - `redirected`、`timeout`、`network_error`：網路或部署保護問題。
  - `job_reported_failure`：handler 回 503，看 Sentry。
  - `needs_attention`：webhook-retry 的 `exhausted` 或 `inventoryUnavailable` 大於 0，需人工處理（見 (d)）。
- 暫停：
  - 首選：repo variable `SCHEDULED_JOBS_PAUSED=true`。job 會被跳過並顯示 skipped，有留痕。
  - 長期停用：Actions 頁面 Disable workflow。
  - heartbeat（`scheduled-jobs-heartbeat.yml`，預設關閉，需 `SCHEDULED_JOBS_HEARTBEAT_ENABLED=true` 才會啟動）：停止要 Disable 該 workflow，進行中的迴圈約 5 分鐘內結束，取消 run 為選用；只設 `SCHEDULED_JOBS_PAUSED=true` 停不掉進行中的迴圈。詳見 runbook §3.0。
- 恢復：刪除變數或設為 `false`，再用 `workflow_dispatch` 跑 `all`，確認全部 `ok`。
- 封測期間維持關閉：`SCHEDULED_JOBS_ENABLE_BILLING_CYCLE`、`SCHEDULED_JOBS_ENABLE_LIVE_MEDIA`（billing 與瀏覽器直播隱藏，D-02、D-09）。
- 已知限制：GitHub 排程延遲 5～15 分鐘，偶爾整輪略過；公開 repo 60 天無 commit 會自動停用；environment 不可設 required reviewers。

## (b) 合成資料清理

- 原則（ROADMAP §4.2）：10-30 前「只列清單、不刪」。刪除只針對明確標記為合成的資料，先備份，owner 同意後由工程用腳本執行，留收據。
- 合成資料的標記方式：目前來源文件未定義。清點前需工程先確認，不可用猜的。
- 清點步驟（唯讀）：
  1. 列出 staging 的 `Vendor`（商家）清單，逐筆標記是否為合成，只記 ID 與計數。
  2. 對每個合成商家，統計其下的訂單（`CommerceOrder`）、報名與表單提交、直播場次、Cloudflare Stream 影片數。
  3. 列出 Cloudflare Stream 合成影片的資源 ID 清單，並與 staging 標記比對（GOAL plan §9 Q6b 仍未驗證）。
  4. 清單只寫計數與 ID，不含買家姓名、Email、電話或訂單內容。
- 清單產出後：
  - 保留合成商家在自己的租戶內，不影響封測客戶畫面（ROADMAP §4.2）。
  - 封測客戶一律用新建的商家帳號。
- 刪除：本手冊不寫刪除 SQL。由 owner 核准後，依獨立的清理腳本或 runbook 執行，並留收據。

## (c) 客戶資料隔離

- 一位封測商家對應一個 Vendor。商家帳號一律新建，不共用、不沿用合成商家。
- QA 帳號獨立：staging 財務 QA、其他 QA 帳號不用於客戶，也不用來代客戶操作。QA 帳號需 TOTP（O-3、O-14）。
- 個資不進 repo 與文件：客戶姓名、Email、電話、截圖、訂單內容，不進入 repo、Issue、PR、`docs/`、`reports/`（ROADMAP §4.2）。
- 客服回報用匿名代號（客戶A、客戶B）。owner 保存代號與真實身分的對應表，只放在私人處。
- 工程除錯只用合成資料或去識別化樣本。不索取客戶密碼、金流後台截圖。
- 租戶隔離現況：應用層為主（F-026）。RLS 為縱深防禦，B1 唯讀查證 `anon`、`authenticated` 無 grant，非封測阻擋。
- 若發現跨租戶外洩，直接視為 S0（見 (d)）。

### 商家 Email 驗證的人工處理

- 未驗證 Email 的商家不能做新的「不需發布專案就公開」名單型網站發布。決定權在商家的**創辦帳號**（Email 等於商家 Email、狀態 active、仍是該商家 active 成員的帳號）；創辦帳號停權或已離開商家時，改由「任一 active owner 已驗證」決定。
- 創辦人收不到驗證信（被擋信、信箱打錯字以外的情況）時的人工處理：由創辦人本人或平台管理員在登入頁按「忘記密碼」，輸入創辦帳號的 Email 送出重設信。創辦人完成密碼重設後，帳號即視為已驗證（重設信也只寄到該信箱）。平台管理員不得代為開信或代設密碼，也不得直接改資料庫的 `emailVerifiedAt`。
- 稽核紀錄出現 `independent_publish_email_gate_owner_fallback` 時，表示某商家的新獨立發布是靠「其他已驗證 owner」通過（reason 說明創辦帳號不存在、停權或已離開）。封測期間每週看一次；同一個已驗證帳號出現在多個這樣的商家，視為疑似濫用，依 (d) 回報。這個規則只是減速，真正的限制是 Turnstile、註冊限流與每商家上限。
- 驗證信每個收件地址每小時最多 3 封（含註冊時那封）；客戶回報「一直收不到」時先請對方看垃圾郵件匣並等一小時，再走上面的密碼重設。

## (d) 告警與回報

### Sentry 告警（O-17）

- 在 Sentry staging 專案建立 alert rule，通知 owner（Email 或 owner 指定管道）。
- 名稱需對齊：O-17 寫的是「`webhook-retry exhausted` 或 `InventoryUnavailableError`」，但 `scheduled-jobs-runbook.md` §3.1 的實際 Sentry 訊息是 `webhook_retry_requires_attention`，tag `reason` 為 `inventory_unavailable` 或 `exhausted`。建立時以 runbook 為準。
- 確認 Sentry 的 DSN 指向 staging。
- 排程失敗：Actions run 標紅並發 GitHub 通知。job 失敗不會自動送 Sentry（F-141），每日仍需看寄送紀錄與排程 run。
- 連續失敗告警（B09-02、B09-03）尚未完成。

### 付款異常（needs_attention）

- 依 runbook §3.1：用 `eventId`／`orderNumber` 找到交易，向 PayUni 查實際付款狀態。
- 已付款：人工補庫存或走退款，並在付款事件 SOP 記錄。
- 此類情況（買家已付款、訂單未付）建議歸 S0，由主對話判定。

### 客戶回報管道

- 管道：客戶透過 LINE 或 Email 回報給 owner（ROADMAP §4.3）。是否另建 LINE 群或表單，來源未定，屬 owner 決定。
- 流程：
  1. owner 以匿名代號登記，原始內容留私人處。
  2. 主對話每日兩次建立去識別化 GitHub Issue，標籤 `beta`、`sev:S0`～`sev:S3`。
  3. 依嚴重度派工。
  4. 修好後 owner 回覆客戶。

### 分級與回應時限

| 級別 | 範例（ROADMAP §4.3） | 回應時限 |
|---|---|---|
| S0 | 疑似跨租戶外洩、金額錯誤、secret 外洩；付款成功但訂單未付（建議歸此級） | 當天止血，並單獨通知 owner |
| S1 | 無法登入、無法發布直播、無法結帳、通知未送達 | 24 小時內 |
| S2 | 其他影響使用、但有替代做法 | 3 天內 |
| S3 | 體驗建議、文案 | 每週一批 |

- S0 立即單獨通知 owner（playbook §6.1）。
- 同一根因失敗兩次就停止重試，記為 blocked。

## (e) 封測付款

- 只走 PayUni Sandbox。不接正式商店，不使用真實信用卡（D-01）。
- 測試卡：使用 PayUni 公開的 Sandbox 測試卡號。卡號不寫入文件或對話。
- 演練節奏：
  - O-2：10-24 前，跑一筆 Sandbox 測試付款（取得回呼樣本，T2）。
  - O-12：10-30 完整演練，包含成功、失敗、重複通知、部分與重複退款。
- 不鎖月結、不撥款（D-16）。
- 聯盟只累計、不出款（owner 覆寫）。夥伴入口不授權給外部人（D-17）。
- 只用台幣，單品商品。課程、billing、Funnel 綁卡、諮詢預約先不給客戶用。
- 真實觀眾無法在系統內真正付款（Sandbox 不收款，ROADMAP §4.4）。封測期間的結帳由商家與創辦人自己演練，真實收款仍用商家原本的方式（D-01 建議 a）。
- Sandbox 不會碰到 PayUni 的交易額度上限；正式上線前要另行評估。

## (f) 每日節奏

### 主對話

| 時段 | 動作 |
|---|---|
| 09:00 | `git fetch`、PR 狀態、staging 狀態、看 STATE；決定派工並更新檔案鎖 |
| 午間 | 收子代理回報；範圍檢查；啟動 reviewer |
| 15:00 | 容量檢查：P0 進度 vs 日程；落後就當日通知 owner |
| 18:00 | 合併已通過者；更新 STATE；傳一則 owner 摘要（已合併、阻擋、需決策最多 3 項） |

- 每日摘要每則不超過 5 行，每日最多 3 則（playbook §2.4）。

### owner 每日 10 分鐘

- 看 `OWNER-ACTIONS.md` 中標 ⚠️ 的項目與本週到期的期限（10-24、10-27 LINE、10-29 條款與法務）。
- 看主對話摘要中的「需決策」項目（最多 3 項）。
- 看排程 run 與 Sentry 是否有紅燈。S0、S1 需即時處理。
- 看客戶回報的新增匿名代號與 `sev` 標籤數量。
- 封測開始後，每週一次回顧（見 `BETA-METRICS.md`）。
