# 04 靜態掃描報告（A-04）

- 掃描日期：2026-10-19
- 工作分支：`codex/claude-handoff-20261017`（HEAD 已合併 origin/master `a0c7ffdc`；本機 `origin/master` 為 `78621ca3`，未執行 `git fetch`）
- 環境：Windows 10、Node v22.23.1、Next.js 16.3.8
- 原始輸出：`reports/review-2026Q4/A-04-*.txt`；每個命令的 exit code 與耗時見 `reports/review-2026Q4/A-04-receipt.md`
- 原則：未修改任何既有檔案、未寫入 git、未讀取 `.env*`；臨時工具皆以 `npx --yes` 執行，未寫入 `package.json`

## 0. 重要前提：本機 Prisma Client 已過期

`node_modules/.prisma/client` 產生於 2026-10-17 10:32，而 `prisma/schema.prisma` 最後修改於 2026-10-18 09:42（之後有新 model／欄位進 master，例如 `TrackingDelivery`、`PostPurchaseCredit`、`TrackingSetting.facebookAccessTokenEncrypted`）。因此直接跑 `npm run typecheck` 會得到大量與程式碼本身無關的錯誤。

為了得到可信的結果，另做了「隔離驗證」：把目前 schema 複製到 scratchpad、輸出到獨立目錄產生新的 Prisma Client，再以 `paths` 對應 `@prisma/client` 並排除過期的 `.next/`，用 `tsc --noEmit` 重跑。**完全沒有改動 `node_modules` 或 `.next`**。結果：全專案 typecheck 與 strict-index 皆 0 錯誤。

## 1. TypeScript

| 掃描 | 命令 | exit | 錯誤數 | 輸出 |
|---|---|---|---|---|
| 官方 typecheck | `npm run typecheck` | 2（失敗） | 313 | `A-04-typecheck.txt` |
| 官方 strict-index | `npm run typecheck:strict-index` | 2（失敗） | 125 | `A-04-typecheck-strict-index.txt` |
| 隔離 typecheck（新 Prisma Client、排除 `.next`） | scratchpad 內的 `tsconfig.scan.json` | 0 | 0 | `A-04-typecheck-freshprisma.txt` |
| 隔離 strict-index | scratchpad 內的 `tsconfig.scan-strict.json` | 0 | 0 | `A-04-typecheck-strict-freshprisma.txt` |

隔離掃描涵蓋 1,724 個非 node_modules 檔案。官方指令的失敗**不計為通過**；它們反映的是「本機產生物過期」，不是 HEAD 的程式碼缺陷。

### 1.1 官方 typecheck 的 313 個錯誤分布

- 過期的 `.next/types`、`.next/dev/types`：34 個（TS2307，找不到 `src/app/.../page.js` 等；是舊 build／dev server 產生的 validator，與目前原始碼不符）。
- `src/` 非測試程式：125 個；`src/` 測試：133 個；`tests/`：21 個。
- 依錯誤碼：TS2339 164、TS2551 44、TS2345 44、TS2307 34、TS2353 8、TS7006 5、TS18046 5、TS2344 4、TS2724 2、TS2305 2。除 `.next` 之外，全部可追溯到 Prisma Client 缺 `trackingDelivery`／`postPurchaseCredit`／`facebookAccessTokenEncrypted` 等新 model 與欄位，或連帶的隱含 any。
- 依檔案前 10：`post-purchase-credit.db.test.ts` 75、`tracking-purchase-outbox.db.test.ts` 34、`tracking-purchase-worker.ts` 22、`checkout/result/page.tsx` 20、`tracking-event-sources.db.test.ts` 17、`tests/tracking/native-tracking-settings.browser.ts` 15、`support/orders/page.tsx` 10、`tracking-settings.db.test.ts` 7、`tracking-purchase-outbox.ts` 7、`post-purchase-checkout-recovery.ts` 7。

### 1.2 前 20 條（節錄自 `A-04-typecheck.txt`，已截短）

```
src/app/(app)/settings/tracking/page.tsx(12,36): TS2339 Property 'trackingDelivery' does not exist on type 'PrismaClient<...>'
src/app/(app)/settings/tracking/page.tsx(26,75): TS2339 Property 'credentialRevision' does not exist on type '{...}'
src/app/(app)/settings/tracking/page.tsx(28,60): TS2339 Property 'facebookAccessTokenEncrypted' does not exist ...
src/app/(app)/settings/tracking/page.tsx(30,100): TS2339 Property 'facebookTestEventCode' does not exist ...
.next/dev/types/validator.ts(611,39 ... 2145,39): TS2307 × 9（stale validator）
.next/types/app/(app)/landing-pages/layout.ts(2,24), (7,29): TS2307
.next/types/app/(app)/settings/commissions/page.ts(2,24), (7,29): TS2307
.next/types/app/(app)/settings/layout.ts, settings/page.ts, affiliate-portal/login/page.ts ...: TS2307
```

strict-index 的 125 個錯誤全部同源（`tracking-purchase-worker.ts` 22、`checkout/result/page.tsx` 20、`support/orders/page.tsx` 10…），隔離重跑後為 0，代表 `noUncheckedIndexedAccess` 在 HEAD 沒有新增缺口。

## 2. ESLint

- `npm run lint`：exit 0，**0 errors、3 warnings**（耗時 133 秒）。
- 規則分布：`@next/next/no-img-element` 3 條，全在 `src/components/landing-pages/landing-page-puck-config.tsx`（79:252、85:307、88:722）。
- 另有一則 stderr 訊息：`jsx-ast-utils` 無法解析某個 `AwaitExpression` prop（工具噪音，非程式缺陷）。
- 前 20 條：僅此 3 條。專案 `images.unoptimized: true`（`next.config.ts`），警告屬已知決策，可視為噪音。

## 3. 依賴稽核

### 3.1 `npm audit --json`

- 全部（含 dev）：**5 high、0 critical**（exit 1 是因為有 vulnerability）。
- 只看 production：`npm audit --omit=dev --json` 為 **0 vulnerabilities**（`A-04-audit-prod.txt`）。
- 這 5 個全是同一條 dev-only 鏈：`eslint-config-next@16.3.5` → `@next/eslint-plugin-next` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`。

| 套件 | 嚴重度 | 路徑 | 修復版本 |
|---|---|---|---|
| braces（<=3.0.3，GHSA-vfj7-8cjw-p6xm，CWE-674 深層巢狀 pattern 造成 stack exhaustion，CVSS 7.5） | high | node_modules/braces | **無**。npm registry 的 latest 即 3.0.3（已用 `npm view` 確認），沒有任何修補版 |
| micromatch、fast-glob、@next/eslint-plugin-next、eslint-config-next | high（傳遞） | 同上鏈 | 無實質修復。`npm audit` 建議的 `eslint-config-next@14.2.35` 是降到 Next 14 的 major 降版，不可採用 |

先前文件（`docs/launch/evidence-index.md`、`docs/ai-team/evidence/sec-2026-08-07-dependency-audit.md`）記錄 audit 為 0 vulnerabilities；這次新增的 braces advisory 是新公告造成的變化，不是程式變更造成。

### 3.2 `overrides` 區塊與推測原因

| override | 推測原因（證據） |
|---|---|
| `deepmerge-ts: 8.0.1` | 固定傳遞依賴版本；最早出現於 commit `68a96c42`（WP2 staging validator）。docs 無明確說明 |
| `fast-uri: ^3.1.7` | 修補 fast-uri high advisory，歷經 3.1.4 → 3.1.5 → 3.1.7（`docs/ai-team/evidence/sec-01-dependency-audit-20260806.md`） |
| `js-yaml: ^4.3.2` | 2026-08-07 修補 4.3.0 high（`sec-2026-08-07-dependency-audit.md`、`evidence-index.md` L657、L828） |
| `nanoid: ^3.3.17` | 修補 `nanoid <3.3.17` high（`evidence-index.md` L1433） |
| `minimatch@10.2.5` → `brace-expansion ^5.0.9`、`minimatch@3.1.5` → `brace-expansion ^1.1.18` | 依 major 分開 pin，避免全域 override 造成相容性問題（`sec-01...md` L15–16；`COMMAND_LOG.md` 記載全域 override 試驗失敗後撤回） |
| `postcss: ^8.5.16`、`source-map-js: 1.2.2` | `source-map-js` 為 production source-map DoS 修補（commit `a11fa20f`，#376）；`postcss` 推測為同一鏈修補，docs 無明確說明 |
| `sharp: ^0.35.5`、`playwright-core: 1.61.1` | 版本對齊（Next 圖片相依、`@playwright/test` 對齊）；`sharp` 於 commit `f770e2b5`（#212）加入，docs 無明確說明 |

這些 override 屬一次性安全補丁，應建立「何時可移除」的追蹤（B 階段確認）。

## 4. 未使用檔案與 export（knip@5）

預設 knip 無法執行：它會載入 `vitest.course-community-db.config.ts`，該檔刻意在缺少 disposable 綁定時 throw（`A-04-knip-default-failed.txt`，記為 TOOL_BLOCKED）。改用 scratchpad 的設定檔關閉 vitest／playwright plugin，其餘 plugin（含 Next）保留。

| 模式 | 未使用檔案 | 未使用 export | 未使用 type export | 其他 |
|---|---|---|---|---|
| 一般（測試、scripts、tests 皆視為 entry）`A-04-knip.txt` | 5 | 160 | 326 | 重複 export 17、unlisted 依賴 30、unused devDependency 1（tailwindcss，可能誤報，由 postcss／CSS 引用） |
| production（只認 Next route、`proxy.ts`、sentry／instrumentation）`A-04-knip-production.txt` | 19 | 401 | 335 | 重複 export 14 |

說明：一般模式下 `src/lib` 沒有任何未被引用的檔案，因為測試檔本身是 entry；production 模式顯示 19 個「只被測試或 scripts 引用」的檔案。

### 4.1 `src/lib` 下 production 不可達的檔案（死碼候選，需人工確認）

| 檔案 | 目前的引用者 | 判讀 |
|---|---|---|
| `src/lib/ab-testing.ts` | 僅 `ab-testing.test.ts` | 疑似未接線的功能 |
| `src/lib/ai-funnel-assistant.ts` | 僅其測試 | 同上；另含 3 組重複 export |
| `src/lib/evergreen-webinar.ts` | 僅其測試 | 疑似未接線 |
| `src/lib/funnel-templates.ts` | 僅其測試 | 疑似未接線 |
| `src/lib/interaction-card-media.ts` | 僅 `interaction-card-timeline.test.ts` | 疑似未接線 |
| `src/lib/interaction-role-label.ts` | 僅 `interaction-role-form.tsx`（本身也不可達）與測試 | 連帶死碼 |
| `src/lib/wp4-payuni-sandbox-checkout.ts` | 僅其測試 | WP4 sandbox 輔助，可能僅供外部腳本 |
| `src/lib/cloudflare-webhook-fixtures.ts` | `scripts/cloudflare-webhook-fixtures.ts`、route 測試 | 測試／腳本支援，非死碼 |
| `src/lib/staging-qa-finance-bootstrap.ts` | 多支 `scripts/*` | 腳本支援，非死碼 |
| `src/lib/payment-providers/payuni-fixtures.ts` | 測試、`scripts/*` | 測試支援，非死碼（但放在 `src/lib` 是否會被打包需確認） |

### 4.2 其他死碼候選

- `src/components/funnel-blocks/{carousel-block,countdown-timer-block,funnel-page-renderer,lead-form-block,pricing-table-block}.tsx`：兩種模式都判定未使用（5 個，疑似被 `landing-pages/funnel-page-document-renderer` 取代的舊實作）。
- `src/components/interaction-role-form.tsx`：production 不可達。
- `src/app/(app)/billing/plans/actions.ts` 與 `plan-submit-button.tsx`：僅被各自的測試引用，`page.tsx` 未使用；方案選擇 Server Action 可能沒有 UI 入口。**這是帳務相鄰程式，不能直接刪，需 B 階段確認是否為刻意下線。**
- `src/app/api/admin/ops/payuni/test-support/recovery-boundary.ts`：被多個 route 測試引用，production 不可達。
- 17 組重複 export（同一函式兩個名稱），例：`ai-funnel-assistant.ts` 的 `generateFunnelSalesCopy`／`createFunnelSalesCopy`、`consultation-slot-engine.ts` 的 `generateConsultationSlots`／`getAvailableConsultationSlots`。

注意：knip 不看動態 import 與字串路徑，且 Server Action／route 以檔案系統約定被框架引用，以上全部是候選，不得直接刪除。

## 5. 循環依賴（madge@8）

`npx --yes madge@8 --circular --extensions ts,tsx --ts-config tsconfig.json src`：處理 1,482 個檔案，**1 個循環**（exit 1 代表有循環）：

1. `components/landing-pages/funnel-page-document-renderer.tsx` ⇄ `components/landing-pages/funnel-survey.tsx`

風險低（同資料夾的元件互相引用），但需確認沒有 `"use client"` 邊界問題。madge 另有 1 個警告（輸出未列細節）。

## 6. Secret scan

`npm run secret:scan`：**PASS**（輸出 `secret_scan_passed`，無命中檔案）。文件記載過去曾有 47 個 `external_database_url` 分類，本次無輸出任何命中。

## 7. 程式碼規模與熱點

### 7.1 規模

- `src/` 共 1,482 個 `.ts/.tsx`，合計約 189,800 行：非測試 815 檔／約 100,200 行；測試 663 檔／約 89,600 行。

### 7.2 2026-07-01 起改動最頻繁的檔案（origin/master，節錄，完整 40 筆見 `A-04-hotspots-gitlog.txt`）

| 次數 | 檔案 |
|---|---|
| 41 | `scripts/mvp-payuni-sandbox-e2e.mjs` |
| 39 | `docs/codex-goal/API_CONTRACT_REGISTRY.md` |
| 34 | `docs/launch/CURRENT.md` |
| 32 | `scripts/mvp-payuni-sandbox-e2e.test.mjs`、`prisma/schema.prisma` |
| 29 | `scripts/secure-staging-workflow-contract.test.mjs`、`docs/codex-goal/PRISMA_INVARIANTS.md` |
| 27 | `src/app/actions.test.ts`、`.github/workflows/secure-staging-validation.yml` |
| 25 | `src/app/actions.ts`、`scripts/prisma-invariant-inventory.test.ts` |
| 23 | `.github/workflows/ci.yml` |
| 19 | `src/lib/payment-webhooks.ts`、`src/app/api/payments/checkout/route.ts`、`package.json` |
| 12 | `src/lib/payment-providers/payuni.ts` |

高頻 + 高風險的 production 檔：`src/app/actions.ts`（25 次、2,472 行）、`src/lib/payment-webhooks.ts`（19 次、1,302 行）、`src/app/api/payments/checkout/route.ts`（19 次、1,099 行）。

### 7.3 最長的檔案（前 30 見 `A-04-loc.txt`），超過 800 行的共 19 個

非測試（11）：`src/app/actions.ts` 2,472；`components/live-playback.tsx` 1,838；`lib/payment-webhooks.ts` 1,302；`components/live-stepper-form.tsx` 1,233；`lib/email-delivery.ts` 1,220；`app/actions/interaction-actions.ts` 1,155；`components/media-upload-field.tsx` 1,127；`app/api/payments/checkout/route.ts` 1,099；`lib/support-case-domain.ts` 940；`lib/payment-providers/payuni.ts` 898；`lib/commerce-orders.ts` 863。

測試（8）：`app/actions.test.ts` 6,830；`lib/payment-webhooks.test.ts` 2,382；`components/live-playback.test.tsx` 1,572；`api/payments/checkout/route.test.ts` 1,520；`components/live-stepper-form.test.tsx` 1,088；`lib/email-delivery.test.ts` 1,058；`lib/post-purchase-credit.db.test.ts` 855；`api/form-submissions/route.test.ts` 815。

## 8. Next.js 版本與棄用

- 版本：`node_modules/next` = **16.3.8**（與 `package.json` 一致；`eslint-config-next` 為 16.3.5，略落後）。
- `middleware.ts`：不存在；已使用 `src/proxy.ts`（Next 16 的新命名）與 `src/proxy.test.ts`。
- `getServerSideProps`／`getStaticProps`／`getInitialProps`、`next/router`、`next/legacy`：`src/` 內 0 命中。
- `experimental`：`src/` 與 `next.config.ts` 皆 0 命中。
- `unstable_` 前綴：只有 `unstable_retry`（error boundary 的 prop），命中檔案：`src/app/(app)/billing/error.tsx`、`src/app/(app)/messages/deliveries/error.tsx`（含 `.test.tsx`）、`src/app/admin/billing/error.tsx`、`src/components/billing/finance-route-states.test.tsx`。需 B-05 對照 `node_modules/next/dist/docs/` 確認 16.3 的現況。
- `next.config.ts` 觀察：CSP 僅為 Report-Only 且 `script-src` 含 `'unsafe-inline' 'unsafe-eval'`（尚未強制）；`images.unoptimized: true`；Sentry `tunnelRoute: "/monitoring"`。

## 9. 大型依賴與 bundle

`node_modules` 總計 1.1 GB。直接 dependencies 大小（完整見 `A-04-dependency-sizes.txt`）：

| 套件 | 大小 |
|---|---|
| next | 195.6 MB |
| @prisma/client | 73.6 MB（`@prisma` 資料夾合計 153.5 MB） |
| lucide-react | 37.4 MB |
| hls.js | 24.0 MB |
| react-dom | 7.1 MB |
| zod | 5.9 MB |
| @puckeditor/core | 4.5 MB |
| @aws-sdk/client-s3 | 4.2 MB |
| @sentry/nextjs | 3.1 MB（`@sentry` 合計 70.5 MB） |
| tus-js-client | 2.7 MB |

devDependencies 以 prisma 70.2 MB、typescript 22.9 MB 最大。磁碟大小不等於 bundle 大小，僅供參考。

**`next build` 未執行**（記為 NOT_RUN，不硬跑），原因：
1. `npm run build` 內含 `prisma generate`，會覆寫共用的 `node_modules/.prisma`，違反「不修改既有檔案」且可能影響另一個進行中的 session；
2. 本機 Prisma Client 已過期，`next build` 內建的型別檢查會因第 1 節的錯誤失敗；
3. 建置的 `preflight --production` 需要 `.env*` 內的變數，本次禁止讀取；
4. 會覆寫過期但仍存在的 `.next/`。

建議在 B 階段以乾淨 worktree、合成環境變數與 `SENTRY_DISABLE_AUTO_UPLOAD=true` 執行。

## 判讀

### 真正需要修／處理的

1. **本機 Prisma Client 過期，導致 `npm run typecheck` 與 `typecheck:strict-index` 在這個工作樹上失敗**（313／125 個錯誤；證據 `A-04-typecheck.txt`、`A-04-typecheck-strict-index.txt`；隔離驗證 `A-04-typecheck-freshprisma.txt` 為 0）。處理方式是 `npm run db:generate`，並考慮在 `preflight` 或文件加入「schema 比 generated client 新就警告」的檢查。程式本身無型別缺陷。
2. **braces 的 high advisory（DoS，無修補版）**，但僅限 dev 工具鏈（eslint-config-next），production audit 為 0（`A-04-audit.txt`、`A-04-audit-prod.txt`）。需決定處理策略（記錄例外，或把 ESLint 的 glob 依賴換掉），不能用 `npm audit fix`（會降到 Next 14）。這是全部 5 個 high 的唯一來源。
3. **`src/app/actions.ts`（2,472 行）、`payment-webhooks.ts`（1,302 行）、`payments/checkout/route.ts`（1,099 行）是高頻改動且高風險的大檔**（`A-04-hotspots-gitlog.txt`、`A-04-loc.txt`），屬重構／審查優先項，非立即缺陷。
4. **CSP 仍是 Report-Only 且允許 `unsafe-inline`／`unsafe-eval`**（`next.config.ts`），屬安全強化項目，建議納入 B 階段。

### 噪音（不需處理）

- `.next/types`、`.next/dev/types` 的 34 個 TS2307：過期產生物，重新 build／dev 後消失（`.next` 已被 git 忽略）。
- 3 個 `@next/next/no-img-element` 警告：專案刻意使用 `images.unoptimized`（`A-04-lint.txt`）。
- `jsx-ast-utils` 的 AwaitExpression 訊息、knip 的 `tailwindcss` unused devDependency 與多數 `unlisted`（`playwright`、`happy-dom`、`js-yaml` 等被 scripts／測試使用，來自傳遞依賴）。
- `npm audit` 建議的 `eslint-config-next@14.2.35`（降版，不可採用）。
- secret scan PASS，無需處理（`A-04-secret-scan.txt`）。

### 需 B 階段人工確認

- 死碼候選：`src/lib/ab-testing.ts`、`ai-funnel-assistant.ts`、`evergreen-webinar.ts`、`funnel-templates.ts`、`interaction-card-media.ts`、`interaction-role-label.ts`、`wp4-payuni-sandbox-checkout.ts`，以及 `src/components/funnel-blocks/*`（5 檔）、`interaction-role-form.tsx`（證據 `A-04-knip-production.txt`）。
- `src/app/(app)/billing/plans/actions.ts` 與 `plan-submit-button.tsx` 只被測試引用，需確認方案選擇功能是否刻意下線（涉及帳務，勿直接刪）。
- 循環依賴 `funnel-page-document-renderer` ⇄ `funnel-survey`（`A-04-madge.txt`）。
- `unstable_retry` 在 Next 16.3.8 的現況（B-05；證據 `A-04-nextjs-deprecation.txt`）。
- `package.json` overrides 中 `deepmerge-ts`、`postcss`、`sharp`、`playwright-core` 沒有文件說明，需補原因與移除條件。
- 17 組重複 export（別名）是否為相容層（證據 `A-04-knip.txt`）。
- `next build` 與各 route 的 First Load JS，需在乾淨環境實測（本次 NOT_RUN）。
