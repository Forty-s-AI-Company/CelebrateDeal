# CelebrateDeal 背景工作觸發器（Cloudflare Worker）

用 Cloudflare Worker 的 cron 每 5 分鐘呼叫 staging 的背景工作，取代 GitHub Actions 不穩定的排程。密鑰只存在你的 Cloudflare 帳號，repo 裡沒有任何 secret。GitHub 的 heartbeat 與 `scheduled-jobs.yml` 保留作備援（各 job 有 claim lease，重疊呼叫不會重複處理）。

背景與完整說明：`docs/launch/scheduled-jobs-external-trigger.md`。

## 排程內容

| cron（UTC） | 台灣時間 | 呼叫（POST，依序） |
|---|---|---|
| `*/5 * * * *` | 每 5 分鐘 | `/api/jobs/email-deliveries`、`/api/cron/line-notifications`、`/api/jobs/webhook-retry` |
| `22 17 * * *` | 每日 01:22 | `/api/jobs/electronic-invoices` |

目標網址在 `wrangler.toml` 的 `TARGET_ORIGIN`（staging 固定網址）。`live-media`、`billing-cycle`、`data-retention` 封測期間不啟用，所以不在清單內。每個請求逾時 120 秒、不跟隨轉址；日誌只有 job 名稱、HTTP 狀態與耗時。

## 部署（你要做的三步）

在這個資料夾（`ops/cloudflare/scheduled-jobs-worker/`）執行：

1. `npx wrangler login`（瀏覽器授權你的 Cloudflare 帳號）
2. `npx wrangler secret put JOB_SECRET`（提示後貼上 staging 的 `JOB_SECRET`；不會顯示也不會寫入檔案）
3. `npx wrangler deploy`

請不要把 `JOB_SECRET` 貼到聊天、截圖、issue 或 repo。

## 確認有在運作

- Cloudflare Dashboard → Workers → `celebratedeal-scheduler-staging` → Triggers，應有兩條 cron；Settings → Variables 的 `JOB_SECRET` 應顯示為加密的 secret。
- `npx wrangler tail`，等下一個 5 分鐘整點，應看到三行 `scheduled-job name=… http=200 outcome=ok ms=…`。
- Vercel staging Logs 裡 `POST /api/jobs/email-deliveries` 應約每 5 分鐘一筆。
- 失敗的 `outcome` 對照：`unauthorized`（密鑰不符）、`redirected`（網域或部署保護攔截）、`route_missing`（alias 未切）、`job_reported_failure`（503，看 Sentry）、`timeout`、`network_error`。`webhook-retry` 回 200 但有「重試用盡或售完」時，Worker 不解析回應內容，請看 Sentry 的 `webhook_retry_requires_attention`。

## 暫停與移除

- 暫停（保留 Worker）：把 `wrangler.toml` 的 `SCHEDULED_JOBS_PAUSED` 改成 `"true"`，再 `npx wrangler deploy`。日誌會出現 `outcome=paused`。注意：repo variable `SCHEDULED_JOBS_PAUSED` 擋不住 Worker，要在這裡設定。
- 立刻停止：Dashboard → Workers → 該 Worker → Triggers 刪除 cron，或 `npx wrangler delete`。
- 之後要延伸到 Production：另建一個 Worker（複製此資料夾、改 `name` 與 `TARGET_ORIGIN`），使用 Production 自己的 `JOB_SECRET`；`webhook-retry` 在 B03-07 gate 完成前不要放進 Production 清單。

## 測試

`npm run test:contracts`（內含 `scripts/scheduled-jobs-worker.test.mjs`）檢查 cron 與 job 對應與 runner 一致、請求格式、以及日誌不含密鑰。這個資料夾不屬於 Next.js build；它是純 JavaScript，不被 tsconfig 型別檢查。
