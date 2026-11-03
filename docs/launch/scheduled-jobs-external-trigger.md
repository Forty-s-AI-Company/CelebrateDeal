# 背景工作的外部觸發器設定（GO-NO-GO §5 B-1）

- 日期：2026-11-03
- 依據來源：`.github/workflows/scheduled-jobs.yml`；`.github/workflows/scheduled-jobs-heartbeat.yml`；`scripts/scheduled-jobs-runner.mjs`（端點清單、HTTP 方法、標頭、結果判定）；`src/app/api/jobs/*/route.ts`、`src/app/api/cron/*/route.ts`；`src/lib/api-security.ts`；`docs/launch/scheduled-jobs-runbook.md`（§2、§3、§3.0、§4、§5）；`docs/goal-beta-prep-2026Q4/GO-NO-GO.md` §5 B-1；`docs/goal-beta-prep-2026Q4/OWNER-ACTIONS.md` O-16。
- 狀態：**設定步驟草稿，尚未實測。** 外部服務的限制（逾時秒數、免費額度）以服務商當下公布為準，下文標「待確認」者必須在設定時核對。

## 1. 為什麼要做

GitHub Actions 的 `*/5 * * * *` 排程實測約每 2～5 小時才跑一次（10-24 起 36 次 schedule run，間隔中位數 184 分鐘、最長 425 分鐘）。報名確認信、開播提醒、webhook 重試若只靠它，會晚數小時。目前的緩解是 `scheduled-jobs-heartbeat.yml`（GitHub Actions 長駐迴圈），它預設關閉、屬於 GitHub 使用條款的灰色地帶，而且 GitHub 若停用 Actions，CI 也會一起失效。長期做法是用**外部觸發器**每 5 分鐘呼叫同一批端點；heartbeat 保留作為備援（各 job 有 claim lease，重疊呼叫不會重複處理）。

## 2. 要呼叫的端點（從 workflow 與 runner 抄出）

來源：`scripts/scheduled-jobs-runner.mjs` 的 `SCHEDULED_JOBS`。目前 runner 固定打 staging（`celebrate-deal-staging.carry-digital-nomad.in.net`）；外部觸發器同樣先設定在 staging。Production 上線後是另一組主機與另一把 `JOB_SECRET`（見 §8）。

### 2.1 每 5 分鐘（頻繁）

| 名稱 | 方法與路徑 | 說明 | 預設 |
|---|---|---|---|
| email-deliveries | `POST /api/jobs/email-deliveries` | 交易信、開播提醒、直播後追蹤、學員通知、LINE 物化與派送、報名重試草稿清理 | 啟用 |
| line-notifications | `POST /api/cron/line-notifications` | 推進 LINE outbox（有 claim lease，不會重送） | 啟用 |
| webhook-retry | `POST /api/jobs/webhook-retry` | 先釋放過期庫存保留，再重試失敗的付款 webhook（金流路徑，單次最長約 300 秒） | 啟用（Production 受 B03-07 gate 限制，見 §8） |
| live-media | `POST /api/cron/live-media` | 瀏覽器直播媒體清理；封測隱藏瀏覽器直播（D-09），**不要建立**，否則每次回 503 | 不啟用 |

### 2.2 每日 01:22（台灣時間）＝ 17:22 UTC

| 名稱 | 方法與路徑 | 說明 | 預設 |
|---|---|---|---|
| electronic-invoices | `POST /api/jobs/electronic-invoices` | 電子發票；fiscal adapter 未接時回 202，視為成功 | 啟用 |
| billing-cycle | `POST /api/jobs/billing-cycle` | 開立月費帳單並標記逾期；封測期間 billing 隱藏（D-02、D-16） | **不要建立** |
| data-retention | `POST /api/cron/data-retention` | 個資保存期限清理；O-21 未定案、部署環境也需 `DATA_RETENTION_ENABLED=true` | **不要建立** |

### 2.3 刻意不排程的端點

`/api/cron/line-notifications/runtime-binding`（staging 驗證探針，不是工作）、`/api/jobs/payuni-live-probe`（一次性正式探針，專屬密鑰）、`/api/jobs/tracking-deliveries`（需要 body 帶 `vendorId`，預設停用）。外部觸發器**不要**呼叫這三個。

### 2.4 請求格式

- 方法：`POST`，**不需要 body**（內容空白即可）。
- 標頭：`Authorization: Bearer <JOB_SECRET>`。`Authorization` 的 scheme 不分大小寫，值是 staging 環境的 `JOB_SECRET`（與 Vercel staging 專案、GitHub `Preview – celebrate-deal-staging` environment 的值相同）。建議再加 `Cache-Control: no-store`（runner 也有送）。
- 不要跟隨轉址：runner 設定 `redirect: manual`，回 3xx 代表網域或部署保護攔截（判為 `redirected`）。外部服務若可關閉「follow redirects」請關閉，才不會把轉址後的 200 誤判成成功。
- 逾時：runner 的逾時是 120 秒；`webhook-retry` 單次最長可到 300 秒（伺服器上限）。外部服務的逾時設定**待確認**，見 §3.3。
- 每一個端點的 GET 與 POST 共用同一個處理程式，只差驗證哪一把密鑰（POST＝`JOB_SECRET`，GET＝`CRON_SECRET`），詳見 §6。

### 2.5 回應與判讀（與 runner 的 `classifyStatus` 一致）

| HTTP | 意義 | 處理 |
|---|---|---|
| 200～299 | 成功（`electronic-invoices` 的 202 也算成功） | 無 |
| 401、403 | 密鑰不一致（`unauthorized`） | 重貼 staging 的 `JOB_SECRET` |
| 3xx | 網域或部署保護攔截（`redirected`） | 檢查 alias 與網址 |
| 404、405 | 部署沒有該入口，通常是 alias 還沒切（`route_missing`） | 先確認 O-18 的 alias |
| 503 | 工作自己回報失敗（`job_reported_failure`） | 看 Sentry 的 `captureOperationalError` |
| `webhook-retry` 200 且 JSON 的 `exhausted` 或 `inventoryUnavailable` > 0 | `needs_attention`：有付款事件重試用盡或遇到售完 | 人工處理，見 `scheduled-jobs-runbook.md` §3.1 |

注意：`needs_attention` 在 HTTP 層看起來是 200。外部服務若只看狀態碼，不會知道要人工處理；要偵測它，需讓外部服務檢查回應內容（cron-job.org 可設定「回應內容比對」；Worker 可自己解析 JSON 並記錄），或靠 Sentry 的 `webhook_retry_requires_attention` 告警（O-17）。

## 3. 方案比較與建議

| 方案 | owner 要做的事 | 費用 | 優點 | 限制 |
|---|---|---|---|---|
| A. cron-job.org 類服務 | 建帳號；在介面建 3～4 個 job；把 `JOB_SECRET` 貼進自訂標頭 | 免費方案通常足夠（以服務商公布為準，待確認） | 最快（約 15 分鐘）；有執行歷史與失敗通知信 | 密鑰存放在第三方；單次請求的逾時上限可能只有 30 秒（待確認）；解析回應內容的能力有限 |
| B. Cloudflare Worker cron | 登入 Cloudflare；`wrangler login`；`wrangler secret put JOB_SECRET`；`wrangler deploy` | Workers 免費方案包含 cron trigger（額度以 Cloudflare 公布為準，待確認） | owner 已有 Cloudflare 帳號；密鑰留在 Cloudflare；能解析回應並寫 log；可擴充成 dead-man 通知 | 需要部署一個小 Worker（模板見 §5）；cron 以 UTC 計算 |
| C. Vercel Cron | 升 Pro、決定 D-06 | Pro 方案費用 | 與平台整合 | **只對 Production deployment 觸發**；staging 是 Preview，永遠不會執行；Hobby 只允許每日一次。現階段（staging）無法使用，列為 Production 的選項（`scheduled-jobs-runbook.md` §4） |

**建議**：封測期間採 **A 或 B 擇一**。想要最快解除 B-1 → A；想要密鑰留在自己手上、之後可延伸到 Production → B。兩者都保留 heartbeat 作為備援，等外部觸發穩定一週後再決定是否關掉 heartbeat。

### 3.1 owner 要做的最小動作

- **A**：到 cron-job.org（或同類服務）建帳號 → 照 §4 建 job → 在每個 job 的 Headers 貼 `Authorization: Bearer <JOB_SECRET>`。其餘（網址、頻率、方法）都照本文件。
- **B**：已有 Cloudflare 帳號 → 在本機 `npx wrangler login` → 依 §5 取得模板檔 → `npx wrangler secret put JOB_SECRET`（互動式輸入，不會顯示）→ `npx wrangler deploy`。

兩種方式都：**不要把 `JOB_SECRET` 貼到聊天、截圖、issue、log 或 repo**。回報只寫「建好了」或貼 job 的名稱與頻率。

### 3.2 為什麼不直接由主對話代設

主對話沒有（也不應該有）第三方服務的帳號與 `JOB_SECRET`；密鑰只能由 owner 輸入。

### 3.3 逾時的風險（待確認）

`webhook-retry` 與 `email-deliveries` 在佇列為空時通常很快回應，但有積壓時可能跑數十秒到數分鐘。若外部服務在例如 30 秒就中斷並標記失敗，伺服器端的處理**不一定被取消**，但無法保證（Vercel 函式在客戶端中斷後是否繼續屬平台行為）。設定時請實際查看該服務的逾時上限，並在 staging 做一次「積壓情境」驗證。逾時風險較高的 `webhook-retry`，優先選擇逾時可調長的方案（Worker 的 `fetch` 不受外部 30 秒限制，但仍受 Worker 執行時間限制，待確認）。

## 4. 方案 A：cron-job.org 類服務的設定

為每個要排程的工作建立一個 job（以下 URL 為 staging；`<STAGING>` ＝ `https://celebrate-deal-staging.carry-digital-nomad.in.net`）：

| Job 名稱 | URL | 方法 | 頻率 | 標頭 |
|---|---|---|---|---|
| celebratedeal-staging-email-deliveries | `<STAGING>/api/jobs/email-deliveries` | POST | 每 5 分鐘 | `Authorization: Bearer <JOB_SECRET>` |
| celebratedeal-staging-line-notifications | `<STAGING>/api/cron/line-notifications` | POST | 每 5 分鐘 | 同上 |
| celebratedeal-staging-webhook-retry | `<STAGING>/api/jobs/webhook-retry` | POST | 每 5 分鐘 | 同上 |
| celebratedeal-staging-electronic-invoices | `<STAGING>/api/jobs/electronic-invoices` | POST | 每日 01:22（時區選 Asia/Taipei；若服務只支援 UTC 則 17:22） | 同上 |

設定要點：

1. 請求方法選 `POST`，Body 留空。
2. Headers 新增 `Authorization`，值為 `Bearer ` 加空白再貼 `JOB_SECRET`；另加 `Cache-Control: no-store`。
3. 關閉「跟隨轉址」（若有此選項）。
4. 把「成功」定義為 HTTP 2xx；開啟「連續失敗 N 次寄 Email 通知 owner」（建議 N＝3，對應約 15 分鐘）。
5. 錯開分鐘：三個每 5 分鐘的 job 建議分別設在第 0、1、2 分鐘起算（`0-59/5`、`1-59/5`、`2-59/5`），避免同時打。
6. 有「回應內容比對」功能時，可在 `webhook-retry` 加一條「回應不得含 `"exhausted":` 後接大於 0 的數字」之類的規則；沒有就靠 Sentry。
7. 建好後先按「測試執行」，在執行歷史看到 `200`。

## 5. 方案 B：Cloudflare Worker cron 的設定

### 5.1 設定檔與程式模板

下面是模板（**不含任何密鑰**；`JOB_SECRET` 以 Worker secret 注入）。請放在一個**獨立的資料夾**（例如本機 `celebratedeal-scheduler/`），不要放進本 repo 的 `src/`。若 owner 要納入版本控制，另開 PR。

`wrangler.toml`：

```toml
name = "celebratedeal-scheduler-staging"
main = "src/index.js"
compatibility_date = "2026-11-01"

[vars]
TARGET_ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net"

# Cloudflare cron 以 UTC 計算。22 17 * * * = 台灣時間 01:22。
[triggers]
crons = ["*/5 * * * *", "22 17 * * *"]
```

`src/index.js`：

```js
const FREQUENT = [
  "/api/jobs/email-deliveries",
  "/api/cron/line-notifications",
  "/api/jobs/webhook-retry",
];
const DAILY = ["/api/jobs/electronic-invoices"];

async function callJob(env, path) {
  try {
    const response = await fetch(new URL(path, env.TARGET_ORIGIN), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.JOB_SECRET}`,
        "Cache-Control": "no-store",
      },
      redirect: "manual",
    });
    // 只記錄路徑與狀態碼，不記錄標頭、回應內容或密鑰。
    console.log(`scheduled-job path=${path} http=${response.status}`);
    if (response.status >= 300 || response.status < 200) {
      console.error(`scheduled-job path=${path} outcome=failed http=${response.status}`);
    }
    return response.status;
  } catch {
    console.error(`scheduled-job path=${path} outcome=network_error`);
    return 0;
  }
}

export default {
  async scheduled(event, env, ctx) {
    const paths = event.cron === "22 17 * * *" ? DAILY : FREQUENT;
    // 依序呼叫，避免同時佔用同一個資料庫連線池；waitUntil 讓 Worker 等到全部結束。
    ctx.waitUntil((async () => {
      for (const path of paths) await callJob(env, path);
    })());
  },
};
```

重點：

- 不要把 `live-media`、`billing-cycle`、`data-retention` 加進清單（見 §2）。
- `redirect: "manual"`，3xx 一律視為失敗，與 runner 一致。
- 日誌只輸出路徑與狀態碼；不要輸出回應內容（可能含付款事件資訊）。

### 5.2 部署步驟

1. `npx wrangler login`（瀏覽器授權 owner 的 Cloudflare 帳號）。
2. `npx wrangler secret put JOB_SECRET`，在提示後貼上 staging 的 `JOB_SECRET`（不會顯示、不會寫入檔案）。
3. `npx wrangler deploy`。
4. 在 Cloudflare Dashboard → Workers → 該 Worker → Triggers 確認有兩條 cron；Settings → Variables 確認 `JOB_SECRET` 顯示為加密的 secret。
5. 用 `npx wrangler tail`（即時日誌）等下一個 5 分鐘整點，看到三行 `scheduled-job path=… http=200`。

## 6. 降低密鑰外洩範圍的選項：改用 GET＋`CRON_SECRET`

`JOB_SECRET` 除了排程 POST 入口之外，還保護 5 個 `/api/admin/ops/**` 端點（F-016），也是未設定 `CSRF_SECRET` 環境的退回加密根金鑰。把它交給第三方服務，影響面比較大。

可排程端點都有對應的 **GET 入口，驗證的是另一把密鑰 `CRON_SECRET`**（`scheduled-jobs-runbook.md` §2、§5：「任何一把外洩只開放一半入口」）。外部觸發器可改用：

- 方法 `GET`，標頭 `Authorization: Bearer <CRON_SECRET>`，路徑與 §2 相同。
- 注意：**GET 不接受 `JOB_SECRET`，POST 不接受 `CRON_SECRET`**，兩者不可混用。
- staging 的 `CRON_SECRET` 是否已設定、值是否與 `JOB_SECRET` 不同：**待 owner 確認**（preflight 會在兩者相同時警告）。

本文件的主要流程依任務要求寫 `Authorization: Bearer $JOB_SECRET`；如果 owner 不想把 `JOB_SECRET` 交給第三方，改用此選項更安全，端點與頻率不變。

## 7. 失敗時怎麼看

| 位置 | 看什麼 |
|---|---|
| 外部服務 | cron-job.org：job 的執行歷史（狀態碼、耗時）與失敗通知信；Worker：`npx wrangler tail` 或 Dashboard → Workers → Logs |
| Vercel | `celebrate-deal-staging` → Logs，篩選路徑（例如 `/api/jobs/webhook-retry`）與方法 POST；時間應每 5 分鐘一輪，與外部服務的執行時間對得上 |
| Sentry | `webhook_retry_requires_attention`（`reason` ＝ `inventory_unavailable` 或 `exhausted`）、`captureOperationalError` 的 `source: webhook_retry_job` |
| GitHub | heartbeat 與 `scheduled-jobs.yml` 仍是備援：`gh run list --workflow scheduled-jobs-heartbeat.yml --limit 5` |
| 狀態碼對照 | §2.5 |

**停止**：外部服務暫停 job（或刪除 Worker 的 cron trigger）；事故時另可設 repo variable `SCHEDULED_JOBS_PAUSED=true`，但它只擋 GitHub workflow，**擋不住外部觸發器**，所以停外部觸發要到外部服務操作。

## 8. 驗收（關閉 B-1 的條件）

1. 在外部觸發器啟用後的 24 小時內，從 Vercel staging Logs 取 `POST /api/jobs/email-deliveries` 的時間戳，相鄰間隔中位數約 5 分鐘、最長不超過 15 分鐘。
2. 三個頻繁 job 皆 `200`；每日 job 隔天 01:22 前後有一筆 `202` 或 `200`。
3. 實際走一次 O-13 第 6、9 步：註冊後報名確認信、開播提醒在幾分鐘內送達。
4. 驗收通過後，更新 GO-NO-GO §5 B-1，並決定 heartbeat 保留作備援或關閉（`SCHEDULED_JOBS_HEARTBEAT_ENABLED`，Disable workflow 才能立刻停）。

### Production 的注意事項

- Production 上線時要另外建一組指向 Production 主機的觸發器，使用 **Production 自己的** `JOB_SECRET`（O-6(b)：不可與 Preview 相同）。runner 與 `scheduled-jobs.yml` 目前只打 staging。
- **webhook-retry 在 Production 受 B03-07 gate 限制**（付款事實先記帳、庫存不足標記超賣並建立退款或工單；`TradeLExpireSec` ≤ 保留 TTL）：該 gate 完成前，Production 不要建立 `webhook-retry` 的排程。
- Vercel Cron（方案 C）只在 Production 且 Pro 方案才適用；若 owner 在 Production 選它，頻繁工作可縮到 `*/5 * * * *`（`scheduled-jobs-runbook.md` §4）。

## 9. 需要 owner 補的資料

1. 選 A 或 B（以及外部服務名稱）。
2. 該服務實際的逾時上限、免費額度與頻率下限（§3、§3.3 標「待確認」處）。
3. 是否接受把 `JOB_SECRET` 放在第三方；不接受則改用 §6 的 GET＋`CRON_SECRET`，並確認 staging 的 `CRON_SECRET` 已設定且不同於 `JOB_SECRET`。
4. O-16：Vercel staging 是否升 Pro（外部觸發每天仍會產生大量 function 呼叫，Hobby 用量上限是否足夠）。
5. 通知管道：失敗通知要寄到哪個信箱。
