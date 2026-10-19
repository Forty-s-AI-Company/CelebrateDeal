# B-02 Receipt：多租戶與授權

- 基線：`78621ca32cabfc016a69504c996c107785987cc2`（`git describe` = `review-baseline-2026Q4`；工作分支 `codex/goal-review-2026q4`）
- 時間：2026-10-19 12:49 至約 13:10（約 21 分鐘）
- 模式：唯讀。沒改程式、沒有 git 寫入、沒讀 `.env*`、沒連任何 DB 或 Supabase。暫存掃描腳本放在 session scratchpad，不在 repo 內。
- 執行者：reviewer 子代理（Opus）；本收據與 `12-tenant-auth.md` 由主對話依 reviewer 回報原文存檔。

## 執行命令
- `git rev-parse HEAD`、`git describe --tags --always`
- `gh pr view 436 --json title,state,body,headRefName,files`：結果 state=OPEN
- 對 122 條 route 逐一 grep 防護函式：`for f in $(find src/app -name route.ts) … grep -oE "require[A-Z]\w*\(|getCurrentAuth\(|requireMerchantApiActor|verifyCsrfToken|assertServerActionSecurity|requireSameOriginRequest|checkRateLimit|requireStudent\w*"`
- `/api/admin/ops/**` 28 條 grep `requireJobSecret|authorizeWp4Ops|VERCEL_ENV|…`
- 用 Node 腳本掃 46 個 `"use server"` 檔的 183 個 export 是否有 actor guard 與 CSRF，標出約 80 個（多數是 4 行的 wrapper），再逐一人工確認
- `grep -rnE "\.(update|delete|findUnique|findUniqueOrThrow|upsert)\(\{\s*where:\s*\{\s*id" src/app src/lib`：81 處逐一判讀
- `grep -rlniE "row level security|create policy" prisma/migrations`，再用迴圈比對每個 `CREATE TABLE` 有沒有對應的 `ENABLE ROW LEVEL SECURITY`：148 張表中有 77 張缺
- 跨租戶測試關鍵字掃描（`cross-tenant|other vendor|foreign|跨租戶|tenant…`）：127 個檔命中，再對每個 action 檔統計命中數
- `npx vitest run src/lib/auth.test.ts src/lib/csrf.test.ts src/lib/merchant-api-security.test.ts src/lib/api-security.test.ts src/lib/data-api-hardening-migration.test.ts src/lib/team-funnel-access.test.ts`：6 個檔、95 個測試全部通過（其中 `auth.test.ts:224` 證實了 B02-01）

## 逐檔閱讀
- lib：`auth.ts`（全文）、`csrf.ts`（全文）、`api-security.ts`（1-120）、`merchant-api-security.ts`（全文）、`sensitive-data.ts`（全文）、`student-portal-auth.ts`（283-400）、`mfa-enrollment.ts`、`mfa-recovery-regeneration.ts`、`wp4-runtime-boundary.ts`（20-61）、`rate-limit.ts`（140-185）、`env.ts`（片段）、`affiliate-portal.ts`（1-60）、`affiliate-payee-profile.ts`／`affiliate-remuneration-quotes.ts`（綁定段）、`cloudflare-ops.ts`（綁定段）、`funnel-operations-service.ts`（17-140）、`sales-project-scope.ts`、`platform-plan-checkout.ts`（268-308）、`platform-referral.ts`、`commerce-shipping-action.ts`、`password-reset.ts`（片段）、`team-funnel-access.ts`／`team-funnel-product-slots.ts`（片段）
- route：10 條「grep 不到防護」的全文；`admin/ops/cloudflare/{direct-upload,live-input}`、`test-email`、`api/cloudflare/direct-upload`、`media/videos/status`、`live-presenter`、`live-danmaku/scripted`、`live-playback-source`、`live-purchase-broadcasts`、`live-chat/messages`（1-60）、`products/upsert`、`orders/shipping`、`team-funnel/{product-slots,pages}`、`payments/checkout`（ID 綁定段）
- actions：`affiliate-remuneration-actions.ts`、`affiliate-actions.ts`、`auth-security-actions.ts`（205-290）、`consultation-actions.ts`（370-545）、`funnel-automation-actions.ts`、`funnel-operations-actions.ts`、`vendor-member-actions.ts`（36-235）、`team-membership-actions.ts`（guard 地圖）、`invoice-actions.ts`（綁定段）、`interaction-actions.ts`（703-950）、`support-case-actions.ts`（guard 地圖）、`actions.ts`（guard 地圖 580-2460、1739-1800）
- 頁面：`admin/layout.tsx`、`(app)/affiliates/[id]/access/page.tsx`、`affiliate-portal/page.tsx`、`(viewer)/live/[slug]/page.tsx`（1-200）、`(app)/affiliates/**` 與 `support-cases`／`customers`／`orders` 的 guard
- schema 與 migration：`VendorMember`、`AffiliatePortalAccess`、`Vendor`、`UserOnboardingPreference`；`20260724150000_harden_supabase_data_api`
- 測試：`auth.test.ts`（203-245）

## 抽查比例
- route：防護 grep 100%（122/122）；全文閱讀約 25%；admin/ops 100% 追到 guard
- Server Action：自動掃描 100%（183 個 export）；人工讀到最後 DB 操作的約 30 個（約 16%），包含系統地圖 Critical 子集合中所有商家層級的函式

## 未完成或未覆蓋
- `form-submissions`（797 行）、`live-interactions`（501 行）、`payments/checkout` 的完整邏輯；`portal/**` 的 route 只看了 guard
- 144 個 page.tsx 只 grep 角色
- staging／production 的實際 Supabase GRANT 與 RLS、`RATE_LIMIT_PROVIDER`、`JOB_SECRET` 是否跨環境共用：需 owner 或受控 runner 驗證（B02-03、B02-05、B02-09）
- 沒有跑 DB 測試（`*.db.test.ts`），也沒有跑 e2e
- 依審查者角色限制，這份 receipt 和 `12-tenant-auth.md` 沒有由 reviewer 寫入，由主對話存檔

## 結果
BLOCKER 1（B02-01）、MAJOR 1（B02-02）、MINOR 7、NIT 6。
