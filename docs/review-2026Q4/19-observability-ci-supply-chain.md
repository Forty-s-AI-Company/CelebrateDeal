# 19 可觀測性、CI／CD 與供應鏈審查（B-09）

- 審查日期：2026-10-19（Asia/Taipei）
- 基線：`origin/master` = `78621ca3`（本分支 `codex/goal-review-2026q4` 與其相同）
- 方式：唯讀。只讀 repo 檔案、`gh api` 的 repository 設定、`npm view`／`npm ls`。未讀 `.env*`、未呼叫 Vercel／Sentry／Cloudflare 的任何 API、未執行部署或任何外部寫入。
- 前置文件：`03-test-map.md`（CI 結構與耗時）、`04-static-scan.md`（audit、overrides）、`01-system-map.md`（排程缺口）。
- 範圍界線：Vercel 專案設定、Sentry 後台設定、Production 排程是否存在於 repo 之外，**本次無法從 repo 或 GitHub 判定**，一律標為「需 owner 確認」，不假設有或沒有。

## 0. 結論摘要

1. **排程缺口屬實，而且比系統地圖寫的更嚴重**：`vercel.json` 沒有 `crons`、24 個 workflow 沒有任何 `schedule:`，而且有測試（`scheduler-config.test.ts`）禁止在 `vercel.json` 加 `crons`。8 類真正的背景工作（寄信、LINE、學員通知、付款 webhook 重試、庫存保留釋放、月結、Meta 追蹤派送、直播媒體清理）在 repo 內沒有人呼叫。另外，**4 個 job 只接受 POST + `JOB_SECRET`，Vercel Cron 只會送 GET + `CRON_SECRET`，所以即使現在補上 `vercel.json` crons，也只有 3 個 `cron/*` 加 `email-deliveries` 的 GET 能被驅動。**
2. **失敗幾乎看不見**：`/api/health` 只做 `SELECT 1`；4 個端點的失敗分支沒有送 Sentry；沒有任何 heartbeat、job lag 或 Sentry Cron Monitor。
3. **Sentry 的 PII 防線依賴 SDK 預設值**：沒有 `beforeSend`／`beforeBreadcrumb`；cookies、headers、query params、stack frame 區域變數的收集預設都是開啟。自建的 `captureOperationalError` 做得很好（白名單），但未處理例外走 `onRequestError`／`global-error`，不經過它。
4. **CI 對公開 repo 缺三件基本防護**：job 沒有 `timeout-minutes`（預設 360 分鐘）、沒有 `concurrency`、fork PR 核准政策只擋「首次貢獻者」。CI 本身沒有使用任何真實 secret，這點是好的。
5. **供應鏈**：braces advisory 目前沒有任何可升級的修補版（已用 `npm view` 驗證，連最新 `eslint-config-next@16.4.2` 都仍鎖 `fast-glob@3.3.1`），只影響 dev 工具鏈，建議記錄例外而非硬修。真正的缺口是公開 repo 的 GitHub secret scanning、push protection、Dependabot 全部關閉，也沒有 `dependabot.yml`。
6. **CSP 還離 enforce 很遠**：Report-Only 的回報端點把報告直接丟掉（204，不記錄），所以目前**收集不到任何資料**。

## 1. Findings 總表

欄位：嚴重度 BLOCKER／MAJOR／MINOR／NIT；估工為工程師實作＋驗證的粗估；「owner」指需要 owner 決策；「封測」指封閉測試前必修。

| ID | 嚴重度 | 位置 | 問題 | 影響 | 建議 | 估工 | owner | 封測 |
|---|---|---|---|---|---|---|---|---|
| B09-01 | BLOCKER | `vercel.json`、`.github/workflows/*`、`src/app/api/jobs/email-deliveries/scheduler-config.test.ts:5-14` | repo 內沒有任何東西驅動 9 個 `/api/cron`、`/api/jobs` 端點 | 見 2.2：正式環境信件、LINE、學員通知、付款 webhook 重試、庫存釋放、月結、Meta 追蹤、直播清理都不會自動執行 | 先由 owner 確認 repo 外是否已有排程；沒有就選排程器（見 2.3）並把 4 個 POST-only job 補上可被排程器呼叫的方式 | 1～2 天 | 是 | 是 |
| B09-02 | MAJOR | `src/app/api/cron/line-notifications/route.ts:39`、`cron/live-media/route.ts:11`、`jobs/tracking-deliveries/route.ts`、`jobs/payuni-live-probe/route.ts` | 失敗分支只回 503，沒有 `captureOperationalError`；其餘 job 有 | job 壞了沒有人知道；與 B09-01 疊加 | 補 capture；每個 job 成功時寫 heartbeat（Sentry Cron Monitor 或外部 heartbeat） | 0.5～1 天 | 否 | 是 |
| B09-03 | MAJOR | `src/app/api/health/route.ts:76-95` | health 只驗證 DB 連線；公開；無 job lag、無 migration 版本、無外部相依 | 「綠燈」不代表系統可用；沒有 repo 內的 uptime 監控 | 保留公開的最小 liveness；另加需 `CRON_SECRET` 的 readiness（job 最後成功時間、待處理佇列深度） | 0.5 天 | 否 | 是 |
| B09-04 | MAJOR | `sentry.server.config.ts:17-20`、`sentry.edge.config.ts:39-42`、`src/instrumentation-client.ts:18-21` | 只設 `userInfo:false`、`httpBodies:[]`；`cookies`、`httpHeaders`、`queryParams`、`stackFrameVariables` 皆為預設 `true`；無 `beforeSend`／`beforeBreadcrumb` | 台灣個資法範圍的 PII（email、電話、訂單查詢參數、magic link token）可能經 query string、header、例外訊息、區域變數進入 Sentry；DSN 在海外 | 明確設定 `cookies:false`、`httpHeaders` 白名單、`queryParams:false`、`stackFrameVariables:false`；加 scrubber（email、電話、卡號、`token`/`secret` 參數）與單元測試 | 1 天 | 否 | 是 |
| B09-05 | MINOR | `src/instrumentation-client.ts:16-17` | `replaysOnErrorSampleRate: 0.1` 但沒有 `replayIntegration`，設定無作用；`enableLogs: true` 但程式未使用 `Sentry.logger` | 文件與行為不一致；日後有人加上 replay 時會在沒有遮罩設定下直接啟用 | 移除無作用設定，或加 replay 時一併設 `maskAllText`、`blockAllMedia` | 1 小時 | 否 | 否 |
| B09-06 | MINOR | `next.config.ts:55-76`、`package.json:7` | `webpack:{automaticVercelMonitors,treeshake}` 只對 webpack build 生效；`npm run build` 為 `next build`（Next 16 預設 Turbopack），Playwright 用 `--webpack`；未明確設 `release.name` | 被認為存在的 Vercel cron monitor 其實不會建立（也沒有 cron 可監控）；source map 上傳路徑在兩種 builder 不同，未驗證 | 確認 Production 實際使用哪個 builder；明確設 release（git SHA）；用一次無外送的 build 驗證 | 0.5 天 | 否 | 否 |
| B09-07 | MAJOR | `.github/workflows/ci.yml:8` | `quality` job 無 `timeout-minutes`（預設 360 分鐘）；repo 為公開 | 步驟卡住或有人在 fork PR 改 ci.yml 跑長時間工作，可燒 6 小時 runner；正常為 30～33 分鐘 | 加 `timeout-minutes: 60`；各長步驟加 `timeout-minutes` | 10 分鐘 | 否 | 是 |
| B09-08 | MINOR | `ci.yml:3-5` | `on: push`（所有分支）＋`pull_request`，無 `concurrency` | 同一個 PR 每次更新跑兩輪（各約 33 分鐘），舊輪不取消 | `push` 限 `master`；加 `concurrency` 並 `cancel-in-progress: true`。注意 `quality` 是 required check，名稱不可變 | 15 分鐘 | 否 | 否 |
| B09-09 | MINOR | `ci.yml` 全檔 | 沒有 `permissions:`；`actions/checkout@v4`、`setup-node@v4` 用 tag，其他 23 個 workflow 用 SHA；repo 設定 `sha_pinning_required:false` | repo 預設 token 權限已是 `read`，實際風險低；但 CI 是唯一自動執行的 workflow，應顯式宣告 | 加 `permissions: contents: read`，action 改 SHA pin | 15 分鐘 | 否 | 否 |
| B09-10 | MAJOR | repo 設定 `fork-pr-contributor-approval = first_time_contributors` | 公開 repo；曾貢獻過的外部帳號之 fork PR 不需核准即可執行 workflow（以 PR 內的 ci.yml 為準） | CI 無真實 secret，所以不會外洩；但可濫用 runner 時間（配合 B09-07 的 360 分鐘上限） | 改為 `all_external_contributors`（需 owner 在 Settings 變更；本次不動） | 5 分鐘 | 是 | 是 |
| B09-11 | MINOR | `ci.yml:65-70` | CI 依賴 `refs/pull/277/head` 並比對固定 SHA | 屬歷史 PR 的 ref；若該 ref 日後不可取得，整個 CI 紅燈，且與功能無關 | 把需要的 fixture 以 tag 或 vendored 檔案取代，或標為可選 | 0.5 天 | 否 | 否 |
| B09-12 | MINOR | `ci.yml` 步驟 `test:coverage`、`test:db:concurrency`、`test:contracts`、Playwright 各 runner | 完整 Vitest 跑兩次（245 秒＋211 秒）、Node TAP 兩次、數次 `next build` | 浪費約 8～12 分鐘（約 25～35%，估計值）；目前整體約 33 分鐘 | 見 4.3 | 1～2 天 | 否 | 否 |
| B09-13 | MINOR | `.github/workflows/`（23 個 `workflow_dispatch`） | 3 個從未執行（`payuni-live-probe`、`staging-backup-recovery`、`staging-provider-binding-attestation`）；3 個最近一次失敗；`q1-*`、`f2-*` 綁定 10 月 9～11 日的固定來源，已是歷史工具 | 維護面積大；每個都能讀 staging 環境 secret | 把 `q1-*`／`f2-*` 移到 archive tag；保留 `staging-migrate`、`staging-browser-smoke` 等仍會用的 | 0.5 天 | 是 | 否 |
| B09-14 | MAJOR | GitHub environments；`vercel.staging.json` | `Preview – celebrate-deal-staging` 只有「僅受保護分支」政策、0 位 reviewer；`Production` 與 `Preview – celebrate-deal` 完全無保護；沒有任何 workflow 使用 `Production`。另外 staging 的 `buildCommand` 每次部署都會跑 `db:migrate:deploy` | Production 部署路徑不經 GitHub，GitHub 端沒有人工 approval 的技術強制；是否真的有，取決於 Vercel 設定與操作紀律（repo 內無法證明）。staging 變數若誤填成 Production URL，部署就會直接改 Production schema | 設 `Production` 環境 required reviewer＋僅 `master`；日後 production deploy 一律經該環境的 workflow；staging build 內的 migrate 改為只跑 `migrate status`，遷移一律走 `staging-migrate`；請 owner 確認 Vercel 端現況 | 0.5 天 | 是 | 是（若封測使用 Production） |
| B09-15 | MAJOR | repo 設定 `security_and_analysis` | 公開 repo 的 secret scanning、push protection、Dependabot security updates 皆 `disabled`；無 `dependabot.yml`／Renovate／CODEOWNERS | 密鑰誤推到公開 repo 沒有平台層攔截（`npm run secret:scan` 只在 CI，事後才跑）；依賴漏洞不會自動出 PR | 開啟三項（公開 repo 免費）；加最小的 `dependabot.yml`（npm，每週，分組） | 0.5 小時＋持續處理 | 是 | 是 |
| B09-16 | MINOR | `package-lock.json`、`package.json:84-99` | braces ≤3.0.3 high advisory（GHSA-vfj7-8cjw-p6xm）無修補版；5 個 high 全來自 `eslint-config-next → @next/eslint-plugin-next → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3` | 僅 dev 工具鏈，production audit 為 0；CI 的 audit 步驟用 `--omit=dev`，不受影響；利用條件需攻擊者控制 glob pattern，ESLint 讀的是自己的設定 | 見 5.1：記錄例外並設到期日，不用 `npm audit fix` | 1 小時 | 是 | 否 |
| B09-17 | MINOR | `package.json` `overrides`、`ci.yml:78-79` | 4 項 override 無文件說明（`deepmerge-ts`、`postcss`、`sharp`、`playwright-core`）；9 個套件有 install script（見 5.3）；CI 用會執行 script 的 `npm ci` | 難判斷何時可移除；`@sentry/cli` 安裝時會下載二進位檔 | 補原因與移除條件；CI 改 `npm ci --ignore-scripts` 並手動預載 Prisma engine（`staging-migrate.yml` 已有此做法） | 0.5 天 | 否 | 否 |
| B09-18 | MAJOR | `src/app/api/security/csp-report/route.ts:7-17`、`next.config.ts:4-16` | CSP 只有 Report-Only，且回報端點收下報告後直接回 204，不記錄、不轉送 | 部署以來蒐集到的違規資料為零；`script-src` 含 `'unsafe-inline' 'unsafe-eval'`，現階段完全不能擋 XSS | 見 6.2：先讓回報可見，再逐項處理來源，最後 enforce | 3～5 天 | 否 | 否（建議公開上線前完成） |
| B09-19 | MINOR | `next.config.ts:42` | HSTS 為 `max-age=63072000; includeSubDomains` | 若 Production 網域下有任何未啟 HTTPS 的子網域會被擋；無 `preload` 屬刻意或遺漏不明 | 上線前列出網域下所有子網域確認；未確認前不要加 `preload` | 1 小時 | 是 | 否 |
| B09-20 | NIT | `src/lib/auth.ts:42-51` | 登入 cookie `celebrate_session` 為 `httpOnly`、`sameSite:lax`、`secure` 依 `NODE_ENV==="production"`；沒有 `__Host-` 前綴 | `secure` 綁 `NODE_ENV` 而非實際協定；Preview 與 Production 都是 production build，所以目前正確 | 若要加深防禦可改 `__Host-` 前綴（需 path=/、無 Domain），會讓現有 session 失效，列為上線後再議 | 2 小時 | 否 | 否 |
| B09-21 | NIT | `src/app/api/jobs/*`、`src/app/api/cron/*` | 未設定 `maxDuration`；`email-deliveries` 在單次呼叫內循序處理 9 段工作 | 實際上限取決於 Vercel 方案與 Fluid Compute 設定（repo 內看不到），逾時會讓後段工作長期餓死 | 確認方案上限；必要時把 email 與 LINE 拆成獨立排程 | 2 小時 | 是 | 否 |
| B09-22 | NIT | `docs/launch/payuni-live-one-time-probe.md` §開始前 4 | 文件說「每 5 分鐘的排程」，但 `payuni-live-probe.yml` 只有 `workflow_dispatch`（註解寫明合併不得啟動真實金流探針） | 文件與 workflow 不符；實際是安全的（不會自動跑） | 更新文件，寫明目前無排程 | 15 分鐘 | 否 | 否 |

## 2. 排程缺口（B09-01）

### 2.1 事實

- `vercel.json` 只有 `framework` 與 `git.deploymentEnabled.master=false`；`vercel.staging.json` 寫 `"crons": []`。
- 搜尋 `schedule:`、`cron:` 於 `.github` 無結果；24 個 workflow 全是 `ci.yml`（push／PR）或 `workflow_dispatch`。
- `scheduler-config.test.ts` 明確斷言 `vercel.json` 不得有 `crons`（原因：staging 跑在 Vercel Hobby，不接受每分鐘排程）。
- `docs/launch/staging-cron-operations.md`：staging 排程器狀態為 `PENDING_EXTERNAL`，Production 為 `NO_GO`，並明說「不要為了讓 build 通過就改成每日排程」。
- 唯一曾存在的排程概念是 `PAYUNI_LIVE_PROBE_SCHEDULER_ENABLED`，但對應 workflow 現在也只剩手動觸發（B09-22）。

結論：repo 內沒有任何排程。**Production 的 Vercel 專案設定、外部排程服務是否已有人在呼叫，repo 無法證明，需 owner 回答。**

### 2.2 九個端點的影響

| 端點 | 方法／驗證 | 沒有排程時的後果 |
|---|---|---|
| `/api/jobs/email-deliveries` | GET `CRON_SECRET`／POST `JOB_SECRET` | 最大的一個：交易信件、直播開播提醒、直播後追蹤信、學員通知（四渠道）、LINE 物化與派送、報名表單重試草稿的過期清理，全部不跑。使用者報名後收不到信 |
| `/api/cron/line-notifications` | GET `CRON_SECRET` | LINE outbox 不會物化與派送（但 `email-deliveries` 也會做同樣兩件事，所以只要前者有跑，這個是冗餘） |
| `/api/cron/line-notifications/runtime-binding` | GET `CRON_SECRET` | 其實是檢查端點，不是工作；不需要排程 |
| `/api/cron/live-media` | GET `CRON_SECRET` | 直播媒體 session 不清理，閒置資源累積 |
| `/api/jobs/webhook-retry` | **僅 POST** `JOB_SECRET` | **金流路徑**：失敗的付款 webhook 不重試（付款成功但訂單沒推進）；過期的庫存保留不釋放（商品被卡住無法購買） |
| `/api/jobs/billing-cycle` | **僅 POST** `JOB_SECRET` | 月結帳單不產生、逾期不標記。程式裡 `automaticCharges: 0`，不會自動扣款，影響的是帳務與發票 |
| `/api/jobs/tracking-deliveries` | **僅 POST** `JOB_SECRET` | Meta CAPI 追蹤事件不派送（預設關閉，開啟後才有影響） |
| `/api/jobs/electronic-invoices` | **僅 POST** `JOB_SECRET` | 電子發票 adapter 本來就未接（回 202 並保持 queued），目前無實際影響 |
| `/api/jobs/payuni-live-probe` | 一次性探針 | 刻意不排程，正確 |

**pending refund consumer 不受此缺口影響**：它不是端點，而是 staging 手動腳本 `scripts/payuni-sandbox-pending-refund-consumer.mjs`（由 `workflow_dispatch` 與 q1 runner 使用）。另一方面這也代表 Production 沒有自動化的待處理退款對帳，這是獨立議題，歸金流審查，不在此判定。

### 2.3 排程器選項

Vercel Cron 只會對路徑發 **GET** 並帶 `Authorization: Bearer ${CRON_SECRET}`。所以：

| 選項 | 可驅動的端點 | 優點 | 缺點 |
|---|---|---|---|
| A. Vercel Cron（需付費方案才能每分鐘） | 只有 3 個 `cron/*` 與 `email-deliveries` 的 GET；`webhook-retry`、`billing-cycle`、`tracking-deliveries`、`electronic-invoices` 需先新增 GET handler（驗 `CRON_SECRET`） | 與部署同處，Vercel 會顯示執行紀錄 | 要改 4 個 route，並改掉禁止 `crons` 的測試；staging 的 Hobby 方案無法用 |
| B. GitHub Actions `schedule` | 全部（可 POST、可帶 `JOB_SECRET`） | 不用改 route；secret 放環境 | 最短 5 分鐘、實際延遲常達 10 分鐘以上、公開 repo 閒置 60 天會自動停用排程；webhook 重試與信件延遲不理想 |
| C. 外部排程服務（cron-job.org、Cloudflare Workers Cron 等） | 全部 | 可每分鐘、可帶任意 header | 多一個服務與 secret 輪替；Cloudflare 已在用，Worker Cron 最順 |

建議：**C（Cloudflare Worker cron）或 A 擇一**，不建議 B 當正式排程。無論選哪個，都要加 B09-02 的 heartbeat，並在排程器端設「連續失敗告警」。選型屬 owner 決策（成本、方案）。

## 3. 可觀測性

### 3.1 Sentry 設定現況

做得好的：

- DSN 只讀環境變數，沒有寫死；`environment` 經 `resolveSentryEnvironment` 白名單驗證。
- `monitoring.ts` 的 `captureOperationalError` 使用固定 enum 分類、context 鍵與值的白名單（`SAFE_CONTEXT_KEYS`、`SAFE_CONTEXT_VALUE`），且丟出的是固定訊息的 `OperationalError`，不帶原始錯誤字串。
- 程式內未呼叫 `Sentry.setUser`／`setContext`，沒有手動把使用者資料放進去。
- `tracesSampleRate` 正式為 0.1；`tunnelRoute:"/monitoring"` 避免廣告阻擋器吃掉事件。
- client 的 source map 預設在上傳後刪除（SDK 於 `webpack.js:229-236` 內建；`productionBrowserSourceMaps` 未開啟）；`SENTRY_AUTH_TOKEN` 只在 build 時使用。

缺口：

- B09-04：預設收集範圍過大，未處理的例外（`onRequestError`、`global-error.tsx`）直接帶原始 `error.message`，Prisma 與金流錯誤訊息可能含識別資訊。
- 沒有 `beforeSend`：email、電話、卡號、token 的遮罩完全靠 SDK 內建過濾。SDK 型別註解寫的是「金鑰與 token 類敏感值會被過濾」，不含 email 或電話。
- 沒有 `tracesSampler`：`/api/health` 與 cron 呼叫也會被取樣，浪費配額。
- DSN 缺漏時：`captureOperationalError` 退回 `console.error`，其他路徑靜默不送；沒有啟動時檢查。`global-error.tsx` 對使用者說「錯誤已送出給維運團隊」，在 DSN 缺漏時是不實的。

### 3.2 關於 `remaining-capabilities-source-map-security-*`

這兩個檔（`docs/remaining-capabilities-source-map-security-patch-20261006.json`、`...-delivery-...json`）對應 #376，內容是 **`source-map-js` 的 DoS advisory（GHSA-68fv-2mgg-jv7q）以 exact override 修補**，並不是「公開 source map 的外洩」修補。要確認的是「Production 上有沒有公開 `.map` 檔」，這屬部署後檢查；repo 內證據是未開 `productionBrowserSourceMaps`，且 SDK 預設上傳後刪除。**但這依賴 webpack 路徑**，見 B09-06；Turbopack 路徑需另外驗證。

### 3.3 Health 與告警

- `/api/health`：回 `{ ok, database, latencyMs }`，失敗回 503 並以固定分類 log（不洩漏連線資訊，這點做得好）。
- 沒有 repo 內的 uptime 探測（沒有 workflow、沒有 Vercel 設定），也沒有 Sentry alert rule 的宣告（Sentry 規則在後台，repo 看不到）。
- 沒有「job 最後成功時間」的任何紀錄表或指標，所以即使補上排程，也無法回答「信件佇列是不是停了」。

建議的最小可行設計：每個 job 成功時寫一筆 heartbeat（job 名稱、時間、處理數量）或呼叫 Sentry Cron Monitor check-in；readiness 端點讀取並比對預期間隔；外部 uptime 服務打 liveness，另一個打 readiness。若新增 table，需登記 `PRISMA_INVARIANTS.md`（`AGENTS.md` 規定）。

## 4. CI

### 4.1 結構（HEAD 的 `ci.yml`）

- 單一 job `quality`，45 個具名步驟（GitHub UI 計入 setup／post 為 49）；所有步驟序列執行，沒有平行 job。
- 環境變數全是假值（`ci-job-secret-123456` 等），`SENTRY_DSN` 指向 `sentry.invalid`，沒有使用 `secrets.*`。這是對的：fork PR 不會拿到任何真實密鑰。
- `RATE_LIMIT_PROVIDER: cloudflare_waf` 與 `PAYMENT_PROVIDER: demo` 讓測試不碰外部服務。

### 4.2 對公開 repo 的暴露

- 觸發是 `pull_request`（非 `pull_request_target`），fork 的程式碼在沒有 secret、token 唯讀的環境下執行；`default_workflow_permissions` 為 `read`、`can_approve_pull_request_reviews` 為 `false`，這些設定都正確。
- 缺口只剩 runner 時間濫用（B09-07、B09-10）。
- Branch protection（`master`）：required check `quality`、`strict:true`、`enforce_admins:true`、線性歷史、禁止 force push 與刪除、要求解決對話；**`required_approving_review_count: 0`**，也就是說 `AGENTS.md` 要求的「高風險變更需獨立審查」沒有技術強制，靠流程與紀律。單人 owner 的現況下是合理取捨，但請在 `docs/` 明寫為已知風險。
- repo 允許 merge commit、rebase、squash 三種合併方式；`AGENTS.md` 要求 squash。可關掉另外兩種（需 owner 設定）。

### 4.3 重複執行的節省方案（B09-12）

| 項目 | 現況 | 方案 | 預估節省（估計值，未實測） |
|---|---|---|---|
| 完整 Vitest 兩次 | `test:coverage`（757 檔）＋`test:db:concurrency`（759 檔），差 2 檔 | 讓 `vitest.synthetic-db-coverage.config.ts` 只跑 `wp17-db` 與需要獨立 schema 的檔案；或把 mfa-db／payout-db 2 檔併入主流程，刪掉整套重跑 | 約 3 分鐘 |
| Node TAP 兩次 | 含在 `test:coverage` 內，`test:contracts` 再跑一次 | 刪 `test:contracts` 步驟，或讓覆蓋流程跳過 | 約 25 秒 |
| 數次 `next build` | 4 個 browser runner＋Playwright webServer＋`npm run build`＋controlled build，各自重建（沿用 `03-test-map.md`，本次未逐一重算） | 建一次、上傳 `.next` artifact，後續 runner 重用（需處理各 runner 不同的環境變數與 distDir） | 約 3～6 分鐘 |
| 單一序列 job | 33 分鐘串行 | 拆成 lint／typecheck、unit＋coverage、db、e2e 平行 job，另加一個彙總 job 命名為 `quality`（維持 required check 名稱） | 牆鐘時間可降到約 15～18 分鐘 |
| push＋PR 雙觸發 | 兩輪 | B09-08 | 每個 PR 少 1 輪 |

先做 B09-07／08／09（共約 40 分鐘工作量、風險極低），再做拆 job；拆 job 時要先在非 required 的分支驗證，避免 `quality` 名稱短暫缺席造成 master 被卡住。

### 4.4 另外 23 個 workflow 的用途與是否還在用

全為 `workflow_dispatch`，都用 `Preview – celebrate-deal-staging` 環境；最近一次執行時間取自 `gh run list`：

| 類別 | workflow | 最近一次 | 判讀 |
|---|---|---|---|
| 仍在用 | `staging-migrate`（#430） | 10/18 成功 | 保留，這是 staging 資料庫遷移的受保護入口 |
| 偶用 | `staging-browser-smoke`、`staging-funnel-smoke`（失敗）、`staging-r2-image-smoke`、`staging-stream-resource-smoke`、`staging-preview-preflight`、`staging-provider-readonly-probe`、`staging-migration-apply`、`staging-migration-compat-preflight`、`secure-staging-validation` | 9/25～10/9 | 保留；`staging-funnel-smoke` 與 `staging-fixture-diagnostics` 最近一次失敗，需決定修或封存 |
| 歷史工具 | `q1-*`（7 個，`q1-original-callback` 最近失敗）、`f2-issued-pending-state`、`staging-issued-trade-recovery`（失敗）、`staging-qa-finance-bootstrap` | 10/9～10/11 | 綁固定來源 SHA 的一次性復原，建議 tag 封存（`staging-qa-finance-bootstrap` 仍與 #436 有關，先保留） |
| 從未執行 | `payuni-live-probe`、`staging-backup-recovery`、`staging-provider-binding-attestation` | 無 | 前者刻意；後兩個需確認是否仍需要 |

## 5. 供應鏈

### 5.1 braces advisory 的處理選項

事實：`npm ls braces` 的唯一路徑是 `eslint-config-next@16.3.5 → @next/eslint-plugin-next@16.3.5 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`；`braces` 在 npm 的最新版本是 3.0.3（也在受影響範圍內）；`@next/eslint-plugin-next@16.4.2` 仍依賴 `fast-glob@3.3.1`，所以升級 `eslint-config-next` 也不會消除。

| 選項 | 評估 |
|---|---|
| 記錄例外（建議） | 在 `docs/` 記錄「僅 dev 鏈、需攻擊者控制 glob pattern、CI 僅 audit production」，附到期日（例如 2026-12-31 或上游出修補版）。CI 已經是 `--omit=dev`，不需動 |
| 用 `overrides` 強制 | 無可用版本可指定，不可行 |
| 降到 `eslint-config-next@14.2.35` | `npm audit` 的建議，會降 major，不可採用 |
| 移除 `eslint-config-next`，自行組 ESLint 規則 | 可行但工程量大且失去 Next 官方規則更新，不建議 |
| 加每週排程 audit（含 dev）通知 | 輔助，可與 Dependabot 一起設 |

另外：`next` 目前 16.3.8，npm latest 為 16.4.2，可在 Dependabot 啟用後依其 PR 評估（本次不判定升版風險）。

### 5.2 `overrides`

- 有文件依據：`fast-uri`、`js-yaml`、`nanoid`、兩個 `minimatch@x → brace-expansion`、`source-map-js`（#376）。
- 無文件說明：`deepmerge-ts: 8.0.1`、`postcss`、`sharp`、`playwright-core`。建議各補一行原因與移除條件，否則下一次升級時沒人敢動。
- `package.json` 沒有 `engines`，Node 版本只由 CI 的 `node-version: 22` 決定。

### 5.3 Lockfile 與 install script

- `package-lock.json`：`lockfileVersion` 3、共 913 個套件、全部從 `registry.npmjs.org` 解析；唯一缺 `integrity` 的是 `@tailwindcss/oxide-wasm32-wasi` 下 6 個 `inBundle` 的可選依賴，屬 npm 已知現象，可接受。
- 有 install script（`hasInstallScript`）的 9 個：`@prisma/client`、`@prisma/engines`、`prisma`、`@sentry/cli`（下載平台二進位檔）、`esbuild`（dev）、`unrs-resolver`（dev）、`fsevents`（3 個 optional）。
- `ci.yml` 用 `npm ci`（會執行這些 script）。`staging-migrate.yml` 已示範更安全的做法：`npm ci --ignore-scripts` 再手動預載 Prisma engine。建議 CI 也比照，並對 `@sentry/cli` 設 `SENTRYCLI_SKIP_DOWNLOAD=1`（CI 不上傳 source map）。

## 6. CSP 與安全標頭

### 6.1 現況

| 標頭 | 位置 | 值 | 評價 |
|---|---|---|---|
| `Content-Security-Policy-Report-Only` | `next.config.ts:43` | 見 6.2 | 只報告；報告被丟棄 |
| `X-Frame-Options` | 同上 | `DENY` | 正確，與 `frame-ancestors 'none'` 一致 |
| `X-Content-Type-Options` | 同上 | `nosniff` | 正確 |
| `Referrer-Policy` | 同上 | `strict-origin-when-cross-origin` | 正確 |
| `Permissions-Policy` | 同上 | 相機麥克風等全關；`/lives/:id/presenter` 例外開 | 正確 |
| `Strict-Transport-Security` | 同上 | `max-age=63072000; includeSubDomains` | 見 B09-19 |

`src/proxy.ts` **完全不處理 CSP 或安全標頭**，且 matcher 只涵蓋 `/lp/:path*` 與 fingerprint 標記路徑；所有標頭來自 `next.config.ts` 的靜態 `headers()`。

### 6.2 改成 enforce 之前要先處理的來源

靜態標頭無法放 nonce。要移除 script 的 `'unsafe-inline'`，必須改成 per-request nonce，而 nonce 需要動態渲染，proxy matcher 要擴大到全站，且會與 `src/proxy.ts` 現有 `/lp` 的每請求 DB 查詢（#440）疊加成本。建議順序：

1. **讓報告看得見**：`csp-report` 路由至少記一行結構化 log（只記 `violated-directive`、`blocked-uri` 的 origin、`document-uri` 的 path，不記 query）；改用 `Reporting-Endpoints`／`report-to`（`report-uri` 已被取代）。先收集 1～2 週真實資料。
2. **補漏掉的來源**（目前 enforce 會直接壞掉的）：
   - `connect-src` 缺 `https://videodelivery.net`、`https://*.cloudflarestream.com`（hls.js 以 XHR／fetch 讀 manifest 與分段；現在只在 `media-src`）、`upload.videodelivery.net`（tus 上傳）、R2 預簽上傳網域。
   - `frame-src` 沒設，落到 `default-src 'self'`：`landing-page-renderer.tsx:74` 的 YouTube-nocookie 與 Vimeo 嵌入會被擋。
   - `worker-src blob:`：hls.js 常用 blob worker。
   - `img-src https:`、`media-src https:` 過寬，要改成實際使用的網域清單（R2 公開網域、Cloudflare）。
   - `script-src` 與 `connect-src` 的 PostHog：`product-analytics.ts` 看起來是伺服器端呼叫，client 可能根本不需要，需確認後移除。
3. **移除 `'unsafe-eval'`**：正式版 Next 不需要；若 Puck 編輯器或其他函式庫在後台需要，則只對 `/(app)` 路徑放寬，不對公開頁。先在 Report-Only 下觀察。
4. **移除 script 的 `'unsafe-inline'`**：改 nonce＋`'strict-dynamic'`。Next 的內嵌 hydration script 需要 nonce，這是工作量最大的一步。
5. **`style-src 'unsafe-inline'`**：有 33 個檔案使用 `style=`；多數產品都保留這項，風險可接受，不列為 enforce 的前置條件。
6. **`form-action`**：已包含 PayUni 兩個網域。Chrome 會把 redirect 目標也算進 `form-action`，要實測 PayUni 付款 → 回呼 → 回站的完整流程，以及 LINE 登入。
7. 先對公開頁與 checkout 做 enforce（風險最大、第三方最少），後台最後。每一步先 Report-Only 並跑 Playwright 全套瀏覽器測試。

## 7. 部署

- `vercel.json`：`git.deploymentEnabled.master=false`，master 推送不會自動部署，這是好設計。沒有 `regions`、`functions`、`crons` 設定；staging 的 `hnd1` 區域應在 Vercel 專案設定（`docs/launch/CURRENT.md` 記載），repo 看不到。
- `vercel.staging.json`：`buildCommand` 先對 `STAGING_DATABASE_URL` 做 `db:migrate:deploy` 再 build，也就是每次 staging 部署都會跑 migration。便利，但沒有 `staging-migrate.yml` 的 `ref_protected` 與環境保護（B09-14）。
- Production 部署路徑：repo 內沒有任何 workflow 使用 `Production` 環境；GitHub 端的 `Production` 環境沒有 reviewer、沒有分支限制。因此「Production 部署是否真的需要人工 approval」，**答案是：在 repo 與 GitHub 層面沒有技術強制**；實際靠 Vercel 後台設定與 owner 操作，這部分我沒有查（避免觸碰外部服務），列為需 owner 確認。
- staging 環境保護（#430、#432）：已確認 `Preview – celebrate-deal-staging` 設有「僅受保護分支可部署」；`staging-migrate` 另有 `github.ref == master && ref_protected` 的 job 條件、`concurrency` 與 `timeout-minutes: 20`、`permissions: contents: read`、`persist-credentials:false`、SHA pin 的 action、`--ignore-scripts`，是這個 repo 裡 workflow 寫法最好的範本，其他 workflow 與 `ci.yml` 可以比照。
- 注意：公開 repo 中 workflow 檔、`docs/launch/*` 會揭露 staging 網址、環境名稱與驗收流程。未發現密鑰（`secret:scan` PASS），但建議 owner 知悉這是公開資訊。

## 8. 已驗證與未驗證

已驗證（有指令或檔案行號）：`vercel.json`／`vercel.staging.json` 內容；無 `schedule:`；各 job route 的方法與 secret；`capture` 呼叫數；Sentry 三份設定；SDK 預設值（`node_modules/@sentry/core/build/types/types/datacollection.d.ts`）；`gh api` 取得的 repo 權限、branch protection、environments、fork 核准政策、security_and_analysis；`npm ls braces`、`npm view`；lockfile 統計；24 個 workflow 的 `permissions`／`timeout`／`concurrency`／環境。

未驗證：Vercel 專案設定（方案、區域、環境變數、production branch）；Sentry 後台（alert rule、PII 設定、資料保留）；repo 外是否已有排程；`stackFrameVariables` 在 Node 端是否實際啟用；Turbopack 路徑下的 source map 上傳；CI 重複執行的節省數字（估計值，非實測）；`next build` 次數。
