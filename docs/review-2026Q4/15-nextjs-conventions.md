# 15 Next.js 16 / React 19 慣例審查（B-05）

> 基線 `review-baseline-2026Q4` = `78621ca3`（審查時 HEAD 與 origin/master 相同）。全程唯讀：沒有修改既有檔案、沒有 git 寫入、沒有讀 `.env*`、沒有連任何外部服務、沒有執行 `next dev`／`next build`。審查者：B-05 子代理。
> 所有「是否符合 Next.js」的判斷都以 `node_modules/next/dist/docs/`（`next` 16.3.8）與 `node_modules/next/dist/` 內的實際 runtime 程式碼為準，沒有憑記憶。讀過的 docs 檔案清單見 `reports/review-2026Q4/B-05-06-receipt.md`。

## 0. 結論先講

1. **有一個已確定的功能性缺陷**：3 個 error boundary（商家帳務、平台帳務、Email 寄送紀錄）使用 `unstable_retry`，但 16.3.8 的 runtime 只傳 `reset` 與 `retry`（`retry` 在 v16.3.0 轉為穩定，`unstable_retry` 已不存在）。按下「重新載入」會呼叫 `undefined`，錯誤無法復原。對應的單元測試是手動塞 `unstable_retry` prop，所以測試全綠但真實環境壞掉（B05-01）。
2. **另有 5 個 error boundary 用 `reset`**。docs 明說 `reset` 只清掉 client 端錯誤狀態、不重新取資料；server 端渲染錯誤（例如 Dashboard 的 DB 逾時，也就是已知的 Dashboard 問題）按了不會恢復，要用 `retry()`（B05-02，需實測確認行為）。
3. 專案其餘 Next 用法大致符合 16.3.8：`proxy.ts` 命名與 Node runtime 正確、沒有 `middleware`、沒有 `getServerSideProps`、`params`／`searchParams`／`cookies()` 都有 `await`、沒有 `unstable_cache`、`preferredRegion`、單參數 `revalidateTag`。真正在用的已棄用項目只有 `<Image priority>`（2 處）。
4. `proxy.ts` 對 `/lp/*` 每個 GET／HEAD 請求（含 RSC 導覽）讀一次資料庫並取回整份已發布 `content` JSON，與 docs「proxy 檢查要快、不要取完整內容」的建議相反，且同一個請求之後 page 還會再讀兩次（B05-04；效能面見 `16-performance-cost.md` B06-04）。
5. 專案**沒有啟用 `cacheComponents`**，完全沒有 `'use cache'`／`cacheLife`／`cacheTag`；只有 2 個政策頁用 `revalidate = 3600`，19 個檔案用 `dynamic = "force-dynamic"`。這是「previous model」，在 16.3.8 仍受支援；但日後要啟用 `cacheComponents` 時，這 21 個檔案的 segment config 都會報錯，需要列入遷移估工（B05-10）。
6. React 19 的 `useActionState`（19 個檔案）與 `useFormStatus`（集中在共用的 `FormSubmitButton`）用法正確；`useOptimistic` 0 處（不需要）。PRODUCT.md 原則 4（每次操作都有回音）大部分已由 `FormSubmitButton` 落實，但仍有 **12 個檔案的表單**用裸 `<button>`，沒有 pending／防重送；其中包含推廣夥伴「簽署提領」與「方案結帳」這種金流相鄰操作（B05-09）。

## 1. 方法與覆蓋

- **docs 優先**：先讀 `proxy.md`、`error.md`、`loading.md`、route handlers、`caching`、`cacheComponents`、`public-static-pages`、`caching-without-cache-components`、`streaming`、`server-actions`、`forms`、`revalidatePath`、`after`、`generate-metadata`、`image`、`migrating-to-cache-components`、`version-16` 等，再對照程式。
- **以 runtime 為準**：docs 與程式不一致時，直接讀 `node_modules/next/dist/client/components/error-boundary.js` 與編譯後的 `dist/compiled/next-server/app-page*.runtime.prod.js`，確認 error boundary 實際傳給 `error.tsx` 的 props。
- **靜態掃描**：自寫的唯讀 Node 腳本（放在 session scratchpad，不進 repo）掃 `src/`：`"use client"` 邊界、client 元件可達的 server 專用模組、`findMany` 是否有 `take`。
- **既有測試**：`npx vitest run` 跑 `messages/deliveries/error.test.tsx`、`components/billing/finance-route-states.test.tsx`、`proxy.test.ts`，3 檔 21 個測試全過（這正是 B05-01 的證據：測試通過但 runtime 壞）。
- **未覆蓋**：沒有 `next build`／`next dev`（因此 First Load JS、實際 route 的 static／dynamic 標記、streaming 實際 HTTP 狀態都沒量到）；沒有瀏覽器實測；`reset` 行為（B05-02）是依 docs 與 runtime 原始碼推論，未實際觸發。

## 2. 程式使用的 Next API 與 16.3.8 docs 對照

| 項目 | 現況（證據） | 結論 | 對應 docs |
|---|---|---|---|
| `proxy.ts` | `src/proxy.ts` 匯出 `proxy`，無 `runtime` export，matcher 為常數 `["/__celebratedeal_wp187_fingerprint\\.json", "/lp/:path*"]`（`:127`）；無 `middleware.*` | 命名、runtime、matcher 皆合規。職責：lineage marker 回應、`/lp/*` 公開頁 404／503 預檢、訪客 cookie 注入。沒有拿 proxy 當唯一授權（授權在各 action／lib），符合「不要只靠 proxy」 | `03-file-conventions/proxy.md`「Matcher」「Execution order」「Runtime」 |
| proxy 內讀 DB | `src/proxy.ts:37-47` → `publicLandingPageStatus` 取 `publishedVersion.content`（`public-landing-page-status.ts:135`） | 能運作（Node runtime 可用 Prisma），但與建議相反，見 B05-04 | `03-file-conventions/loading.md`「Status Codes」、`02-guides/streaming.md`「Status codes」：「Keep proxy checks fast, and avoid fetching full content there」 |
| error boundary | 9 個 `error.tsx` + `global-error.tsx`；3 個用 `unstable_retry`、5 個用 `reset`、`p/[slug]/error.tsx` 與 `global-error.tsx` 沒有任何重試 | **不合規**，見 B05-01／02／03 | `03-file-conventions/error.md`「retry」「reset」「Version History」 |
| `'use cache'`／`cacheLife`／`cacheTag` | 0 處；`next.config.ts` 無 `cacheComponents` | 屬 previous model，合規；注意與 `revalidate`／`dynamic` 的互斥（B05-10） | `01-getting-started/08-caching.md`、`cacheComponents.md`、`migrating-to-cache-components.md` |
| `revalidate` | `src/app/policies/page.tsx:12`、`policies/[slug]/page.tsx:7` 皆 `3600`，後者另有 `generateStaticParams`（`:13`） | 合規，也是全站唯一預先渲染的公開內容頁 | `02-guides/caching-without-cache-components.md`「Route segment config」 |
| `dynamic = "force-dynamic"` | 19 個檔案：16 頁（`lp/[slug]`、`lp/[slug]/[stepPath]`、`checkout/result`、`checkout/recover/[grantId]`、`verify-registration`、`portal/**` 6 頁、`support/**` 5 頁）＋3 個 route handler（`api/admin/ops/provider-runtime`、`lp/…/play`、`portal/notify.link`） | 合規但多數是冗餘（這些頁本來就讀 `cookies()`／`searchParams`），僅作為明確標記。啟用 `cacheComponents` 時必須移除 | `migrating-to-cache-components.md`「`dynamic = "force-dynamic"`」：Not needed |
| `export const runtime = "nodejs"` | 7 個 route 檔（`api/media/**`、`api/live-studio/drafts`、`provider-runtime`） | `nodejs` 是預設值，冗餘無害；docs 只要求移除 `edge` | `02-route-segment-config/runtime.md` |
| `maxDuration`／`preferredRegion` | 0 處 | 區域不在程式內設定是對的（`preferredRegion` 已棄用）；但這也代表區域完全靠 Vercel 專案設定（見 `16-performance-cost.md` B06-03） | `preferredRegion.md`（deprecated）、`maxDuration.md` |
| Route handler `GET` 快取語意 | 122 個 `route.ts`，沒有任何 `force-static`；輪詢類 GET 皆自行設 `Cache-Control: private, no-store`（例如 `api/live-chat/messages/route.ts:17`、`api/dashboard/details/route.ts:5`） | 合規：未啟用 `cacheComponents` 時 GET handler 預設不快取，且 handler 讀 `request.url`／DB／cookie 本來就是動態 | `01-getting-started/15-route-handlers.md`「Caching」 |
| `generateMetadata`／`generateViewport` | 15 個檔案有 metadata；`lp/[slug]`（`:19`）與 `form/[slug]` 用 React `cache()` 讓 metadata 與 page 共用同一次查詢 | 合規。缺口：`/live/[slug]`、`/p/[slug]` 沒有 metadata（B05-07） | `04-functions/generate-metadata.md`「Streaming metadata」 |
| `loading.tsx` | 32 個；`form`、`lp`、`p`、`registration-error`、`browser-qa`、`@checkout`、`portal` 刻意不放（`src/app/loading.test.tsx` 固定這份清單，理由是 loading 的 Suspense 邊界會讓原生表單重試頁在沒有 JS 時不可見） | 設計有據。副作用：有 `loading.tsx` 的段落 `notFound()` 一律回 HTTP 200（B05-08） | `03-file-conventions/loading.md`「Status Codes」 |
| Streaming 與 200 | `CURRENT.md` 記錄「HTTP 200 是串流回應」；WP-01 用 proxy 預檢處理 `/lp/*` | 預檢方式是 docs 認可的作法之一，但代價見 B05-04；`lp` 本身沒有 `loading.tsx`，需確認 page 內 `notFound()` 是否已足夠（B05-04 建議第 1 點） | `02-guides/streaming.md`「The HTTP contract」「Status codes」 |
| `params`／`searchParams`／`cookies()`／`headers()` | 全部以 Promise 型別並 `await`；沒有同步存取 | 合規（15 起的 async request APIs） | `03-file-conventions/page.md`、`04-functions/cookies.md` |
| Server Actions | 46 個 `"use server"` 檔；沒有設定 `serverActions.bodySizeLimit`（預設 1MB）；檔案上傳走 R2 預簽、Stream direct／tus，不經 action | 合規。部署期間 action ID 會輪替，需確認 Skew Protection（B05-12） | `02-guides/server-actions.md`「Deployment considerations」、`05-config/…/serverActions.md` |
| `revalidatePath` | 137 處；其中 `revalidatePath("/", "layout")` 與 `"/(app)", "layout"` 共 14 處 | 語法合規（route group 寫法在 docs 範例內）；成本偏高，見 B05-11 | `04-functions/revalidatePath.md`「Revalidating all data」「Server Function」 |
| `after()` | 僅 `src/lib/password-reset.ts:119` | 合規，但公開頁的訪客寫入沒有用（B06-04） | `04-functions/after.md` |
| `next/image` | 10 個檔案；`images.unoptimized: true`（`next.config.ts:30`）；`<Image priority>` 2 處 | `unoptimized` 是有註解的決策；`priority` 已棄用（B05-05） | `02-components/image.md`「priority」 |
| `lucide-react` | 67 個檔案具名匯入 | 合規：`lucide-react` 在 Next 預設的 `optimizePackageImports` 清單內，具名匯入只載入用到的模組 | `05-config/…/optimizePackageImports.md` |
| 動態載入 | `next/dynamic` 3 處（Puck 編輯器、漏斗編輯器、`PersistentLivePlayback`）；`hls.js` 以 `import()` 懶載入（`live-playback.tsx:1684`、`promo-video-player.tsx:48`） | 合規，策略正確 | `02-guides/lazy-loading.md` |
| 實驗旗標／lint | `next.config.ts` 無 `experimental`；`lint` 為 `eslint`（非 `next lint`）；`dev`／`build` 無 `--turbopack` | 合規（Turbopack 預設） | `02-guides/upgrading/version-16.md` |

### 2.1 Server／Client 邊界

- `"use client"`：129 個非測試檔（126 個 `.tsx`、3 個 `.ts`），其中 `src/app` 底下 14 個。數量合理，大多是互動表單與直播元件。
- 沒有發現「把大型 server 資料序列化進 client」的結構性問題；有兩類值得注意：
  - **未分頁的清單當 props 傳進 client 元件**：`lives/new/page.tsx:65-122` 一次把商品、影片、表單、範本、腳本、推廣夥伴、團隊成員全部傳給 `LiveStepperForm`（63 KB 的 client 元件），資料量隨商家目錄線性成長（B06-11）。
  - **client 元件匯入含 DB 的模組**：`src/components/form-submissions-workbench.tsx:11` 從 `@/lib/form-submission-search` 匯入常數 `FORM_SUBMISSION_QUERY_MAX_LENGTH`，而該檔 `import { getDb } from "@/lib/db"`（`form-submission-search.ts:2`）。整個專案只有 1 個檔案 `import "server-only"`，`db.ts`、`auth.ts`、`r2-images.ts` 都沒有（B05-06）。
- 自寫腳本掃 129 個 client 檔的 import 圖（遇到 `"use server"` 檔即停止），只找到上述 1 條會碰到 `db.ts` 的路徑。

### 2.2 Streaming、loading 與 HTTP 狀態碼

`loading.md`「Status Codes」與 `streaming.md`「Status codes」：一旦 Suspense fallback 或 `loading.tsx` 觸發串流，狀態碼已送出為 200，之後的 `notFound()` 只會注入 `<meta name="robots" content="noindex">`。docs 的兩種解法：把 `notFound()` 放在任何 `await` 與 Suspense 之前，或在 proxy 提前回應。

專案的做法：

- 公開註冊／漏斗類頁面（`form`、`lp`、`p`、`portal`）不放 `loading.tsx`，讓 `notFound()` 有機會產生真 404。
- `/lp/*` 另外在 proxy 預檢（WP-01，#440），確保「頁面不存在或未發布」是真 404、DB 失敗是真 503。
- 其餘有 `loading.tsx` 的段落（`/live/[slug]`、`checkout/**`、`support/**`）仍是串流 200（B05-08）。

## 3. 棄用或即將棄用的用法

| 用法 | 位置 | docs | 狀態／處置 |
|---|---|---|---|
| `unstable_retry` prop | `src/app/(app)/billing/error.tsx:5,7,20`、`src/app/admin/billing/error.tsx:5,7,20`、`src/app/(app)/messages/deliveries/error.tsx:4,7,17`；測試 `error.test.tsx:10`、`finance-route-states.test.tsx:42,58` | `error.md`「Version History」：v16.2.0 加入 `unstable_retry`、**v16.3.0 `retry` 轉穩定** | **已失效，不只是棄用**（runtime 不再傳入）。改用 `retry` |
| `reset` 當主要復原手段 | `(app)/dashboard/error.tsx:14`、`(app)/billing/usage/error.tsx:12`、`admin/billing/stream-reconciliation/error.tsx:8`、`checkout/[vendorId]/[productId]/error.tsx:19`、`checkout/result/error.tsx:20` | `error.md`「reset」：「In most cases, you should use `retry()` instead」 | 建議改 `retry`（B05-02） |
| `<Image priority>` | `src/app/form/[slug]/page.tsx:85`、`src/components/commerce-checkout-entry.tsx:146` | `image.md`「priority」：Next.js 16 起棄用，改用 `preload`，多數情況用 `loading="eager"`／`fetchPriority="high"`；`Version History v16.0.0` | 已棄用，仍可運作（B05-05） |
| `dynamic`／`revalidate` segment config | 19 + 2 個檔案 | `migrating-to-cache-components.md` L76：啟用 `cacheComponents` 後仍匯出 `dynamic`、`revalidate`、`fetchCache` 的 segment 會報錯 | 目前不是問題；啟用前要處理（B05-10） |
| `unstable_cache` | 0 處 | `unstable_cache.md`：16 起由 `use cache` 取代 | 未使用 |
| `middleware.ts`、`next/legacy/image`、`next/router`、`getServerSideProps`、`experimental_ppr`、`unstable_noStore`、`preferredRegion`、單參數 `revalidateTag`、`images.domains` | 0 處（`reports/review-2026Q4/A-04-nextjs-deprecation.txt` 與本次 grep 一致） | 各自 deprecated／removed | 未使用 |

## 4. React 19

| API | 使用 | 判斷 |
|---|---|---|
| `useActionState` | 19 個 client 檔，簽章一律 `[state, action, pending]`（部分省略 `pending`，改由子層 `FormSubmitButton` 的 `useFormStatus` 顯示） | 正確，符合 `forms.md`「Pending states」 |
| `useFormStatus` | 只在 `src/components/form-submit-button.tsx`，並由 `ui.tsx` 的 `SubmitButton`／`DangerButton` 包裝；支援 `confirmMessage`（`window.confirm` 後 `requestSubmit(button)` 保留 name／value／formAction）、`pendingMessage` live region、`aria-busy`、`aria-disabled`、依 submitter 區分多按鈕表單 | 設計良好、可存取，是落實原則 4 的核心 |
| `useOptimistic` | 0 處 | 不需要；`vendor-feature-management.tsx` 以 `useTransition` 手寫樂觀更新並在失敗時還原，行為正確 |
| `useTransition`／`startTransition` | 10／11 個檔案；error boundary 內搭配 `retry`／`reset` 顯示 pending | 正確 |
| `useFormState`（舊名） | 0 處 | — |

**PRODUCT.md 原則 4 缺口**：104 個檔案出現 `action={…}`，絕大多數經 `FormSubmitButton`。盤點 server component 頁與少數 client 元件中仍用裸 `<button>`、沒有 pending／防重送的 server action 或原生 POST 表單，共 12 個檔案（B05-09 列清單）。

## 5. Findings

嚴重度沿用其他軸線：BLOCKER／MAJOR／MINOR／NIT。「封測前必修」欄：是＝上線前必須處理；建議＝低成本且有實際影響；否＝可排後續。

| ID | 嚴重度 | 檔案:行號 | 問題 | 為何重要（情境） | 重現／測試 | 建議修法與對應 docs | 估工 | 需 owner 決策 | 封測前必修 |
|---|---|---|---|---|---|---|---|---|---|
| B05-01 | MAJOR | `src/app/(app)/billing/error.tsx:5,7,20`；`src/app/admin/billing/error.tsx:5,7,20`；`src/app/(app)/messages/deliveries/error.tsx:4,7,17`；測試 `src/app/(app)/messages/deliveries/error.test.tsx:10`、`src/components/billing/finance-route-states.test.tsx:42,58` | 3 個 error boundary 以 `unstable_retry` 取 prop。16.3.8 的 `ErrorBoundaryHandler` 只傳 `{ error, reset, retry }`（`node_modules/next/dist/client/components/error-boundary.js:43,114`；編譯後的 `dist/compiled/next-server/app-page-turbo.runtime.prod.js` 內 `unstable_retry` 出現 0 次、`retry:this.retry` 有）。`unstable_retry` 在 v16.3.0 已改名為 `retry`。 | 商家帳務、平台財務與 Email 寄送紀錄頁出錯時，畫面上的「重新載入」按鈕呼叫 `undefined`：`messages/deliveries` 的 `onClick={unstable_retry}` 等於沒有 handler；兩個帳務頁在 `startTransition(() => unstable_retry())` 內丟 `TypeError: unstable_retry is not a function`，按鈕顯示「重新載入中…」後沒有任何結果。這三頁的錯誤文案都承諾「請重新載入最新資料」，實際無法重載，只能手動 F5。而且測試手動塞 `unstable_retry: vi.fn()`，所以全綠，掩蓋了缺陷。 | 讀碼＋grep 即可確認：`grep -c unstable_retry node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js` 為 0。`npx vitest run` 上述 2 個測試檔（連同 `proxy.test.ts`）3 檔 21 個測試通過。 | 3 個檔案把 prop 名稱改成 `retry`（型別 `() => void`）；`retry` 內部本來就包 `startTransition`，pending 顯示可保留 `useTransition` 或改用 state。測試改成傳 `retry`，並新增「prop 名稱必須是 runtime 實際傳入者」的測試（例如實際渲染 `next/dist/client/components/error-boundary` 的 `ErrorBoundary` 並檢查 `errorComponent` 收到的 props）。docs：`error.md`「retry」「Version History」。 | S（約 1 小時） | 否 | **是** |
| B05-02 | MAJOR（需實測確認） | `src/app/(app)/dashboard/error.tsx:3,14`；`src/app/(app)/billing/usage/error.tsx:3,12`；`src/app/admin/billing/stream-reconciliation/error.tsx:3,8`；`src/app/checkout/[vendorId]/[productId]/error.tsx:6,19`；`src/app/checkout/result/error.tsx:6,20` | 5 個 boundary 以 `reset` 作為「重新載入」。docs：`reset` 只清掉 boundary 的錯誤狀態並用**現有內容**重新渲染，不重新向 server 取資料；要重新取資料請用 `retry()`（它在 `startTransition` 內 `router.refresh()` 再 `reset`，見 `error-boundary.js:42-47`）。 | 這 5 頁的錯誤多半來自 server 端渲染（DB 逾時、provider 失敗）：Dashboard 就是 CURRENT.md 記錄的逾時案例；結帳頁與付款結果頁是買家入口，文案寫「你可以安全地再試一次」。server 端錯誤已編進 RSC payload，單純 `reset` 會用同一份 payload 再丟一次，使用者看到按鈕沒有效果。 | 無法在本次唯讀環境實際觸發 server error；結論來自 docs 與 `error-boundary.js` 的 `retry` 實作。建議在 B 階段用 E2E 注入錯誤（`dashboard/page.tsx` 已有 `e2eDashboardFailScope` 診斷參數）實測。 | 5 個檔案改用 `retry`。抽一個共用的 `RouteErrorPanel`（pending、`role="alert"`、`retry`），把 B05-01 的 3 個與此 5 個統一，之後 docs 再改名只需改一處。docs：`error.md`「reset」；`01-getting-started/10-error-handling.md`「Nested error boundaries」。 | S | 否 | **是**（與 B05-01 同一批） |
| B05-03 | NIT | `src/app/global-error.tsx:7-24`；`src/app/p/[slug]/error.tsx:3-12` | `global-error.tsx` 只送 Sentry、沒有重試／重新整理按鈕；`p/[slug]/error.tsx` 的文案「請稍後再試」也沒有任何動作。 | 根 layout 或夥伴公開頁壞掉時，使用者沒有可操作的出口。 | — | 兩者加上 `retry` 按鈕；`global-error` 因為取代根 layout，要自己帶樣式（docs 範例見 `error.md`「Global Error」）。 | S | 否 | 否 |
| B05-04 | MAJOR | `src/proxy.ts:37-47`；`src/lib/public-landing-page-status.ts:122-143`（`content: true` 在 `:135`）；`src/lib/funnel-runtime.ts:108-121`；`src/lib/landing-page-service.ts:613-` | `/lp/*` 的每個 GET／HEAD（含 client router 的 RSC 導覽與預取，註解 `proxy.ts:66-72` 已說明）都在 proxy 內讀 `landingPage` + `publishedVersion.content`（整份漏斗 JSON）+ 報名表 count，只為決定是否回 404／503。之後 page 內 `loadPublicLandingPage`（`landing-page-service.ts:617`）與 `resolvePublicFunnelRuntime`（`funnel-runtime.ts:108`）各再讀一次同一份 `content`。同一個請求把這份 JSON 讀取並 `parse` 3 次。`public-landing-page-status.ts:33` 的註解還要求「與 page 的 notFound 判斷保持同步」，是漂移風險。 | docs 對此的明確建議是「Keep proxy checks fast, and avoid fetching full content there」（`loading.md`「Status Codes」）。漏斗一旦有廣告流量，每個訪客的第一個位元組要先等 DB（Tokyo pooler）完成一次大查詢；DB 一抖，整個 `/lp` 全部變 503（設計上是對的，但因為 proxy 在最前面，放大了影響面）。 | 讀碼；`src/proxy.test.ts` 通過。 | (1) 先驗證是否仍需要 proxy：`lp` 沒有任何 `loading.tsx`（`loading.test.tsx` 排除清單），page 在 `await load()` 之後的 `notFound()` 在沒有 Suspense 的情況下理論上能產生真 404；`proxy.ts:38` 註解寫的「root loading boundary」在 `src/app` 底下並不存在（`root-loading.tsx` 只被各段落的 `loading.tsx` re-export）。實測確認 200 的來源是否其實是 `generateMetadata` 串流或其他邊界，再決定是否保留 proxy。(2) 若 proxy 保留：只查「slug → 狀態＋可公開的 step path 清單」的輕量投影（發布時寫入小表或欄位），不取 `content`。(3) 無論如何，同一請求只完整讀取 `content` 一次（page 層用 `cache()` 共用）。docs：`proxy.md`「Execution order」；`streaming.md`「Status codes」。 | M（2～3 天含測試） | 否（技術決策） | 否（流量放大前處理；與 B06-04 一起排） |
| B05-05 | MINOR | `src/app/form/[slug]/page.tsx:85`；`src/components/commerce-checkout-entry.tsx:146` | 兩處 `<Image … priority>`。 | `priority` 在 Next 16 已棄用，將來移除會直接壞掉。兩處都在報名頁／結帳頁首屏（LCP 圖），不能無聲失效。 | — | 改為 `loading="eager"` 加 `fetchPriority="high"`（docs 建議的多數情境），或確定需要時用 `preload`。專案是 `unoptimized`，`preload` 的收益有限，建議前者。docs：`image.md`「priority」「preload」。 | S | 否 | 否 |
| B05-06 | MINOR | `src/components/form-submissions-workbench.tsx:11`；`src/lib/form-submission-search.ts:1-3`；`src/lib/db.ts`、`src/lib/auth.ts`、`src/lib/r2-images.ts` | client 元件為了一個常數匯入了 `form-submission-search.ts`，該檔 `import { getDb } from "@/lib/db"`。全專案只有 1 個檔案使用 `server-only`。 | `@prisma/client` 在瀏覽器 bundle 會走 stub，不會洩漏，但會帶進不必要的程式碼；更重要的是，將來若有人在 client 元件匯入含 `process.env` 秘密的模組，非 `NEXT_PUBLIC_` 變數在 client 端是空字串，變成無聲壞掉而不是建置失敗。 | 腳本掃 129 個 client 檔，僅此 1 條路徑可達。 | 把常數移到不含 DB 的檔案；`db.ts`、`auth.ts`、`r2-images.ts`、`student-portal-auth.ts` 等加 `import "server-only"`（會在 client 引入時建置失敗）。docs：`05-server-and-client-components.md`「Preventing environment poisoning」；`production-checklist.md`「Security」。 | S | 否 | 否 |
| B05-07 | MINOR | `src/app/layout.tsx:7-10`；`src/app/(viewer)/live/[slug]/page.tsx`（無 metadata）；`src/app/p/[slug]/page.tsx`（無 metadata）；`src/app` 無 `not-found.tsx`／`global-not-found.tsx`／`robots`／`sitemap` | `/live/[slug]` 與 `/p/[slug]` 沒有 `generateMetadata`，繼承根 layout 的英文描述「Live-commerce automation MVP…」。沒有根層 not-found（系統地圖已記）。 | 直播連結是商家最常貼到 LINE／FB 的 URL；分享預覽會顯示平台名稱而不是活動標題與封面。HTML-limited bot（`facebookexternalhit` 等）只會等頁面自己的 `generateMetadata`，沒有就吃根預設。未知網址會顯示 Next 預設英文 404。 | — | 為兩頁加 `generateMetadata`（標題、描述、`heroImageUrl` 當 OG 圖；`lp` 與 `form` 已有現成範例）；根層加 `global-not-found.tsx` 提供繁中 404。docs：`generate-metadata.md`「Streaming metadata」；`production-checklist.md`「Metadata and SEO」「Global 404」。 | S–M | 是（是否要做分享預覽／SEO） | 建議 |
| B05-08 | MINOR | `src/app/(viewer)/loading.tsx`、`src/app/checkout/loading.tsx`、`src/app/support/loading.tsx`；`src/app/(viewer)/live/[slug]/page.tsx:41-44,58-60` | 有 `loading.tsx` 的段落，`notFound()` 一律是 HTTP 200 + `noindex`（串流已開始）。`/live/[slug]` 不存在或未就緒時對外是 200。 | 外部監控、連結檢查、LINE 的 URL 預覽爬蟲看不到 404。CURRENT.md 已經因為同樣機制（Funnel 公開頁 200）誤判過一次。 | 讀碼 + docs。 | 接受並文件化；或對 `/live/[slug]` 套用與 `/lp` 同款的輕量預檢（該頁本來就是單一 `findFirst`，成本低）。docs：`loading.md`「Status Codes」。 | S | 否 | 否 |
| B05-09 | MAJOR（金流相鄰 4 處）／MINOR（其餘） | **金流相鄰**：`src/app/affiliate-portal/[vendorSlug]/[affiliateId]/remuneration/page.tsx:25,34,40,41`（提交收款資料、取得報價、簽署提領）；`src/app/(app)/affiliates/[id]/remuneration/page.tsx:24,27`（核准收款資料、下載 CSV）；`src/components/billing-plan-checkout-form.tsx:15-25`（方案結帳，原生 POST 到 `/api/billing/plans/select`）；`src/app/(app)/affiliates/payout-policy/page.tsx:17-22`。**其他**：`(app)/affiliates/[id]/access/page.tsx:33-37`、`(app)/products/[id]/lessons/page.tsx:22-31`、`(app)/products/[id]/community/page.tsx:23-29`、`(app)/consultations/mobile/page.tsx:63-73`（4 顆提交鈕）、`src/app/welcome/page.tsx:19`、`src/app/checkout/result/page.tsx:137-139`、`src/app/portal/[vendorSlug]/page.tsx:68-70,107`、`src/components/student-portal-language-switcher.tsx:7` | 12 個檔案的表單使用裸 `<button>`：沒有 pending、沒有 `disabled`、沒有 `aria-busy`、沒有送出中文字提示，也沒有防重送。專案已有 `FormSubmitButton`（`src/components/form-submit-button.tsx`），`SubmitButton`／`DangerButton` 也已包裝；`billing/plans/plan-submit-button.tsx` 另有一個 pending 版本但 page 沒有使用（A-04 已記）。 | 直接違反 PRODUCT.md 設計原則 4「所有非同步動作具備 loading、pending、防重送、成功與可修正的錯誤提示」。「簽署提領」「方案結帳」是金額確認後的不可逆動作：連按兩次或網路慢時使用者看不到任何狀態，可能重複送出（server 端是否冪等屬 B-03 範圍，這裡只指出前端沒有擋）。`consultations/mobile` 是行動版為主的畫面，4 顆按鈕沒有任何送出中回饋。 | 讀碼；以 `<form … action={` 與 `<button` 交叉比對，排除已使用 `FormSubmitButton`／`SubmitButton`／`DangerButton` 的檔案。 | 全部換成 `SubmitButton`／`FormSubmitButton`（零新機制，換 import 即可）；`billing-plan-checkout-form.tsx` 因為是原生 POST 導向，至少加 `FormSubmitButton`（`useFormStatus` 會在 form submission 期間回報 pending）或沿用 `PlanSubmitButton`。再補一條 lint／測試規則：server action 表單內不得出現裸 `<button`。docs：`forms.md`「Pending states」；`mutating-data.md`「Showing a pending state」。 | S（約 0.5～1 天） | 否 | **是**（金流相鄰 4 處）；其餘建議 |
| B05-10 | NIT（遷移成本） | 19 個 `dynamic = "force-dynamic"` 檔案（見 2 節表）＋ `src/app/policies/page.tsx:12`、`policies/[slug]/page.tsx:7`（`revalidate = 3600`） | 專案停留在「previous model」（未啟用 `cacheComponents`）。 | 現在完全合規；但 `unstable_cache` 已被 `use cache` 取代，且 `migrating-to-cache-components.md` L76 明說啟用後這些 segment config 都會報錯。若 B06-04／B06-05 的快取方案要採用 `use cache`，必須先做這個遷移。 | — | 在 B06 快取方案決定前不要動。決定採用時，一次處理：移除 19 個 `dynamic`（`force-dynamic` docs 標示「Not needed」），2 個 `revalidate` 改 `cacheLife`，其餘 request-time 資料用 Suspense 包起來。docs：`migrating-to-cache-components.md`「`dynamic = "force-dynamic"`」「`revalidate`」。 | M（1～2 天；不含快取設計） | 是（是否走 Cache Components） | 否 |
| B05-11 | MINOR | `src/app/actions/sales-workspace-actions.ts:70,95,139,153,165`；`src/app/(app)/settings/features/actions.ts:29`；`src/app/actions/consultation-actions.ts:216,238,256`；`src/app/actions/form-actions.ts:191`；`src/app/actions/product-server-actions.ts:20`；`src/app/actions.ts:1397` | 14 處 `revalidatePath("/", "layout")` 或 `("/(app)", "layout")`。 | docs：Server Function 內呼叫會在**同一個 action 回應**內重渲染目前路由，且（現行行為）讓所有先前造訪的頁面下次造訪時重新整理；`"/"` + `layout` 還會清空 client cache。`(app)` layout 一次重渲染要做 10 條以上查詢（B06-02）。所以「建立專案、改商品、儲存表單」每次都讓整個商家殼層重算。 | — | 只有殼層資料（專案清單、方案名稱、功能模組、onboarding）真的改變的 action 才用 layout 層級；其餘改為精準 `revalidatePath("/products")`。更根本是降低 layout 成本（B06-02）。docs：`revalidatePath.md`「Server Function」；`server-actions.md`「Choosing a cache update」。 | S | 否 | 否 |
| B05-12 | MINOR（需驗證） | repo 內無設定；`docs` 沒有 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`／Skew Protection 紀錄 | 每次部署 Server Action ID 會變（至少每 14 天輪替一次），舊頁面呼叫新部署會出現「Failed to find Server Action」。 | 商家在直播進行中或表單填到一半遇到部署，儲存會失敗。直播排程後台幾乎都是 Server Action。 | owner 在 Vercel 專案設定確認是否啟用 Skew Protection，並確認多實例間 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 固定。 | 啟用 Skew Protection；錯誤時 UI 提示重新整理（docs 建議「Surface the error as a retry path」）。上線避開直播時段，並記入 release runbook。docs：`server-actions.md`「Deployment considerations」；`deploymentId.md`。 | S（設定） | 是（Vercel 方案與設定） | 建議 |
| B05-13 | NIT | `src/app/api/media/**`（6 個 route）、`src/app/api/live-studio/drafts/route.ts:11`、`src/app/api/admin/ops/provider-runtime/route.ts:7` | 7 個檔案 `export const runtime = "nodejs"`。 | 預設值，冗餘；docs 的建議是移除 `runtime` export（針對 edge）。無風險。 | — | 可順手移除，降低「這裡刻意不是 edge」的誤導。 | S | 否 | 否 |

## 6. 符合項目（不需處理）

- `src/proxy.ts` 的職責、命名、matcher、非 edge runtime；沒有 middleware 殘留；`proxy.test.ts` 通過。
- `params`、`searchParams`、`cookies()`、`headers()` 全部非同步使用，沒有 15 的相容層。
- `lp`／`form` 的 metadata 與 page 共用 `React.cache`，同一請求不重複查詢。
- Route handler 沒有誤用快取語意；輪詢類 GET 明確 `private, no-store`。
- 直播頁 `hls.js` 懶載入；Safari 走原生 HLS（`video.canPlayType`），其他瀏覽器才載入 `hls.js`。
- 重 client 元件（Puck、漏斗編輯器、直播播放）用 `next/dynamic` 隔離；root layout 不直接 import 直播播放本體。
- `lucide-react` 具名匯入受 Next 內建 `optimizePackageImports` 保護。
- React 19：表單 pending 由 `FormSubmitButton` 集中處理，a11y（`aria-busy`、live region、確認對話框後保留 submitter）完整。

## 7. 建議排序

1. **B05-01 + B05-02**：同一個 PR（共用 `RouteErrorPanel`，8 個檔案＋測試）；封測前。
2. **B05-09**：金流相鄰 4 處先換 `FormSubmitButton`；其餘順手。封測前。
3. **B05-12**：設定確認，零工程成本。
4. **B05-04** 與 `16-performance-cost.md` B06-04 一起做公開漏斗頁的設計（輕量預檢＋內容快取）。
5. 其餘 MINOR／NIT 排入一般 backlog。

## 8. 派工提示（給主對話）

- B05-01／02／03／05／06／09／13 屬一般 UI／慣例修正，可派 `engineer`（Sonnet）；B05-09 中 `billing-plan-checkout-form.tsx` 與 `affiliate-portal/**/remuneration` 觸及付款與出款，建議該部分派 `engineer-hard` 並做一次 `reviewer`。
- B05-04 動到公開頁可用性與 404／503 契約，建議 `engineer-hard`。
