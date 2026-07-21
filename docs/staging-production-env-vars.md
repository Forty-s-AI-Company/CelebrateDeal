# CelebrateDeal Staging / Production Env Vars 對照表

最後更新：2026-07-21

## 1. 使用原則

- 真實 secret 只放 Vercel Environment Variables、GitHub Actions Secrets 或本機 `.env.*.local`。
- 本 repo 只提交 `.env.example`、`.env.staging.example`、`.env.production.example`。
- `NEXT_PUBLIC_*` 會進瀏覽器 bundle，不可放 secret。
- Preview / staging 不可使用 production database 或 production PayUni credentials。

## 2. 對照表

| Key | Staging | Production | 來源 | 驗收標準 |
|---|---|---|---|---|
| `DATABASE_URL` | Supabase staging pooled/runtime URL | Supabase production pooled/runtime URL | Supabase Project Settings | `/api/health` DB ok |
| `DIRECT_URL` | Supabase staging direct URL | Supabase production direct URL | Supabase Project Settings | `npm run db:migrate:status` up to date |
| `NEXT_PUBLIC_APP_URL` | `https://staging-app...` | `https://app...` | Vercel domain | Email links / webhook URLs 正確 |
| `JOB_SECRET` | staging random secret | production random secret | Password manager | `/api/admin/preflight` Bearer token 可通過 |
| `CSRF_SECRET` | staging random secret | production 獨立 random secret | Password manager | preflight 通過；不得與 `JOB_SECRET` 共用 |
| `RATE_LIMIT_PROVIDER` | `cloudflare_waf` 或 `upstash_redis` | `cloudflare_waf` 或 `upstash_redis` | Cloudflare / Upstash | preflight 不得顯示 `memory`；Staging 實測 429 |
| `CLOUDFLARE_ACCOUNT_ID` | same or staging account | production account | Cloudflare dashboard | direct upload API 可建立 upload URL |
| `CLOUDFLARE_STREAM_TOKEN` | staging scoped token | production scoped token | Cloudflare API Tokens | 不在 client bundle 出現 |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | staging webhook secret | production webhook secret | Cloudflare Notifications | 假 secret webhook 會 401 |
| `PAYMENT_PROVIDER` | `payuni` | `payuni` | app config | preflight pass |
| `PAYUNI_HASH_KEY` | sandbox key | production key | PayUni dashboard | sandbox paid webhook 可驗簽 |
| `PAYUNI_HASH_IV` | sandbox IV | production IV | PayUni dashboard | sandbox paid webhook 可驗簽 |
| `PAYUNI_MERCHANT_ID` | sandbox merchant | production merchant | PayUni dashboard | checkout metadata 正確 |
| PayUni callback 驗證 | 使用 Sandbox Hash Key / Hash IV | 使用 Production Hash Key / Hash IV | PayUni 商店串接設定 | `EncryptInfo` 與 `HashInfo` 驗證通過 |
| `RESEND_API_KEY` | staging key | production key | Resend dashboard | test email delivered |
| `EMAIL_FROM` | staging sender | production sender | Resend verified domain | SPF / DKIM / DMARC pass |
| `SMOKE_TEST_EMAIL` | 單一測試收件信箱 | 單一受控維運信箱（非必要可不啟用 smoke） | 維運設定 | 其他收件人呼叫 test-email 必須回 403 |
| `SENTRY_DSN` | staging DSN | production DSN | Sentry project | ops monitoring test issue appears |
| `NEXT_PUBLIC_SENTRY_DSN` | staging public DSN | production public DSN | Sentry project | client global error can report |
| `SENTRY_ORG` | org slug | org slug | Sentry | source map upload enabled |
| `SENTRY_PROJECT` | staging project slug | production project slug | Sentry | release/source maps visible |
| `SENTRY_AUTH_TOKEN` | staging upload token | production upload token | Sentry auth token | build can upload source maps |
| `NEXT_PUBLIC_POSTHOG_KEY` | staging project key | production project key | PostHog | `production_smoke_test` event appears |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog host | PostHog host | PostHog | capture API 200 |

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

預設 `external:smoke` 不會建立 Cloudflare Live Input 或 payment transaction。若要測會產生狀態的流程：

```bash
RUN_CLOUDFLARE_SMOKE=true npm run external:smoke
RUN_DEMO_PAYMENT_WEBHOOK_SMOKE=true SMOKE_VENDOR_SLUG=your-vendor npm run external:smoke
```
