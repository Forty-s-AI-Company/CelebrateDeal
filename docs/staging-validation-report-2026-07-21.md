# CelebrateDeal Staging 上線驗收報告（2026-07-21）

## 驗收邊界

- 僅操作 CelebrateDeal Staging Supabase 與 Vercel Preview scope。
- 未操作 Production 資料庫、Production deployment、正式付款、正式退款或正式 Cloudflare 資源。
- PayUni Sandbox QA 依本輪規則完全跳過。
- AI Team、Supervisor、Watchdog 與 revive timer 全程保持停用。
- 報告不包含環境變數值、token、測試收件人、交易識別或 provider response。

## 部署前結果

- 基準 Git HEAD：`3453ee9`；本輪 Sentry 環境隔離修正：`65b645f`。
- Git 工作樹於驗收開始時乾淨。
- ESLint、TypeScript、91 個測試檔／711 項測試與 Production Build 通過。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- 本機 `prisma migrate status`：7 個 migration，schema up to date。
- Supabase CLI linked project 已確認為 `CelebrateDeal Staging`（Tokyo），不是 Production project。
- `NEXT_PUBLIC_SUPABASE_URL` 與 publishable key 均匹配 Staging project。

## 備份、還原與 migration

- Supabase Staging 目前沒有可列出的 physical backup，PITR 未啟用。
- migration 前已在 repository 外、權限受限的本機 state 目錄建立：
  - custom roles 邏輯備份；
  - `public` schema 邏輯備份；
  - `public` data 邏輯備份。
- 還原演練使用一次性隔離 PostgreSQL 容器，完成 roles、schema、data 還原後再套 migration，容器隨後刪除。
- 還原程序需先讓 restore 管理角色取得 `prisma` membership 與 `public` schema 權限；補齊後演練通過。
- 還原與 migration 彩排 RTO：21 秒（本機隔離環境基準，不代表 Supabase 平台完整 restore 時間）。
- `20260721133000_inventory_reservations` 已只對 Staging 執行 `prisma migrate deploy`。
- migration 後驗證通過：
  - Prisma migration history 為 finished、未 rolled back；
  - `InventoryReservation` 存在；
  - 3 個外鍵存在；
  - 3 個唯一索引存在；
  - 既有 Vendor 資料可讀；
  - migration status up to date。

## 庫存 reservation 驗收

以下測試直接連接 Staging DB，僅建立有唯一前綴且保存 ID 的假資料，`afterEach` 依 ID 清理；驗收前後 fixture 數量差為 0：

- 原子保留及 paid 重送只 commit 一次：通過。
- 最後一件商品兩筆併發 checkout 只允許一筆成功：通過。
- provider checkout 建立失敗釋放 reservation，重送不重複補庫存：通過。
- partial refund 不補庫存，full refund 重送只補一次：通過。
- 逾時 pending reservation 釋放並標記 expired：通過。
- payment webhook paid／refund 重送完整生命週期：通過。

跨區域 DB 驗收使用 30 秒測試 timeout；第一次 5 秒 timeout 屬網路驗收時間不足，調整後 assertion 全數通過，沒有修改產品邏輯或降低條件。

## Vercel Preview 與環境隔離

- 既有 `celebratedeal.carry-digital-nomad.in.net` 經 Vercel inspect 確認為 **Production target**，本輪未部署、改 alias 或用作 Staging。
- Vercel Preview 原先沒有環境變數；本輪只在 Preview scope 補上已驗證的 Staging Supabase、DB、Resend、Sentry、PostHog、CSRF/JOB 與安全 smoke 開關。
- Preview payment provider 設為 `demo`；Cloudflare、PayUni 與 demo webhook 外部 smoke 均為 `false`。
- 尚未加入 Cloudflare credentials 與 `RATE_LIMIT_PROVIDER`，因此 release preflight 會 fail-closed，Preview deployment 未執行。

## Email、Sentry、Cloudflare、CSP

- Resend API 可達，`EMAIL_FROM` 網域存在且為 Verified。
- 單一 `SMOKE_TEST_EMAIL` 已配置；因 Preview deployment 尚未通過安全閘門，本輪沒有寄信。
- Sentry server DSN 已配置，client DSN 原先未配置；本輪已在 Preview 將 client DSN 與明確 `staging` environment tag 補齊。
- Sentry project API 驗證未通過；在 project/token scope 未確認前，未送 synthetic error。
- Cloudflare Stream token 驗證有效，但 account 查詢權限不足，無法證明資源為獨立 Staging；未建立影片、Live Input 或執行 webhook 外部 QA。
- CSP 維持 Report-Only。因沒有新的安全 Preview deployment，本輪沒有足夠的新 violation 樣本，未切換 enforce。

本輪程式修正後的最終 gate：ESLint、TypeScript、92 個測試檔／715 項測試、Production Build 與 high-level dependency audit 全數通過。

## 阻擋 Preview deployment 的項目

1. 設定 durable rate limiter：
   - 提供 Staging Upstash REST URL/token 並設定 `RATE_LIMIT_PROVIDER=upstash_redis`；或
   - 建立獨立、受 Cloudflare WAF 保護的 Staging domain，確認規則後設定 `RATE_LIMIT_PROVIDER=cloudflare_waf`。
2. 提供可證明為 Staging 的 Cloudflare Stream account/resource scope；目前 token 雖有效，但 account identity 無法驗證。
3. 修正或補足 Sentry project API token scope，確認指定 project 與 source-map upload 權限。

以上條件完成前，不得用 Production alias 代替 Staging，也不得把缺少的安全條件偽裝成已通過。
