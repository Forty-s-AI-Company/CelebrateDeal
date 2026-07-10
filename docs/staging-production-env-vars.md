# CelebrateDeal Staging / Production Env Vars 對照表

最後更新：2026-07-09

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
| `CLOUDFLARE_ACCOUNT_ID` | same or staging account | production account | Cloudflare dashboard | direct upload API 可建立 upload URL |
| `CLOUDFLARE_STREAM_TOKEN` | staging scoped token | production scoped token | Cloudflare API Tokens | 不在 client bundle 出現 |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | staging webhook secret | production webhook secret | Cloudflare Notifications | 假 secret webhook 會 401 |
| `PAYMENT_PROVIDER` | `payuni` | `payuni` | app config | preflight pass |
| `PAYUNI_HASH_KEY` | sandbox key | production key | PayUni dashboard | sandbox paid webhook 可驗簽 |
| `PAYUNI_HASH_IV` | sandbox IV | production IV | PayUni dashboard | sandbox paid webhook 可驗簽 |
| `PAYUNI_MERCHANT_ID` | sandbox merchant | production merchant | PayUni dashboard | checkout metadata 正確 |
| `PAYUNI_WEBHOOK_SECRET` | sandbox webhook secret | production webhook secret | Password manager | webhook signature pass |
| `RESEND_API_KEY` | staging key | production key | Resend dashboard | test email delivered |
| `EMAIL_FROM` | staging sender | production sender | Resend verified domain | SPF / DKIM / DMARC pass |
| `SENTRY_DSN` | staging DSN | production DSN | Sentry project | ops monitoring test issue appears |
| `NEXT_PUBLIC_SENTRY_DSN` | staging public DSN | production public DSN | Sentry project | client global error can report |
| `SENTRY_ORG` | org slug | org slug | Sentry | source map upload enabled |
| `SENTRY_PROJECT` | staging project slug | production project slug | Sentry | release/source maps visible |
| `SENTRY_AUTH_TOKEN` | staging upload token | production upload token | Sentry auth token | build can upload source maps |
| `NEXT_PUBLIC_POSTHOG_KEY` | staging project key | production project key | PostHog | `production_smoke_test` event appears |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog host | PostHog host | PostHog | capture API 200 |

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
