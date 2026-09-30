# CelebrateDeal Staging / Production Env Vars 對照表

最後更新：2026-10-01

## 1. 使用原則

- 真實 secret 只放 Vercel Environment Variables、GitHub Actions Secrets 或本機 `.env.*.local`。
- 本 repo 只提交 `.env.example`、`.env.staging.example`、`.env.production.example`。
- `NEXT_PUBLIC_*` 會進瀏覽器 bundle，不可放 secret。
- Preview / staging 不可使用 production database。經商店權限核對與隔離審查後，指定 staging 才可暫時使用 CelebrateDeal 正式 PAYUNi 商店做真實小額測試。

## 2. 對照表

| Key | Staging | Production | 來源 | 驗收標準 |
|---|---|---|---|---|
| `DATABASE_URL` | Supabase staging pooled/runtime URL | Supabase production pooled/runtime URL | Supabase Project Settings | `/api/health` DB ok |
| `DIRECT_URL` | Supabase staging direct URL | Supabase production direct URL | Supabase Project Settings | `npm run db:migrate:status` up to date |
| `NEXT_PUBLIC_APP_URL` | `https://staging-app...` | `https://app...` | Vercel domain | Email links / webhook URLs 正確 |
| `JOB_SECRET` | staging random secret | production random secret | Password manager | `/api/admin/preflight` Bearer token 可通過 |
| `CRON_SECRET` | staging random secret | production random secret | Password manager | Vercel Cron 對 `/api/jobs/email-deliveries` 的 Bearer 驗證可通過；不得輸出值 |
| `CSRF_SECRET` | staging random secret | production 獨立 random secret | Password manager | preflight 通過；不得與 `JOB_SECRET` 共用 |
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

指定 staging 的目標設定是 `PAYUNI_ENV=production`，使用 CelebrateDeal 正式商店；平台三個方案 Starter、Growth、Team / Pro 的測試月費分別為 NT$1、NT$2、NT$3，正式站維持原價。這是待實作與待驗證的部署目標，**目前不能只修改 Vercel 環境變數就開始方案付款**：程式仍拒絕 Preview + 正式 PAYUNi 的一般 checkout，方案金額仍由資料庫 `BillingPlan.monthlyPriceCents` 決定。必須先完成隔離的 staging 資料庫價格設定、僅允許指定測試商家的方案結帳路徑，以及測試與部署檢查；不得修改正式資料庫的方案價格。現有「首筆 1 元綁卡＋第二筆 1 元扣款」探針是另一條受控流程，不能視為三方案付款已通過。

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
