# Production 環境變數逐項勾選清單

- 日期：2026-11-03
- 依據來源：`docs/staging-production-env-vars.md` §2 對照表的 Production 欄位（最後更新 2026-10-19）與 §6、§7；`src/lib/env.ts`（preflight 的實際檢查項目與訊息）；`scripts/preflight.ts`；`.env.production.example`；`docs/goal-beta-prep-2026Q4/OWNER-ACTIONS.md`（O-4、O-6、O-7、O-15、O-26）；`docs/review-2026Q4/01-system-map.md`（R2 變數）；`docs/launch/payuni-live-one-time-probe.md`。
- 配套：[production-cutover-runbook.md](production-cutover-runbook.md) §S5。

## 使用方式

- **只有 owner 輸入值**。這份清單不含也不得填入任何金鑰值；回報只寫「設了」與「preflight 哪一項 PASS」。主對話不讀 Vercel 環境變數的值（`vercel env ls` 只看名稱存在與否）。
- 設定位置：Vercel → 專案 `celebrate-deal` → Settings → Environment Variables → **Production** 環境（不要勾 Preview、Development）。GitHub 的 secret 放在 `production` environment（見 runbook S2）。
- 驗收：Production build 會先執行 `npm run preflight`（`scripts/preflight.ts`）。輸出格式是 `[PASS]`／`[WARN]`／`[FAIL] <KEY>: <訊息>`，有任何 `[FAIL]` 時 build 直接失敗。下方「preflight」欄寫的是該項應出現的 key 與狀態。
- 「狀態」欄：`待 owner` 代表**目前無法得知是否已有值**（主對話無法讀取 Production 環境），請 owner 設定後回報；`不設` 代表刻意不設定。
- 不要把 Production 與 staging／Preview 的任何 secret 設成同值（`JOB_SECRET`、`CRON_SECRET`、`CSRF_SECRET`、`LIVE_CHAT_INGRESS_SECRET` 都要獨立）。

## A. 資料庫與部署

| ☐ | 變數 | 內容／來源 | 誰提供 | 驗收（preflight） | 狀態 |
|---|---|---|---|---|---|
| ☐ | `DATABASE_URL` | Supabase Production 的 transaction pooler（6543），帶 `pgbouncer=true&connection_limit=<N>`（N 從 3～5 起，依負載調整）。來源：Supabase Project Settings | owner | `DATABASE_URL: PASS`（必要）；缺 `pgbouncer=true` 或 `connection_limit` 會有 `[WARN] DATABASE_URL`，應消除；`/api/health` DB ok | 待 owner；若 O-15 選 A，連線字串是遷移後的新專案 |
| ☐ | `DIRECT_URL` | Supabase Production direct 或 session 連線 | owner | `DIRECT_URL: PASS`；`npm run db:migrate:status` up to date（正式 migration 走 `production-migrate.yml`，不從 Vercel 執行） | 待 owner |
| ☐ | `NEXT_PUBLIC_APP_URL` | Production 正式 HTTPS 網址（目前記錄的是 `https://celebratedeal.carry-digital-nomad.in.net`；改用其他網域時以新網域為準）。信件連結、PayUni 的 `ReturnURL`／`NotifyURL` 都由它組成 | owner | `NEXT_PUBLIC_APP_URL: PASS`；不得含 `localhost`，必須 HTTPS（否則 `[FAIL]`） | 待 owner（網域未最終確認，見子網域盤點） |
| ☐ | `EXPECTED_FUNCTION_REGION` | 選填。只用來驗證，**不會換區域** | owner | `FUNCTION_REGION: PASS` | 選填 |
| ☐ | `DATABASE_REGION` | 選填；只在 `DATABASE_URL` 不是 Supabase pooler 網址、推不出區域時需要（孟買 `ap-south-1`、東京 `ap-northeast-1`） | owner | **`DATABASE_REGION: PASS` 是 Production 上線前的必要項目**（`staging-production-env-vars.md` §6）。跨區未解決時會是 `[WARN]` | 待 O-15 |
| ☐ | `VERCEL_CONFIG_FILE` | Production **不設**（讀 `vercel.json`，`regions: ["hnd1"]`）。若 O-15 選 B（改 `bom1`），需要工程 PR 讓 Production 讀專用設定檔，且 `VERCEL_CONFIG_FILE` 只接受白名單檔名 | 工程 | 區域項目 PASS | 不設（A）／待 PR（B） |

## B. 排程與加密密鑰

三把密鑰必須互不相同，也都與 staging、Preview 不同。

| ☐ | 變數 | 內容／來源 | 誰提供 | 驗收（preflight） | 狀態 |
|---|---|---|---|---|---|
| ☐ | `JOB_SECRET` | 隨機字串（至少 16 字元；建議 32 bytes 以上）。密碼管理器。O-6(b)：Production 與 Preview 必須不同值 | owner | `JOB_SECRET: PASS`；`/api/admin/preflight` 的 Bearer 可通過；與 `CRON_SECRET` 相同會有 `[WARN]` | 待 owner |
| ☐ | `CRON_SECRET` | 隨機字串（至少 16 字元），Vercel Cron 的 GET 入口用 | owner | `CRON_SECRET: PASS` | 待 owner |
| ☐ | `CSRF_SECRET` | **資料加密根金鑰**，至少 32 bytes 隨機值，與 `JOB_SECRET` 不同、與 staging 不同。**禁止在有資料後輪替**（§7）。設定時機與條件見 runbook S8 | owner（Claude 不輸入、不產生、不經手） | `CSRF_SECRET: PASS`（訊息：已設定獨立且至少 32 bytes）；失敗訊息有「不得與 JOB_SECRET 共用」「至少 32 bytes」 | 待 owner；備份對應版本要記錄 |
| ☐ | `LIVE_CHAT_INGRESS_SECRET` | 隨機字串，32～上限字元，前後無空白、無換行。同一個值要放在 edge（Cloudflare Worker／Transform Rule）每個請求覆寫 `x-celebratedeal-live-chat-ingress` | owner | `LIVE_CHAT_INGRESS_SECRET: PASS` | 待 owner；edge 規則另需核對（O-7） |
| ☐ | `RATE_LIMIT_PROVIDER` | `cloudflare_waf` 或 `upstash_redis`。**不得是 `memory`，也不得留空**（Production build 會 `[FAIL]`） | owner | `RATE_LIMIT_PROVIDER` 不出現 `[FAIL]`；`/api/admin/preflight` 的 `rateLimit` 不是 memory；實測 429 | 待 owner；選 `cloudflare_waf` 需先確認 O-7（橘雲、無直連入口，否則限流可被偽造標頭繞過） |
| ☐ | `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` | 只有 `RATE_LIMIT_PROVIDER=upstash_redis` 時必要 | owner | 兩項 `PASS`，缺一 `[FAIL]` | 視選擇；`cloudflare_waf` 時不設 |

## C. 付款（PayUni）

**切換順序**（`staging-production-env-vars.md` §2 切換順序）：先確認 `PAYUNI_MERCHANT_ID`／`PAYUNI_HASH_KEY`／`PAYUNI_HASH_IV` 三件組屬於 **CelebrateDeal 正式商店**，才把 `PAYUNI_ENV` 設成 `production`。切換不會自動取得或改寫金鑰；只改 `PAYUNI_ENV` 而沒有正式三件組時，交易一律被拒絕（fail closed）。

建議順序：
1. owner 在 PayUni 正式後台確認這組商店就是 CelebrateDeal（不是 PureFit 等其他商店），並取得商店代號、Hash Key（32 bytes）、Hash IV（16 bytes）。
2. owner 設定 `PAYMENT_PROVIDER=payuni`。
3. owner 設定 `PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV`。
4. 最後才設定 `PAYUNI_ENV=production`。
5. 部署後看 preflight：`PAYUNI_ENV`、`PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV` 四項都是 PASS，才算完成。

| ☐ | 變數 | 內容／來源 | 誰提供 | 驗收（preflight） | 狀態 |
|---|---|---|---|---|---|
| ☐ | `PAYMENT_PROVIDER` | `payuni`。Production 只允許這個值（`demo` 等會 `[FAIL]`） | owner | `PAYMENT_PROVIDER: PASS` | 待 owner |
| ☐ | `PAYUNI_ENV` | `production` | owner | `PAYUNI_ENV: PASS`（訊息：與 production deployment boundary 一致）；不是 `production` 會 `[FAIL]` | 待 owner；最後一個設定 |
| ☐ | `PAYUNI_MERCHANT_ID` | CelebrateDeal 正式商店代號。PayUni 正式後台 | owner | `PAYUNI_MERCHANT_ID: PASS` | 待 owner（O-1 與商店權限需另行核對） |
| ☐ | `PAYUNI_HASH_KEY` | 正式 Hash Key，必須剛好 32 bytes | owner | `PAYUNI_HASH_KEY: PASS`（長度不符為 `[FAIL]`） | 待 owner |
| ☐ | `PAYUNI_HASH_IV` | 正式 Hash IV，必須剛好 16 bytes | owner | `PAYUNI_HASH_IV: PASS` | 待 owner |
| ☐ | `PAYUNI_SANDBOX_MERCHANT_ID`、`PAYUNI_SANDBOX_HASH_KEY`、`PAYUNI_SANDBOX_HASH_IV` | 可保留供切換；`PAYUNI_ENV=production` 時不使用 | owner | 無（Production 不檢查） | 選填；建議不放，降低誤切換風險 |
| ☐ | PayUni 回呼 URL | **不需要另外設定** `PAYUNI_NOTIFY_URL`、`PAYUNI_RETURN_URL` 或 webhook secret：每筆 UPP checkout 由 `NEXT_PUBLIC_APP_URL` 組出 `ReturnURL`、`NotifyURL`；回呼只接受官方 `EncryptInfo`／`HashInfo` 驗證。PayUni 文件規定 NotifyURL 只能用 80 或 443 埠 | — | 回呼簽章驗證通過（見 [payuni-tradestatus-mapping.md](payuni-tradestatus-mapping.md)） | 是否需在 PayUni 正式後台登記網域或來源 IP：**待 owner 向 PayUni 確認** |
| ☐ | `PAYUNI_CREDIT_FEE_BPS`、`PAYUNI_FEE_TAX_BPS` | 依 PayUni 合約費率；預設 280、500。**待會計師確認（D-30）** | owner＋會計師 | 無（格式錯誤用預設值） | 待 D-30；封測不影響 |
| ☐ | `PAYUNI_REFUND_HOLD_RELEASE_*`、`FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS` | 財務政策預設值（3 次／24 小時／6 小時；NT$50,000） | owner | 無 | 可不設 |
| ☐ | `PAYMENT_WEBHOOK_MAX_RETRIES` | `.env.production.example` 列 5；webhook 重試上限 | owner | 無 | 可不設 |
| ☐ | `ECPAY_WEBHOOK_SECRET` | 不使用 | — | — | 不設 |
| ☐ | `PAYUNI_LIVE_PROBE_*`、`PAYUNI_STAGING_PLAN_TEST_ENABLED`、`WP4_SANDBOX_EXECUTOR_ENABLED` | 只屬 staging／Preview 的受控測試；**Production 不設** | — | — | 不設 |

**正式收款前另有工程 gate**（不是環境變數，但同屬上線條件）：RR-03、R448-03、B03-07，見 [production-cutover-runbook.md](production-cutover-runbook.md) S0。

## D. Email（Resend）

| ☐ | 變數 | 內容／來源 | 誰提供 | 驗收（preflight） | 狀態 |
|---|---|---|---|---|---|
| ☐ | `RESEND_API_KEY` | Resend dashboard 的 **Production 專用** key（與 staging 不同） | owner | `RESEND_API_KEY: PASS`；測試信送達 | 待 owner |
| ☐ | `EMAIL_FROM` | 正式寄件人，單一有效地址，可用「名稱 <email>」格式，例如 `CelebrateDeal <no-reply@<正式寄件網域>>`。`.env.production.example` 的 `celebratedeal.com` 只是範例，**正式寄件網域未確認** | owner | `EMAIL_FROM: PASS`（格式錯誤時為 `[FAIL]`） | 待 owner（網域待定） |
| ☐ | 寄件網域 DNS | 在 Resend 驗證該網域，並在 Cloudflare DNS 建立：**SPF**（TXT，包含 Resend 的 include）、**DKIM**（Resend 提供的 CNAME／TXT）、**DMARC**（`_dmarc` TXT，先 `p=none` 觀察，穩定後收緊）。記錄值由 Resend 後台產生，照抄 | owner | Resend 後台網域狀態 Verified；寄測試信，檢視原始標頭 `spf=pass`、`dkim=pass`、`dmarc=pass`（`staging-production-env-vars.md`：SPF／DKIM／DMARC pass） | 待 owner；`mail.`、`send.` 類子網域也要列入 [子網域盤點](subdomain-inventory.md) |
| ☐ | `SMOKE_TEST_EMAIL` | 單一受控維運信箱（其他收件人呼叫 test-email 一律 403） | owner | `SMOKE_TEST_EMAIL: PASS`（缺少或格式錯誤為 `[WARN]`） | 待 owner；沒有 smoke 需求可不設 |

驗證信（商家 Email 驗證、24 小時有效）依賴本節，信件送不出去時商家無法驗證。

## E. 監控與分析

| ☐ | 變數 | 內容／來源 | 誰提供 | 驗收（preflight） | 狀態 |
|---|---|---|---|---|---|
| ☐ | `SENTRY_DSN` | Sentry **production 專案**的 DSN | owner | `SENTRY_DSN: PASS`（必要，缺少為 `[FAIL]`）；測試事件出現在 production 專案 | 待 owner |
| ☐ | `NEXT_PUBLIC_SENTRY_DSN` | 同專案的 public DSN | owner | `NEXT_PUBLIC_SENTRY_DSN: PASS`（缺少為 `[WARN]`）；client 全域錯誤可回報 | 待 owner |
| ☐ | `SENTRY_ENVIRONMENT`、`NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production`（1–64 個英數、點、底線、連字號） | owner | 兩項 `PASS`；事件 tag 正確 | 待 owner |
| ☐ | `SENTRY_ORG`、`SENTRY_PROJECT`、`SENTRY_AUTH_TOKEN` | production 專案的 org slug、project slug、source map 上傳 token | owner | 三項 `PASS`（缺少為 `[WARN]`）；release／source map 可見 | 待 owner |
| ☐ | Sentry 告警規則（O-17） | 為 `webhook_retry_requires_attention`、`webhook-retry exhausted`、`InventoryUnavailableError` 建立 Production 專案的 alert rule，通知 owner | owner | 建立後觸發一筆測試 | 待 owner |
| ☐ | `NEXT_PUBLIC_POSTHOG_KEY`、`NEXT_PUBLIC_POSTHOG_HOST` | PostHog production 專案 key 與 host。**這兩項在 preflight 是必要項目，缺少為 `[FAIL]`，會讓 build 失敗** | owner | 兩項 `PASS`；`production_smoke_test` 事件出現；capture API 200 | 待 owner |

## F. 註冊與機器人防護（O-26）

| ☐ | 變數 | 內容／來源 | 誰提供 | 驗收（preflight） | 狀態 |
|---|---|---|---|---|---|
| ☐ | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` | 在 Cloudflare Dashboard → Turnstile 建立 widget（Managed），Hostname 加入正式網域。**兩個必須同時設定**，只設一個會讓註冊與重寄驗證信全部失敗，preflight 也 `[FAIL]`。Cloudflare 公開的測試金鑰（`1x0000…`）在 Production 一律拒絕 | owner | `TURNSTILE_SECRET_KEY: PASS`（已設定站點金鑰與伺服器金鑰）；`/register` 看得到「確認你是真人」元件 | 待 owner（staging 已於 2026-10-25 完成，Production 尚未）；邀請制封測可稍後，但**開放公開註冊前必做** |
| ☐ | `TURNSTILE_ALLOWED_HOSTNAMES` | 選填；要額外接受的網域 | owner | — | 不設 |
| ☐ | `REGISTRATION_MODE` | **不設定**（未設定＝邀請制）。只有在 Turnstile 與寄信都就緒、owner 決定開放公開註冊時才設成 `open`；缺 Turnstile 或寄信設定就設 `open` 時 preflight `[FAIL]` | owner | `REGISTRATION_MODE: PASS`（訊息：商家註冊僅限平台邀請） | 不設 |

## G. 媒體（Cloudflare Stream 與 R2）

| ☐ | 變數 | 內容／來源 | 誰提供 | 驗收（preflight） | 狀態 |
|---|---|---|---|---|---|
| ☐ | `CLOUDFLARE_ACCOUNT_ID` | Production 的 Cloudflare account | owner | 三項要**同時存在或同時不存在**；部分存在為 `[FAIL]`；全不存在為 `[WARN]`（Stream 功能安全停用） | 待 owner |
| ☐ | `CLOUDFLARE_STREAM_TOKEN` | **Production 專用** scoped API token（Stream 權限），不得沿用 staging 的 token。不得出現在 client bundle | owner | `CLOUDFLARE_STREAM_TOKEN: PASS`；`/api/admin/preflight` 的 Cloudflare 診斷 ready；direct upload 可建立 upload URL | 待 owner（O-26 清單中的「Cloudflare Stream 正式 token」） |
| ☐ | `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | Cloudflare Notifications 的 webhook signing secret（正式驗證用官方 `Webhook-Signature`；`x-cloudflare-stream-webhook-secret` fallback 只給 staging／local smoke） | owner | `CLOUDFLARE_STREAM_WEBHOOK_SECRET: PASS`；假簽章 webhook 回 401 | 待 owner |
| ☐ | `CLOUDFLARE_R2_ACCOUNT_ID`、`CLOUDFLARE_R2_ACCESS_KEY_ID`、`CLOUDFLARE_R2_SECRET_ACCESS_KEY`、`CLOUDFLARE_R2_BUCKET`、`CLOUDFLARE_R2_PUBLIC_BASE_URL` | 商家圖片上傳用 R2。Production 用 `celebrate-deal` bucket（staging 是 `celebrate-deal-staging`，不可共用）。**這組不在 `staging-production-env-vars.md` §2 對照表內**，依 `01-system-map.md` 補列 | owner | 圖片上傳與公開讀取 smoke；preflight 無對應項目 | 待 owner；是否啟用圖片上傳功能需 owner 決定 |
| ☐ | `CELEBRATEDEAL_MEDIA_ORIGIN` | 瀏覽器直播媒體來源。封測隱藏瀏覽器直播（D-09），**不設** | — | `live-media` 排程不啟用 | 不設 |

## H. 維運 smoke 與其他

| ☐ | 變數 | 內容／來源 | 誰提供 | 驗收 | 狀態 |
|---|---|---|---|---|---|
| ☐ | `OPS_SMOKE_SECRET` | F-016：provider smoke 端點（`/api/admin/ops/test-email`、`test-analytics`、`test-monitoring`、`/api/admin/ops/cloudflare/*`、`/api/cloudflare/{direct-upload,live-inputs}`）專用 Bearer。至少 32 字元隨機值，與 `JOB_SECRET`／`CRON_SECRET`／`CSRF_SECRET` 都不同、與 staging 不同。未設定時這些端點一律 401（不會退回 `JOB_SECRET`） | owner | 未設定：`OPS_SMOKE_SECRET: PASS`（端點關閉）；已設定：`[WARN]`「Production 已開啟 smoke 端點」；值太短或與其他密鑰相同為 `[FAIL]` | **預設不設**；只在上線後的外部服務驗證（例如 Resend 測試信）期間暫設，完成後移除 |
| ☐ | `SMOKE_VENDOR_ID` | F-016：Cloudflare smoke 一律綁定這個 vendor（呼叫端帶其他 `vendorId` 回 403，未設定回 503）。指向 Production 專用的 smoke vendor，不可是真實商家 | owner | 只在 `OPS_SMOKE_SECRET` 已設定時檢查；缺少為 `[WARN]` | 只在 Cloudflare smoke 期間與 `OPS_SMOKE_SECRET` 一起設定，完成後移除 |
| ☐ | `BANK_ACCOUNT_KEYRING_JSON` | 商家撥款帳號加密 keyring（`src/lib/bank-account.ts`）。封測期間不撥款；啟用撥款前必須設定，金鑰另存、含輪替設計 | owner | 撥款帳號 backfill／寫入功能可用 | 待 owner（撥款前） |
| ☐ | `DATA_RETENTION_ENABLED`、`DATA_RETENTION_*_DAYS` | 個資保存期限清理，預設關閉；O-21 待 owner 定案 | owner | — | 不設（O-21 定案後再開） |
| ☐ | `TARGET_APP_URL`、`SMOKE_VENDOR_SLUG`、`RUN_*_SMOKE` | 只給本機／CI 的 `external:smoke`（部署端的 `SMOKE_VENDOR_ID` 見上一列） | — | — | Production 不設 |

## I. 設定完成後的整體驗收

1. ☐ Production build log 的 preflight：無任何 `[FAIL]`；`[WARN]` 逐條說明原因（允許的 WARN：Sentry 選配項、`SMOKE_TEST_EMAIL` 若不做 smoke）。
2. ☐ `NEXT_PUBLIC_*` 清單只含：`NEXT_PUBLIC_APP_URL`、`NEXT_PUBLIC_SENTRY_DSN`、`NEXT_PUBLIC_SENTRY_ENVIRONMENT`、`NEXT_PUBLIC_POSTHOG_KEY`、`NEXT_PUBLIC_POSTHOG_HOST`、`NEXT_PUBLIC_TURNSTILE_SITE_KEY`（都不是 secret）。
3. ☐ 三把密鑰（`JOB_SECRET`、`CRON_SECRET`、`CSRF_SECRET`）兩兩不同，且與 staging 不同（owner 回報「不同」即可）。
4. ☐ Production 環境沒有任何 Sandbox 專用或 staging 專用變數殘留（`PAYUNI_LIVE_PROBE_*`、`PAYUNI_STAGING_PLAN_TEST_ENABLED`、`WP4_*`）。
5. ☐ `/api/admin/preflight`（Bearer）回 `ok: true`、`all_passed: true`（見 runbook S10）。

## J. 需要 owner 補的資料

1. 正式網域與正式寄件網域（影響 `NEXT_PUBLIC_APP_URL`、`EMAIL_FROM`、Turnstile hostname、Resend DNS）。
2. 所有「待 owner」項目目前是否已有值：主對話無法讀取 Production 環境，請 owner 逐項勾選。
3. PayUni 正式商店三件組是否已取得、是否確認屬於 CelebrateDeal 商店；PayUni 是否需登記回呼網域或來源 IP。
4. Sentry production 專案、PostHog production 專案是否已建立。
5. Cloudflare：Production 的 Stream token、R2 bucket 與 token，以及 Turnstile widget。
6. `RATE_LIMIT_PROVIDER` 選 `cloudflare_waf` 或 `upstash_redis`；選前者需 O-7 的答案。
7. `OPS_SMOKE_SECRET` 的最終名稱（等另一條線的 PR 合併）。
