# B-05／B-06 回執：Next.js 慣例與效能成本審查

- 執行者：B-05／B-06 子代理（唯讀）
- 日期：2026-10-19
- 產出：`docs/review-2026Q4/15-nextjs-conventions.md`、`docs/review-2026Q4/16-performance-cost.md` 與本回執。
- 基線：`codex/goal-review-2026q4` = origin/master `78621ca3`；`next` 16.3.8、`react`／`react-dom` 19.2.4、`@prisma/client` 6.19.3。
- 修改既有檔案：無。沒有任何 git 寫入；沒有讀取 `.env*`；沒有連線任何資料庫或外部服務；沒有執行 `next dev`／`next build`。暫存腳本（`scan.mjs`、`boundary.mjs`）只放在 session scratchpad，未進 repo。唯一執行的測試：`npx vitest run` 3 個檔案（`src/app/(app)/messages/deliveries/error.test.tsx`、`src/components/billing/finance-route-states.test.tsx`、`src/proxy.test.ts`），21 個測試全過（這些測試不需 DB）。

## 讀過的 Next.js docs（`node_modules/next/dist/docs/01-app/`）

「全文」＝讀完整頁；「部分」＝讀指定行段；「標題／grep」＝只看標題或用 grep 擷取相關段落。

### 03-api-reference/03-file-conventions
- `proxy.md`（部分：1-260 行 + 版本表）
- `middleware.md`（grep：確認已棄用並更名）
- `error.md`（部分：1-220 行 + Version History）
- `loading.md`（部分：1-120 行，含 SEO、Status Codes）
- `layout.md`（部分：「Interaction with `loading.js`」）
- `route.md`（grep：`preferredRegion` 相關）
- `02-route-segment-config/runtime.md`（全文）、`preferredRegion.md`（全文）、`maxDuration.md`（部分）、`index.md`（grep）

### 01-getting-started
- `08-caching.md`（部分：1-200 行）
- `15-route-handlers.md`（部分：1-200 行，含「Caching」「With Cache Components」）
- `10-error-handling.md`（標題／grep：`retry()` 範例）
- `07-mutating-data.md`、`05-server-and-client-components.md`（標題）

### 02-guides
- `public-static-pages.md`（部分：1-200 行）
- `caching-without-cache-components.md`（部分：1-140 行）
- `streaming.md`（grep：status code、bots、proxy 建議段落）
- `server-actions.md`（部分：1-40、141-200 行）
- `forms.md`（部分：Pending states、Optimistic updates；其餘標題）
- `production-checklist.md`（部分：1-130 行）
- `lazy-loading.md`（部分：1-60 行；標題）
- `videos.md`（部分：1-60 行）
- `migrating-to-cache-components.md`（部分：標題、100-175 行）
- `upgrading/version-16.md`（部分：1-200 行）
- `deploymentId.md`（部分：1-40 行）
- `server-and-client-boundary.md`、`incremental-static-regeneration.md`、`how-revalidation-works.md`、`package-bundling.md`（標題）

### 03-api-reference/04-functions
- `revalidatePath.md`（部分：1-200 行）
- `revalidateTag.md`（grep：單參數棄用）
- `unstable_cache.md`（部分：1-30 行）
- `unstable_noStore.md`（grep：版本表）
- `after.md`（部分：1-60 行）
- `generate-metadata.md`（grep + 部分：Streaming metadata、With Cache Components、棄用提示）
- `cookies.md`、`headers.md`、`draft-mode.md`（grep：非同步存取棄用提示）

### 01-directives、02-components、05-config
- `01-directives/use-cache.md`（部分：1-40 行）
- `02-components/image.md`（grep + 285-310 行：`priority` 棄用；Version History）
- `05-config/01-next-config-js/cacheComponents.md`（部分：1-60 行）
- `05-config/01-next-config-js/optimizePackageImports.md`（部分：1-60 行）
- `05-config/01-next-config-js/serverActions.md`（部分：1-50 行）
- `05-config/01-next-config-js/deploymentId.md`（見上）

### 全 docs 掃描
- 以 `grep -n -i "deprecat"` 掃 `03-api-reference`、`01-getting-started`、`02-guides`（排除 14／15 升級指南）取得棄用清單。

## 為取證而讀的 Next.js runtime 檔（非 docs）

- `node_modules/next/dist/client/components/error-boundary.js`（`retry`／`reset`／傳給 `errorComponent` 的 props）
- `node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js`、`app-page.runtime.prod.js`（`unstable_retry` 出現 0 次；`retry:this.retry` 存在）
- `node_modules/next/dist/bundle-analyzer/_next/static/chunks/0qgq.-.c2spwh.js`（舊版 bundle 中唯一出現 `unstable_retry` 的位置）

## 讀過的 repo 文件

- `docs/review-2026Q4/01-system-map.md`、`04-static-scan.md`、`19-observability-ci-supply-chain.md`、`12-tenant-auth.md`（格式參考）
- `docs/launch/CURRENT.md`（Dashboard 與區域段落）
- `reports/review-2026Q4/A-04-nextjs-deprecation.txt`、`B-04-receipt.md`（格式參考）
- `PRODUCT.md`（設計原則 4）
- `docs/market-2026Q4/research_notes/台灣直播導購 SaaS 市場研究 2026/c05_payments_integrations_unit_costs.md`（Vercel hnd1、Cloudflare Stream、R2 單價與情境）
- `docs/live-commerce-mvp-report.md`、`docs/production-database-runbook.md`、`docs/staging-backup-restore-drill-runbook.md`（pooler 與區域紀錄，grep）

## 主要程式檔（節錄）

`src/proxy.ts`、`src/lib/public-landing-page-status.ts`、`src/lib/landing-page-service.ts`、`src/lib/funnel-runtime.ts`、`src/lib/auth.ts`、`src/lib/db.ts`、`src/lib/live-chat.ts`、`src/lib/stream-usage.ts`、`src/lib/stream-usage-client.ts`、`src/lib/cloudflare-stream.ts`、`src/lib/cloudflare-stream-webhook-handler.ts`、`src/lib/live-playback-source.ts`、`src/lib/r2-images.ts`、`src/lib/rate-limit.ts`、`src/lib/customer-crm.ts`、`src/lib/student-course-learning.ts`、`src/lib/student-portal.ts`；`src/app/layout.tsx`、`(app)/layout.tsx`、`(app)/dashboard/**`、`lp/**`、`p/**`、`form/**`、`(viewer)/live/**`、`portal/**`、9 個 `error.tsx` 與 `global-error.tsx`；`src/app/api/live-chat`、`live-interactions`、`live-media`、`stream-usage`、`media/**`、`dashboard/details`；`src/components/live-playback.tsx`、`live-chat-panel.tsx`、`live-advanced-interactions.tsx`、`persistent-live-playback.tsx`、`promo-video-player.tsx`、`media-upload-field.tsx`、`course-player.tsx`、`form-submit-button.tsx`；`next.config.ts`、`vercel.json`、`vercel.staging.json`、`sentry.*.config.ts`、`src/instrumentation-client.ts`。

## 掃描與取證（可重現）

1. `grep -rE "use cache|cacheLife|cacheTag|unstable_cache"` → 0。
2. `grep -rnE "^export const (dynamic|revalidate|runtime|maxDuration|preferredRegion)"` → 19 個 `force-dynamic`、2 個 `revalidate`、7 個 `runtime = "nodejs"`、0 個 `maxDuration`／`preferredRegion`。
3. 自寫 Node 腳本（scratchpad）掃 `src/` 非測試檔的 `findMany`：351 個，無 `take` 211 個，含 `include` 46 個，兩者皆是 29 個（清單在 `16-performance-cost.md` 附錄 A）。
4. 自寫 Node 腳本掃 129 個 `"use client"` 檔的 import 圖（遇 `"use server"` 停止）：只有 `form-submissions-workbench.tsx → form-submission-search.ts → db.ts` 一條。
5. `grep` 全部 `setInterval`／`setTimeout` 輪詢並逐一讀對應 route（`16-…` 附錄 B）。
6. 以 `<form … action={` 與 `<button`／`SubmitButton`／`FormSubmitButton`／`DangerButton` 交叉比對（`15-…` B05-09 的 12 個檔案）。
7. `grep -c unstable_retry node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js` → 0。

## 未做的事與限制

- 沒有 `next build`：First Load JS、route 靜態／動態實際標記、streaming 實際 HTTP 狀態、Sentry 在 Turbopack 的行為（見 `19-…` B09-06）都未量測。
- 沒有負載測試與 SQL log：所有 SQL 往返數與 req/s、SQL/s 是依程式碼計數的估計。
- 沒有 Vercel／Supabase／Cloudflare 實際設定：production 區域、連線池、Skew Protection、Stream signed URL 狀態、媒體伺服器部署皆為「待 owner 確認」。
- `reset` 在 server 端錯誤下是否真的無法復原（B05-02）依 docs 與 `error-boundary.js` 推論，未在瀏覽器實測。
- 成本單價引用 `docs/market-2026Q4` 的研究（存取日 2026-10-18），未重新查證官方頁面。
