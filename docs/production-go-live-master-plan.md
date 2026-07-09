# CelebrateDeal 正式 MVP 全 Phase 上線總控表

最後更新：2026-07-09

## 0. 原則

這份文件把 Phase 0 到 Phase 6 合併成一次性上線總控表。後續不再用「每次只做一個 Phase」的節奏，而是照本文件一路推到可收費 MVP。

狀態定義：

- `Done in repo`：專案內可完成的程式碼、文件、migration、檢查機制已完成。
- `External required`：需要登入 Cloudflare、Vercel、Supabase、PayUni、Resend、Sentry、PostHog 等外部服務才能完成。
- `Ready for credential`：程式碼骨架已完成，只等真實憑證或外部設定。

## 1. Phase 0：上線前整理

| 任務 | 狀態 | 驗收方式 |
|---|---|---|
| 確認正式網域 | External required | 決定正式 root domain、app domain、email domain |
| 確認 Cloudflare 帳號 | External required | zone、WAF、Stream 可用 |
| 確認 Vercel 專案 | External required | GitHub repo 已連線，production branch 已設定 |
| 確認 Supabase 專案 | External required | production / staging project 已建立 |
| 確認 PayUni sandbox / production | External required | sandbox credentials 與 production 申請時程確認 |
| 確認 Email domain | External required | SPF / DKIM / DMARC 可設定 |

## 2. Phase 1：資料庫正式化

| 任務 | 狀態 | 驗收方式 |
|---|---|---|
| Prisma SQLite 改 PostgreSQL | Done in repo | `prisma/schema.prisma` provider 已為 `postgresql` |
| Supabase `DATABASE_URL` / `DIRECT_URL` | Ready for credential | `.env.example` 與 runbook 已定義 |
| PostgreSQL baseline migration | Done in repo | `prisma/migrations/20260709090000_postgresql_baseline` |
| 舊 SQLite migration 歸檔 | Done in repo | `prisma/migrations_sqlite_archive` |
| Production seed policy | Done in repo | `SEED_MODE=production-bootstrap` 非破壞性 upsert |
| Backup / rollback runbook | Done in repo | `docs/production-database-runbook.md` |

## 3. Phase 2：部署與環境變數

| 任務 | 狀態 | 驗收方式 |
|---|---|---|
| Vercel production env vars | Ready for credential | `.env.example` 已列出必要 keys |
| Production env validation | Done in repo | `src/lib/env.ts` |
| Preflight CLI | Done in repo | `npm run preflight` |
| Admin preflight API | Done in repo | `GET /api/admin/preflight` with Bearer `JOB_SECRET` |
| Health check API | Done in repo | `GET /api/health` |
| Cloudflare DNS / custom domain | External required | Cloudflare / Vercel dashboard 完成 |
| Build / deploy 驗證 | Done in repo | CI 使用 PostgreSQL service，跑 migration / lint / typecheck / test |
| 本機 preflight 驗證 | Done in repo | `npm run preflight` 使用完整測試 env 通過 |

## 4. Phase 3：Cloudflare Stream 串接

| 任務 | 狀態 | 驗收方式 |
|---|---|---|
| Cloudflare Stream service layer | Done in repo | `src/lib/cloudflare-stream.ts` |
| Direct creator upload API | Done in repo | `POST /api/cloudflare/direct-upload` |
| Stream webhook API | Done in repo | `POST /api/cloudflare/stream-webhook` |
| Live Input API | Done in repo | `POST /api/cloudflare/live-inputs` |
| Stream UID / playback 欄位 | Done in repo | `Video` / `Live` schema 已有欄位 |
| 實際 Cloudflare API smoke test | External required | 需 Cloudflare token |
| Usage estimation | Partial | 已有 `usage_records` 與 billing 計算，仍需接 Cloudflare 真實用量 |

## 5. Phase 4：PayUni 金流正式串接

| 任務 | 狀態 | 驗收方式 |
|---|---|---|
| Provider adapter 架構 | Done in repo | `src/lib/payment-providers/**` |
| PayUni adapter | Done in repo | `src/lib/payment-providers/payuni.ts` |
| Payment webhook route | Done in repo | `POST /api/webhooks/payments` |
| Webhook signature 骨架 | Done in repo | PayUni HashKey / HashIV 或 webhook secret 驗證 |
| Checkout API scaffold | Done in repo | `POST /api/payments/checkout` |
| Refund webhook / reconciliation | Done in repo | `refund_records`、commission adjustment、webhook detail |
| PayUni sandbox 端對端測試 | External required | 需 PayUni sandbox credentials |
| PayUni production 審核 | External required | 需商務申請完成 |

## 6. Phase 5：Email / Monitoring / Analytics

| 任務 | 狀態 | 驗收方式 |
|---|---|---|
| Resend service layer | Done in repo | `src/lib/email.ts` |
| Product analytics service layer | Done in repo | `src/lib/product-analytics.ts` |
| Analytics API 同步 PostHog | Done in repo | `src/app/api/analytics/route.ts` |
| Monitoring abstraction | Done in repo | `src/lib/monitoring.ts` |
| Sentry SDK 實際安裝 | Ready for credential | 需 Sentry project / DSN，之後可接 SDK |
| Resend domain verification | External required | DNS records |
| PostHog project setup | External required | project key |
| Alert rules | External required | Sentry / Vercel / Supabase / Cloudflare dashboards |

## 7. Phase 6：Go-live Checklist

| 任務 | 狀態 | 驗收方式 |
|---|---|---|
| Smoke test route set | Done in repo | `/api/health`、核心 routes build 成功 |
| Payment test | Ready for credential | 需 PayUni sandbox |
| Webhook test | Ready for credential | 需 PayUni sandbox event |
| Live page test | Ready for credential | 需 Cloudflare Stream asset |
| Backup restore drill | External required | 需 Supabase staging / restore project |
| Rollback plan | Done in repo | `docs/production-database-runbook.md` |

## 8. 一次性執行順序

1. 先補齊外部服務帳號：Cloudflare、Vercel、Supabase、PayUni、Resend、Sentry、PostHog。
2. 把 production / staging env vars 填入 Vercel 與 GitHub Actions secrets。
3. 對 Supabase staging 執行 `npm run db:migrate:deploy`。
4. 對 staging 跑 `npm run preflight` 與 `/api/admin/preflight`。
5. 串 Cloudflare Stream direct upload，建立第一支測試影片。
6. 串 PayUni sandbox checkout 與 webhook。
7. 串 Resend 測試信。
8. 串 Sentry / PostHog，確認 error / event 有進 dashboard。
9. 完成 Supabase restore drill。
10. 對 production 重跑 migration、preflight、smoke test。

## 9. 可收費 MVP 最後門檻

以下項目沒有通過，不建議正式收費：

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run db:migrate:status`
- `npm run preflight`
- `/api/health`
- `/api/admin/preflight`
- PayUni sandbox paid / refunded webhook
- Cloudflare Stream upload / ready webhook
- Resend test email
- Sentry error test
- Supabase backup restore drill
