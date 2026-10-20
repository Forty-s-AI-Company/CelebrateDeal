# 背景工作排程 Runbook（F-042／B09-01、B03-06）

最後更新：2026-10-19（工作線 B2）

## 1. 為什麼需要這份文件

`/api/jobs/*` 與 `/api/cron/*` 的背景工作（交易信、開播提醒、學員通知、LINE、付款 webhook 重試、庫存釋放、月結、電子發票、直播媒體清理）在 repo 內原本沒有任何排程會呼叫它們。本 runbook 定義兩條排程路徑、驗證方式、暫停方式與兩把密鑰的分工。

## 2. 端點盤點

| 端點 | 排程 | 頻率 | 呼叫方式 | 說明 |
|---|---|---|---|---|
| `/api/jobs/email-deliveries` | 是 | 每 5 分鐘 | POST＋`JOB_SECRET`／GET＋`CRON_SECRET` | 交易信、開播提醒、直播後追蹤、學員通知、LINE 物化與派送、報名重試草稿清理 |
| `/api/cron/line-notifications` | 是 | 每 5 分鐘 | POST＋`JOB_SECRET`（新增）／GET＋`CRON_SECRET` | 與上一列重疊，但能在 email 流程中途失敗時獨立推進 LINE outbox；有 claim lease，不會重送 |
| `/api/jobs/webhook-retry` | 是 | 每 5 分鐘 | POST＋`JOB_SECRET`／GET＋`CRON_SECRET`（新增） | 先釋放過期庫存保留，再重試失敗的付款 webhook（金流路徑） |
| `/api/cron/live-media` | 需開啟 | 每 5 分鐘 | POST＋`JOB_SECRET`（新增）／GET＋`CRON_SECRET` | 只在 `vars.SCHEDULED_JOBS_ENABLE_LIVE_MEDIA=true` 時排程。瀏覽器直播封測隱藏（D-09），未設定 `CELEBRATEDEAL_MEDIA_ORIGIN` 時固定回 503，預設排程會讓每次執行都標紅 |
| `/api/jobs/billing-cycle` | **需開啟** | 每日 01:22（台灣） | POST＋`JOB_SECRET`／GET＋`CRON_SECRET`（新增） | 只在 `vars.SCHEDULED_JOBS_ENABLE_BILLING_CYCLE=true` 時排程，`all` 也一樣；單選 `billing-cycle` 的手動 dispatch 才會直接執行。這個 job 會重算未鎖定月份的 draft 結算，並替每個 active 訂閱 upsert `issued` 月費帳單；因為帳單在 `dueAt <= now` 才產生，同一次執行結尾就會被標成 `overdue`（既有問題，另案處理）。封測期間 billing 隱藏（D-02、D-16），所以預設關閉。不會扣款（`automaticCharges: 0`） |
| `/api/jobs/electronic-invoices` | 是 | 每日 01:22（台灣） | POST＋`JOB_SECRET`／GET＋`CRON_SECRET`（新增） | fiscal adapter 未接時回 202，視為成功 |
| `/api/cron/data-retention` | **需開啟** | 每日 01:22（台灣） | POST＋`JOB_SECRET`／GET＋`CRON_SECRET` | F-070 保存期限清理：WebhookEvent 原始 payload、AnalyticsEvent、AuditLog IP。只在 `vars.SCHEDULED_JOBS_ENABLE_DATA_RETENTION=true` 時排程，`all` 也一樣；部署環境另須設定 `DATA_RETENTION_ENABLED=true`，否則 endpoint 只回 `skipped`、不寫資料。保存天數由 `DATA_RETENTION_*_DAYS` 決定（預設 180／365／365，待 owner 依律師建議訂定），設定不合法時回 503 不清理。回應 `remaining=true` 代表當次達批次上限，隔天會接續 |
| `/api/jobs/tracking-deliveries` | 否 | — | POST＋`JOB_SECRET` | 需要 body 帶 `vendorId`，且預設 `tracking_executor_disabled`。要排程得先做「列出待派送商家」的批次入口（後續工作） |
| `/api/jobs/payuni-live-probe` | 否 | — | 專屬密鑰 | 一次性正式環境探針，刻意不排程 |
| `/api/cron/line-notifications/runtime-binding` | 否 | — | GET＋`CRON_SECRET` | staging 驗證探針，不是工作 |

每個可排程端點的 GET 與 POST 共用同一個 handler，只差驗證哪一把密鑰。GET 不接受 `JOB_SECRET`，POST 不接受 `CRON_SECRET`（`scripts/scheduled-jobs-runner.test.mjs` 與各 `route.test.ts` 有斷言）。

## 3. 主要路徑：GitHub Actions 排程（staging）

- Workflow：`.github/workflows/scheduled-jobs.yml`
- 觸發：`schedule`（`*/5 * * * *` 與 `22 17 * * *`；每日分鐘刻意避開 5 的倍數）＋`workflow_dispatch`（可選單一 job 或 `all`）
- 只在受保護的 `master` 執行；GitHub 的 `schedule` 一律跑預設分支，**PR 合併到 master 之後才會開始排程**
- Environment：`Preview – celebrate-deal-staging`，只讀取 `secrets.JOB_SECRET`
- 目標固定為 `https://celebrate-deal-staging.carry-digital-nomad.in.net`，不接受任何主機輸入
- 每個 job 一個 step、`continue-on-error: true`；最後一步只要有任何 job 不是 2xx 就讓 run 失敗（標紅）
- `concurrency` 依觸發來源分組（`*/5`、每日、手動各一組）：同一組上一輪還沒跑完時下一輪排隊。分組是為了避免每日 run 在排隊時被下一輪 `*/5` 取代而被取消（被取消的 run 不會標紅）。不同組可能同時執行，各 job 都有 claim lease，不會重複處理同一筆

### 已知限制

- GitHub 排程是盡力而為：尖峰時段常延遲 5～15 分鐘，偶爾會整輪略過。交易信與 webhook 重試因此可能延遲十幾分鐘。
- 公開 repo 若 60 天沒有任何 commit，GitHub 會自動停用排程 workflow（Actions 頁面會出現提示，需要手動重新啟用）。
- 每次執行都會在 `Preview – celebrate-deal-staging` environment 留下一筆 deployment 紀錄（每天約 290 筆）。這個 environment 也是 Vercel 預覽部署使用的，還存著 DB URL、Vercel token 等 secret。最小權限的做法是 owner 在 GitHub 新增只存 `JOB_SECRET`、只允許 `master` 的專屬 environment（例如 `staging-scheduler`），再把 workflow 的 `environment` 改過去（PR #447 審查 n4，待 owner 設定）。
- 若該 environment 設了「required reviewers」，每次排程都會卡在等待核准。合併前請確認該 environment 沒有 reviewer 規則，只有分支限制。

### 怎麼確認「真的有被呼叫」

1. Actions → `Scheduled background jobs (staging)` → 任一 run。
2. 每個 job step 只印一行，例如 `scheduled-job name=webhook-retry http=200 outcome=ok`。不會印 response body、header 或密鑰。
3. Run 的 Summary 有一張表，列出每個 job 的 `success`／`failure`／`skipped`。
4. 交叉比對：Vercel → `celebrate-deal-staging` → Logs，篩選路徑（例如 `/api/jobs/webhook-retry`）與方法 POST，時間應該與 Actions run 對得上。
5. `outcome` 對照：`unauthorized`＝staging 的 `JOB_SECRET` 與 GitHub environment 的值不一致；`route_missing`＝staging 部署還沒有本次的 POST／GET 入口；`job_reported_failure`＝handler 回 503（看 Sentry 的 `captureOperationalError`）；`redirected`＝alias 被部署保護或網域設定攔截；`timeout`／`network_error`＝staging 沒有回應；`needs_attention`＝HTTP 200，但 webhook-retry 回報 `exhausted` 或 `inventoryUnavailable` 大於 0（見 §3.1），該行會附上這兩個數字，run 會標紅。

### 3.1 webhook-retry 的人工處理訊號（B03-07）

排程啟用後，保留超過 30 分鐘的庫存會被釋放、交易改成 `expired`。若 PayUni 之後才送來 `paid` 而商品已售完，`InventoryUnavailableError` 會讓整筆付款處理 rollback，重試 5 次後變成 `exhausted`：**買家已付款，訂單卻停在未付**。目前的最小保護：

- 每次重試遇到售完、或事件進入 `exhausted`，都會以 **error 等級**送出 Sentry 訊息 `webhook_retry_requires_attention`，tag `reason` 是 `inventory_unavailable` 或 `exhausted`，extra 只有內部 `eventId` 與 `orderNumber`（不含買家資料、payload 或 provider 訊息）。
- `/api/jobs/webhook-retry` 的回應多了 `exhausted`、`inventoryUnavailable` 兩個計數；任一大於 0，scheduler 的該 step 會以 `needs_attention` 標紅。
- owner 需在 staging 的 Sentry 專案為 `webhook_retry_requires_attention` 建立告警規則（通知到值班信箱或 Slack）。
- 處理方式：用 `eventId`／`orderNumber` 在後台找到交易，向 PayUni 查實際付款狀態；已付款就人工補庫存或走退款，並在付款事件 SOP 記錄。

**Production 上線前硬性 gate：B03-07 必修。** 付款事實一律先記帳、不得因庫存 rollback；庫存不足時把訂單標記為超賣並建立退款或人工工單；UPP 的 `TradeLExpireSec` 必須 ≤ 保留 TTL。上述完成前，Production 不得啟用 webhook-retry 排程。

### 暫停與恢復

| 方式 | 效果 | 用途 |
|---|---|---|
| repo variable `SCHEDULED_JOBS_PAUSED=true` | job 被 `if` 跳過，run 顯示 skipped | 最快、可留痕；事故處理首選 |
| Actions 頁面 Disable workflow | 不再觸發 | 長時間停用 |
| repo variable `SCHEDULED_JOBS_ENABLE_LIVE_MEDIA=true` | 開始排程 live-media 清理 | browser_live 部署好再開 |
| repo variable `SCHEDULED_JOBS_ENABLE_DATA_RETENTION=true` | 開始每日執行 data-retention 清理 | owner 依律師建議訂定保存期限、在部署環境設定 `DATA_RETENTION_*_DAYS` 與 `DATA_RETENTION_ENABLED=true` 後再開 |
| repo variable `SCHEDULED_JOBS_ENABLE_BILLING_CYCLE=true` | 開始每日執行 billing-cycle（開立帳單、標記逾期） | billing 對商家開放、owner 同意後再開；先修「開立當下就逾期」 |

恢復：刪除 `SCHEDULED_JOBS_PAUSED` 或改成 `false`，再用 `workflow_dispatch` 手動跑一次 `all` 確認全部 `ok`。`all` 不會執行 billing-cycle（除非已設 `SCHEDULED_JOBS_ENABLE_BILLING_CYCLE=true`），也不會執行 live-media（除非已設 `SCHEDULED_JOBS_ENABLE_LIVE_MEDIA=true`）。要單獨驗證 billing-cycle，先確認 owner 同意在 staging 開立帳單，再單選 `billing-cycle` dispatch。

## 4. 次要路徑：Vercel Cron（Production 用，目前未啟用）

**重要事實**：Vercel 只會對 **Production deployment** 觸發 Cron。staging alias 指向的是 Preview deployment（`VERCEL_ENV=preview`、`CRON_SECRET` 設在 preview target），所以把 crons 寫進 `vercel.staging.json` 永遠不會執行；而 staging 專案是 Hobby，Hobby 會在部署驗證時拒絕比每日一次更頻繁的 cron，寫了反而可能讓 staging 部署失敗。因此：

- `vercel.json` 維持沒有 `crons`（Preview 專案會讀它，`scheduler-config.test.ts` 有斷言）。
- `vercel.staging.json` 維持 `"crons": []`（同一個測試有斷言）。
- 程式端已準備好：所有可排程端點都有驗 `CRON_SECRET` 的 GET 入口。

Production 專案確認是 Pro 方案、由 owner 決定 D-06 之後，把下面這段放進 **Production 專案使用的設定檔**（repo 內只有一份 `vercel.json`，Preview 專案也讀它；若 Production 專案同樣讀這份檔案，需先讓 Production 使用獨立設定或確認 Preview 專案也升級，否則 Hobby 的 Preview 會部署失敗），並同步修改 `scheduler-config.test.ts`：

```json
"crons": [
  { "path": "/api/jobs/email-deliveries", "schedule": "0 * * * *" },
  { "path": "/api/cron/line-notifications", "schedule": "0 * * * *" },
  { "path": "/api/jobs/webhook-retry", "schedule": "0 * * * *" },
  { "path": "/api/jobs/billing-cycle", "schedule": "22 17 * * *" },
  { "path": "/api/jobs/electronic-invoices", "schedule": "22 17 * * *" }
]
```

- 先以每小時一次上線；**Pro 方案可把前三列縮到 `*/5 * * * *`（或更短）**。
- `live-media` 等 browser_live 有部署（F-095）再加。
- Vercel Cron 以 UTC 解讀排程；`22 17 * * *` 是台灣時間 01:22。billing-cycle 一列只在 billing 開放、owner 同意後才加入。
- 確認方式：Vercel → Production 專案 → Settings → Cron Jobs 會列出每個 cron 與最近一次執行；Logs 篩選 `user-agent: vercel-cron/1.0`。
- 暫停：Settings → Cron Jobs → Disable Cron Jobs（不需重新部署）。

## 5. 密鑰分工

| 密鑰 | 誰持有 | 用在哪 | 輪替影響 |
|---|---|---|---|
| `JOB_SECRET` | GitHub environment `Preview – celebrate-deal-staging`、Vercel staging 專案 | 受控 runner（本 workflow、手動維運）呼叫 POST 入口 | 兩邊同時更新即可。注意：未設定 `CSRF_SECRET` 的環境會拿它當應用層加密金鑰（見 `src/lib/sensitive-data.ts`），那種環境**不可輪替** |
| `CRON_SECRET` | Vercel 專案環境變數（Vercel Cron 會自動帶 `Authorization: Bearer <CRON_SECRET>`） | Vercel Cron 呼叫 GET 入口；也保護 `runtime-binding` 探針 | 更新 Vercel 環境變數並重新部署 |

兩把密鑰必須不同值。GitHub Actions 不持有 `CRON_SECRET`，Vercel Cron 不持有 `JOB_SECRET`，任何一把外洩只開放一半入口。

## 6. 尚未完成

- 以 staging 的實際 Actions run 與 Vercel log 證明每個 job 被呼叫（需要合併到 master 之後才會開始排程；由主對話或 owner 執行並記錄收據）。
- job heartbeat／連續失敗告警（B09-02、B09-03）。目前靠 Actions run 標紅與 GitHub 通知。
- `tracking-deliveries` 的可排程批次入口。
- Production 排程平台決策（D-06）：本 workflow 只打 staging。
