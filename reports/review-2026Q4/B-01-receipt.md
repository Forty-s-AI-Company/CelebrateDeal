# B-01 收據（架構與邊界審查）

- 日期：2026-10-19
- 基線：`review-baseline-2026Q4` = `78621ca3`；分支 `codex/goal-review-2026q4`（HEAD = origin/master = 基線）
- 產出：`docs/review-2026Q4/11-architecture.md`、本檔。除此之外沒有新增、修改或刪除 repo 內任何檔案。
- 邊界遵守：未讀取 `.env*`；未執行任何 git 寫入；未連資料庫、Supabase、Vercel、Cloudflare；未執行測試、`npm install`、`prisma generate`、`next build`。所有臨時腳本放在 session 的 scratchpad 目錄（repo 之外）。

## 1. 自建 import 圖

工具：Node v22.23.1 腳本（scratchpad：`graph.mjs`、`stats.mjs`、`b.mjs`、`act.mjs`、`mod.mjs`、`xm.mjs`、`clo.mjs`、`cl.mjs`、`depth.mjs`、`rt.mjs`、`q3.mjs`）。

- 掃描範圍：`src/**/*.ts(x)`，排除 `src/generated`；1,571 個檔案；測試檔（`*.test.ts(x)`、`*.db.test.*`）只當被引用者、不當邊的起點；得 2,760 條非測試邊。
- 解析：`@/` 別名、相對路徑、`index.ts(x)`；`import … from`、`export … from`、字面量 `import("…")`；標記 type-only。不處理 `require()`、非字面量動態 import、`vi.mock`。
- 交叉驗證：`lib/db.ts` 224 個 app 層引用、`lib/auth.ts` 161、`csrf.ts` 91、`api-security.ts` 81，與 `01-system-map.md` §3 完全相同。
- 強連通分量：1 個（`components/landing-pages/funnel-page-document-renderer.tsx` ⇄ `funnel-survey.tsx`），經查 `funnel-survey.tsx:4` 為 `import type`，屬 type-only 循環，與 madge 結果一致、與 `architecture-boundaries.test.ts` 的「執行期 0 循環」不矛盾。
- lib→app／components 邊：0 條。
- lib→lib 唯一邊 634 條；最長相依鏈 15（`platform-plan-checkout.ts`、`wp4-payuni-sandbox-refund-execution.ts`）；126 個頂層 lib 檔不 import 其他 lib、214 個會。

## 2. 關鍵量測（供複核）

| 量測 | 結果 | 方法 |
|---|---|---|
| page／layout 直接呼叫 Prisma model | 92／144 個檔案，245 處，寫入 0 | 正規表示式 `(getDb\(\)\|db\|database\|tx\|prisma\|client).<model>.<find…\|create…>(`，`q3.mjs` |
| route 內聯 Prisma | 35 個檔案、17 個有寫入 | 同上 |
| action 檔內聯 Prisma | 28 個檔案、271 處（寫入 141） | 同上 |
| lib 內 Prisma | 136 個檔案、1,067 處 | 同上 |
| 元件 import `lib/db`（執行期） | 2 個伺服器端元件；客戶端經非 `"use server"` 路徑 1 條（`form-submissions-workbench.tsx` → `form-submission-search.ts` → `db.ts`） | `b.mjs`、`cl.mjs`（遇到 `"use server"` 檔案即停止展開） |
| 元件 → `app/**` | 37 條，目標全為 Server Action 檔 | `act.mjs` |
| `@/app/actions` 的使用者 | 28 個非測試檔（11 元件＋17 頁面） | `act.mjs` |
| `actions.ts` 的 wrapper／真邏輯 export | 38／13（共 51） | 人工核對 `grep -nE "^export async function"` 與各函式本體 |
| 退款 action 的不可達區塊 | `src/app/actions.ts:2178-2359`（約 182 行） | 人工閱讀 2123–2454；第一個 `if (providerName === "payuni")`（2156）三個分支皆 `redirect()` |
| 功能開關伺服器端強制處 | 約 7 處，僅 `affiliate_program`／`tax_remuneration` | `grep -rnE "hasVendorFeature\|requiredFeatureForPath\|FeatureAccessBoundary\|enabledFeatureModules" src` |
| 單行（0 換行）檔案 | 7 個，皆為 #261 功能模組 | Node 掃 `git ls-files src scripts tests` 中 >300 位元組且不含 `\n` 者 |
| 傳遞閉包 | 見 `11-architecture.md` §1.5 | `clo.mjs`（排除 type-only 邊） |
| 模組歸屬統計 | 見模組表；規則見下 | `mod.mjs` |

模組歸屬規則（第一個符合者）：admin-ops → team-funnel → student-portal → courses → consultations → line-notify → tracking → affiliates → billing → checkout-payments → funnel → forms → live → crm-messaging-support → products → auth-tenant-core → 其餘（shared/other）。各規則的正規表示式在 `mod.mjs`；結果為啟發式。

## 3. 讀過的檔案（完整或相關區段）

`docs/review-2026Q4/{01-system-map,03-test-map,04-static-scan,12-tenant-auth}.md`、`docs/codex-goal/ARCHITECTURE_BOUNDARIES.md`、`docs/production-infrastructure-plan.md`、`reports/review-2026Q4/A-04-{madge,knip-production}.txt`、`PRODUCT.md`、`README.md`、`scripts/architecture-boundaries.test.ts`、`eslint.config.mjs`、`vercel.json`、`vercel.staging.json`、`next.config.ts`（片段）、`src/proxy.ts`、`src/app/actions.ts`（1–215、586–640、1455–1482、2123–2472 及各 export 位置）、`src/app/(app)/layout.tsx`、`src/components/{app-shell,feature-access-boundary,landing-pages/landing-page-editor,landing-pages/workspace-editor,verified-registration-share,registration-retry-boundary}.tsx`、`src/lib/{auth,vendor-feature-toggles,landing-page-content,funnel-page-document,landing-page-service,public-landing-page-status,wp4-runtime-boundary,payment-method-reference,rate-limit,request-client-ip,env}.ts`（區段）、`src/lib/payment-providers/{index,payuni,types}.ts`（區段）、`src/lib/payment-webhooks.ts`（結構與 import）、`src/app/api/webhooks/{payments,payment-methods}/route.ts`、`src/app/api/payments/checkout/route.ts`（import 與查詢位置）、knip 19 個檔案的檔頭與引用者、`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`、`03-api-reference/03-file-conventions/proxy.md`。

## 4. 沒有做、或做了但不確定的事

- 沒有量測 bundle、沒有 `next build`、沒有執行任何測試；「測試可信度」是從測試結構（mock 數、是否連真 DB、設定檔重複次數）與 `03-test-map.md` 推得。
- `feature-access-boundary` 的「RSC payload 仍包含被隱藏頁面內容」是依 React Server Components 的運作原理推論（伺服器元件作為 `children` 傳入客戶端元件時，仍在伺服器渲染並序列化），未用瀏覽器實測。
- `cf-connecting-ip` 風險取決於 production 是否真的有 Cloudflare 代理；repo 內無法證明，已標為 owner 決策。
- Evergreen 直播「設定可存、runtime 未接線」只確認了程式碼引用關係，未走查觀眾端行為。
- `"use server"` 檔案不能轉出 export 是 wrapper 的**推測**成因，未在 Next 文件中逐條驗證。
- 部分死碼（`funnel-templates.ts` 被誰取代）為推測，已在文件標示。

## 5. 命令摘要

```text
git rev-parse HEAD; git status --short
git ls-files …; git ls-files --eol …; git log --since=2026-07-01 --format=%h -- <path> | wc -l
git show <commit>:src/app/actions.ts | wc -l        # 行數趨勢
node <scratchpad>/graph.mjs ... depth.mjs            # import 圖與統計（唯讀）
grep / sed -n / wc -l / ls                           # 閱讀與計數
```

Exit code：所有命令皆成功；一個 shell 迴圈（`for f in $(find …); do grep -cE '…\$transaction'`）因反斜線被 shell 吃掉而報錯，結果丟棄，改用 `rt.mjs`／`q3.mjs` 重做。
