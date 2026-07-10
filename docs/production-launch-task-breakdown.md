# CelebrateDeal 正式 MVP 上線任務拆解

最後更新：2026-07-09

## 0. 文件目的

本文件基於目前 CelebrateDeal 專案狀態與 `docs/production-infrastructure-plan.md`，拆解正式 MVP 上線前需要完成的任務。

若需要一次看完全部 Phase 與目前完成狀態，請以 `docs/production-go-live-master-plan.md` 作為總控文件。

目前專案狀態：

- Next.js App Router + Prisma + PostgreSQL baseline 架構；舊 SQLite migration 已歸檔。
- 已完成 Cloudflare-first 直播導購頁、互動腳本、互動角色、商品、報名表、聯盟追蹤。
- 已完成定價、用量、月結、批次出款、audit log、webhook provider adapter、webhook retry worker、reconciliation checks。
- 已完成 Vercel Production deployment、custom domain、Production env vars、Supabase production migration、production bootstrap seed 與 `/api/health` 驗證。
- 已完成正式 Auth MVP 與第一個 platform admin bootstrap 流程；production `/login` 已隱藏 demo 帳密提示。
- 尚未完成第一個 platform admin production 實際建立、Cloudflare Stream 真實 upload / webhook / Live Input 驗證、PayUni sandbox / production 真實 payload 驗證、Email domain verification、Sentry alert rules、PostHog funnel dashboard 與完整 go-live drill。

目前正式環境：

- Domain：`https://celebratedeal.carry-digital-nomad.in.net`
- Health check：`https://celebratedeal.carry-digital-nomad.in.net/api/health`
- Supabase project：`CelebrateDeal`
- Production DB 狀態：PostgreSQL baseline migration 已套用；production seed 只 upsert 3 筆 `billing_plans`，未灌入 demo vendor / demo live / demo payment data。
- Auth 狀態：已新增 `UserSession` session table migration、`VendorMember.status` member lifecycle migration 與 `npm run admin:bootstrap`，待正式 Supabase env 與 admin email / password 設定後執行 production migration / bootstrap。
- 本機 `.env.local` 原則：保留本機開發用途，不改成 production DB URL，避免日常開發誤寫正式資料庫。
- 本輪驗證狀態：`lint` / `typecheck` / `test` / `build` 均已通過；本機 route smoke test 已確認 `/login` 不顯示 demo 帳密提示，受保護頁未登入會導向 `/login`。

優先級定義：

- `P0`：沒有完成就不應正式收費上線。
- `P1`：可收費 MVP 建議完成，若延後需明確風險控管。
- `P2`：上線後可逐步強化。

---

## 1. Phase 0：上線前整理

### 1.1 確認正式網域

- 任務名稱：確認正式產品網域與子網域規劃
- 目的：決定正式入口、後台入口、webhook URL 與 email domain，避免部署後頻繁改 DNS。
- 涉及檔案：
  - `docs/production-infrastructure-plan.md`
  - `.env.production`
  - Vercel Project Domain Settings
  - Cloudflare DNS
- 驗收標準：
  - 已決定正式主網域，例如 `celebratedeal.com`
  - 已決定 app 子網域，例如 `app.celebratedeal.com`
  - 已決定 webhook URL，例如 `https://app.celebratedeal.com/api/webhooks/payments`
  - 已決定 email sender domain，例如 `mail.celebratedeal.com`
- 風險：
  - 網域後續更換會影響金流 webhook、Email DNS、Sentry allowed origins 與前台分享連結。
- 預估優先級：P0

### 1.2 確認 Cloudflare 帳號

- 任務名稱：建立或確認 Cloudflare production account
- 目的：集中管理 DNS、WAF、Stream、Stream Live、Turnstile 與未來 Worker Cron。
- 涉及檔案：
  - `docs/production-infrastructure-plan.md`
  - `src/components/video-form.tsx`
  - `src/components/live-stepper-form.tsx`
  - `prisma/schema.prisma`
- 驗收標準：
  - Cloudflare account 已建立
  - production zone 已加入
  - DNSSEC、SSL/TLS mode、WAF baseline 已確認
  - Stream / Stream Live 可用
  - 已建立 API token 權限範圍草案
- 風險：
  - Cloudflare 帳號與 DNS 不穩，會直接影響前台播放、webhook、admin 登入與影片播放。
- 預估優先級：P0

### 1.3 確認 Vercel 專案

- 任務名稱：建立 Vercel production project
- 目的：部署 Next.js App Router、API routes、Server Actions、Webhook endpoint 與 job endpoint。
- 涉及檔案：
  - `next.config.ts`
  - `package.json`
  - `.github/workflows/ci.yml`
  - Vercel Project Settings
- 驗收標準：
  - Vercel project 已連到 GitHub repo
  - production branch 已指定
  - preview deployment 可正常 build
  - production deployment 需要手動 promote 或明確流程
- 風險：
  - 未區分 preview / production env vars，可能導致 sandbox webhook 打到正式資料庫。
- 預估優先級：P0

### 1.4 確認 Supabase 專案

- 任務名稱：建立 Supabase production project
- 目的：提供正式 PostgreSQL、備份、SQL editor 與 production DATABASE_URL。
- 涉及檔案：
  - `prisma/schema.prisma`
  - `prisma/migrations/**`
  - `prisma.config.ts`
  - `.env.production`
- 驗收標準：
  - Supabase production project 已建立
  - Region 已選定
  - Direct URL 與 pooled URL 已取得
  - DB password 已存入密碼管理工具
  - 備份策略已確認
- 風險：
  - Region 選錯會造成延遲；連線字串用錯會導致 migration 或 Prisma connection pool 問題。
- 預估優先級：P0

### 1.5 確認 PayUni sandbox / production 申請

- 任務名稱：確認 PayUni 商店、sandbox 與正式金流申請狀態
- 目的：讓付款、退款、webhook、對帳可以進入真實驗證。
- 涉及檔案：
  - `src/lib/payment-providers/**`
  - `src/app/api/webhooks/payments/route.ts`
  - `src/lib/payment-webhooks.ts`
  - `src/lib/reconciliation.ts`
  - `.env.production`
- 驗收標準：
  - 已取得 sandbox merchant id / HashKey / HashIV 或等價憑證
  - 已取得 production 申請時程
  - 已確認 webhook payload 與簽章規格
  - 已確認退款 API / 後台退款流程
- 風險：
  - 金流審核時間不可控；payload 規格與目前 ecpay-like adapter 不一定一致。
- 預估優先級：P0

### 1.6 確認 Email domain

- 任務名稱：確認交易信與系統信寄件網域
- 目的：支援報名確認、開播提醒、帳單通知、出款通知與系統警示。
- 涉及檔案：
  - `src/components/message-template-form.tsx`
  - `prisma/schema.prisma`
  - `.env.production`
  - Resend Dashboard
- 驗收標準：
  - 已決定寄件 domain
  - SPF / DKIM / DMARC DNS 設定完成
  - 可寄出測試信並通過收件測試
- 風險：
  - Email domain 未驗證會影響交易通知送達率。
- 預估優先級：P1

---

## 2. Phase 1：資料庫正式化

目前執行狀態（2026-07-09）：

- 已將 Prisma datasource 改為 PostgreSQL。
- 已新增 `DIRECT_URL` migration 連線設計。
- 已將舊 SQLite migrations 歸檔至 `prisma/migrations_sqlite_archive/`。
- 已建立 PostgreSQL baseline migration：`prisma/migrations/20260709090000_postgresql_baseline/`。
- 已新增 production-safe seed guard：production 只允許 `SEED_MODE=production-bootstrap`。
- 已建立正式資料庫操作文件：`docs/production-database-runbook.md`。
- 已使用 Docker PostgreSQL 驗證 baseline migration、production bootstrap seed、lint、typecheck、test、build。
- 已在 Supabase production 執行 `prisma migrate status`，確認 baseline migration 尚未套用且 public schema 無 user tables。
- 已在 Supabase production 執行 `prisma migrate deploy`，成功套用 `20260709090000_postgresql_baseline`。
- 已在 Supabase production 執行 `NODE_ENV=production SEED_MODE=production-bootstrap npm run db:seed`，成功 upsert 3 筆 billing plans。
- 已再次執行 `prisma migrate status`，結果為 `Database schema is up to date!`。
- 已驗證 production DB 筆數：`billingPlans=3`、`vendors=0`、`users=0`、`lives=0`、`forms=0`。
- 已新增 Auth session migration：`20260709110000_auth_sessions`，用於正式登入 session、platform admin role 與 user status。
- 已新增第一個 platform admin bootstrap script：`scripts/bootstrap-platform-admin.ts`，production 不透過 demo seed 建立管理員。
- 已新增 vendor member lifecycle migration：`20260709113000_vendor_member_status`，支援商家 owner 停用成員但保留歷史紀錄。
- 已在本機 Docker PostgreSQL 驗證 `npm run admin:bootstrap` 可建立 platform admin，並可用 session 進入 `/admin/billing/dashboard`。
- 本輪第一次執行 production migrate status 時，Prisma 讀到本機 `file:dev.db`，因此未執行 production deploy。
- 後續使用 Vercel CLI 將 production env 拉到 gitignored `.env.production.local`，但 `DATABASE_URL` / `DIRECT_URL` key 的值為空字串，Prisma 因 `DIRECT_URL` empty 拒絕 `migrate status`；需先補齊 Vercel production env value 或以安全 shell env 注入後再執行。
- 已取得 Supabase Transaction pooler connection string，並將 Vercel Production `DATABASE_URL` 改為 pooler URL；`DIRECT_URL` 保留 Supabase direct URL。
- 已成功套用 Auth production migrations，並完成第一個 platform admin bootstrap。
- Production `/api/health` 已恢復 200，確認 Vercel runtime 可透過 pooler 連 Supabase。
- Production smoke test 已確認 `/login` 200、未登入 protected routes 會導向 `/login`、platform admin 短效 session 可進入 `/admin/billing/dashboard`。
- 尚待完成 restore drill 與 staging DB 長期流程。

### 2.1 Prisma SQLite 改 PostgreSQL

- 任務名稱：將 Prisma datasource 從 SQLite 改為 PostgreSQL
- 目的：讓 production DB 支援正式 SaaS 資料量、備份、連線與查詢需求。
- 涉及檔案：
  - `prisma/schema.prisma`
  - `prisma/migrations/**`
  - `prisma.config.ts`
  - `package.json`
- 驗收標準：
  - `datasource db.provider` 改為 `postgresql`
  - Prisma client 可 generate
  - migration 可在乾淨 Supabase DB 跑完
  - `npm run typecheck` 通過
- 風險：
  - SQLite 與 PostgreSQL 對 JSON、DateTime、索引、unique 行為不同。
  - 既有 migration 是 SQLite 產生，可能需要重建 production baseline migration。
- 預估優先級：P0

### 2.2 Supabase DATABASE_URL

- 任務名稱：設定 Supabase production DATABASE_URL
- 目的：讓 Vercel production 使用正式 PostgreSQL。
- 涉及檔案：
  - `.env.production`
  - Vercel Environment Variables
  - `prisma.config.ts`
- 驗收標準：
  - Vercel production env 已設定 `DATABASE_URL`
  - Vercel production env 已設定 `DIRECT_URL`
  - migration 使用 direct URL
  - app runtime 使用 Supabase transaction pooler URL
  - `DATABASE_URL` 已加上 `pgbouncer=true`，避免 Prisma prepared statement 與 Supavisor transaction mode 衝突
  - production build 不暴露 DB secret
- 風險：
  - 錯把 production URL 放入 client env 會外洩。
  - pooled URL 與 migration URL 混用可能造成 migration 錯誤。
- 預估優先級：P0

### 2.3 Migration 流程

- 任務名稱：建立 production migration 流程
- 目的：確保 schema 變更可重現、可審核、可 rollback。
- 涉及檔案：
  - `prisma/migrations/**`
  - `.github/workflows/ci.yml`
  - `package.json`
  - `docs/production-infrastructure-plan.md`
- 驗收標準：
  - production 禁止直接 `prisma db push`
  - migration 先在 staging DB 測試
  - migration 執行前有 backup
  - migration 執行後有 smoke test
  - production migration 使用 `npx prisma migrate deploy`
  - production migration 前先跑 `npx prisma migrate status`
  - production migration 前查詢 public schema user tables，避免誤把 baseline 套到既有資料庫
- 風險：
  - migration 未測試可能造成 production schema lock 或資料遺失。
- 預估優先級：P0

### 2.4 Production seed policy

- 任務名稱：定義 production seed policy
- 目的：避免 demo 資料污染正式資料庫。
- 涉及檔案：
  - `prisma/seed.ts`
  - `package.json`
  - `docs/production-launch-task-breakdown.md`
- 驗收標準：
  - production 不自動執行 demo seed
  - 若需 production seed，只允許建立必要 billing plans / admin account
  - seed script 有環境保護，例如 `NODE_ENV !== "production"` 時才建立 demo data
  - production seed 目前只允許 `SEED_MODE=production-bootstrap`
  - production bootstrap 只 upsert `billing_plans`
  - production seed 後確認 `vendors/users/lives/forms` 仍為 0，避免 demo data 混入正式資料庫
- 風險：
  - demo seed 模式會清空平台層資料與 vendor data，不可直接在 production 執行。
- 預估優先級：P0

### 2.5 Backup policy

- 任務名稱：建立 DB backup 與 restore policy
- 目的：保護商家、交易、月結、出款與 webhook 對帳資料。
- 涉及檔案：
  - Supabase Dashboard
  - `docs/production-infrastructure-plan.md`
  - `docs/production-launch-task-breakdown.md`
- 驗收標準：
  - 每日自動備份已啟用
  - 上線前完成一次 restore drill
  - 定義 RPO / RTO
  - 月結與出款前手動 snapshot 流程已定義
- 風險：
  - 財務資料無備份會造成不可接受的營運風險。
- 預估優先級：P0

### 2.6 正式 Auth 與 platform admin bootstrap

- 任務名稱：建立正式 Auth MVP 與第一個平台管理員
- 目的：替換 demo cookie auth，讓 production 可以用真實平台管理員登入 admin billing，並保留商家 owner / accountant 權限分流。
- 涉及檔案：
  - `prisma/schema.prisma`
  - `prisma/migrations/20260709110000_auth_sessions/migration.sql`
  - `src/lib/auth.ts`
  - `src/lib/password.ts`
  - `src/app/actions.ts`
  - `src/app/login/page.tsx`
  - `src/app/admin/layout.tsx`
  - `scripts/bootstrap-platform-admin.ts`
  - `.env.example`
- 驗收標準：
  - `UserSession` table 已建立
  - `VendorMember.status` 可標記 active / inactive
  - login 使用 `User.email/passwordHash`
  - session token 只以 hash 形式保存於資料庫
  - cookie 使用 httpOnly、sameSite lax、production secure
  - login 失敗寫入 audit log
  - login 失敗達門檻時 rate limit
  - platform admin 可進入 `/admin/billing/dashboard`
  - vendor owner / admin / accountant 可操作 finance admin route
  - vendor owner 可新增與停用 member
  - 停用 member 後會撤銷該 vendor 的 active sessions
  - 使用者可在 `/settings/security` 查看 session list，並撤銷其他 session / 全部 session
  - production `/login` 不顯示 demo 帳密提示
  - `npm run admin:bootstrap` 可重複執行，不重複建立同 email user
  - bootstrap 不會建立 demo vendor / demo live，不會清空 production data
- 風險：
  - 尚未有 MFA、完整密碼重設與 vendor member email 邀請 UI；可收費 MVP 前需要補上。
  - 本輪 rate limit 是基於 audit log 的 MVP 實作，正式高流量環境建議改用 Redis / Upstash / Vercel KV 這類集中式計數。
  - 密碼重設目前是流程規劃與 UI 說明，尚未實作 reset token / email。
  - 第一個 platform admin password 不應放在 repo 或一般聊天紀錄，需用本機 env 或 Vercel / Supabase 安全流程保存。
- 預估優先級：P0

---

## 3. Phase 2：部署與環境變數

目前執行狀態（2026-07-09）：

- 已建立 Vercel project：`a25814740s-projects/celebrate-deal`。
- 已完成 Production env vars，包含 DB、Cloudflare、PayUni、Resend、Sentry、PostHog 與 job secret。
- 已完成 custom domain：`celebratedeal.carry-digital-nomad.in.net`。
- 已完成 Production redeploy，latest deployment 狀態為 `Ready`。
- 已驗證 `/api/health` 回傳 `ok=true`、`database=ok`。
- 尚待 Email domain verification、Cloudflare WAF baseline 與完整 alert rules。
- Auth runtime env 不強制要求 `PLATFORM_ADMIN_*`，因為 bootstrap 是一次性 CLI；正式建立管理員時再以本機安全 env 執行。

### 3.1 Vercel production env vars

- 任務名稱：設定 Vercel production environment variables
- 目的：讓 production app 可連線 DB、金流、Cloudflare、Email、Sentry、PostHog 與 job endpoint。
- 涉及檔案：
  - Vercel Project Settings
  - `.env.production`
  - `src/app/api/jobs/webhook-retry/route.ts`
  - `src/lib/payment-providers/**`
- 驗收標準：
  - 已設定 `DATABASE_URL`
  - 已設定 `DIRECT_URL`
  - 已設定 `NEXT_PUBLIC_APP_URL`
  - 已設定 `JOB_SECRET`
  - 已設定 Cloudflare Stream 相關 env
  - 已設定 PayUni / ECPay provider secrets
  - 已設定 Resend / Sentry / PostHog env
  - env 更新後已重新部署 production
  - `/api/health` 已通過
- 風險：
  - env var 漏設會造成 build 可過但 runtime webhook / DB / email 失敗。
- 預估優先級：P0

### 3.2 Cloudflare DNS

- 任務名稱：設定 Cloudflare DNS records
- 目的：讓正式網域指向 Vercel，並支援 email domain verification 與 webhook URL。
- 涉及檔案：
  - Cloudflare DNS
  - Vercel Domains
  - Resend DNS settings
- 驗收標準：
  - `app` 子網域 CNAME 指向 Vercel
  - root domain redirect 或 landing 規則已定義
  - SPF / DKIM / DMARC 已設定
  - DNS propagation 驗證完成
- 風險：
  - DNS proxy / SSL 設定錯誤會造成 webhook 或 Vercel domain 驗證失敗。
- 預估優先級：P0

### 3.3 Custom domain

- 任務名稱：綁定 Vercel custom domain
- 目的：讓 production app 使用正式 HTTPS 網域。
- 涉及檔案：
  - Vercel Domains
  - Cloudflare DNS
  - `.env.production`
- 驗收標準：
  - `https://app.your-domain.com/login` 可開啟
  - SSL 憑證正常
  - `NEXT_PUBLIC_APP_URL` 與實際網域一致
  - webhook URL 使用正式 domain
- 風險：
  - `NEXT_PUBLIC_APP_URL` 不一致會影響 webhook callback、email links、前台分享連結。
- 預估優先級：P0

### 3.4 Build / deploy 驗證

- 任務名稱：建立 production build / deploy 驗證流程
- 目的：確保正式部署前會跑必要檢查。
- 涉及檔案：
  - `package.json`
  - `.github/workflows/ci.yml`
  - Vercel Deployment Settings
- 驗收標準：
  - 每次 PR 跑 `npm run lint`
  - 每次 PR 跑 `npm run typecheck`
  - 每次 PR 跑 `npm run test`
  - 每次 production deploy 跑 `npm run build`
  - preview deployment 可驗證主要頁面
- 風險：
  - 未經檢查直接部署可能導致金流 webhook 或 admin 財務頁 production error。
- 預估優先級：P0

---

## 4. Phase 3：Cloudflare Stream 串接

### 4.1 Upload API

- 任務名稱：建立 Cloudflare Stream upload API
- 目的：讓後台影片庫可以建立 Stream asset 並保存 UID / playback ID。
- 涉及檔案：
  - `src/app/(app)/videos/**`
  - `src/components/video-form.tsx`
  - `prisma/schema.prisma`
  - `src/lib/cloudflare-stream.ts`
- 驗收標準：
  - 後台可建立 upload request
  - `videos.cloudflareStreamUid` 正確保存
  - `videos.cloudflarePlaybackId` 正確保存
  - 失敗時顯示可理解錯誤
- 風險：
  - 影片上傳失敗或 UID 未保存會導致直播頁無法播放。
- 預估優先級：P0

### 4.2 Direct creator upload

- 任務名稱：支援 Cloudflare direct creator upload
- 目的：避免影片先經過 Vercel server，降低大檔案上傳風險。
- 涉及檔案：
  - `src/app/api/cloudflare/direct-upload/route.ts`
  - `src/components/video-form.tsx`
  - `src/lib/cloudflare-stream.ts`
- 驗收標準：
  - 後台可取得 direct upload URL
  - 使用者可直接上傳影片到 Cloudflare
  - 上傳完成後可回填 video UID
- 風險：
  - 如果走 Vercel server 中轉大檔案，容易遇到 timeout / request size limit。
- 預估優先級：P0

### 4.3 Stream webhook

- 任務名稱：建立 Cloudflare Stream webhook
- 目的：同步影片 ready 狀態、duration、thumbnail 與錯誤狀態。
- 涉及檔案：
  - `src/app/api/cloudflare/stream-webhook/route.ts`
  - `src/lib/cloudflare-stream.ts`
  - `prisma/schema.prisma`
- 驗收標準：
  - Cloudflare ready event 可更新 `cloudflareReadyToStream`
  - 可更新 duration / thumbnail
  - webhook 驗證與失敗 log 已處理
- 風險：
  - 未同步 ready 狀態會造成前台顯示可播放但實際失敗。
- 預估優先級：P0

### 4.4 Live Input

- 任務名稱：串接 Cloudflare Stream Live Input
- 目的：支援真直播，不只 VOD / 偽直播。
- 涉及檔案：
  - `src/components/live-stepper-form.tsx`
  - `src/app/(app)/lives/new/page.tsx`
  - `src/app/(app)/lives/[id]/edit/page.tsx`
  - `src/lib/cloudflare-stream.ts`
- 驗收標準：
  - 可建立 live input
  - 可保存 `cloudflareLiveInputUid`
  - 可顯示 stream key，但不在一般頁面明文暴露
  - 前台 `/live/:slug` 可使用 live playback
- 風險：
  - stream key 外洩會造成直播被盜用。
- 預估優先級：P1

### 4.5 Usage estimation

- 任務名稱：建立 Cloudflare Stream 用量估算流程
- 目的：支援方案用量、超額費、成本預警與 quota 控制。
- 涉及檔案：
  - `src/lib/billing.ts`
  - `src/app/(app)/billing/usage/page.tsx`
  - `src/app/api/analytics/route.ts`
  - `prisma/schema.prisma`
- 驗收標準：
  - 可估算 delivered minutes
  - 可估算 stored minutes
  - 寫入 `usage_records`
  - dashboard 可看用量趨勢
- 風險：
  - 影音成本若不可視，直播導購 SaaS 很容易毛利失控。
- 預估優先級：P1

---

## 5. Phase 4：PayUni 金流正式串接

### 5.1 Provider adapter

- 任務名稱：新增 PayUni provider adapter
- 目的：將目前 demo / ecpay-like adapter 擴充為 PayUni 實際規格。
- 涉及檔案：
  - `src/lib/payment-providers/**`
  - `src/app/api/webhooks/payments/route.ts`
  - `src/lib/payment-webhooks.ts`
- 驗收標準：
  - PayUni sandbox payload 可 normalize 成內部 payload
  - PayUni signature 驗證通過
  - failed signature 會回 401 並寫 audit log
- 風險：
  - PayUni 規格若與目前 ecpay-like 假設不同，需要調整欄位 mapping。
- 預估優先級：P0

### 5.2 Checkout flow

- 任務名稱：建立付款 checkout flow
- 目的：讓商品 / 直播 CTA 可進入 PayUni 付款流程。
- 涉及檔案：
  - `src/components/live-playback.tsx`
  - `src/app/live/[slug]/page.tsx`
  - `src/app/api/payments/checkout/route.ts`
  - `prisma/schema.prisma`
- 驗收標準：
  - 前台商品 CTA 可建立付款請求
  - 付款前保存 orderNumber
  - 付款完成後 webhook 可回寫 transaction
  - affiliate referralCode 可傳入付款 metadata
- 風險：
  - 若 orderNumber 與 referralCode 未一致保存，後續分潤與對帳會斷掉。
- 預估優先級：P0

### 5.3 Webhook signature

- 任務名稱：實作 PayUni production webhook signature 驗證
- 目的：確保金流 webhook 不是偽造請求。
- 涉及檔案：
  - `src/lib/payment-providers/payuni.ts`
  - `src/app/api/webhooks/payments/route.ts`
  - `.env.production`
- 驗收標準：
  - 正確簽章 payload 可處理
  - 錯誤簽章 payload 回 401
  - audit log 記錄 signature failed
  - 不記錄敏感 HashKey / HashIV
- 風險：
  - 簽章驗證錯誤會導致金流 webhook 全部失敗，或造成偽造入帳風險。
- 預估優先級：P0

### 5.4 Refund flow

- 任務名稱：串接 PayUni refund flow
- 目的：支援退款、退刷、部分退款與後續佣金調整。
- 涉及檔案：
  - `src/lib/payment-providers/payuni.ts`
  - `src/lib/payment-webhooks.ts`
  - `src/app/admin/billing/dashboard/page.tsx`
  - `prisma/schema.prisma`
- 驗收標準：
  - PayUni refund webhook 可建立 `refund_records`
  - 部分退款不重複建立 refund record
  - 全額退款可 void 或調整 affiliate commission
  - 月結重算會扣回退款
- 風險：
  - 退款與佣金調整若不同步，會造成商家與推廣者對帳爭議。
- 預估優先級：P0

### 5.5 Reconciliation

- 任務名稱：完成 PayUni 對帳檢查
- 目的：讓營運可檢查 webhook、交易、退款、佣金是否一致。
- 涉及檔案：
  - `src/lib/reconciliation.ts`
  - `src/app/admin/billing/webhooks/[id]/page.tsx`
  - `src/app/admin/billing/webhooks/page.tsx`
- 驗收標準：
  - webhook detail 顯示金額一致 / 不一致
  - 顯示退款一致 / 不一致
  - 顯示 referral commission 是否建立
  - 可匯出或複製差異結果
- 風險：
  - 沒有對帳中心，金流錯帳會靠人工翻 DB，正式上線不可接受。
- 預估優先級：P0

---

## 6. Phase 5：Email / Monitoring / Analytics

### 6.1 Resend

- 任務名稱：串接 Resend 交易信
- 目的：寄送報名成功、開播提醒、付款成功、退款通知、帳單與出款通知。
- 涉及檔案：
  - `src/components/message-template-form.tsx`
  - `src/app/actions.ts`
  - `src/lib/email.ts`
  - `.env.production`
- 驗收標準：
  - Resend API key 已設定
  - Email domain verified
  - 測試信可送達 Gmail
  - 失敗時寫入 log 或 audit
- 風險：
  - Email 沒有送達會影響直播提醒、付款信任與帳務通知。
- 預估優先級：P1

### 6.2 Sentry

- 任務名稱：串接 Sentry error monitoring
- 目的：監控前端、Server Actions、API routes、webhook、job 失敗。
- 涉及檔案：
  - `next.config.ts`
  - `sentry.client.config.ts`
  - `sentry.server.config.ts`
  - `.env.production`
- 驗收標準：
  - production error 可進 Sentry
  - webhook failed 有 alert
  - job failed 有 alert
  - release / environment 可區分
- 風險：
  - 沒有錯誤監控，上線後只能靠使用者回報問題。
- 預估優先級：P0

### 6.3 PostHog

- 任務名稱：串接 PostHog product analytics
- 目的：追蹤商家 onboarding、直播頁轉換、商品點擊、報名與付款 funnel。
- 涉及檔案：
  - `src/app/layout.tsx`
  - `src/components/live-playback.tsx`
  - `src/app/api/analytics/route.ts`
  - `.env.production`
- 驗收標準：
  - 前台 page view 可追蹤
  - CTA click / product click / lead submit 可追蹤
  - admin 操作 funnel 可追蹤
  - 不記錄敏感付款資料
- 風險：
  - 沒有產品分析，無法知道商家是否卡在建立直播、串商品、金流設定。
- 預估優先級：P1

### 6.4 Alert rules

- 任務名稱：建立 production alert rules
- 目的：讓 webhook、DB、金流、部署、影音錯誤可被快速發現。
- 涉及檔案：
  - Sentry Dashboard
  - Vercel Project
  - Supabase Dashboard
  - Cloudflare Dashboard
  - `src/app/api/jobs/webhook-retry/route.ts`
- 驗收標準：
  - API error alert
  - webhook failed alert
  - retry exhausted alert
  - DB connection alert
  - Cloudflare Stream usage alert
- 風險：
  - 沒有 alert，金流 webhook 失敗可能累積到月結才發現。
- 預估優先級：P0

---

## 7. Phase 6：Go-live checklist

### 7.1 Smoke test

- 任務名稱：Production smoke test
- 目的：確認正式環境核心頁面可開、登入可用、後台不爆錯。
- 涉及檔案：
  - `src/app/**`
  - Vercel Production Deployment
- 驗收標準：
  - `/login` 200
  - production `/login` 不顯示 demo 帳密提示
  - `/dashboard` 登入後可開
  - `/videos` 可開
  - `/lives` 可開
  - `/admin/billing/dashboard` 可開
  - platform admin 登入後會導向 `/admin/billing/dashboard`
  - 未登入存取 `/admin/billing/dashboard` 會導向 `/login`
- 風險：
  - 首頁可開不代表 admin / API / DB 可用，要測核心路徑。
- 預估優先級：P0

### 7.2 Payment test

- 任務名稱：Production payment sandbox / live penny test
- 目的：確認付款流程、orderNumber、referralCode、transaction 可完整串起。
- 涉及檔案：
  - `src/lib/payment-providers/**`
  - `src/app/api/webhooks/payments/route.ts`
  - `src/lib/payment-webhooks.ts`
- 驗收標準：
  - sandbox payment success
  - payment transaction created
  - affiliate commission created
  - audit log created
  - 金流後台與 app 金額一致
- 風險：
  - 金流測試不完整會導致正式收款後無法對帳。
- 預估優先級：P0

### 7.3 Webhook test

- 任務名稱：Production webhook test
- 目的：確認 webhook signature、idempotency、retry、對帳中心都可用。
- 涉及檔案：
  - `src/app/api/webhooks/payments/route.ts`
  - `src/app/api/jobs/webhook-retry/route.ts`
  - `src/app/admin/billing/webhooks/**`
- 驗收標準：
  - 正確簽章 webhook 可 processed
  - 重複 webhook 不重複入帳
  - 錯誤 webhook 進 failed
  - retry worker 可處理到期事件
  - webhook detail 顯示 reconciliation result
- 風險：
  - webhook 是金流與系統一致性的核心，不能只測付款成功頁。
- 預估優先級：P0

### 7.4 Live page test

- 任務名稱：Production live page test
- 目的：確認前台直播導購頁可播放、互動、收 lead、追蹤來源。
- 涉及檔案：
  - `src/app/live/[slug]/page.tsx`
  - `src/components/live-playback.tsx`
  - `src/app/api/analytics/route.ts`
  - `src/app/api/form-submissions/route.ts`
- 驗收標準：
  - `/live/:slug` 可開
  - 影片可播放
  - 商品浮出可點擊
  - 報名可提交
  - `?ref=` 可追蹤 affiliate
  - analytics events 正常寫入
- 風險：
  - 前台是商家與觀眾的主要體驗，若 mobile 播放卡住會直接影響成交。
- 預估優先級：P0

### 7.5 Backup restore drill

- 任務名稱：Production restore drill
- 目的：驗證備份不是「看起來有」，而是真的能還原。
- 涉及檔案：
  - Supabase Backup
  - `prisma/migrations/**`
  - `docs/production-infrastructure-plan.md`
- 驗收標準：
  - 可從 backup restore 到 staging DB
  - migration schema 與 production 一致
  - 隨機抽查 vendor / payment / settlement / webhook data
- 風險：
  - 沒做 restore drill，等真的壞掉才發現備份不能用，這個很痛。
- 預估優先級：P0

### 7.6 Rollback plan

- 任務名稱：Production rollback plan
- 目的：定義部署失敗、migration 失敗、金流 webhook 錯誤時的回復流程。
- 涉及檔案：
  - Vercel Deployments
  - Supabase Backup
  - `prisma/migrations/**`
  - `docs/production-launch-task-breakdown.md`
- 驗收標準：
  - Vercel rollback 流程已演練
  - DB rollback / restore 流程已文件化
  - webhook 暫停 / 重送流程已文件化
  - 金流 production 切回 sandbox 或 maintenance mode 策略已確認
- 風險：
  - 沒 rollback plan，上線事故會拖成營運事故。
- 預估優先級：P0

---

## 8. 建議執行順序

1. Phase 0：先確認帳號、網域、金流申請與 email domain。
2. Phase 1：先處理 PostgreSQL migration 與 production seed policy。
3. Phase 2：完成 Vercel / Cloudflare DNS / env vars / custom domain。
4. Phase 4：優先 PayUni 金流正式串接，因為金流審核與 webhook 測試最容易拉長時程。
5. Phase 3：Cloudflare Stream API 串接可與 Phase 4 平行。
6. Phase 5：Sentry / alert rules 要在 go-live 前完成，PostHog 可稍後補深。
7. Phase 6：Go-live checklist 必須逐項簽核，不建議省略。

---

## 9. 最小可收費 MVP 必做 P0 清單

- 確認正式網域
- 確認 Cloudflare 帳號與 DNS
- 確認 Vercel production project
- 確認 Supabase production project
- PayUni sandbox / production 申請
- Prisma PostgreSQL migration
- Production seed policy
- Backup policy
- Vercel env vars
- Custom domain
- Production build / deploy 驗證
- Cloudflare Stream upload API
- Direct creator upload
- Stream webhook
- PayUni provider adapter
- Checkout flow
- PayUni webhook signature
- Refund flow
- Reconciliation
- Sentry
- Alert rules
- Smoke test
- Payment test
- Webhook test
- Live page test
- Backup restore drill
- Rollback plan
- 第一個 platform admin bootstrap
