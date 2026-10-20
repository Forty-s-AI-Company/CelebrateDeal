# CelebrateDeal Staging / Production Env Vars 對照表

最後更新：2026-10-19

## 1. 使用原則

- 真實 secret 只放 Vercel Environment Variables、GitHub Actions Secrets 或本機 `.env.*.local`。
- 本 repo 只提交 `.env.example`、`.env.staging.example`、`.env.production.example`。
- `NEXT_PUBLIC_*` 會進瀏覽器 bundle，不可放 secret。
- Preview / staging 不可使用 production database。經商店權限核對與隔離審查後，指定 staging 才可暫時使用 CelebrateDeal 正式 PAYUNi 商店做真實小額測試。

## 2. 對照表

| Key | Staging | Production | 來源 | 驗收標準 |
|---|---|---|---|---|
| `DATABASE_URL` | Supabase staging transaction pooler（6543）＋`pgbouncer=true&connection_limit=<N>` | Supabase production transaction pooler（6543）＋`pgbouncer=true&connection_limit=<N>` | Supabase Project Settings | `/api/health` DB ok；preflight 的 `DATABASE_POOLER*`、`DATABASE_CONNECTION_LIMIT` 為 PASS（見 §6） |
| `EXPECTED_FUNCTION_REGION` | 選填；只用來驗證，與 Vercel 設定檔的 `regions` 不一致時警告 | 選填；同左。**設這個值不會換區域**，換區域必須改 Production 實際讀取的 Vercel 設定檔 | 部署設定 | preflight `FUNCTION_REGION`／`DATABASE_REGION` 為 PASS |
| `VERCEL_CONFIG_FILE` | `vercel.staging.json`（由 staging 的 buildCommand 設定） | 不設（讀 `vercel.json`） | 部署設定 | 只接受 `vercel.json`、`vercel.staging.json`；其他值一律改讀 `vercel.json` |
| `DATABASE_REGION` | 選填；AWS 區域 ID，例如 `ap-northeast-1` | 選填；例如 `ap-south-1` | Supabase Project Settings | 只在 `DATABASE_URL` 不是 Supabase pooler 網址、無法推得區域時需要 |
| `DIRECT_URL` | Supabase staging direct URL | Supabase production direct URL | Supabase Project Settings | `npm run db:migrate:status` up to date |
| `NEXT_PUBLIC_APP_URL` | `https://staging-app...` | `https://app...` | Vercel domain | Email links / webhook URLs 正確 |
| `JOB_SECRET` | staging random secret | production random secret | Password manager | `/api/admin/preflight` Bearer token 可通過 |
| `CRON_SECRET` | staging random secret | production random secret | Password manager | Vercel Cron 對 `/api/jobs/email-deliveries` 的 Bearer 驗證可通過；不得輸出值 |
| `CSRF_SECRET` | staging random secret | production 獨立 random secret | Password manager | preflight 通過；不得與 `JOB_SECRET` 共用。**這是應用層資料加密根金鑰：禁止輪替；備份時必須一併保存對應版本**（見 §7） |
| `LIVE_CHAT_INGRESS_SECRET` | staging random secret，至少 32 字元 | production random secret，至少 32 字元 | Password manager＋edge secret store | preflight 通過；不得輸出或進入 client bundle |
| `RATE_LIMIT_PROVIDER` | `cloudflare_waf` 或 `upstash_redis` | `cloudflare_waf` 或 `upstash_redis` | Cloudflare / Upstash | preflight 不得顯示 `memory`；Staging 實測 429 |
| `CLOUDFLARE_ACCOUNT_ID` | same or staging account | production account | Cloudflare dashboard | direct upload API 可建立 upload URL |
| `CLOUDFLARE_STREAM_TOKEN` | staging scoped token | production scoped token | Cloudflare API Tokens | 不在 client bundle 出現 |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | staging webhook secret | production webhook secret | Cloudflare Notifications | 假 secret webhook 會 401 |
| `PAYMENT_PROVIDER` | `payuni` | `payuni` | app config | preflight pass |
| `PAYUNI_ENV` | `sandbox`；隔離的一次性正式測試可設 `production` | `production` | 部署設定 | 同時選擇 API 網址與整組商店金鑰 |
| `PAYUNI_SANDBOX_MERCHANT_ID`、`PAYUNI_SANDBOX_HASH_KEY`、`PAYUNI_SANDBOX_HASH_IV` | Sandbox 商店完整一組 | 可保留供切換 | PAYUNi Sandbox 後台 | `PAYUNI_ENV=sandbox` 時專用，缺一即拒絕交易 |
| `PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV` | 僅隔離正式 1 元測試需要 | CelebrateDeal 正式商店完整一組 | PAYUNi 正式後台 | `PAYUNI_ENV=production` 時專用，缺一即拒絕交易 |
| PayUni callback 驗證 | 使用所選 Sandbox Hash Key / Hash IV | 使用所選 Production Hash Key / Hash IV | PAYUNi 商店串接設定 | `EncryptInfo` 與 `HashInfo` 驗證通過 |
| `PAYUNI_REFUND_HOLD_RELEASE_CONFIRMATIONS`、`PAYUNI_REFUND_HOLD_RELEASE_WINDOW_HOURS`、`PAYUNI_REFUND_HOLD_CONFIRMATION_INTERVAL_HOURS` | 可不設（預設 3 次、24 小時、6 小時） | 可不設（預設 3 次、24 小時、6 小時） | 財務政策 | F-046：結果不明的 PayUni 退款保留，只有保留建立超過時間窗後、且距上一次計數至少間隔設定小時數的「沒有退款」查詢才計數，連續達設定次數（含釋放當下那次）才可人工釋放；預設最早 36 小時。次數 2–20、時間窗 1–720 小時、間隔 1–168 小時，超出範圍或格式錯誤時用預設值 |
| `FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS` | 可不設（預設 5000000 分＝NT$50,000） | 可不設（預設 5000000 分＝NT$50,000） | 財務政策 | F-049：月結人工調整的新值絕對值，或與現值的差額絕對值，任一超過此值（分）時，需另一位平台管理員覆核後才生效；鎖單時未覆核的申請自動標為 `rejected_by_lock`；只接受非負整數，格式錯誤時用預設值 |
| `PAYUNI_CREDIT_FEE_BPS`、`PAYUNI_FEE_TAX_BPS` | 可不設（預設 280＝2.8%、500＝5%） | 依 PayUni 合約費率設定（預設 280、500） | PayUni 合約；**待會計師確認（D-30）** | F-040：PayUni paid 回呼沒有 NetAmount／GatewayFee 時，伺服器以「毛額 × 費率 ×（1＋手續費營業稅率）」計算 `gatewayFeeCents`，TWD 每筆四捨五入到整數元（分為 100 的倍數；捨入單位與方向**待會計師確認（D-30）**），`netAmountCents`＝毛額−手續費−平台費，交易 metadata 記 `feeSource: "contract_rate"`；provider 有回費用時一律用 provider 值（`feeSource: "provider"`）。合約費率只在交易首次沒有費用紀錄時寫入，之後不帶費用的 paid 重送或 retry 不會覆蓋（即使 env 費率已改）。費率 0–1000 bps、稅率 0–2000 bps，格式錯誤時用預設值。目前一律用信用卡費率，ATM／超商費率待 D-30 確認 |
| `RESEND_API_KEY` | staging key | production key | Resend dashboard | test email delivered |
| `EMAIL_FROM` | staging sender | production sender | Resend verified domain | SPF / DKIM / DMARC pass |
| `SMOKE_TEST_EMAIL` | 單一測試收件信箱 | 單一受控維運信箱（非必要可不啟用 smoke） | 維運設定 | 其他收件人呼叫 test-email 必須回 403 |
| `SENTRY_DSN` | staging DSN | production DSN | Sentry project | ops monitoring test issue appears |
| `NEXT_PUBLIC_SENTRY_DSN` | staging public DSN | production public DSN | Sentry project | client global error can report |
| `SENTRY_ENVIRONMENT` | `staging` | `production` | 手動設定 | server event environment tag 正確 |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `staging` | `production` | 手動設定 | client event environment tag 正確 |
| `SENTRY_ORG` | org slug | org slug | Sentry | source map upload enabled |
| `SENTRY_PROJECT` | staging project slug | production project slug | Sentry | release/source maps visible |
| `SENTRY_AUTH_TOKEN` | staging upload token | production upload token | Sentry auth token | build can upload source maps |
| `NEXT_PUBLIC_POSTHOG_KEY` | staging project key | production project key | PostHog | `production_smoke_test` event appears |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog host | PostHog host | PostHog | capture API 200 |

切換順序：先在 Sandbox 部署的 Secret 管理新增完整 `PAYUNI_SANDBOX_*` 三件組，再發布此程式。正式商店沿用 `PAYUNI_MERCHANT_ID`／`PAYUNI_HASH_KEY`／`PAYUNI_HASH_IV`；確認它們屬於 CelebrateDeal 正式商店後，才在目標環境將 `PAYUNI_ENV` 切成 `production`。切換不會自動取得或改寫金鑰。

## 2026-10-01 staging 正式金流測試決定

指定 staging 的目標設定是 `PAYUNI_ENV=production`，使用 CelebrateDeal 正式商店；平台三個方案 Starter、Growth、Team / Pro 的測試月費分別為 NT$1、NT$2、NT$3，正式站維持原價。受控程式路徑仍在草稿 PR #351；固定 staging 尚未切換。測試價格存於三筆獨立且停用的 staging 專用方案，原本三筆方案與正式站資料不改。`PAYUNI_STAGING_PLAN_TEST_ENABLED=true` 只在已審查的 Preview 部署使用；程式還會核對 staging 資料庫、指定商家、CelebrateDeal 商店代號及短效資料庫許可綁定的唯一部署 URL。一般商品／發票結帳與退款仍封鎖。完整順序見 [三方案正式金流 staging runbook](launch/payuni-staging-live-plan-test.md)。現有「首筆 1 元綁卡＋第二筆 1 元扣款」探針是另一條受控流程，不能視為三方案付款已通過。

PayUni 不另外設定 `PAYUNI_NOTIFY_URL`、`PAYUNI_RETURN_URL` 或自訂 webhook secret。每筆 UPP checkout 會從 `NEXT_PUBLIC_APP_URL` 組合 `ReturnURL` 與 `NotifyURL`，回傳則只接受官方 `EncryptInfo`、`HashInfo`、Hash Key 與 Hash IV 驗證。

## 3. Vercel 設定方式

建議用 Vercel Dashboard 設定，並分別套用：

- Production：正式網域與 production credentials。
- Preview：staging / preview credentials，可指定 `staging` branch。
- Development：本機開發可用 staging 或 mock credentials。

CLI 範例：

```bash
vercel env ls production
vercel env pull .env.production.local --environment=production --yes
vercel env pull .env.staging.local --environment=preview --yes
```

## 4. 本機 smoke test

```bash
npm run preflight
npm run external:smoke
```

`npm run build` 會先執行 preflight。Vercel Preview／Production 缺少 `CSRF_SECRET`、使用 `memory` rate limit，或公開網址仍是 localhost 時，build 會直接失敗；一般本機開發則維持可使用 localhost 與 memory provider。

## 5. Live chat ingress trust

Production／Preview 的 live chat route 使用專用 header `x-celebratedeal-live-chat-ingress` 作為 edge 入口 proof。Cloudflare Worker／Transform Rule 或 Vercel 前置 proxy 必須在每個請求覆寫該 header，值與 server-side `LIVE_CHAT_INGRESS_SECRET` 完全一致；app 只有在 proof 通過常數時間比較後，才會信任 `cf-connecting-ip` 或 `x-real-ip`。

- `cf-ray` 只是不可信 metadata，不能作為 proof。
- `RATE_LIMIT_PROVIDER` 只能選擇 Cloudflare／Vercel proxy 類型，不能單獨建立信任根。
- Edge 必須刪除使用者自行帶入的同名 header，並封鎖公開網路直接連到 origin；否則攻擊者可能繞過 edge 規則。
- 本機 runtime 只使用 `request.ip`，不讀取 proxy headers。
- `LIVE_CHAT_INGRESS_SECRET` 只放 server 與 edge secret store，不放 `NEXT_PUBLIC_*`、repo 或瀏覽器程式碼。

預設 `external:smoke` 不會建立 Cloudflare Live Input 或 payment transaction。若要測會產生狀態的流程：

```bash
RUN_CLOUDFLARE_SMOKE=true npm run external:smoke
RUN_DEMO_PAYMENT_WEBHOOK_SMOKE=true SMOKE_VENDOR_SLUG=your-vendor npm run external:smoke
```

## 6. 函式區域與連線池（F-090／B06-03）

- `vercel.json` 與 `vercel.staging.json` 都寫明 `"regions": ["hnd1"]`（東京）。staging 的 Supabase 專案在 `ap-northeast-1`，兩者同區。
- **已知跨區：Supabase production 專案在 `ap-south-1`（孟買）。** 若 Production 也讀 `vercel.json`，函式會在 `hnd1`、資料庫在孟買，每次資料庫往返多約 100 ms 以上（仍比 Vercel 預設的 `iad1` 近）。這需要 owner 二選一：把 Supabase production 遷到東京，或讓 Production 函式改用 `bom1`。在決定之前，preflight 會對 Production build 印出 `[WARN] DATABASE_REGION` 但不阻擋建置。
- 區域不寫死在程式裡：preflight 讀 Vercel 設定檔（預設 `vercel.json`，`VERCEL_CONFIG_FILE=vercel.staging.json` 時讀 staging 設定）的 `regions`，以它為準，因為設定檔會覆蓋 Dashboard。`EXPECTED_FUNCTION_REGION` 只用來驗證：兩者不一致就警告，資料庫比對仍用設定檔的區域；設定檔沒有 `regions` 時才以 `EXPECTED_FUNCTION_REGION` 描述 Dashboard 設定。資料庫區域由 Supabase pooler 主機名稱推得（只印區域 ID，不印主機），或由 `DATABASE_REGION` 指定。函式執行時另有 Vercel 注入的 `VERCEL_REGION`，有值時會一併比對。
- **Production 上線前，preflight 的 `DATABASE_REGION` 必須是 PASS**（PR #447 審查 m3）。若 owner 選 Production 改用 `bom1`，只改 Dashboard 會被 `vercel.json` 的 `regions` 蓋掉，必須改 Production 讀取的設定檔（或讓 Production 使用專屬設定）。是否把跨區從 WARN 升為 FAIL 會改變 build gate，需要 owner 同意。
- preflight 也會比對 `CRON_SECRET` 與 `JOB_SECRET`：兩者相同時警告（不印值），因為 GET／POST 排程入口的密鑰分離會失效。
- 連線池參數只放在 `DATABASE_URL`（`src/lib/db.ts` 不覆寫）：6543 transaction pooler、`pgbouncer=true`、`connection_limit` 從 3～5 起依負載測試調整。Migration 走 `DIRECT_URL`（session mode）。
- 這些檢查只在 `VERCEL_ENV` 是 `production` 或 `preview` 時執行，結果一律是 PASS／WARN，不改變 build 的 exit code。

## 7. `CSRF_SECRET` 是資料加密根金鑰（F-031①／B04-03）

`CSRF_SECRET` 的名稱容易讓人以為只管 CSRF token，實際上它是**應用層資料加密的根金鑰**：

- `src/lib/sensitive-data.ts` 的 `deriveSensitiveDataKey()` 以 `CSRF_SECRET` 經 HMAC-SHA256 依用途衍生 AES-256-GCM 金鑰與雜湊索引金鑰（沒有 `CSRF_SECRET` 時改用 `JOB_SECRET`）。
- 受影響的資料包含：MFA secret、LINE 憑證、訂單買家與收件個資、私訊、tracking token、學員通知、發票請求、交付網址，以及各種 token 雜湊與查詢用雜湊索引（例如 customerKeyHash、destinationKeyHash）。
- 密文格式只有 `v1`，沒有 key id，也沒有舊金鑰解密清單。銀行帳號另用 `BANK_ACCOUNT_KEYRING_JSON`，有輪替設計，不在此列。

因此：

1. **禁止輪替 `CSRF_SECRET`**，包括資安事件時。換掉它，上述密文會永久無法解密，雜湊索引全部對不上（GCM auth failure）。要能輪替，必須先完成 B04-03 ②③：獨立的 `DATA_ENCRYPTION_KEYRING`（含 key id、decrypt-only 舊金鑰）與可重跑的 re-encrypt 腳本。
2. **不可在已有資料的環境「補設」或「改設」**：某環境原本沒有 `CSRF_SECRET`、一直用 `JOB_SECRET` 加密，之後才補上 `CSRF_SECRET`，效果等同輪替。這種環境的 `JOB_SECRET` 也同樣不可輪替。
3. **備份必須一併保存對應版本**：每一份資料庫備份都要能對應到「備份當下」的 `CSRF_SECRET`（必要時含 `JOB_SECRET`）。金鑰存放在與備份分開的密碼管理器，記錄「哪一段期間的備份對應哪一版」；不得與備份檔放在同一處，不得寫進 repo、log、收據或聊天。
4. **還原時缺它，加密資料全部不可讀**：資料表與筆數都會還原成功，但所有加密欄位與雜湊查詢失效，等同遺失個資與 MFA。隔離還原演練必須用對應版本的金鑰抽查加密欄位可讀，見 `docs/production-backup-restore-runbook.md` §B 第 6 步與 §E。
5. staging 與 production 必須使用不同值；staging 值外洩不影響 production 資料。
