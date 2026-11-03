# PR #472 審查：next 16.4.2／@sentry/nextjs 10.76.2 安全升級

- 分支：`codex/beta-security-deps-upgrade`，commit `f7dd7add`，比對 `origin/master`（merge-base `8a7ae383`）
- 審查日期：2026-10-23
- 審查者：reviewer（Opus），只讀審查，未修改程式、未 commit／push
- 結論：**可合併**（前提是 `quality` CI 轉綠）

## 變更範圍

9 個檔案：`package.json`、`package-lock.json`、`next.config.ts`、`next.config.test.ts`、`src/lib/presenter-headers.test.ts`、`src/app/error-boundary-props.test.ts`（只改註解）、新增 `src/app/default.tsx` 與 `src/app/default.test.tsx`、skill 草稿的版本字串。沒有夾帶無關變更。

## 逐項檢查

### 1. 依賴與 lockfile

- `package.json` 只改三個版本：`next` 16.3.8→16.4.2、`@sentry/nextjs` ^10.64.0→^10.76.2、`eslint-config-next` 16.3.5→16.4.2。沒有 `overrides`、`.npmrc`、audit allowlist；`.github/` 沒有變動，CI 仍然跑 `npm audit --omit=dev --audit-level=high`（`.github/workflows/ci.yml:96`）。
- lockfile 逐套件比對：沒有降級；所有異動的 `resolved` 都在 `https://registry.npmjs.org/`，integrity 都是 sha512。版本異動都是 next／Sentry 依賴樹的連帶變化（@next/swc-*、@sentry/*、@opentelemetry 2.11→2.12、webpack 5.111→5.112.2，後者是 `schema-utils@4.8.1` 的 peer `^5.112.0` 所要求，以及 import-in-the-middle 等）。被移除的有 `@sentry/bundler-plugin-core`、`@apm-js-collab/*`、`astring`、`meriyah`、`semifies`。
- 在 scratchpad 用 `npm ci --ignore-scripts` 從零安裝（735 個套件），之後跑 `npm audit --omit=dev --audit-level=high`：**found 0 vulnerabilities，exit 0**。master 的 lockfile 在同一條件下有 2 個 critical（next、@sentry/nextjs），與 PR 描述的四個 GHSA 相符。
- 完整 audit（含 dev）在 master 與 PR 都是同一組既有 dev 漏洞（vite、braces／micromatch／fast-glob 經由 `@next/eslint-plugin-next`、vitest）。這個 PR 沒有新增 dev 漏洞，但也沒有修掉它們。
- `npm ls @sentry/core`：只有 **10.76.2 一份**，全部都是 deduped。

### 2. Next 16.4 語意

- 讀過 `node_modules/next/dist/docs`：16.4 的 version history 只有新功能（`ensureStatic`、`navigation`／`prefetch` 改名、agent 相關的 experimental 選項，預設都關閉）；`error.tsx` 的 `retry` 從 v16.3.0 起已是穩定 API。專案沒有使用其中會改變語意的項目。
- 16.4 新增的實際行為變更是預設開啟 strict route matching（`server/lib/router-utils/strict-route-matching-config.js`、`normalize-catchall-routes.js`）。這就是新增 `default.tsx` 的原因，見第 3 項。
- Server Actions CSRF：16.3.8 與 16.4.2 的 `csrf-protection.js`、`server-action-request-meta.js` 完全相同；`action-handler.js` 仍然做 origin／host 比對，`bodySizeLimit` 預設仍是 1 MB。實測帶外部 `Origin` 的 `Next-Action` POST 會被拒（500 `Invalid Server Actions request`）。專案沒有設定 `serverActions.allowedOrigins`／`bodySizeLimit`，所以行為不變。
- `next.config.ts` 除了 import 路徑外沒有變更。`images.unoptimized: true` 維持不變；`headers()` 兩條規則都還在。實測 404 頁的回應帶齊 nosniff、`X-Frame-Options: DENY`、Referrer-Policy、Permissions-Policy、HSTS、CSP-Report-Only，也有 `noindex`。
- `src/proxy.ts` 沒有變更。實測 fingerprint 標記 URL 仍然回 200 JSON。
- `npm run typecheck` 通過；對變更檔案跑 eslint 通過。

### 3. `src/app/default.tsx`

- 拓撲分析：在 16.4.2 strict 模式下對本專案的路由形狀做模擬。沒有根層級的 children default 時，`/[...catchAll]` 會被剪掉，並且對只有 route handler 的路徑（`/api/*`、`/favicon.ico`）回報 `IncompatibleParallelRouteSlotsError`。加上 `/default` 後，拓撲與 16.3（loose）相同：`/[...catchAll]` 保留，children 走 `default` → `notFound()`。這等同於 Next 內建 children default 的行為（內建版本也是 `notFound()`）。
- 實測（在 scratchpad 用 PR 的 webpack build 跑 `next start`，連 scratchpad 內的拋棄式 PG）：
  - `/this-does-not-exist`、`/a/b/c/deep-missing`、`/api/does-not-exist`（GET 與 POST）→ 404
  - `/api/health` → 200 JSON（route handler 不受影響）
  - `/favicon.ico` → 200
  - `/login` → 200
  - `/checkout/x/y`（canonical checkout 頁）→ 200
  - `/admin` → 404
  - 帶外部 Origin 的 Server Action POST → 500 拒絕
- 結論：原本會 404 的網址仍然是 404。`default.tsx` 只是 `notFound()`，不渲染任何內容，所以不會讓未授權內容可見。`@checkout` 的 `page`／`default`／`[...catchAll]`／`(.)checkout` 攔截都沒有變動。route handler 優先於動態 catch-all，與 16.3 相同。對 Server Actions 沒有副作用。

### 4. Sentry

- `withSentryConfig` 改從 `@sentry/nextjs/config` 匯入。10.76.2 的 `package.json` exports 有 `./config`，主入口標註 `@deprecated … removed in v11`，這個改法正確。repo 內沒有其他地方從主入口匯入 `withSentryConfig`。
- 原 config 用到的 `tunnelRoute`、`webpack.automaticVercelMonitors`、`webpack.treeshake.removeDebugLogging`、`telemetry`、`silent`、`widenClientFileUpload` 在 10.76.2 都不是 deprecated。
- tunnel：build 產出的 `routes-manifest.json` 仍有 `/monitoring`（帶 o／p／r 參數）→ `*.ingest.*.sentry.io` 的 afterFiles rewrite。
- `sentry.server.config.ts`、`sentry.edge.config.ts`、`src/instrumentation-client.ts`、`src/instrumentation.ts` 都沒有變更，仍然載入 `sentry-scrub` 的 `beforeSend*`／`beforeBreadcrumb`／`dataCollection`。`tracesSampler`、`replaysSessionSampleRate: 0`、`replaysOnErrorSampleRate: 0.1` 沒有變更。
- 跑了 `sentry-scrub.test.ts`、`sentry-environment.test.ts`、`monitoring.test.ts`、`next.config.test.ts`、`presenter-headers.test.ts`、`default.test.tsx`、`error-boundary-props.test.ts`、`not-found.test.tsx`、`global-error.test.tsx`、`layout.test.tsx`：10 個檔案、71 個測試全過。

### 5. 測試

- 沒有 skip、沒有刪除斷言、沒有放寬門檻。兩個 `vi.mock` 改成 `@sentry/nextjs/config` 是必要的；不改的話 mock 會失效，改為載入真的 wrapper。斷言內容沒有變。
- 本機 DB 失敗的重現：在 scratchpad 內自建 PG 18.4 拋棄式 cluster（127.0.0.1:55491，`celebratedeal_test`／`celebratedeal_ci`，沒有碰 5433／54329），兩個庫都跑 `prisma migrate deploy`。
  - `two-tenant-actions.db.test.ts`：PR 37 失敗；master 樹（主 repo 的 node_modules 是 next 16.3.8／Sentry 10.64，`src`／`prisma` 與 master 相同）同樣是 37 失敗。原因相同，都是清理步驟的 `PostgresError code "23001"`（RESTRICT 違反）。fixture（`src/test/two-tenant-fixture.ts:233`）只吞 Prisma `P2003`，而 Prisma 沒有把 23001 對應到 `P2003`，所以拋出 `PrismaClientUnknownRequestError`。這與 Next／Sentry 升級無關。
  - 全部 `.db.test.`：PR 的失敗檔案是 master 失敗檔案的子集，原因相同（主要是本審查環境沒有提供「Sensitive data encryption key」設定，加上上述 23001）。PR 沒有新增任何失敗。
  - 未實跑：`test:db:concurrency`（需要 wp17／wp18 雙 schema，且 wp18 專案會跑整套測試）、e2e、contracts、PG16。這些以 CI 為準；本審查期間 `quality` 仍為 pending。

### 6. 無關變更

沒有。skill 草稿的版本字串跟著升級更新，屬於相關變更。

## Findings

### BLOCKER
無。

### MAJOR
無。

### MINOR

**M-1 `src/lib/sentry-scrub.ts:35-46`：Sentry 10.76 的 `dataCollection` 有新欄位與棄用，scrubber 沒有跟上**

- 情境：10.76 把 `dataCollection.queryParams` 標為 `@deprecated`（改用 `urlQueryParams`）。只要設定了 `dataCollection`，新增欄位的預設值就以全收集為準：`databaseQueryData: true`、`graphQL: { document: true, variables: true }`（見 `@sentry/core/build/cjs/utils/data-collection/resolveDataCollectionOptions.js`）。目前 `urlQueryParams ?? queryParams` 仍然解析成 `false`，新欄位目前也只有 Supabase／GraphQL 整合會用到，而本專案沒有使用這兩者，所以**現在不會外洩**。風險在於：v11 移除 `queryParams` 後，網址參數會直接回到預設收集；之後若加入 Supabase／GraphQL 整合，查詢資料也會被收集，而 F-143 的「從來源不收集」保證會悄悄失效。
- 修法（可另開 PR）：把 `queryParams` 改成 `urlQueryParams: false`，並補上 `databaseQueryData: false`、`graphQL: { document: false, variables: false }`。同步更新 `SentryDataCollectionConfig` 型別與 `sentry-scrub.test.ts`；可以加一條斷言，要求 `resolveDataCollectionOptions` 解析後每個欄位都是關閉或白名單。

### NIT

**N-1 `src/app/default.test.tsx:15-18`：單元測試只驗證 `notFound()` 有被呼叫，沒有守住真正的風險，也就是路由拓撲**

- 情境：日後如果有人改成 `deprecated.looseRouteMatching` 或調整 `@checkout`，單元測試仍會綠燈，但 `/api/*`、未知網址與 checkout 的 HTTP 狀態可能改變。
- 修法：在既有 e2e 加一條輕量斷言，檢查未知網址 404、`/api/<不存在>` 404、`/api/health` 200、canonical `/checkout/...` 頁正常。

**N-2 `scripts/preflight.ts:2`、`prisma.config.ts:3`：`dotenv` 是未宣告的幽靈依賴，這次升級改變了它的可達性**

- 情境：master 上根層 `dotenv@16.6.1` 是經由 prod 依賴 `@sentry/bundler-plugin-core` 裝進來的。該套件被移除後，lockfile 改標為 `devOptional`，現在只能經由 dev 依賴樹取得。`npm run build` 的 preflight 直接 `import "dotenv"`。目前 Vercel／CI 都會安裝 dev 依賴，所以不受影響，但這是脆弱的。
- 修法：把 `dotenv` 明確列入 `devDependencies`。

**N-3（既有問題，與本 PR 無關）`src/test/two-tenant-fixture.ts:233`：清理只辨識 `P2003`**

- 情境：PostgreSQL 18 對 ON DELETE RESTRICT 回 SQLSTATE 23001，Prisma 6 不會把它對應到 `P2003`，所以本機 PG18 環境固定有 37 個假失敗，掩蓋了真正的回歸訊號。
- 修法（另開 PR）：同時接受 `PrismaClientUnknownRequestError` 且訊息或 meta 含 `23001`／`violates RESTRICT setting` 的情況，或在清理前先刪除受限的子表資料（disposable schema 範圍內）。

## 審查環境與清理

- scratchpad：`audit-pr`（`npm ci` 乾淨安裝）、`audit-master`（只用 lockfile 稽核）、`pg18`（拋棄式 cluster，已停止）、`runapp`（PR build 的副本；node_modules junction 已用 `rmdir` 解除）。
- 對 `/monitoring?o=1&p=2&r=us` 的探測會經由 rewrite 送出一次 GET 到 Sentry ingest。org／project 都是虛構值，沒有任何資料。
- worktree 與主 repo 的 `git status` 在審查結束時都是乾淨的。

## 結論

**可合併**。依賴變更最小且來源乾淨；乾淨安裝後 production audit 為 0。`default.tsx` 恢復了 16.3 的路由拓撲，實測 404、route handler、checkout、安全標頭與 CSRF 都沒有改變。Sentry scrubber 與 tunnel 仍然有效，`@sentry/core` 只有單一版本。本機 37 個 DB 失敗在 master 上同樣重現，原因是 PG18 的錯誤碼 23001，與升級無關。合併前需要等 `quality` CI（PG16、concurrency、e2e）轉綠。M-1 建議盡快另開 PR 處理。
