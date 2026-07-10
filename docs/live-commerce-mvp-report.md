# Cloudflare-first Live Commerce MVP Report

## 1. 修正版產品架構摘要

CelebrateDeal 已從「基礎直播導購 MVP」修正為 Cloudflare-first 的直播導購自動化平台。

核心架構：

- 影音主幹：Cloudflare Stream / Stream Live 欄位已納入 `videos` 與 `lives`，支援 VOD 與 live input 共用前台播放頁。
- 自建前台：`/live/:slug` 自建播放、聊天、商品、報名 tabs，不依賴 YouTube 作為核心頁面。
- 導購節奏：`interaction_scripts` + `interaction_events` 以影片秒數觸發官方訊息、商品浮出、CTA 切換。
- 官方互動代理：`interaction_roles` 使用「AI 主持人」、「系統助手」、「官方角色」命名，不使用假帳號或洗留言語意。
- 來源追蹤：`affiliates` + `affiliate_clicks` 支援 `?ref=` 推廣碼追蹤。
- 風險控管：`blacklists` 支援 email / phone / IP / visitorId 管理，表單提交會阻擋封鎖中的 email / phone。
- 用量與計費：`billing_plans`、`vendor_usage_limits`、`usage_records` 支援方案、點數、串流分鐘、儲存分鐘與事件用量紀錄。
- 定價與月結：依 PRD 擴充 `vendor_subscriptions`、`invoices`、`settlements`、`payout_batches`、`payout_items`、`payment_accounts`、`payment_transactions`、`affiliate_commissions`、`affiliate_payouts`，保留平台統一金流與商家自帶金流兩種模式。

## 2. 修正版實作計畫

已完成：

- 在既有 Next.js App Router / Prisma 架構上擴充，沒有砍掉重做；資料庫已從 SQLite 開發模式切到 PostgreSQL baseline。
- Prisma schema 新增 Cloudflare、互動腳本、角色、黑名單、聯盟、用量與方案模型。
- 後台新增 routes：
  - `/interaction-scripts`
  - `/interaction-scripts/new`
  - `/interaction-scripts/:id/edit`
  - `/interaction-roles`
  - `/interaction-roles/new`
  - `/interaction-roles/:id/edit`
  - `/blacklists`
  - `/affiliates`
  - `/affiliates/new`
  - `/affiliates/:id/edit`
  - `/billing/usage`
  - `/billing/plans`
  - `/billing/invoices`
  - `/billing/settlements`
  - `/billing/payouts`
  - `/affiliates/:id`
  - `/affiliates/commissions`
  - `/admin/billing/settlements`
  - `/admin/billing/payouts`
  - `/admin/billing/payouts/:id/csv`
  - `/admin/billing/dashboard`
  - `/admin/billing/webhooks`
  - `/admin/billing/webhooks/:id`
  - `/api/webhooks/payments`
  - `/api/jobs/webhook-retry`
- Live room stepper 擴充為 8 步。
- 前台播放頁支援互動角色訊息、商品秒數浮出、CTA 切換、affiliate ref、play progress analytics。
- Dashboard 擴充為 Cloudflare-first 營運總覽。
- Auth 已從 demo vendor cookie 升級為資料庫 session MVP，支援 platform admin、vendor owner、accountant 權限分流。
- 新增第一個 platform admin 的獨立 bootstrap script，不透過 demo seed、不覆蓋 production data，可重複執行。
- 依 UX audit 完成第一輪產品體驗重構：
  - `interaction-script-form.tsx` 改為視覺化時間軸，支援 `MM:SS`，並提供 3 組常見導購節奏範本。
  - `live-playback.tsx` 改為手機直播感介面：影片滿版、聊天浮層、官方角色標籤、商品 Pop-up、浮動 CTA 與底部直播操作列。
  - 互動角色頁新增「匯入 10 個官方角色」入口，降低商家冷啟動成本。
  - live stepper 最後一步新增手機前台預覽 mockup。

下一階段建議：

- 串接 Cloudflare Stream API 建立 video upload、direct creator upload、live input、webhook ready 狀態。
- 強化正式 Auth：加入 rate limit、登入稽核、密碼重設、MFA 與可管理的 vendor member 邀請流程。
- 將互動腳本時間軸升級為可新增/刪除/拖拉排序的編輯器。
- 加入計費 provider 與 webhook，將 usage records 轉為可結算帳務。

## 3. 預計新增 / 修改的檔案清單

主要新增：

- `.github/workflows/ci.yml`
- `src/app/(app)/interaction-scripts/**`
- `src/app/(app)/interaction-roles/**`
- `src/app/(app)/blacklists/page.tsx`
- `src/app/(app)/affiliates/**`
- `src/app/(app)/billing/usage/page.tsx`
- `src/app/(app)/billing/plans/page.tsx`
- `src/app/(app)/billing/invoices/page.tsx`
- `src/app/(app)/billing/settlements/page.tsx`
- `src/app/(app)/billing/payouts/page.tsx`
- `src/app/admin/billing/settlements/page.tsx`
- `src/app/admin/billing/payouts/page.tsx`
- `src/app/admin/billing/payouts/[id]/csv/route.ts`
- `src/app/admin/billing/dashboard/page.tsx`
- `src/app/admin/billing/webhooks/page.tsx`
- `src/app/admin/billing/webhooks/[id]/page.tsx`
- `src/app/admin/layout.tsx`
- `src/app/api/webhooks/payments/route.ts`
- `src/app/api/jobs/webhook-retry/route.ts`
- `src/lib/audit.ts`
- `src/lib/billing.ts`
- `src/lib/payment-webhooks.ts`
- `src/lib/payment-webhooks.test.ts`
- `src/lib/payment-providers/**`
- `src/lib/webhook-retry.ts`
- `src/lib/reconciliation.ts`
- `scripts/bootstrap-platform-admin.ts`
- `vitest.config.ts`
- `src/app/api/affiliate-clicks/route.ts`
- `src/components/interaction-script-form.tsx`
- `src/components/interaction-role-form.tsx`
- `src/components/affiliate-form.tsx`

主要修改：

- `prisma/schema.prisma`
- `prisma/seed.ts`
- `src/app/actions.ts`
- `src/lib/auth.ts`
- `src/lib/password.ts`
- `src/app/login/page.tsx`
- `src/app/admin/layout.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/components/app-shell.tsx`
- `src/components/live-stepper-form.tsx`
- `src/components/live-playback.tsx`
- `src/components/video-form.tsx`
- `src/components/lead-form.tsx`
- `src/components/interaction-script-form.tsx`
- `src/components/interaction-role-form.tsx`
- `src/app/live/[slug]/page.tsx`
- `src/app/api/form-submissions/route.ts`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/lives/new/page.tsx`
- `src/app/(app)/lives/[id]/edit/page.tsx`
- `src/app/(app)/lives/[id]/preview/page.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`

## 4. 既有成果沿用與重構

沿用：

- Next.js App Router 專案結構
- Prisma + PostgreSQL baseline 資料層，舊 SQLite 本機資料已降為歷史 demo 參考
- Protected app shell 與既有後台資訊架構
- 原有核心 CRUD：影片、商品、表單、訊息模板、直播間
- 公開頁 `/live/:slug` 與 `/form/:slug`
- 基礎 analytics event API
- GitHub Actions CI

重構 / 擴充：

- `videos` 改為 Cloudflare-first，新增 Stream UID、Live Input UID、Playback ID、ready 狀態與估算分鐘。
- `lives` 新增 stream mode、Live Input UID、通知模板、互動腳本與 quota policy。
- `LiveStepperForm` 從 4 步擴充為 8 步，並修正切換步驟時欄位不應從 DOM 消失的問題。
- `LivePlayback` 加入時間軸互動、官方角色訊息、商品浮出、CTA 切換、ref 追蹤與 play progress。
- Dashboard 從基礎 KPI 擴充為營運、聯盟、用量、onboarding checklist。
- Billing 從方案與扣點展示擴充為混合式計費骨架：固定月費、超額用量、平台金流服務費、交易服務費、月結、批次出款與聯盟分潤報表。
- Admin billing 新增可操作流程：指定月份產生 / 重算 settlement、人工 adjustment、鎖單、從 locked settlement 建立 payout batch、匯出 CSV、標記 paid / failed / retrying。
- 財務稽核新增 `audit_logs`，記錄月結產生、人工調整、鎖單、建立出款批次、CSV 匯出、出款狀態變更、退款與佣金作廢，並預留 IP / User-Agent。
- 退款調整新增 `refund_records` 與交易退款欄位，月結重算會扣回退款金額、金流費退回與平台交易服務費退回；聯盟佣金支援作廢。
- Admin billing dashboard 顯示本月 MRR、待鎖單 settlement、待出款金額、failed payout count、近 7 天交易、佣金調整與最近 audit log。
- 金流 webhook 新增 `/api/webhooks/payments`，使用 Zod 驗證 paid / refunded / partially_refunded / failed 事件，寫入 `webhook_events` 避免重複處理，並自動 upsert 交易、建立退款紀錄、建立或調整聯盟佣金。
- Admin billing dashboard 補 webhook event 監控，顯示最近事件、failed count 與 retry 操作。
- Payment provider adapter 新增 demo provider 與 ecpay-like provider，webhook route 會先驗證簽章、normalize payload，再進入內部處理流程。
- Webhook 對帳中心新增清單與詳情頁，顯示 raw payload、normalized payload、處理結果、retry queue 欄位與相關 audit logs。
- 補上 webhook 核心測試：duplicate webhook 不重複入帳、refund webhook 不重複建立退款紀錄、referralCode 自動建立佣金。
- Webhook retry worker 新增 `/api/jobs/webhook-retry`，會處理 failed 且 nextRetryAt 到期、retryCount 未達 maxRetries 的事件，並支援 `retrying` / `exhausted` 狀態。
- Reconciliation checks 新增交易金額、退款總額、聯盟佣金歸因檢查，Webhook 詳情頁會顯示每項 pass / fail。
- 測試擴充為 9 個，新增 worker 只處理到期事件、maxRetries 後 exhausted、reconciliation 可抓退款金額不一致。
- 財務權限 MVP 版使用 `VendorMember.role` 的 `owner` / `admin` / `accountant` 判斷可否操作 `/admin/billing/*`；商家端 billing 頁仍只查詢自己的 vendor 資料。
- 互動腳本從 triggerSec 表單重構為活動節奏時間軸，避免商家像在填資料庫欄位。
- 互動腳本列表新增編輯、複製、刪除 icon 操作，並補上頁碼切換、總頁數與每頁筆數下拉選單。
- 互動腳本編輯頁改為雙欄雙 scroll：左側固定影片預覽與時間點大綱，右側用緊湊留言列快速新增、切換角色與刪除。
- 前台播放頁從一般商品頁重構為直播導購頁，商品會以覆蓋式卡片出現，聊天也改為直播浮層。
- 互動角色新增官方角色庫一鍵匯入，語意維持官方代理，不使用假帳號或洗留言命名。
- 互動角色改成左側清單 / 右側編輯面板，新增與編輯共用同一套 UI，頭像改用 DiceBear 向量插畫並支援性別切換與左右切換。
- Auth 從 `celebrate_vendor_id` demo cookie 重構為 `UserSession` 資料庫 session，登入後以 httpOnly `celebrate_session` cookie 保存 session token hash。
- Login flow 改為驗證 `User.email/passwordHash`，platform admin 登入後進入 `/admin/billing/dashboard`，商家成員登入後進入 `/dashboard`。
- `/admin/*` 改由 `requireFinanceAdmin()` 保護，允許 platform admin 以及 vendor 端 `owner` / `admin` / `accountant` 操作財務管理。
- `/settings/security` 改為更新目前登入 user 的密碼，並在登出時撤銷目前 session。
- Production `/login` 已隱藏 demo 帳密提示；demo 預填只保留在非 production 環境。
- 新增 `npm run admin:bootstrap`，用 `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` 建立或確保第一個 platform admin，不會建立 demo vendor / demo live，也不會重複建立同 email user。

## 5. Cloudflare-first 整合策略

目前已預留：

- `videos.cloudflareStreamUid`
- `videos.cloudflareLiveInputUid`
- `videos.cloudflarePlaybackId`
- `videos.cloudflareReadyToStream`
- `videos.liveStreamKey`
- `videos.liveInputStatus`
- `videos.estimatedMinutes`
- `lives.streamMode`
- `lives.cloudflareLiveInputUid`
- `lives.quotaPolicy`
- `usage_records`
- `vendor_usage_limits`

建議 API 抽象層：

- `src/lib/cloudflare-stream.ts`
  - `createDirectUpload()`
  - `getVideoStatus(uid)`
  - `createLiveInput()`
  - `getLiveInput(uid)`
  - `deleteAsset(uid)`
- Cloudflare webhook route：
  - `/api/cloudflare/stream-webhook`
  - 更新 `cloudflareReadyToStream`、`status`、duration、thumbnail。
- 用量估算：
  - VOD：依影片分鐘、觀看事件與進度事件估算。
  - Live：依 live input 時長、觀看峰值與 play progress 估算。
  - 寫入 `usage_records`，同步更新 `vendor_usage_limits`。

## 6. 風險與待確認事項

- Auth 已具備 session table 與基本角色權限；正式收費前仍需補 rate limit、登入失敗稽核、密碼重設、MFA、CSRF 策略與 vendor member 邀請 / 停權 UI。
- Cloudflare API 尚未真的串接，目前是資料結構、UI 流程與抽象策略預留。
- Prisma 已切換為 PostgreSQL datasource，舊 SQLite migrations 已歸檔；正式 SaaS 後續以 Supabase Postgres baseline migration 為主。
- 互動腳本已支援任意新增與刪除留言列；拖拉排序尚未實作，目前以時間欄位與清單位置管理節奏。
- 黑名單目前阻擋 email / phone 表單提交；聊天室即時封鎖需等 real-time chat layer 補上。
- 聯盟轉換目前以 ref click 標記 convertedAt，正式版需更精準綁定 visitor/session/order。
- 計費已有手動月結、出款、退款調整、provider adapter、金流 webhook MVP、背景 retry worker 與基礎對帳檢查；尚未接真實金流商完整簽章規格、自動發票與正式排程服務。
- 月結與批次出款已具備 MVP 操作流程與 CSV 匯出；尚未接銀行指定格式、自動金流 webhook、完整平台 super admin 帳號與批次重送排程。
- 聯盟佣金已獨立於平台交易服務費記錄，也支援手動作廢；正式版仍需補訂單 webhook 歸因、自動負向佣金調整與更完整的退貨規則。

## 7. 驗證指令

完成後需執行：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

目前 CI 也會在 push / pull request 執行 lint、typecheck、unit tests。

本次 UI 拋光已執行並通過：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## 8. Phase 1：資料庫正式化更新

本次已完成：

- `prisma/schema.prisma` 從 SQLite datasource 改為 PostgreSQL。
- 新增 `directUrl = env("DIRECT_URL")`，正式 migration 與 runtime 連線分離。
- `prisma.config.ts` 的 migration datasource 優先使用 `DIRECT_URL`，再 fallback 到非 SQLite 的 `DATABASE_URL`。
- 舊 SQLite migration 已歸檔至 `prisma/migrations_sqlite_archive/`，避免 production 誤跑 `PRAGMA` / `DATETIME` 等 SQLite SQL。
- 新增 PostgreSQL baseline migration：`prisma/migrations/20260709090000_postgresql_baseline/migration.sql`。
- CI 已改成使用 PostgreSQL service，並在測試前執行 `npm run db:migrate:deploy`。
- `prisma/seed.ts` 已加入 production guard；production 只允許 `SEED_MODE=production-bootstrap` 進行非破壞性 billing plans upsert。
- 新增 `.env.example`，補上 `DATABASE_URL` / `DIRECT_URL`、Cloudflare、PayUni、Resend、Sentry、PostHog 與 job secret placeholders。
- 新增正式 DB runbook：`docs/production-database-runbook.md`，包含 migration、production seed、backup、restore drill 與 rollback policy。

尚待真實環境確認：

- Supabase production / staging project 尚未提供真實 `DATABASE_URL` / `DIRECT_URL`。
- 尚未在 Supabase staging 跑 migration deploy 與 restore drill。
- 第一個 platform admin 帳號需等正式 Auth / admin role matrix 定案後，以獨立 bootstrap 流程建立。

本次 Phase 1 已使用 Docker PostgreSQL 驗證並通過：

```bash
npm run db:generate
npm run db:migrate:deploy
SEED_MODE=production-bootstrap npm run db:seed
npm run lint
npm run typecheck
npm run test
npm run build
```

測試結果：

- Unit tests：3 個 test files / 9 tests passed。
- Build：Next.js 16 production build completed successfully。

## 9. Phase 2-6：一次性上線骨架更新

本次已不再拆成單一 Phase，而是把正式 MVP 上線需要的 Phase 2 到 Phase 6 骨架一次補齊：

- 新增 production env validation：`src/lib/env.ts`。
- 新增 preflight CLI：`npm run preflight`。
- 新增 external smoke CLI：`npm run external:smoke`。
- 新增 admin preflight API：`/api/admin/preflight`，使用 `JOB_SECRET` Bearer token 保護。
- 新增 health check API：`/api/health`。
- 新增 Cloudflare Stream service layer：`src/lib/cloudflare-stream.ts`。
- 新增 Cloudflare direct upload API：`/api/cloudflare/direct-upload`。
- 新增 Cloudflare Live Input API：`/api/cloudflare/live-inputs`。
- 新增 Cloudflare Stream webhook API：`/api/cloudflare/stream-webhook`。
- 新增 PayUni provider adapter：`src/lib/payment-providers/payuni.ts`。
- 新增 checkout scaffold：`/api/payments/checkout`。
- 新增 Resend transactional email service：`src/lib/email.ts`。
- 新增 PostHog product analytics service：`src/lib/product-analytics.ts`，並讓 analytics API 有 key 時同步送出。
- 新增 Sentry SDK 實際接線：`@sentry/nextjs`、`instrumentation.ts`、`instrumentation-client.ts`、`sentry.server.config.ts`、`sentry.edge.config.ts`、`src/app/global-error.tsx`。
- 新增 monitoring abstraction：`src/lib/monitoring.ts`。
- 新增全 Phase 上線總控文件：`docs/production-go-live-master-plan.md`。
- 新增 staging / production env vars 對照表：`docs/staging-production-env-vars.md`。
- 新增 production go-live checklist：`docs/production-go-live-checklist.md`。
- 新增外部服務驗證 runbook：`docs/external-service-validation-runbook.md`。
- 新增外部服務驗證報告：`docs/external-service-validation-report.md`。

仍需外部服務完成的項目：

- Cloudflare production token、Stream webhook secret、實際影片 upload / ready webhook 測試。
- Vercel production project、custom domain、production env vars。
- Supabase staging / production 真實 migration 與 restore drill。
- PayUni sandbox / production credentials、真實 paid / refunded webhook 測試。
- Resend domain verification 與測試信。
- Sentry / PostHog project 建立與 dashboard alert rules。

本次 Phase 2-6 本機驗證已通過：

```bash
npm run db:generate
npm run lint
npm run typecheck
npm run build
npm run db:migrate:deploy
npm run db:migrate:status
npm run test
npm run preflight
```

驗證結果：

- PostgreSQL baseline migration applied successfully。
- Prisma migrate status：Database schema is up to date。
- Unit tests：3 個 test files / 9 tests passed。
- Next.js production build：47 routes compiled successfully。
- Preflight：使用測試用完整 env vars 驗證通過；placeholder DSN 會被擋下。

## 10. Production Supabase / Vercel 上線狀態更新

本次已完成正式 Vercel / Supabase 基礎部署：

- Vercel production project：`a25814740s-projects/celebrate-deal`。
- Production custom domain：`https://celebratedeal.carry-digital-nomad.in.net`。
- Vercel Production env vars 已補齊：
  - `DATABASE_URL`
  - `DIRECT_URL`
  - `NEXT_PUBLIC_APP_URL`
  - Cloudflare Stream 相關 env
  - PayUni / ECPay webhook 相關 env
  - Resend env
  - Sentry env
  - PostHog env
  - `JOB_SECRET`
- Supabase production project：`CelebrateDeal`。
- Runtime DB URL 使用 Supabase transaction pooler，並加入 `pgbouncer=true`，避免 Prisma prepared statement 與 Supavisor transaction mode 衝突。
- Migration 使用 Supabase direct connection，不使用 pooled URL 跑 schema migration。

Production migration / seed 實際結果：

```bash
npx prisma migrate status
npx prisma migrate deploy
NODE_ENV=production SEED_MODE=production-bootstrap npm run db:seed
npx prisma migrate status
```

執行結果：

- migration 前 public schema 無 user tables。
- 已成功套用 `20260709090000_postgresql_baseline`。
- migration 後狀態：`Database schema is up to date!`
- production seed 只 upsert 3 筆 `billing_plans`。
- production DB 筆數：
  - `billingPlans=3`
  - `vendors=0`
  - `users=0`
  - `lives=0`
  - `forms=0`

Production smoke test：

- `/api/health`：200，`ok=true`，`database=ok`。
- `/login`：200。
- `/dashboard`：未登入時 307 導向 `/login`，符合目前 Auth flow。
- `/live/summer-glow-live`：404，符合 production bootstrap 未灌 demo live 的預期。
- `/form/summer-live-reminder`：404，符合 production bootstrap 未灌 demo form 的預期。
- `/billing/plans`：未登入時導向 `/login`，response payload 可看到 3 筆 billing plans，代表 production bootstrap seed 生效。

Production seed policy：

- 本機 `.env.local` 不改成 production DB URL，避免日常開發誤寫正式資料庫。
- production 禁止 demo seed。
- production 只允許 `SEED_MODE=production-bootstrap`。
- production bootstrap 目前只允許 upsert 平台預設方案。
- 第一個正式 admin / vendor / demo live 不透過通用 seed 建立，需等正式 Auth 與 admin role matrix 定案後，用獨立 bootstrap 流程處理。

## 11. 正式 Auth 與第一個平台管理員 Bootstrap

本次已完成：

- 新增 `UserSession` 資料表與 migration：`prisma/migrations/20260709110000_auth_sessions/migration.sql`。
- `User` 新增 `platformRole`、`status`、`lastLoginAt`，用於 platform admin 與帳號啟停狀態。
- 新增 `VendorMember.status` / `deactivatedAt` / `updatedAt` 與 migration：`prisma/migrations/20260709113000_vendor_member_status/migration.sql`。
- `src/lib/auth.ts` 改為正式 session helper，包含 `authenticateUser()`、`createUserSession()`、`revokeCurrentSession()`、`requireAuth()`、`requireVendor()`、`requireFinanceAdmin()`。
- Auth vendor selection 現在只接受 active membership；停用成員後不會再被視為可登入商家。
- `src/app/actions.ts` 的 login / logout / password update 已改走 `User` + `UserSession`，並清除舊 demo vendor cookie。
- Login flow 新增 15 分鐘 5 次失敗的 MVP rate limit，並將 `login_failed`、`login_rate_limited`、`login_success` 寫入 `audit_logs`。
- `src/app/actions.ts` 新增商家成員管理 Server Actions：owner 可新增 / 啟用成員、停用成員，停用後同步撤銷該 vendor 的 active sessions。
- `src/app/actions.ts` 新增 session revoke actions：撤銷其他裝置與撤銷全部 session。
- `src/app/admin/layout.tsx` 改由 finance admin guard 保護，platform admin 可不綁定 vendor 直接進入 admin billing。
- `src/app/(app)/settings/security/page.tsx` 已擴充為安全中心：更新密碼、目前 session 清單、撤銷 session、商家成員管理、密碼重設流程規劃。
- Production `/login` 不再顯示 demo 帳密提示，並補上 rate limit / no vendor / session revoked 錯誤提示。
- `src/lib/password.ts` 改為每次產生隨機 salt，保留舊 hash 格式驗證相容性。
- 新增 `scripts/bootstrap-platform-admin.ts` 與 `npm run admin:bootstrap`，用於建立第一個平台管理員。

本輪驗證結果：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

- `lint`：通過。
- `typecheck`：通過。
- `test`：使用本機 Docker PostgreSQL 套用 `20260709090000_postgresql_baseline` 與 `20260709110000_auth_sessions` 後，3 個 test files / 9 tests passed。
- `build`：Next.js 16 production build 通過，48 個 app routes 完成編譯。
- Route smoke test：
  - `/login`：200，未顯示 demo 帳密提示。
  - `/dashboard`：未登入 307 導向 `/login`。
  - `/admin/billing/dashboard`：未登入 307 導向 `/login`；platform admin session 可 200 開啟。
  - `/billing/plans`：未登入 307 導向 `/login`。

注意：本輪已完成 bootstrap script 與本機驗證，但尚未在 production 執行第一個 platform admin 建立，因為需要正式管理員 email / password。

Production Auth 上線注意：

- 本機 `.env.local` / `.env` 目前仍是 `file:dev.db`，因此本輪沒有直接執行 production `migrate deploy`，避免誤判連線來源。
- 已嘗試使用 Vercel CLI 拉取 production env 到 gitignored `.env.production.local`；檔案中有 `DATABASE_URL` / `DIRECT_URL` key，但目前值為空字串，Prisma 因 `DIRECT_URL` empty 而拒絕 `migrate status`。
- 要套用 production migration 時，需先在 Vercel 補上非空的 Supabase `DIRECT_URL` / `DATABASE_URL`，或以安全方式在 shell 內注入，再依序執行 `npm run db:migrate:status` 與 `npm run db:migrate:deploy`。
- `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` 目前不可留空；補上後才能執行 `npm run admin:bootstrap` 建立第一個 production platform admin。

Production Auth 上線結果更新：

- 已使用 Supabase direct connection 成功執行 production `migrate status` 與 `migrate deploy`。
- 已套用 `20260709110000_auth_sessions` 與 `20260709113000_vendor_member_status`。
- migration 後狀態：`Database schema is up to date!`
- production DB 仍維持非 demo 狀態：`billingPlans=3`、`vendors=0`、`users=1`、`sessions=0`、`members=0`。
- 已建立第一個 `platform_admin`，並寫入 bootstrap audit log。
- Vercel Production `DATABASE_URL` 已改為 Supabase Transaction pooler，`DIRECT_URL` 保留 direct connection 給 migration 使用。
- `npm run build` 已改為 `prisma generate && next build`，避免 Vercel build cache 使用舊 Prisma Client。
- Production deployment 已完成並 ready。
- Production smoke test：
  - `/api/health`：200，database ok。
  - `/login`：200。
  - `/dashboard`：未登入 307 導向 `/login`。
  - `/admin/billing/dashboard`：未登入 307 導向 `/login`；platform admin 短效 session 可 200 開啟。
  - `/billing/plans`：未登入 307 導向 `/login`。

Platform admin bootstrap policy：

- 必須先設定 `PLATFORM_ADMIN_EMAIL` 與 `PLATFORM_ADMIN_PASSWORD`。
- 密碼至少 12 字元。
- 只接受 PostgreSQL `DATABASE_URL`，避免誤在舊 SQLite demo DB 執行。
- 若 email 已存在，會確保 `platformRole=platform_admin` 與 `status=active`，預設不重設密碼。
- 若需要重設密碼，必須明確設定 `PLATFORM_ADMIN_RESET_PASSWORD=true`。
- 每次執行會寫入 `audit_logs`，方便追蹤 bootstrap 操作。

正式 production 執行順序建議：

```bash
npm run db:migrate:status
npm run db:migrate:deploy
PLATFORM_ADMIN_EMAIL="admin@example.com" PLATFORM_ADMIN_PASSWORD="請改成正式強密碼" PLATFORM_ADMIN_NAME="Platform Admin" npm run admin:bootstrap
```

尚待完成：

- 建立 vendor owner / accountant 邀請與停權 UI。
- 補登入 rate limit、登入失敗 audit、密碼重設與 MFA。
- 針對 admin 操作補更細的 platform-level permission matrix。

## 12. 全 Phase 外部服務接線與驗證流程

本次已完成：

- 新增 staging / production env vars 對照表：`docs/staging-production-env-vars.md`。
- 新增外部服務驗證 runbook：`docs/external-service-validation-runbook.md`。
- 新增 production go-live checklist：`docs/production-go-live-checklist.md`。
- 新增外部服務驗證報告：`docs/external-service-validation-report.md`。
- 新增 Sentry SDK 正式接線，並移除 wizard 產生的硬編碼 DSN、example page 與 example API。
- 新增 protected ops endpoints：
  - `/api/admin/ops/test-email`
  - `/api/admin/ops/test-analytics`
  - `/api/admin/ops/test-monitoring`
- 新增 `npm run external:smoke`，用於 staging / production app URL 的可重複 smoke test。
- 更新 `npm run preflight` 規則，將必要欄位與建議欄位分開，PayUni 欄位依 `PAYMENT_PROVIDER=payuni` 條件檢查。

本輪驗證結果：

```bash
npm run db:migrate:deploy
npm run db:migrate:status
npm run db:generate
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
```

- `db:migrate:deploy`：本機 Docker PostgreSQL 無 pending migrations。
- `db:migrate:status`：Database schema is up to date。
- `db:generate`：Prisma Client generated。
- `lint`：通過。
- `typecheck`：通過。
- `test`：3 個 test files / 9 tests passed。
- `build`：Next.js 16 production build 通過，50 個 app routes 完成編譯。
- `preflight`：使用完整測試 env vars 驗證通過。

外部服務待 dashboard 驗收：

- Supabase：staging / production 真實 `DATABASE_URL` / `DIRECT_URL` 與 restore drill。
- Vercel：production / preview env vars、custom domain、deployment promotion。
- Cloudflare：Stream direct upload、Live Input、Stream webhook ready event。
- PayUni：sandbox / production paid、refunded、duplicate webhook。
- Resend：domain verification 與 test email delivered。
- Sentry：synthetic issue 與 alert rule。
- PostHog：`production_smoke_test` event 與 funnel dashboard。

## 13. 可收費 MVP 上線前安全與營運硬化

本輪基於 repo 現況與既有 go-live 文件，完成一輪可收費 MVP 前的 code review / security review 與直接修正。

Repo 盤點結果：

- Prisma datasource 已改為 PostgreSQL，migration 目前包含 baseline、auth sessions、vendor member status。
- `docs/bombmy_analysis.zip` 仍維持既有 deleted 狀態，本輪未還原。
- Sentry wizard example page / API 已維持刪除狀態。
- 未發現真實 DSN、HashKey、HashIV、Stream token、stream key 被提交到 repo。
- 發現本機 `cookies.txt` 產物並已移除，且補進 `.gitignore`。
- `.env.staging.example` 已允許進版控，保留為 placeholder-only 範本。

本輪安全修正：

- 新增 `src/lib/api-security.ts`，統一處理 Bearer secret 與 shared header secret 的 constant-time 驗證。
- `/api/admin/preflight`、`/api/admin/ops/*`、`/api/jobs/webhook-retry` 改為缺少 `JOB_SECRET` 時 fail closed。
- `/api/cloudflare/direct-upload`、`/api/cloudflare/live-inputs` 加上 Bearer `JOB_SECRET`，避免公開建立 Cloudflare 付費資源。
- `/api/cloudflare/stream-webhook` 改為必須驗證 `CLOUDFLARE_STREAM_WEBHOOK_SECRET`。
- `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 已升級為 preflight 必要欄位，避免 route fail closed 但 env 檢查仍放行。
- `/api/payments/checkout` 改為必須帶 `productId`，金額與幣別由後端 Product 決定，不再信任前端 `amountCents`。
- `/api/form-submissions`、`/api/analytics`、`/api/affiliate-clicks`、`/api/payments/checkout` 加入 repo 內輕量 rate limit。
- 表單、analytics、affiliate click 補 vendor / live 關聯檢查，避免跨商家資料錯配。
- `/api/health` 不再回傳原始 DB error。
- payment webhook 簽章失敗 / payload invalid audit log 不再保存 raw body。
- ecpay-like provider 移除 demo fallback secret。
- 使用者更新密碼最低長度由 8 碼提高為 12 碼。
- `next.config.ts` 新增基礎 security headers：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`。
- GitHub Actions CI 補上 `npm run build` 與 `npm run preflight`。

四面向審查：

- 安全性：已修正 fail-open secret、前端金額竄改、raw error leakage、raw webhook body audit、Cloudflare 成本濫用風險。
- 效能：新增 in-memory rate limit 作為 repo 內基本防刷；production 仍需 Cloudflare WAF / Turnstile / Bot rules。
- 可讀性：API secret 驗證與 rate limit 抽成共用 lib，避免各 route 重複寫不一致邏輯。
- 可維護性：CI 加上 build / preflight，正式 env 缺漏可提早在 PR 階段被抓出。

新增文件：

- `docs/production-readiness-review.md`

本輪驗證結果：

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:migrate:status
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
```

- `db:generate`：通過。
- `db:migrate:deploy`：本機 Docker PostgreSQL 成功套用 3 個 migrations。
- `db:migrate:status`：Database schema is up to date。
- `lint`：通過。
- `typecheck`：通過。
- `test`：3 個 test files / 9 tests passed。
- `build`：Next.js 16 production build 通過，50 個 app routes 完成編譯。
- `preflight`：通過。

驗證備註：

- 第一次 `npm run test` 讀到舊 SQLite env 而失敗；改用 Docker PostgreSQL 後已通過。
- 第一次 `npm run db:generate` 遇到 Next dev server 鎖住 Prisma DLL；停止本專案 dev server 後已通過。

仍待外部驗收：

- Supabase staging / production 真實 migration 與 restore drill。
- Vercel env vars、custom domain、deployment promotion。
- Cloudflare Stream direct upload、Live Input、ready webhook。
- PayUni paid / refunded / duplicate webhook / reconciliation。
- Resend domain verification 與 test email delivered。
- Sentry synthetic issue 與 alert rule。
- PostHog product event 與 funnel dashboard。

## 14. CSRF、E2E、自動化 Smoke、正式金流 Checkout 補強

本輪針對「可收費 MVP 上線前」再補一層安全與可驗收流程，重點是讓正式 checkout、Cloudflare Stream 寫回、CSRF 與 smoke testing 不再只是文件規劃。

已完成：

- 新增無狀態 HMAC CSRF token：
  - `src/lib/csrf.ts`
  - `src/lib/csrf-constants.ts`
  - `src/components/csrf-field.tsx`
- 所有 mutating Server Actions 已加入 `assertServerActionSecurity(formData)`：
  - login / logout
  - settings
  - videos / products / forms / lives
  - interaction roles / scripts
  - blacklist / affiliates
  - settlements / payouts / refunds / webhook retry
- Public JSON POST API 加上 same-origin 與 client header gate：
  - `/api/analytics`
  - `/api/affiliate-clicks`
  - `/api/form-submissions`
  - `/api/payments/checkout`
- rate limit 已抽成 provider 介面：
  - `memory`
  - `cloudflare_waf`
  - `upstash_redis`
  - production durable provider 標為 External required。
- PayUni checkout adapter 已補上：
  - server-side checkout session builder
  - 不信任 client amount
  - 使用 Product price / currency 建立交易
  - PayUni `upp` form post payload
  - `EncryptInfo` / `HashInfo` 產生與驗證
  - webhook route 支援 `?provider=payuni`
- Cloudflare Stream 補強：
  - direct upload 建立後寫回 `Video.cloudflareStreamUid` / playback mapping
  - Live Input 建立後寫回 `Video.cloudflareLiveInputUid`
  - API response 不回傳明文 stream key，只回傳 stream key reference
  - Stream webhook ready event 更新 ready 狀態與 playback URL
- Playwright smoke E2E 已加入：
  - `/login`
  - 未登入導向
  - admin protect
  - live page render
  - form submit
  - checkout 使用 product price
  - protected API 錯誤 Bearer token 回 401
- GitHub Actions CI 已補：
  - Playwright browser install
  - `npm run e2e:smoke`
- 文件已更新：
  - `docs/production-readiness-review.md`
  - `docs/production-go-live-checklist.md`
  - `docs/external-service-validation-runbook.md`

四面向審查：

- 安全性：Server Actions 有 CSRF / Origin 檢查；公開 JSON POST 有 same-origin + client header；checkout 價格只由後端 Product 決定；PayUni / Cloudflare secret 不提交到 repo。
- 效能：rate limit 仍保留 memory provider 方便本機測試，production 已預留 Cloudflare WAF / Upstash Redis durable provider。
- 可讀性：CSRF、API same-origin、rate limit、payment provider checkout 都集中在共用 lib，避免散落在各 route。
- 可維護性：Playwright smoke 與 CI 串起核心漏斗，後續重構 UI 或金流時能較早抓到破壞性變更。

External required：

- Cloudflare dashboard：Stream token、direct upload、Live Input、Stream webhook ready event 實測。
- PayUni dashboard：sandbox / production merchant id、HashKey、HashIV、checkout form post、paid / refunded / duplicate webhook 實測。
- Durable rate limit：Cloudflare WAF rule 或 Upstash Redis credential 與 production 切換。
- Supabase / Vercel / Resend / Sentry / PostHog：仍需各 dashboard 完成正式驗收。

本輪驗證結果：

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:migrate:status
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
npm run e2e:smoke
```

- `db:generate`：通過。
- `db:migrate:deploy`：本機 Docker PostgreSQL 無 pending migrations。
- `db:migrate:status`：Database schema is up to date。
- `lint`：通過。
- `typecheck`：通過。
- `test`：3 個 test files / 9 tests passed。
- `build`：Next.js 16 production build 通過，50 個 app routes 完成編譯。
- `preflight`：通過；仍有 `NEXT_PUBLIC_SENTRY_DSN` 與 `RATE_LIMIT_PROVIDER` production 建議 warning。
- `e2e:smoke`：6 tests passed。

驗證中發現並修正：

- Vitest 原本會吃到 Playwright spec，已在 `vitest.config.ts` 排除 `tests/e2e/**`。
- 測試 shell 可能讀到舊 SQLite env，已在 Vitest / Playwright config 加上本機 PostgreSQL fallback。
- 公開報名表 hydration 前快速點擊會走原生 GET submit，已改成 progressive enhancement：JS fetch 與 native POST 都可送出。

## 15. 外部服務 Sandbox 驗收與 Production Hardening

本輪在既有架構上補強 PayUni、Cloudflare Stream、durable rate limit 與 production security，不重構既有 billing / webhook / payout 主流程。

已完成：

- PayUni sandbox 準備：
  - 新增 `docs/payuni-sandbox-checkout-runbook.md`。
  - `/admin/billing/webhooks/:id` 新增 PayUni `EncryptInfo` / `HashInfo` 診斷卡。
  - 新增 `src/lib/payment-providers/payuni-fixtures.ts`，提供 paid / refunded / duplicate webhook fixtures。
  - Webhook raw payload 與 audit snapshot 套用 sensitive field redaction。
- Cloudflare Stream sandbox 準備：
  - 新增 `src/lib/cloudflare-ops.ts` 共用 direct upload / Live Input mapping。
  - 新增 `/api/admin/ops/cloudflare/direct-upload`。
  - 新增 `/api/admin/ops/cloudflare/live-input`。
  - 新增 `/admin/cloudflare/videos` 影片 ready / playback URL 檢查頁。
  - Live Input 只顯示 `streamKeyRef`，一般後台不顯示明文 stream key。
- Durable rate limit：
  - `src/lib/rate-limit.ts` 改為 async provider。
  - 完成 Upstash Redis REST provider，使用 Redis script 做單 key 計數與 TTL。
  - `/api/payments/checkout`、`/api/form-submissions`、`/api/analytics`、`/api/affiliate-clicks` 已接上 async limiter。
  - Cloudflare WAF 路徑保留為 production 邊界層選項。
- Production security：
  - 新增 CSP report-only header。
  - 新增 `/api/security/csp-report`，並接 rate limit。
  - 新增 `PasswordResetToken` schema 與 migration。
  - 新增 password reset request / confirm API，token 只存 hash，使用後 revoke sessions。
  - 新增 `docs/admin-mfa-hardening-plan.md`。

新增測試：

- `src/lib/rate-limit.test.ts`
- `src/lib/payment-providers/payuni.test.ts`
- `src/app/api/cloudflare/stream-webhook/route.test.ts`

四面向審查：

- 安全性：Upstash provider 設定錯誤時 fail closed；PayUni raw payload 顯示與 audit snapshot 做 redaction；password reset token 只存 hash；stream key 不在一般後台明文顯示。
- 效能：rate limit 走單 key Redis script，避免多次 network round trip；Cloudflare mapping helper 避免重複查詢與雙份邏輯。
- 可讀性：PayUni diagnostics、redaction、Cloudflare ops、password reset 各自拆成清楚 lib。
- 可維護性：sandbox fixtures 與 unit tests 可重複驗收 paid/refunded/duplicate webhook，不依賴外部 dashboard 才能跑基本回歸。

External required：

- PayUni sandbox checkout / paid / refunded / duplicate webhook 需 dashboard credentials 與 sandbox 商店。External required。
- Cloudflare Stream direct upload / Live Input / webhook ready event 需 Cloudflare account token。External required。
- Upstash Redis production provider 需 REST URL / token，或改用 Cloudflare WAF rule。External required。
- Password reset email 需接 Resend transactional email template。External required。
- Admin MFA 目前完成規劃文件，正式收費前建議實作 TOTP。External required。

## 16. 正式可收費 MVP：外部 Sandbox 實測與營運安全閉環

本輪新增完成：

- Password reset flow 已從規劃升級為可用流程：
  - `src/app/password-reset/request/page.tsx`
  - `src/app/password-reset/confirm/page.tsx`
  - `/api/auth/password-reset/request`
  - `/api/auth/password-reset/confirm`
  - token 只存 hash、30 分鐘過期、使用後失效、成功重設後 revoke 既有 sessions。
- Resend transactional email 已接到 password reset request；是否實際送達仍需 `SMOKE_TEST_EMAIL` 或 staging domain 驗證。External required。
- Admin MFA 最小實作已完成：
  - `src/app/mfa/setup/page.tsx`
  - `src/app/mfa/verify/page.tsx`
  - TOTP enrollment / verify
  - recovery codes 以 hash 入庫
  - `/admin/**` 由 `requireFinanceAdmin()` 強制檢查 MFA
  - MFA enrollment / verify / recovery code 使用皆寫入 `audit_logs`。
- PayUni sandbox 閉環已補齊 fixture tooling：
  - `scripts/payuni-webhook-fixtures.ts`
  - `npm run payuni:fixture`
  - `npm run external:smoke` 可直接 replay paid / duplicate / refunded webhook。
- Cloudflare admin ops helper 已補結構化錯誤回傳，避免 direct upload 失敗時只看到空白 500。

本輪實測結果：

- `npm run external:smoke`（本機 dev server）：
  - `health`：PASS
  - `admin preflight`：PASS
  - `posthog smoke event`：PASS
  - `sentry smoke event`：PASS
  - `payuni paid webhook`：PASS
  - `payuni duplicate webhook`：PASS
  - `payuni refunded webhook`：PASS
  - `cloudflare direct upload`：FAIL，Cloudflare API 回 `code=10000 Authentication error`
  - `resend test email`：SKIP，`SMOKE_TEST_EMAIL` 未設定
- Cloudflare 失敗已確認不是 app route 權限或 payload 格式問題，而是目前 Cloudflare Stream token / account mapping 無法通過 API 驗證。External required。

本輪最終驗證：

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:migrate:status
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
npm run e2e:smoke
```

結果：

- `lint`：通過
- `typecheck`：通過
- `test`：8 個 test files / 20 tests passed
- `build`：Next.js 16 production build 通過，60 個 app routes 完成編譯
- `preflight`：通過；`NEXT_PUBLIC_SENTRY_DSN` 與 `RATE_LIMIT_PROVIDER` 仍為 warning
- `e2e:smoke`：6 tests passed

仍待 External required：

- Cloudflare Stream token scope / account mapping 修正，完成 direct upload、ready webhook、live input 真實驗收
- Resend password reset email 實際送達驗證
- staging / production admin MFA 實際 enrollment / recovery code smoke

## 17. External Required 收斂與營運交付

本輪新增完成：

- Cloudflare Stream diagnostics：
  - 新增 `src/lib/cloudflare-diagnostics.ts`。
  - `/admin/cloudflare/videos` 顯示 account id / token / webhook secret 是否存在、API base、實際 endpoint 與 `code=10000 Authentication error` 排查順序。
  - `/api/admin/preflight` 回傳 Cloudflare diagnostics，不顯示 token 原文。
- Cloudflare dashboard 檢查單：
  - `docs/cloudflare-stream-dashboard-checklist.md`
  - 收斂 token scope、account id、webhook secret、API base、direct upload、Live Input 與 webhook 驗收。
- Password reset email smoke：
  - 新增 `sendPasswordResetSmokeAction`，只寄送到目前登入帳號 Email。
  - `/settings/security` 與 `/mfa/setup` 可觸發 password reset 測試信。
  - email HTML 已加入 escape，避免未來變更造成 HTML 注入風險。
  - 新增 `docs/password-reset-email-smoke-runbook.md`。
- Admin MFA 營運化：
  - 新增 `regenerateRecoveryCodesAction`。
  - 安全中心與 `/mfa/setup` 可重新產生 recovery codes；舊 codes 會失效。
  - session UI 顯示目前 MFA verified 狀態。
  - 新增 `docs/admin-mfa-recovery-sop.md`。
  - E2E 補上已登入 finance role 未完成 MFA 不可進入 `/admin/**`。
- Production rate limit 收斂：
  - 新增 `docs/production-rate-limit-runbook.md`。
  - 明確列出 Upstash Redis / Cloudflare WAF 啟用、env checklist 與 checkout / form / analytics / affiliate-clicks smoke 驗收方式。
- 安全細節：
  - MFA verify `next` 參數改為只允許 same-site relative path，拒絕 `//example.com` 類 protocol-relative open redirect。

四面向審查：

- 安全性：未新增公開寄信入口；password reset smoke 只寄目前登入者；Cloudflare diagnostics 不洩漏 secret；MFA recovery code 僅顯示一次且 hash 入庫；修正 MFA `next` open redirect 風險。
- 效能：diagnostics 不主動呼叫 Cloudflare API，避免後台列表頁造成外部 API 額外成本；Upstash runbook 保留 durable 限流路徑。
- 可讀性：Cloudflare、password reset、MFA、rate limit 各自拆成 runbook；admin diagnostics 用一致欄位呈現。
- 可維護性：E2E 補上 MFA gate；後續 staging 驗收可直接使用 runbook 與 checklist。

本輪新增 / 修改重點檔案：

- `src/lib/cloudflare-diagnostics.ts`
- `src/app/admin/cloudflare/videos/page.tsx`
- `src/app/api/admin/preflight/route.ts`
- `src/app/actions.ts`
- `src/app/mfa/setup/page.tsx`
- `src/app/mfa/verify/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/lib/email.ts`
- `tests/e2e/smoke.spec.ts`
- `docs/cloudflare-stream-dashboard-checklist.md`
- `docs/password-reset-email-smoke-runbook.md`
- `docs/admin-mfa-recovery-sop.md`
- `docs/production-rate-limit-runbook.md`

仍待 External required：

- Cloudflare dashboard 修正 token scope / account mapping 後重跑 `RUN_CLOUDFLARE_SMOKE=true npm run external:smoke`。
- Resend sender domain 驗證與 password reset email 實際送達。
- Production `RATE_LIMIT_PROVIDER` 切到 `upstash_redis` 或 `cloudflare_waf`，並完成 429 smoke。
- Cloudflare Stream VOD webhook 已支援官方 `Webhook-Signature`；`x-cloudflare-stream-webhook-secret` 仍保留為 staging / local smoke fallback。真實 Cloudflare dashboard callback 仍需外部驗收。

本輪驗證結果：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
npm run e2e:smoke
```

- `lint`：通過
- `typecheck`：通過
- `test`：8 個 test files / 20 tests passed
- `build`：通過，60 個 app routes
- `preflight`：通過；仍有 `NEXT_PUBLIC_SENTRY_DSN` 與 `RATE_LIMIT_PROVIDER` warnings
- `e2e:smoke`：7 tests passed

## 18. Cloudflare Stream 官方 Webhook 簽章收斂

本輪新增完成：

- `/api/cloudflare/stream-webhook` 已改為讀取 raw body 後再驗證與解析 JSON。
- 新增 `src/lib/cloudflare-webhook-signature.ts`：
  - 支援 Cloudflare Stream VOD 官方 `Webhook-Signature` header。
  - 使用 `<time>.<rawBody>` 與 `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 計算 HMAC-SHA256。
  - 使用 constant-time compare 比對 `sig1`。
  - `time` 超過 5 分鐘會被拒絕，避免 replay。
  - 若官方 header 存在但簽章錯誤，會直接拒絕，不會降級走 fallback。
- 保留 `x-cloudflare-stream-webhook-secret` 作為本機與 staging smoke fallback。
- `/admin/cloudflare/videos` diagnostics 已顯示 webhook mode：
  - `official-signature`
  - `shared-secret-fallback`
- `docs/cloudflare-stream-dashboard-checklist.md` 已補上 signing secret 取得、Vercel env 設定與 smoke 驗收流程。

測試覆蓋：

- shared secret fallback 可更新 video ready / playback mapping。
- 官方 `Webhook-Signature` 可通過並更新 video ready / duration。
- invalid official signature 回 401。
- 官方 header 錯誤時不會 fallback 到 shared secret。
- expired timestamp / replay signature 回 401。

目前 External required：

- Cloudflare Stream token / account mapping 仍需在 dashboard 修正，目前 direct upload 仍回 `code=10000 Authentication error`。
- 修正後需重跑 direct upload、ready webhook、Live Input 與官方 `Webhook-Signature` 真實 callback。
- Cloudflare VOD webhook signing secret 需從 Cloudflare Stream webhook subscription 取得並設定到 staging / production `CLOUDFLARE_STREAM_WEBHOOK_SECRET`。

本輪 staging-style smoke：

- `npm run external:smoke`：
  - `health`：PASS
  - `admin preflight`：PASS
  - `posthog smoke event`：PASS
  - `sentry smoke event`：PASS
  - `payuni paid webhook`：PASS
  - `payuni duplicate webhook`：PASS
  - `payuni refunded webhook`：PASS
  - `cloudflare direct upload`：FAIL，Cloudflare API 回 `code=10000 Authentication error`
  - `resend test email`：SKIP，`SMOKE_TEST_EMAIL` 未設定
- 本機 HTTP official signature smoke：PASS，`/api/cloudflare/stream-webhook` 回 `verificationMode=official-signature`。

本輪最終驗證：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
npm run e2e:smoke
```

結果：

- `lint`：通過。
- `typecheck`：通過。
- `test`：8 個 test files / 25 tests passed。
- `build`：通過，60 個 app routes。
- `preflight`：通過；仍有 `NEXT_PUBLIC_SENTRY_DSN` 與 `RATE_LIMIT_PROVIDER` production warning。
- `e2e:smoke`：7 tests passed。

驗證備註：

- 第一次 `build` 因本機 dev server 佔用 Prisma query engine DLL 而失敗；停止 dev server 後重跑已通過。
- `RUN_CLOUDFLARE_SMOKE=true npm run external:smoke` 仍因外部 Cloudflare `code=10000 Authentication error` 失敗，已列為 External required。

## 19. Cloudflare Staging 真實驗收收斂補強

本輪新增完成：

- 新增 `src/lib/cloudflare-webhook-fixtures.ts`。
- 新增 `scripts/cloudflare-webhook-fixtures.ts` 與 `npm run cloudflare:fixtures`。
- fixtures 覆蓋：
  - `ready`
  - `processing`
  - `error`
  - `invalid_signature`
  - `expired_timestamp`
- `scripts/external-smoke.ts` 的 Cloudflare ready webhook replay 已改用官方 `Webhook-Signature`，不再用 shared secret fallback。
- Cloudflare webhook unit tests 已擴充為 6 個案例：fallback、official ready、processing、error、invalid signature、expired timestamp。

目前判斷：

- repo 內 Cloudflare 官方簽章處理已具備可重複驗證方式。
- 真實 direct upload / ready callback / Live Input 仍需要 Cloudflare dashboard 修正 `code=10000 Authentication error` 後才能驗收。
- Production go-live checklist 已補上 `npm run cloudflare:fixtures` 與 production domain signed fixture 驗收項。

本輪 fixture replay 實測：

- `npm run cloudflare:fixtures`：通過。
- `ready` / `processing` / `error`：HTTP 200，`verificationMode=official-signature`。
- `invalid_signature`：HTTP 401，`reason=invalid_signature`。
- `expired_timestamp`：HTTP 401，`reason=expired_timestamp`。
- `npm run external:smoke`：
  - health / admin preflight / Sentry / PostHog：PASS
  - PayUni paid / duplicate / refunded：PASS
  - Cloudflare direct upload：FAIL，Cloudflare API 回 `code=10000 Authentication error`
  - Resend email：SKIP，`SMOKE_TEST_EMAIL` 未設定
