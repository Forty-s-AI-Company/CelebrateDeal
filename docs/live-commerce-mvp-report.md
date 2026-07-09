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
- 依 UX audit 完成第一輪產品體驗重構：
  - `interaction-script-form.tsx` 改為視覺化時間軸，支援 `MM:SS`，並提供 3 組常見導購節奏範本。
  - `live-playback.tsx` 改為手機直播感介面：影片滿版、聊天浮層、官方角色標籤、商品 Pop-up、浮動 CTA 與底部直播操作列。
  - 互動角色頁新增「匯入 10 個官方角色」入口，降低商家冷啟動成本。
  - live stepper 最後一步新增手機前台預覽 mockup。

下一階段建議：

- 串接 Cloudflare Stream API 建立 video upload、direct creator upload、live input、webhook ready 狀態。
- 將目前 demo cookie auth 升級為正式 session table / Auth.js / Clerk。
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
- `vitest.config.ts`
- `src/app/api/affiliate-clicks/route.ts`
- `src/components/interaction-script-form.tsx`
- `src/components/interaction-role-form.tsx`
- `src/components/affiliate-form.tsx`

主要修改：

- `prisma/schema.prisma`
- `prisma/seed.ts`
- `src/app/actions.ts`
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
- Demo auth 與 protected app shell
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

- Auth 仍是 MVP demo cookie，正式上線前需補 session table、CSRF、rate limit、MFA 或 managed auth。
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
- 新增 monitoring abstraction：`src/lib/monitoring.ts`。
- 新增全 Phase 上線總控文件：`docs/production-go-live-master-plan.md`。

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
