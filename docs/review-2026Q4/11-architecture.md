# 11 架構與邊界審查（B-01）

> 基線 `review-baseline-2026Q4` = `78621ca3`（審查時 HEAD 與基線相同，分支 `codex/goal-review-2026q4`）。全程唯讀：沒有改動既有檔案、沒有寫入 git、沒有讀取 `.env*`、沒有連任何資料庫或外部服務。審查者：B-01 子代理。

## 前言

### 範圍與方法

1. 先讀 `01-system-map.md`、`04-static-scan.md`（含 knip、madge 結果）、`docs/codex-goal/ARCHITECTURE_BOUNDARIES.md`，並回頭核對這三份文件的數字是否仍成立。
2. 自建 import 圖（Node 腳本，掃 `src/**/*.ts(x)`，解析 `@/` 別名、相對路徑與字串字面量的動態 `import()`；排除測試檔作為邊的起點；標記 type-only）：1,571 個檔案、2,760 條邊。此圖的 `db.ts` 224 個 app 層引用、`auth.ts` 161 個，與系統地圖逐字相符，作為正確性交叉驗證。
3. 以 Tarjan 強連通分量找循環、以深度優先找最長相依鏈、以傳遞閉包算「改動影響面」。
4. 模組歸屬採「路徑＋檔名」規則（見 `reports/review-2026Q4/B-01-receipt.md`），屬啟發式，會有少量錯分；所有「模組」數字只能看相對大小。
5. 逐檔讀了：`src/app/actions.ts` 的退款、結算、出款區段，`src/lib/auth.ts`、`vendor-feature-toggles.ts`、`feature-access-boundary.tsx`、`app-shell.tsx`、`proxy.ts`、`payment-providers/index.ts`、`payuni.ts` 的 import、`payment-webhooks.ts` 結構、`landing-page-content.ts`、`landing-page-editor.tsx`、`workspace-editor.tsx`、`rate-limit.ts`、`request-client-ip.ts`、`(app)/layout.tsx`。
6. 對照 Next.js 16.3.8 隨附文件 `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` 與 `03-api-reference/03-file-conventions/proxy.md` 確認 Proxy 的定位與預設 runtime。

### 沒有做到的事

- 沒有執行 `next build`、沒有量測 bundle 或 First Load JS（沿用 A-04 的 NOT_RUN 決定）。
- 沒有連 production／staging 檢查 DNS 是否真的經 Cloudflare、是否有 Puck 舊格式的 production 資料、`RATE_LIMIT_PROVIDER` 實際值（皆標「需 owner 確認」）。
- 沒有逐行審查金流正確性（屬 B-03 軸線）；本檔只在架構層面引用金流檔案。
- 沒有跑任何測試；測試可信度結論來自讀測試的結構（mock 比例、是否連真 DB）與 `03-test-map.md`。

### 嚴重度定義

| 等級 | 意義 |
|---|---|
| BLOCKER | 不處理就無法達成封測的前提（資料外洩、金流錯誤、無法隱藏必須隱藏的功能）。本軸線依「owner 對隱藏的定義」有條件升級，見 B01-01 |
| MAJOR | 明顯增加維護風險或審查成本，或讓某個重要承諾不成立；不一定阻擋封測 |
| MINOR | 值得修但可排進後續 |
| NIT | 衛生問題 |

估工單位為人天（工程師含測試，不含 reviewer 時間）；括號內是建議派工：`H` = engineer-hard，`E` = engineer。

### 七題結論一覽

| 題 | 結論 |
|---|---|
| 1 分層與依賴方向 | `src/lib` 沒有目錄分層（340 個頂層檔案、86 種檔名前綴、唯一子目錄是 `payment-providers/`），只有「命名前綴」這種約定；依賴方向在 app→lib 單向成立（lib→app／components 0 條，無執行期循環），但 lib 內部沒有任何規則，最長相依鏈 15 層。真正的 God module 是 `payment-webhooks.ts`、`landing-page-service.ts`、`email-delivery.ts`、`app/actions.ts`；`db.ts`／`auth.ts`／`csrf.ts` 是高扇入但健康的樞紐（`auth.ts` 責任偏混）。 |
| 2 邊界違反 | 元件直接碰 Prisma：2 個伺服器端元件。route handler 內聯 DB：35 個檔案、其中 17 個有寫入。page／layout 直接查詢：92 個檔案、245 處、0 個寫入。Server Action 互相呼叫：沒有（只有 `actions.ts` 的 38 個轉呼叫 wrapper）。 |
| 3 Puck | 只有 2 個檔案 import `@puckeditor/core`；但它的資料形狀（`{root, content, zones}`）被固化成 DB JSON 的 v1 信封，並與兩種新格式共存於同一個 `draftContent` 欄位。移除編輯器成本低；移除格式成本取決於 production 是否有舊資料。 |
| 4 Cloudflare-first | 宣稱與實況不符：實際是 Vercel＋Supabase，Cloudflare 只有 Stream（影音）與 R2（圖片）；Turnstile／Workers／WAF 在程式碼中沒有證據。建議改寫宣稱。另有一個由此衍生的安全風險：限流信任 `cf-connecting-ip`（B01-04）。`proxy.ts` 在公開頁每次 GET 查 DB，違反 Next 文件對 Proxy 的定位（B01-15）。 |
| 5 模組化 | 沒有一個模組能「乾淨下線」；較容易隱藏的是諮詢預約、追蹤、admin ops、學員端／課程；最難的是 live、forms、billing、聯盟出款（織入金流路徑）。現有「功能開關」只有 6 個、且主要是客戶端遮罩（B01-01、B01-02）。 |
| 6 死碼 | knip 的 19 個檔案：12 個真死碼或連帶死碼、3 個 fixture／腳本支援（應搬離 `src/lib`）、1 個半接線功能（evergreen）、1 個測試輔助、2 個孤兒（方案選擇 Server Action 與按鈕，帳務相鄰）。`__test`、`sentry-example-page` 是未追蹤的空目錄；`browser-qa` 有 2 個頁面被編進 production 路由表。 |
| 7 重構 vs 重寫 | 證據偏向「重構優先、局部 strangler」。核心金流模組的測試比外觀更可信（webhook 連真 DB、跑 4 個拋棄式設定）；重寫它們會丟掉這層保護。第一個適合 strangler 的模組是學員端 `/portal`（含課程學習與社群），見最後一節。 |

---

## Findings

排序：封測前必修者在前，其餘依嚴重度。

| ID | 嚴重度 | 檔案:行號 | 問題 | 影響 | 建議 | 估工 | 需 owner 決策 | 封測前必修 |
|---|---|---|---|---|---|---|---|---|
| B01-01 | MAJOR（若 owner 將「隱藏」定義為「不可被觸及」則 BLOCKER） | `src/components/feature-access-boundary.tsx:1`、`src/components/app-shell.tsx:317`、`src/lib/vendor-feature-toggles.ts:1`（以上檔案整檔為單行） | 功能模組的「隱藏」只是客戶端元件（`"use client"`＋`usePathname`）用卡片取代 `children`。`children` 是伺服器元件，仍會在伺服器執行（含 DB 查詢）並進入 RSC payload；Server Action 與 API route 完全沒有檢查。全專案只有 `tax_remuneration`／`affiliate_program` 在約 7 處伺服器端強制（`affiliates/payout-policy/page.tsx:10`、`affiliates/policy/page.tsx:12`、`actions/affiliate-remuneration-actions.ts:21,65`、`actions/merchant-affiliate-payout-policy-actions.ts:15`、`api/affiliates/.../export/route.ts:17`、`lib/affiliate-remuneration-dashboard.ts:10`）。`funnel_builder`、`live_webinar`、`consultation_booking`、`analytics_advanced` 完全沒有伺服器端檢查。 | 被「隱藏」的模組仍可用直接 URL、手動 POST 的 Server Action、API 呼叫觸及；資料仍被送到瀏覽器。只影響該商家自己的資料（非跨租戶），但封測要隱藏的是尚未驗收的金流／帳務功能，遮罩不等於關閉。 | 新增伺服器端 `requireFeature(feature)`，放進 `(app)/layout` 之下各路由群組的 server layout、所有對應 Server Action 與 API route 開頭；以測試矩陣（模組×入口）鎖定。`FeatureAccessBoundary` 保留為純 UX。 | 3–4（H，需 reviewer） | 是：「隱藏」要多嚴格；哪些入口要關 | 是 |
| B01-02 | MAJOR | `src/lib/vendor-feature-toggles.ts:1`（`VENDOR_FEATURE_MODULES` 僅 6 項）、`prisma/schema.prisma:82`、`src/lib/landing-page-service.ts:728-753`、`src/lib/live-quota-admission.ts:8`、`src/app/actions.ts:595-613`、`src/lib/team-funnel-live-sharing.ts:4`、`src/app/(app)/layout.tsx:4,38,48`、`(app)/onboarding/page.tsx:8`、`(app)/dashboard/dashboard-details.tsx:9` | 封測要隱藏的五項中，只有「聯盟 payout」「諮詢預約」有旗標；「課程」「billing」「Funnel 綁卡」沒有。課程是 `Product.fulfillmentType === "course"`／`ProductDeliveryKind.course_portal`，沒有獨立開關。綁卡閘門散落在至少 8 個檔案（發佈就緒檢查、直播配額、團隊直播分享、onboarding、dashboard、layout），沒有單一入口。Prisma 預設值包含 `affiliate_program`、`tax_remuneration`，但不含 `consultation_booking`，而 `normalizeVendorFeatureModules` 對「未寫入」的商家視為全開（`vendor-feature-toggles.ts` 註解：避免部署後意外隱藏既有功能）。 | 想在封測關掉課程、billing、綁卡，沒有任何一個開關可以用；新商家預設仍看到 payout；既有商家因 normalize 規則全開，要隱藏需資料回填。 | 以 B01-01 的 `requireFeature` 為基礎，新增 `courses`、`platform_billing`、`card_binding_gate` 三個旗標（或一個全域 `BETA_PROFILE` 設定覆蓋 vendor 層）；綁卡閘門收斂成 `isCardBindingRequired(vendorId)` 單一函式，8 個呼叫點全改用它；預設值與既有商家回填由 owner 定案後以前進式 migration 處理。 | 4–6（H，含 migration） | 是：封測的預設模組清單、既有商家是否回填、綁卡閘門關閉後付款能否繞過配額 | 是 |
| B01-03 | MAJOR | `src/app/actions.ts:2156-2176`（有效的 PayUni 路徑）、`2178-2359`（不可達）、`2361-2454`（非 PayUni 本地退款）、`src/lib/payment-providers/index.ts:6-11` | `refundPaymentTransactionAction` 的第一個 `if (providerName === "payuni")`（2156）在三個分支都 `redirect()`（回傳 `never`），所以緊接著的第二個相同條件區塊（2178–2359，約 182 行、含自己的 reservation、`$transaction`、provider 呼叫）永遠不會執行，是 `executePayUniRefund` 抽出後留下的舊實作。最後 2361 起的路徑對「非 PayUni」交易直接在本地建立 `RefundRecord` 並把交易標為已退款，完全不呼叫 `provider.refundPayment`；provider registry 仍註冊 `demo`、`ecpay-like`、`platform-ecpay`。 | 不可達碼：審查與維護成本、並可能讓人誤以為它是現行行為（`actions.test.ts` 的 500 行退款測試難以判斷在測哪一條）。本地退款路徑：若 production 存在任何非 PayUni 交易，退款只改帳、不退款給買家。 | 刪除 2178–2359；非 PayUni provider 改為 fail-closed（明確錯誤＋audit），或把本地退款路徑限制在 `demo`；把整個 action 降為「驗證輸入→呼叫 `executeRefund(provider)`→重導」。需 reviewer。 | 1–1.5（H） | 是：production 是否還有非 PayUni 的正式交易或 provider | 是 |
| B01-04 | MAJOR | `src/lib/rate-limit.ts:26-32`（所有 `checkRateLimit` 呼叫的共同取值點，行 91、115）、轉送這兩個標頭的 `src/app/actions/auth-security-actions.ts:56`、`buyer-support-actions.ts:46`、`consultation-actions.ts:110`、`registration-actions.ts:30`、`student-portal-actions.ts:35`、`vendor-member-actions.ts:50,156` | 限流與審計用的來源 IP 取法是「`cf-connecting-ip` 優先，其次 `x-forwarded-for` 第一段」。專案部署在 Vercel；只有「請求真的先經 Cloudflare 代理、且 Vercel 前沒有其他入口」時 `cf-connecting-ip` 才可信，否則它是用戶端可任意設定的標頭。程式碼裡有更嚴謹的 `request-client-ip.ts`（要求 ingress 密鑰證明、Vercel 模式用 `x-real-ip`），但只被 3 個 live-chat route 與 `env.ts` 使用。 | 若沒有 Cloudflare 代理：攻擊者每次請求換一個假 IP 即可繞過登入、註冊、密碼重設、客服、諮詢預約的 per-IP 限流，。若有 Cloudflare 代理：風險消失，但程式與部署沒有任何證明（repo 內無 DNS／Worker／規則檔）。 | 全站改用單一 `getRequestClientIp` 並依部署來源（Vercel `x-real-ip`、或 Cloudflare＋ingress 證明）取值；加測試矩陣（偽造 `cf-connecting-ip` 必須無效）。同時把 `docs/production-infrastructure-plan.md` 的「Cloudflare 在前」變成可驗證的 preflight 項目。轉 B-02／資安軸複核。 | 1–1.5（H） | 是：正式網域 DNS 是否為 Cloudflare 代理（橘雲）、是否強制所有流量經 Cloudflare | 是 |
| B01-05 | MAJOR | `src/app/actions.ts`（2,472 行／51 個 export）；`scripts/architecture-boundaries.test.ts:185-199`（上限 2,500）；`docs/codex-goal/ARCHITECTURE_BOUNDARIES.md:13,68` | 51 個 export 中 38 個是 4 行的轉呼叫 wrapper，13 個含實質邏輯：品牌設定（約 305 行）、直播建立／更新與其輔助（約 810 行）、聯盟新增、結算 3 個、出款 4 個、退款、webhook 重送。財務區段 1483–2472 約 990 行（40%）。11 個元件與 17 個頁面仍 import `@/app/actions`。自 2026-07-09（971 行）到 2026-09-07（2,485 行）膨脹約 1,500 行，之後靠上限停在 2,472；上限被調高過一次（文件寫 2,300，測試現為 2,500，剩 28 行餘裕）。 | 25 次 commit（2026-07-01 起）集中在一個檔案，衝突與審查面大；金額相關 action 與一般 CRUD 同檔，reviewer 難以限縮範圍；`actions.test.ts` 6,833 行用手寫假 Prisma。 | 見「actions.ts 拆分方案」。先刪死碼與 wrapper（機械式、低風險），再依領域搬移；每一步同步調降 `architecture-boundaries.test.ts` 的上限。 | 約 10–14（分階段，H＋E） | 否 | 否（但 B01-03 的部分必修） |
| B01-06 | MAJOR | `src/lib/`（340 個頂層非測試檔、86 種檔名前綴）；`scripts/architecture-boundaries.test.ts`（只管 lib→app／components、API→元件、循環） | 沒有目錄分層，也沒有 lib 內部的相依規則。lib→lib 唯一邊 634 條，最長相依鏈 15 層（`platform-plan-checkout.ts`、`wp4-payuni-sandbox-refund-execution.ts`），214 個會 import 其他 lib 的檔案中 138 個（64%）相依深度 ≥2。124 個檔案 import `@prisma/client`（含型別）、54 個直接 `getDb()`：資料存取、領域規則、框架耦合（20 個檔案 import `next/headers` 等）混在同一層。 | 無法在不讀全部檔案的情況下判斷「改這個檔案會影響誰」；模組隱藏、拆分、重寫都缺少可執行的邊界。 | 用 `dependency-cruiser`（或 ESLint `no-restricted-imports`）先建「模組公開面」規則，從 warn 模式開始：`lib/<module>-*` 只能被同模組或其 `index.ts` 引用。依 B01-02／模組表的順序，逐模組搬進 `src/lib/<module>/`。 | 規則 1–2；搬移隨各模組工作進行 | 否 | 否 |
| B01-07 | MAJOR | `src/lib/auth.ts:1-2,142-166`、`src/lib/platform-plan-checkout.ts:1,19,272,303-304,433,535`、`src/app/api/payments/checkout/route.ts:63,255`、`src/app/actions/invoice-actions.ts:17,181,241`、`src/app/(app)/billing/plans/page.tsx:1-2,28-43`、`src/lib/wp4-runtime-boundary.ts`（25 個引用者）、`wp4-sandbox-fixture.ts`（17 個） | WP4 Sandbox 測試 harness 滲入正式路徑：`auth.ts`（被 171 個檔案引用的核心）內有 `createWp4PreviewMfaVerifiedSession`，可建立 `mfaVerifiedAt` 已設定的 session；方案頁以 `plan.id !== WP4_SANDBOX_FIXTURE.planId` 過濾正式方案查詢；買家結帳、發票付款、平台方案結帳都夾帶 `wp4SourceBoundTransactionMetadata`。`wp4-runtime-boundary.ts` 與 `wp4-sandbox-fixture.ts` 因此進入「被依賴最多的 lib 模組」前 20 名。 | 保護僅靠環境變數組合（`VERCEL_ENV=preview`、`PAYUNI_ENV=sandbox`、`WP4_SANDBOX_EXECUTOR_ENABLED`、專案 ID、資料庫身分）；任一環境設定錯誤，session 建立能力就在核心 auth 內。測試用邏輯與金流核心互相牽連，也妨礙之後重構 auth 與 checkout。 | 把 WP4 能力改為注入：`auth.ts` 只暴露 `createSession` 一般介面，WP4 session 產生移到 `lib/wp4/preview-session.ts`（只被 ops route 引用）；方案查詢與 metadata 改由 `PaymentRuntimePolicy` 介面提供，正式環境注入 no-op。 | 2–3（H，需 reviewer） | 否 | 否（建議在 beta 結束前） |
| B01-08 | MAJOR | `src/lib/payment-providers/payuni.ts:2`（`import { PaymentWebhookPayload } from "@/lib/payment-webhooks"`，值匯入）、`payment-providers/types.ts:2` | provider adapter 反向依賴領域引擎：`payuni.ts` 為了一個 zod schema 把 1,302 行、20 個直接相依的 `payment-webhooks.ts` 拉進來。結果：載入 PayUni adapter 的傳遞閉包是 50 個檔案、涵蓋聯盟、課程、LINE、billing、tracking 等 9 個模組；`platform-plan-checkout.ts` 因此成為全專案最深的相依鏈（15 層）。 | 無法單獨測試或替換 provider（infrastructure plan 寫「保留 ECPay／NewebPay adapter」）；任何 webhook 領域邏輯變動都會讓 adapter 重新載入；strangler 時沒有乾淨的接縫。 | 把 `PaymentWebhookPayload` schema 與型別抽到 `payment-providers/contract.ts`（兩邊都依賴它）；加 lint 規則：`payment-providers/**` 不得 import `lib/payment-webhooks`。 | 1（H） | 否 | 否 |
| B01-09 | MAJOR | `src/lib/payment-webhooks.ts`：`processPaymentWebhookOnce` 934–1281（347 行，ESLint complexity 上限 61）；`eslint.config.mjs:39-41` | 一個交易內同時做付款狀態轉移，以及聯盟佣金（274）、課程分潤（385）、平台訂閱（647）、平台推薦（564–647）、發票（829）、庫存、追蹤 outbox、電子發票、加購抵用、訂單信件。20 個直接相依、43 個傳遞相依（9 個模組）；95 個檔案（傳遞）依賴它；2026-07-01 起 19 次 commit。 | 單點改動影響面極大；也是「重寫」最誘人、風險最高的地方。 | 不重寫。在同一檔案內先把各領域 reconciler 抽成具名函式＋註冊表（`handlers: Array<(tx, ctx) => Promise<void>>`），維持單一交易與既有測試；之後再依 B01-06 搬進 `lib/payments/webhook/*`。測試已連真 DB（44 案、0 mock、4 個拋棄式設定），是可靠的重構安全網。 | 8–12（H，需 reviewer） | 否 | 否 |
| B01-10 | MAJOR | `src/app/api/payments/checkout/route.ts`（1,100 行；27 個 lib 直接相依；傳遞閉包 93 個檔案、15 個模組；7 處內聯 Prisma 呼叫） | 結帳 route 同時負責輸入驗證、價格／優惠／庫存、訂單加購、聯盟與團隊歸因、冪等重放、發票、provider 呼叫、tracking。ARCHITECTURE_BOUNDARIES 把 route 視為薄層，實況不是。 | 與 B01-09 同；單檔改動 19 次（2026-07-01 起）；`route.test.ts` 1,520 行、66 案、11 個 mock。 | 抽出 `lib/checkout/` 服務（`prepareCheckout`、`replayCheckout`、`createCheckoutTransaction`），route 只做 HTTP 轉譯；每一步以既有 route 測試做特徵化。 | 5–8（H，需 reviewer） | 否 | 否 |
| B01-11 | MINOR | `src/app/(app)/layout.tsx:18-47`、`lives/[id]/analytics/page.tsx`（20 處）、`lives/[id]/edit/page.tsx`（15）、`billing/usage/page.tsx`（14）、`lives/new/page.tsx`（10）、`admin/billing/dashboard/page.tsx`（9）、`onboarding/page.tsx`（8） | 144 個 page／layout 中 92 個直接呼叫 Prisma model（245 處、0 個寫入）；`dashboard-read-model.ts` 這種讀模型只有 5 個使用者。`(app)/layout.tsx` 為 owner／admin 每次整頁載入最多執行 10 次查詢（訂閱、專案、偏好、任務狀態各 1 次，加上選了專案時並行的 6 次）並在 layout 內計算 onboarding 進度。 | 租戶範圍由每頁手動帶 `vendorId`（B-02 已確認目前一致）；效能與測試都落在 page 檔案；layout 的 onboarding 邏輯無法單獨測試或快取。 | 把 ≥5 次查詢的 8 個頁面各抽成 `lib/<area>/read-model.ts`；`(app)/layout` 的 onboarding 抽成 `getWorkspaceOnboarding(vendorId, userId)` 並以 `unstable_cache`／標記 `use cache` 的方式依 Next 16 文件評估快取。 | 3–5（E） | 否 | 否 |
| B01-12 | MINOR | `src/app/api/live-interactions/route.ts`（502 行、24 處）、`api/form-submissions/route.ts`（798 行、16）、`api/webhooks/payment-methods/route.ts:252,301`（`$transaction`）、`api/webhooks/payments/route.ts:148,225-290`、`api/live-media/route.ts`、`api/analytics/route.ts`、`api/affiliate-clicks/route.ts` | 122 個 route 中 35 個內聯 Prisma、17 個有寫入。兩個付款相關 webhook route 各自內聯一套 `WebhookEvent` 認領／冪等邏輯（`payments`：create＋`updateMany` 認領；`payment-methods`：`upsert`＋`$transaction`），形狀不同。 | 金流冪等規則有兩份實作，漂移風險；route 層測試成為唯一保護。 | 抽 `lib/webhook-events.ts`（`claimWebhookEvent`／`completeWebhookEvent`），兩個 route 共用。 | 2（H） | 否 | 否 |
| B01-13 | MINOR | `src/components/verified-registration-share.tsx:3,11`、`src/components/registration-retry-boundary.tsx:6,19`、`src/components/form-submissions-workbench.tsx:11` → `src/lib/form-submission-search.ts:2`（`getDb`）；`package.json`（沒有 `server-only`） | 兩個放在 `components/` 的伺服器端元件直接 `getDb()`；一個客戶端元件為了一個常數 import 了會 import `getDb` 的 lib 檔案（唯一一條不經 `"use server"` 的客戶端→DB 路徑）。lib 完全沒有 `import "server-only"` 護欄。 | 目前靠打包時 tree-shaking 才沒出事；之後任何人加一個 export，Prisma 就可能進客戶端 bundle。 | 在 `lib/db.ts`、`auth.ts`、`sensitive-data.ts` 等加 `import "server-only"`；把 `FORM_SUBMISSION_QUERY_MAX_LENGTH` 移到不碰 DB 的檔案。 | 0.5（E） | 否 | 否 |
| B01-14 | MINOR | `src/lib/landing-page-service.ts:422`（`parseFunnelStepPages ?? parsePageDocument ?? parseLandingPageContent`）、`src/components/landing-pages/workspace-editor.tsx:14-15`（以 `"root" in content && "settings" in content` 嗅探）、`prisma/schema.prisma:3791,3864`、`src/lib/landing-page-content.ts:3-4,136-153`、`landing-page-editor.tsx:3,50`、`public-landing-page-status.ts` | 同一個 `LandingPage.draftContent`／`LandingPageVersion.content` 欄位可存三種格式（Puck v1 信封、`PageDocument`、`FunnelStepPages`），用鍵嗅探與解析順序判別，沒有頂層 `kind`。Puck 的資料形狀（含 `zones`）被固化為 DB 契約。 | 解析順序即規格；新增第四種格式、或調整任一 zod schema，都可能改變舊資料被判成哪一種。公開頁判斷（proxy＋兩個 page）要手動保持同步。 | 新寫入一律加 `kind`；寫一個 `classifyLandingContent()` 作為唯一判別點。Puck 處置見「Puck 耦合」一節。 | 1–2（E） | 是：production 是否存在 Puck 格式的草稿／已發佈版本 | 否 |
| B01-15 | MINOR | `src/proxy.ts:34-47`、`src/lib/public-landing-page-status.ts:25-40`（「Pure mirror… Keep in sync」註解）、`src/app/lp/[slug]/page.tsx` | `/lp/*` 的每個 GET／HEAD（含 RSC 導覽與預取）都在 Proxy 內查 DB 決定 404／503；Next 16 文件明載 Proxy 不適合慢速資料存取。同一套路由判斷在 proxy 與兩個 page 各實作一次。DB 異常時整個公開 Funnel 一律 503。 | 推論：每次公開頁瀏覽至少 2 次 DB 往返（proxy 與 page 各一次，未實測）；邏輯漂移風險；Funnel 是封測的主要公開面。 | 先量測（封測前用 k6 或簡單腳本對 `/lp/*` 打 100 並發）；若延遲不可接受，改為頁面層 `notFound()`＋負向快取，proxy 只保留訪客 cookie。 | 量測 0.5；重構 2 | 否 | 建議量測，不必改 |
| B01-16 | MINOR | `src/app/api/admin/ops/**`（28 條 route）、`src/lib/wp4-*.ts`／`q1-*.ts`（15 個非測試檔）、`src/proxy.ts:15,22`、`src/app/__celebratedeal_wp187_fingerprint.json/route.ts`、`src/app/browser-qa/*` | 28 條營運／驗證 route 與其 lib 隨正式 bundle 部署；保護是 `JOB_SECRET`＋「必須是 preview 且 PayUni Sandbox 且專案／DB 身分吻合」的執行期檢查（設計扎實）。版本指紋 JSON 在 production 也公開（內容為靜態的 WP 代號與 digest，不含 secret）。`browser-qa` 兩個頁面以 `NODE_ENV !== "development"` 回 `notFound()`，仍在 production 路由表。 | 攻擊面與審查面：每次審查金流都要排除這 30+ 條路由；指紋端點洩漏內部流程代號。 | 與 B01-07 一起處理；把 ops route 與 browser-qa 改為只在 `VERCEL_ENV !== "production"` 的建置才存在（`next.config.ts` 的 `pageExtensions` 或建置前移除目錄），或收進單一 `[...path]` route 並由執行期 gate 控制；指紋端點加 `VERCEL_ENV` 條件。 | 2（H） | 是：staging 驗證是否依賴與 production 同一份建置 | 否 |
| B01-17 | MINOR | `PRODUCT.md:16`、`README.md:3`、`docs/production-infrastructure-plan.md:7,32` | 「Cloudflare-first」與實況不符。實況：Next.js 在 Vercel（`vercel.json`）、Postgres 在 Supabase、Cloudflare 僅 Stream（`cloudflare-stream*.ts`、`live-media-*.ts`、`stream-usage*.ts`）與 R2（`r2-images.ts`）。基礎設施計畫寫的 Cloudflare DNS／WAF／Turnstile：Turnstile 在 `src`、`scripts` 零命中；沒有 wrangler／Workers／Pages 設定。 | 對外與對內溝通會誤導（成本、可替換性、安全責任）；也是 B01-04 的成因。 | 改寫為「以 Cloudflare Stream 與 R2 作為影音與資產基礎；應用與資料庫分別在 Vercel 與 Supabase」。若 Cloudflare 代理與 WAF 真的在用，把它寫成可驗證的部署前置條件。 | 0.2（docs） | 是：改不改宣稱、是否保留 Cloudflare 代理 | 否 |
| B01-18 | MINOR | 見附錄 A（19 個檔案逐一判定）、`src/app/(app)/billing/plans/actions.ts`、`plan-submit-button.tsx` | knip production 模式的 19 個「僅測試／腳本引用」檔案：12 個真死碼（含 5 個 `funnel-blocks/*`、`interaction-role-form.tsx`、`ab-testing.ts` 等）、3 個 fixture／腳本支援應搬離 `src/lib`、1 個半接線（evergreen）、1 個測試輔助、2 個孤兒的方案選擇 Server Action 與按鈕（頁面已改走 `/api/billing/plans/select` 原生表單，`billing-plan-checkout-form.tsx:1`）。 | 約 930 行真死碼（另有 4 個 fixture／測試輔助檔約 310 行放錯位置）要被 typecheck、lint、審查；孤兒的帳務 Server Action 日後若被誤接線，是一條沒有人審過的付款入口。 | 依附錄 A 刪除或搬移；方案選擇 action 刪除前需 reviewer 確認 `createPlatformPlanCheckout` 仍只由 route 呼叫。 | 1（E；方案 action 為 H） | 是：evergreen 與 funnel-blocks 是否還有計畫 | 否 |
| B01-19 | MINOR | `src/lib/evergreen-webinar.ts`（176 行，僅測試引用）、`src/app/actions/evergreen-webinar-actions.ts`、`src/components/evergreen-webinar-settings.tsx`、`src/app/(app)/lives/[id]/edit/page.tsx:32-66` | 常青直播的設定可以在後台儲存（`isEvergreen`、排程模式），預覽頁也讀得到，但排程狀態機（`getEvergreenPlaybackState` 等）沒有任何正式程式呼叫；`interaction-card-timeline.ts` 只用了部分欄位。**未實測觀眾端行為，屬推論。** | 若觀眾端沒有依設定播放，等於後台有一個不會生效的功能，與 PRODUCT.md「不隱藏真實處理狀態」衝突。 | 封測前以一次手動走查確認；不生效就在 UI 隱藏設定區塊。 | 0.5（E，確認＋隱藏） | 是：保留、接線或隱藏 | 建議（確認即可） |
| B01-20 | MINOR | `docs/codex-goal/ARCHITECTURE_BOUNDARIES.md:5-15,68`、`scripts/architecture-boundaries.test.ts:198` | 文件停在 2026-07-25：寫 187 個 production 檔、61 個 lib 檔、26 個 route、`actions.ts` 2,272 行；現況是 870 個非測試檔、340 個頂層 lib 檔（總 347）、122 個 route、2,472 行。債務上限從文件的 2,300 變成測試的 2,500。madge 另指出一個循環（`funnel-page-document-renderer` ⇄ `funnel-survey`），經查是 type-only import，不影響執行期，所以 boundary 測試的「0 循環」仍成立。 | 看文件的人會低估現況；上限只升不降，失去棘輪意義。 | 重寫該文件數字並自動化（由測試輸出）；上限改為「當前值」，每次拆分同步調降。 | 0.5（docs） | 否 | 否 |
| B01-21 | NIT | `src/components/vendor-feature-management.tsx`、`src/lib/vendor-feature-toggles.ts`、`src/components/feature-access-boundary.tsx`、`src/app/(app)/settings/features/page.tsx` 及三個對應測試（共 7 檔，來自 #261） | 整個檔案被壓成單行（0 個換行）。lint 與 typecheck 不受影響。 | diff、blame、行號引用全部失效；正是封測要大改的那個模組。 | 在 B01-01 動工前先用 Prettier 格式化這 7 個檔案，單獨一個 commit。 | 0.1（E） | 否 | 與 B01-01 同時 |
| B01-22 | NIT | `src/lib/auth.ts`（429 行、20 個 export） | 同一檔案混了 session 建立／撤銷、12 個 `require*` 授權 guard、密碼驗證、MFA secret 讀取與 WP4。 | 171 個直接引用者（傳遞 293）承受任何一處改動；但它只依賴 5 個檔案，穩定性尚可。 | 拆成 `auth/session.ts`、`auth/guards.ts`、`auth/credentials.ts`，保留 `auth.ts` 為轉出口，之後再移除。 | 1（H） | 否 | 否 |
| B01-23 | NIT | `tmp/pdfs/agy-review/page-{1,7,8}.png`（已追蹤）、`src/app/__test/`、`src/app/sentry-example-page/`、`src/generated/`（未追蹤的空目錄）、17 組重複 export 別名（04-static-scan §4.2） | 倉庫衛生。 | 噪音。 | 刪 tmp 圖檔；`.gitignore` 或刪空目錄；別名在拆分時一併清除。 | 0.2（E） | 否 | 否 |

---

## 分層與依賴方向（題 1 的證據）

### 1.1 `src/lib` 的結構

- 頂層非測試檔 340 個（含 `payment-providers/` 的 7 個非測試檔共 347）；檔名前綴共 86 種；最大的前綴群：`live-` 36、`funnel-` 24、`learner-` 15、`affiliate-` 14、`wp4-` 14、`commerce-` 11、`payment-` 11。
- 126 個頂層 lib 檔案不 import 任何其他 lib（葉節點）；214 個會 import。lib→lib 唯一邊 634 條。
- 相依深度分布（只計會 import 其他 lib 的檔案）：深度 1 為 76 個、2–4 為 85 個、5–10 為 32 個、11–15 為 21 個。最深：`platform-plan-checkout.ts` 與 `wp4-payuni-sandbox-refund-execution.ts` 各 15 層。
- lib 層沒有「領域規則 vs 資料存取 vs 框架」之分：124 個檔案 import `@prisma/client`（含型別），54 個直接呼叫 `getDb()`，20 個 import `next/headers`／`navigation`／`cache`／`server`。

**判斷**：沒有實質分層。能成立的只有三件事：（a）lib 不 import app 或 components（0 條）；（b）沒有執行期循環；（c）命名前綴形成鬆散的功能群。

### 1.2 被引用最多的 20 個 lib 模組（唯一引用檔案數；括號為 app／components／lib）

| # | 模組 | 引用檔 | 備註 |
|---|---|---|---|
| 1 | `db.ts` | 280（224／2／54） | 13 行，只匯出 `getDb`，健康樞紐 |
| 2 | `auth.ts` | 171（161／0／10） | 責任偏混，見 B01-22、B01-07 |
| 3 | `csrf.ts` | 98（91／2／5） | |
| 4 | `api-security.ts` | 86（81／0／5） | |
| 5 | `format.ts` | 49（40／6／3） | |
| 6 | `rate-limit.ts` | 37（35／0／2） | B01-04 |
| 7 | `sensitive-data.ts` | 37（2／0／35） | 金鑰衍生來源見系統地圖 §3 |
| 8 | `app-url.ts` | 35（19／1／15） | |
| 9 | `audit.ts` | 30（21／0／9） | |
| 10 | `wp4-runtime-boundary.ts` | 25（22／0／3） | 測試 harness 進入前 10，B01-07 |
| 11 | `funnel-page-document.ts` | 24（1／10／13） | |
| 12 | `funnel-step-pages.ts` | 22（5／7／10） | |
| 13 | `registration-form-fields.ts` | 19（7／2／10） | |
| 14 | `student-portal-locale.ts` | 18（11／6／1） | |
| 15 | `monitoring.ts` | 18（9／0／8） | |
| 16 | `wp4-sandbox-fixture.ts` | 17（4／0／13） | 測試 fixture 進入前 20，B01-07 |
| 17 | `external-url.ts` | 17（6／4／7） | |
| 18 | `student-portal-auth.ts` | 16（16／0／0） | |
| 19 | `sales-project-scope.ts` | 15（11／1／3） | |
| 20 | `message-template.ts` | 15（8／2／5） | 並列 15：`buyer-support-access.ts`、`team-funnel-access.ts`、`funnel-commerce.ts` |

### 1.3 引用他人最多的 20 個 lib 檔案（lib→lib 直接相依數）

`payment-webhooks.ts` 20、`landing-page-service.ts` 17、`email-delivery.ts` 12、`platform-plan-checkout.ts` 11、`commerce-orders.ts` 10、`learner-notification-job.ts` 9、`payment-refund-accounting.ts` 9、`payment-providers/payuni.ts` 8、`post-purchase-checkout-recovery.ts` 8、`tracking-purchase-worker.ts` 8、`env.ts` 7、`funnel-commerce-service.ts` 7、`live-notification-delivery.ts` 7、`mfa-recovery-regeneration.ts` 7、`automation-workflow.ts` 6、`cloudflare-stream-webhook-handler.ts` 6、`learner-consultation-reminders.ts` 6、`learner-verification-delivery.ts` 6、`live-chat.ts` 6、`live-quota-admission.ts` 6。

app 層直接相依 lib 最多者：`app/actions.ts` 41、`api/payments/checkout/route.ts` 27、`api/form-submissions/route.ts` 17、`actions/auth-security-actions.ts` 15、`actions/interaction-actions.ts` 15。

### 1.4 God module 判定

- **高扇入但健康**：`db.ts`、`csrf.ts`、`api-security.ts`、`format.ts`（小、單一職責、無反向相依）。
- **高扇入且責任偏混**：`auth.ts`（B01-22）。
- **高扇出＋大＋高複雜度＝真 God module**：`payment-webhooks.ts`（B01-09）、`landing-page-service.ts`（796 行、17 個相依）、`email-delivery.ts`（1,220 行）、`commerce-orders.ts`（868 行）、`platform-plan-checkout.ts`（565 行、傳遞 66 個檔案）、`app/actions.ts`（B01-05）、`api/payments/checkout/route.ts`（B01-10）。

### 1.5 影響面（傳遞閉包）

| 起點 | 直接相依 | 傳遞相依（會載入） | 傳遞被依賴 |
|---|---|---|---|
| `api/payments/checkout/route.ts` | 28 | 93 | 0 |
| `api/webhooks/payments/route.ts` | 8 | 56 | 0 |
| `lib/payment-webhooks.ts` | 20 | 43 | 95 |
| `lib/commerce-orders.ts` | 9 | 20 | 100 |
| `lib/auth.ts` | 5 | 10 | 293 |
| `lib/platform-plan-checkout.ts` | 11 | 66 | 2 |
| `lib/payment-providers/payuni.ts` | 7 | 50 | 84 |
| `app/actions.ts` | 44 | 126 | 43 |

## 邊界違反清單（題 2）

1. **UI 元件直接 import Prisma**：`@prisma/client` 在 `src/components` 內全是 `import type`（10 個檔案，無執行期依賴）。執行期查 DB 的元件有 2 個：`verified-registration-share.tsx`（`getDb().formSubmission.findFirst`，伺服器元件）與 `registration-retry-boundary.tsx`（呼叫 `readRegistrationRetryDraft(getDb(), …)`）。客戶端元件經非 `"use server"` 路徑碰到 `getDb` 的只有 `form-submissions-workbench.tsx` → `form-submission-search.ts`（B01-13）。
2. **route handler 直接寫 DB**：17 個 route 有寫入，最重的列在 B01-12。其中 `api/live-presenter/route.ts`、`api/email/unsubscribe/route.ts`、`api/live-media/route.ts` 體量小，內聯尚可接受；`live-interactions`、`form-submissions`、兩個付款 webhook 應下沉。
3. **Server Action 之間互相呼叫**：沒有。`actions/*.ts` 之間唯一的 import 是 `product-server-actions.ts` → `product-actions.ts`（`mutateProduct` 共用核心，為刻意設計）。`actions.ts` 的 38 個 wrapper 是「把實作留在 `actions/*.ts`、對外維持舊匯入路徑」的相容層（推測成因：`"use server"` 檔不能 `export … from` 轉出，故以包裝函式代替）。
4. **page 直接做複雜查詢**：見 B01-11。對照 `dashboard-read-model.ts`（295 行、被 `dashboard-kpis`、`dashboard-details`、`orders/[id]`、`admin/billing/dashboard`、`live-engagement-analytics` 使用）：這個模式只覆蓋了很少頁面。
5. **元件→root actions（A-002）**：`affiliate-form`、`app-shell`、`blacklist-search-list`、`brand-settings-form`、`interaction-role-form`、`interaction-roles-workbench`、`interaction-script-form`、`live-interaction-studio`、`live-stepper-form`、`message-template-form-client`、`video-form` 共 11 個元件，另 17 個 page 直接 import `@/app/actions`。
6. **另一類跨層**：`components/` 內有 37 條 import 指向 `app/**`（皆為 Server Action 或其型別），符合 ARCHITECTURE_BOUNDARIES 規則 4，不計違規。

## Puck 耦合（題 3）

| 面向 | 結果 |
|---|---|
| import 範圍 | 只有 `components/landing-pages/landing-page-editor.tsx:3`（`Puck`、`Data`）與 `landing-page-puck-config.tsx:3`（`FieldProps`、`Config`）。`funnel-blocks/*` 完全沒有用 Puck。 |
| 載入方式 | `workspace-editor.tsx:10` 以 `dynamic(..., { ssr: false })` 載入，只進客戶端 chunk（A-04 量到套件約 4.5 MB 磁碟）；公開頁渲染器 `landing-page-renderer.tsx:131` 註明不依賴 Puck runtime。 |
| 資料形狀滲透 | 有：`LandingPagePuckData = { root, content }` 與 `zones` 欄位被固化在 `landing-page-content.ts` 的 zod 信封（`schemaVersion: 1`），存進 `LandingPage.draftContent` 與 `LandingPageVersion.content`（皆為 `Json`）。已發佈版本不可變，因此舊格式必須永久可讀、可渲染。 |
| 與新格式的關係 | 新建頁面走 `FunnelStepPages`（`funnel-goal-step-pages.ts`、`landing-page-workspace.tsx:15`）；Puck 僅用於舊草稿。已有轉接器 `landingPageContentToPageDocument` 與反向 `pageDocumentToLandingPageContent`（`funnel-page-document.ts:356-409`，後者為 best-effort，不支援的節點會降級為文字）。 |
| 版本 | `package.json` 固定 `0.22.4`（0.x，無 `^`，合理）；2026-09-21 引入（#251）。`createLandingPagePuckConfig` 有 102 行、0 個測試；ESLint 3 個 `no-img-element` 警告都在此檔。 |

**升級／替換代價**：
- 升級 Puck 0.x：風險在 `Data` 型別（`landing-page-editor.tsx:50` 以 `as Data` 強轉）與 `onChange` 的資料形狀；影響面 2 個檔案，約 1–2 人天（含手動回歸）。
- 完全移除 Puck 編輯器：若 production 沒有舊格式草稿，刪 2 個檔案＋`workspace-editor` 一個分支＋依賴，約 1 人天；若有舊草稿，需批次轉成 `PageDocument`（轉接器已存在，但反向轉換有損，且已發佈版本要保留舊渲染器），約 4–6 人天加 owner 驗收。
- 因此 Puck 不是封測的風險點；真正的債是「同一欄位三種格式＋鍵嗅探」（B01-14）。

## Cloudflare-first 與 `proxy.ts`（題 4）

- 實況（程式碼可證）：部署 Vercel（`vercel.json`、41 處 `VERCEL_ENV` 讀取）；資料庫 Supabase Postgres（`prisma`）；Cloudflare 的用途是 Stream（上傳、直播輸入、webhook 簽章、用量對帳）與 R2（圖片預簽），共約 53 個非測試檔案提到 cloudflare。
- 文件宣稱：`PRODUCT.md:16`、`README.md:3`、`live-commerce-mvp-report.md`。`docs/production-infrastructure-plan.md:32` 說明其意是「DNS／CDN／WAF 由 Cloudflare 管，Vercel 當 hosting」。repo 內沒有可驗證 Cloudflare 代理存在的檔案；Turnstile 零命中。
- 建議：宣稱改寫（B01-17）；把「是否經 Cloudflare」變成可驗證前置條件，並與 B01-04 一併處理。
- `proxy.ts`（128 行）職責：（1）在 `/__celebratedeal_wp187_fingerprint.json` 回傳靜態版本指紋（因為底線開頭的資料夾是 App Router 私有目錄，`route.ts` 實際不可達，這是 proxy 存在的原因之一）；（2）`/lp/*` 公開頁狀態（DB 查詢決定 404／503）與訪客 pseudonym cookie 注入。Next 文件：Proxy 預設 Node.js runtime、「not intended for slow data fetching」。(2) 的訪客 cookie 屬合理用途；DB 查詢屬 B01-15。

## 模組可隔離度表（題 5）

**怎麼讀**：檔案與行數為非測試檔（路徑＋檔名規則歸屬，啟發式）；「出／入」是與其他模組之間有 import 關係的模組數；可隔離度 1（難）–5（易）綜合：入向邊數、是否織入金流路徑、有無現成旗標、Prisma model 數。聯盟「出款」大部分程式在 `app/actions.ts`（約 700 行），不在下表檔數內。

| 模組 | 檔案（頁／route／action） | 行數 | 出／入 | 主要對外依賴與被依賴 | 現有開關 | 可隔離度 | 封測隱藏方式 | 下線代價 |
|---|---|---|---|---|---|---|---|---|
| 諮詢預約 | 10（2／0／2） | 1,728 | 7／3 | 被 Funnel 區塊（`consultation-booking-block`）、學員端提醒、LINE 設定頁引用；出向 13 條邊到 auth／shared | `consultation_booking`（nav＋客戶端遮罩，無伺服器強制，Prisma 預設不含） | 4 | `requireFeature` 補齊＋預設關；隱藏 Funnel 區塊編輯器選項 | 低；3 個 model |
| 追蹤（Meta CAPI／analytics） | 18（1／2／2） | 1,038 | 4／6 | 被 checkout、form verification、consultation 經 3 個檔案（`tracking-browser-context`、`tracking-event-outbox`、`tracking-purchase-outbox`）呼叫 | 無 | 4 | 關設定頁；outbox 寫入點在 checkout、form verification、consultation，關閉時變 no-op | 低，outbox 已是接縫 |
| admin ops／WP4 | 54（2／30／0） | 3,547 | 8／5 | 被 `auth.ts`、`platform-plan-checkout`、checkout route、`invoice-actions`、方案頁引用（B01-07） | 執行期環境檢查（非功能旗標） | 4 | 已被 preview-only 檢查封住；建議建置期排除（B01-16） | 先做 B01-07 解耦，之後可整組移出 |
| 學員端 portal＋課程 | portal 45（15／11／3）＋courses 23（3／0／5） | 2,954＋2,945 | 8／4＋10／7 | 課程被 `commerce-orders`、`payment-refund-accounting`、`payment-webhooks`、checkout route 以 `course-policy-snapshot`、`course-commission-accounting`、`product-delivery` 三個檔案使用；學員端只經 `/portal` 與少數 LINE／通知檔進入 | 無課程旗標（`fulfillmentType === "course"`） | 3 | 隱藏商品表單的「課程」選項、`/products/[id]/lessons`、`/community`、`/billing/course-payouts`；`/portal` 路由前置檢查 | 中；金流側 3 個契約檔需保留 |
| 聯盟（含 payout／remuneration） | 55（16／5／6）＋actions.ts 內約 700 行 | 3,951＋~700 | 5／4 | 被 `payment-refund-accounting`、`payment-webhooks`（`upsertAffiliateCommission`）、checkout route、方案頁（平台推薦）引用；出向 117 條邊 | `affiliate_program`、`tax_remuneration`（有伺服器強制，約 7 處；預設開） | 2 | `tax_remuneration` 預設關＋既有商家回填；決定「佣金累計是否照常、出款入口關閉」 | 高；佣金帳務是 webhook 交易的一部分 |
| 平台 billing（方案、帳單、用量、付款方式） | 57（13／8／4） | 7,875 | 8／8 | 被 live 配額、Funnel 發佈就緒、team-funnel 直播分享、checkout 發票欄位引用 | 無 | 2 | 需新增旗標；結帳的買家發票欄位屬 checkout，不隨之隱藏 | 高；與配額閘門糾纏 |
| Funnel 綁卡閘門 | 散落 ≥8 檔 | — | — | `landing-page-service.ts:728-753`、`live-quota-admission.ts`、`actions.ts:595`、`team-funnel-live-sharing.ts`、layout／onboarding／dashboard | 無 | 2 | 收斂為 `isCardBindingRequired()`，再以旗標關閉 | 中；先收斂再關 |
| Funnel／Landing | 73（6／2／3） | 9,465 | 7／5 | 內含 Puck 舊路徑；被 forms、team-funnel、live 引用 | `funnel_builder`（客戶端） | 3 | 不隱藏（封測主體） | 高 |
| 報名表單 | 45（7／2／3） | 5,581 | 11／12 | 入向邊 121 條（驗證、追蹤、聊天室） | `funnel_builder`（客戶端） | 2 | 不隱藏 | 高 |
| Live（直播／互動／影片） | 136（20／24／1） | 21,025 | 10／14 | 全專案最大；14 個模組依賴它 | `live_webinar`（客戶端） | 2 | 不隱藏 | 最高 |
| 商品 | 12（6／1／2） | 1,026 | 5／2 | 出向 45 條邊（到金流、課程、團隊） | 無 | 3 | 不隱藏 | 高 |
| LINE／學員通知 | 34（1／5／2） | 4,137 | 8／7 | 被學員端、live、tracking 引用 | 無（設定頁 owner-only） | 3 | 不設定官方帳號即不啟用 | 中 |
| team-funnel（團隊範本、夥伴頁） | 38（8／9／3） | 5,615 | 5／7 | 與聯盟、live 分享綁卡閘門相連 | `funnel_builder`（客戶端） | 3 | 同 Funnel | 中 |
| 結帳／金流核心 | 93（10／12／1） | 13,007 | 14／11 | 全部營收路徑 | — | 1 | 不可隱藏 | 不可下線 |
| auth／租戶核心 | 50（8／7／4） | 4,914 | 6／16 | 被 487 條邊依賴 | — | 1 | 不可隱藏 | 不可下線 |

封測隱藏建議順序（由易到難）：追蹤→諮詢→admin ops→課程／學員端→聯盟 payout→綁卡閘門→billing。前四項約需 3–4 人天（含 B01-01），後三項各 3–6 人天且需 reviewer。

## `actions.ts` 拆分方案

### 現況切面（行號為基線）

| 區段 | 行 | 行數 | 風險 | 現況 |
|---|---|---|---|---|
| import、共用 helper（`text`、`moneyToCents`、錯誤類別） | 1–193 | 193 | — | 退款／結算專用 helper 與一般 helper 混放 |
| 品牌設定（驗證、IP 判斷、`saveBrandSettingsAction`、`…ActionState`） | 202–506 | ~305 | 低 | 真邏輯，含 IPv4／IPv6 私網判斷 |
| wrapper（auth、vendor member、video、form、template、MFA…） | 193–201、507–587、1405–1454 | ~38 個 export | 低 | 4 行轉呼叫，**須逐一對應到 `actions/*`** |
| 直播建立／更新（`upsertLiveAction` 1191–1404 加輔助） | 594–1404 | ~810 | 中 | 與 `lib/live-*` 重疊 |
| 聯盟新增 | 1455–1482 | 28 | 中 | 可併入 `actions/affiliate-actions.ts` |
| 結算（產生、調整、鎖定） | 1483–1738 | ~256 | **高** | `lockSettlementAction` 158 行 |
| 出款（結果登記 1739、建立批次 1872、項目狀態 1996、匯出 2089） | 1739–2122 | ~384 | **高** | 與 `course-payout-actions`、`platform-referral-payout-actions` 同類卻分檔 |
| 退款 | 2123–2454 | 332 | **高** | 含 182 行不可達碼（B01-03） |
| webhook 重送 | 2455–2472 | 18 | 中 | 已委派 `lib/webhook-retry` |

### 目標結構

```text
src/app/actions/
  brand-settings-actions.ts          ← 品牌設定
  live-actions.ts                    ← upsertLiveAction（輔助邏輯搬 lib/live-commit.ts）
  affiliate-actions.ts               ← 併入 upsertAffiliateAction
  settlement-actions.ts              ← 產生／調整／鎖定（邏輯搬 lib/settlement-service.ts，沿用 billing-cycle.ts）
  payout-actions.ts                  ← 商家聯盟出款 4 個 action（與 course-payout、platform-referral-payout 對齊命名）
  refund-actions.ts                  ← 只留驗證→呼叫 executeRefund→重導
  admin-billing-actions.ts           ← retryWebhookEventAction
src/app/actions.ts                   ← 清空後刪除
```

### 分階段與派工

| 階段 | 內容 | 風險 | 派工 | 估工 | 驗證 |
|---|---|---|---|---|---|
| 0 | 刪除 2178–2359 不可達碼；非 PayUni 退款路徑 fail-closed | 金流相鄰 | H＋reviewer | 1–1.5 | `actions.test.ts` 退款區段、`payuni-refund-execution*.db.test.ts` 的 pending-refund 設定 |
| 1 | 把 38 個 wrapper 的使用者改為直接 import `actions/*`，刪除 wrapper；同步調整 7 個腳本／測試的來源清單 | 低（機械式） | E | 1–1.5 | `typecheck`、`lint`、`actions.test.ts`、`scripts/*browser-qa*.test.mjs` |
| 2 | 品牌設定、直播、聯盟新增搬出 | 中 | E | 2–3 | `actions.test.ts` 對應 describe、`project-resource-binding.db.test.ts` |
| 3 | 結算→出款→退款搬出，邏輯下沉到 lib service，action 只剩 CSRF／授權／重導 | **高** | H＋reviewer | 4–6 | `actions.payout-db.test.ts`（真 DB）、`actions.mfa-db.test.ts`、新增特徵化測試；執行 `vitest.g7-finance-db.config.ts` 與 `vitest.pending-refund-db.config.ts` |
| 4 | 把 6,833 行 `actions.test.ts` 依 describe 拆到各 action 旁；移除假 Prisma 手寫物件（約 130 行），改用真 DB 版本覆蓋出款與退款 | 中 | E | 2 | 全部 Vitest；覆蓋率門檻不得降低 |

合計約 10–14 人天；階段 0 與 1 可在封測前完成，階段 3 建議等 B01-01／02 與 B-03 的金流審查結論到齊後再動，避免兩條工作同時改同一批檔案（同一時間每個檔案只有一個 writer）。

### 注意事項

- 每個階段都要同時調降 `scripts/architecture-boundaries.test.ts:198` 的上限（2,500），並更新 `ARCHITECTURE_BOUNDARIES.md`（B01-20）。
- 腳本把 `src/app/actions.ts` 寫死在「來源鏡像清單」：`g7-commerce-browser-qa.mjs:160`、`g7-interaction-roles-browser-qa.mjs:21`、`pending-refund-disposable-qa.mjs:28`、`learner-notification-disposable-qa.mjs:24`，及各自的 `.test.mjs`、`wp160-next-dev-startup-dependency-contract.test.mjs:130`；搬移後清單與測試會失敗，需一併更新（這是拆分成本中最容易被低估的一項）。docs 內另有約 170 個證據檔提到此路徑，屬歷史紀錄，不需更新。
- `"use server"` 檔案對匯出的限制是現有 wrapper 模式的推測成因；拆分時請以各 `actions/*.ts` 直接匯入，不要再建立轉出檔。動手前依 `AGENTS.md` 先讀 `node_modules/next/dist/docs/` 中 `use-server` 的現行規則。
- 金額仍由表單讀入（`moneyToCents`），伺服器綁定與否屬 B-03 範圍；拆分時不得順手改變語意。

## 給 E-02 的證據摘要（重構 vs 重寫，題 7）

### 核心模組的耦合與測試可信度

| 模組 | 行數 | 直接相依 | 傳遞相依 | 被傳遞依賴 | 2026-07-01 起 commit | 測試結構 | 可信度判斷 |
|---|---|---|---|---|---|---|---|
| `api/payments/checkout/route.ts` | 1,100 | 27 | 93 | 0 | 19 | `route.test.ts` 1,520 行、66 案、11 個 mock；`commerce-orders.db.test.ts`、`checkout-admission.db.test.ts`；E2E 全用 `demo` provider | 中：邏輯有測，但 route 層 mock 多，PayUni 無 E2E |
| `lib/payment-webhooks.ts` | 1,302 | 20 | 43 | 95 | 19 | `payment-webhooks.test.ts` 2,382 行、44 案、**0 個 mock、連真 DB**，同一檔被 4 個拋棄式設定重複執行 | **高**：最值得保留的資產 |
| `lib/auth.ts` | 429 | 5 | 10 | 293 | 6 | `auth.test.ts` 29 案、5 個 mock；55 個 E2E direct-url／跨租戶 spec；`actions.mfa-db.test.ts` 真 DB | 中高 |
| 平台 billing（`platform-plan-checkout.ts`） | 565 | 11 | 66 | 2 | 4 | 無同名測試；僅 route 測試與 `payment-webhooks.test.ts` 間接涵蓋 | 中低：最大的無同名測試 lib 檔 |
| `app/actions.ts` 財務區段 | ~990 | 41（整檔） | 126 | 43 | 25（整檔） | `actions.test.ts` 6,833 行、255 案，以手寫假 Prisma（約 130 行）驗證；`actions.payout-db.test.ts` 5 案真 DB | 中：退款、出款多靠 mock，真 DB 版本只覆蓋出款部分 |
| `lib/payuni-refund-execution.ts` | 216 | 5 | 54 | 48 | — | pending-refund 設定 4 個 `.db` 測試（真 DB） | 中高 |

整體測試規模（`03-test-map.md`）：Vitest 757 檔／6,357 案、Node TAP 1,225 案、E2E 90 個 spec、master 最近一次 CI 綠燈；無 PayUni、LINE、MFA 登入專屬 E2E。

### 與重寫相關的結構事實

- 沒有執行期循環、lib→app 反向依賴為 0、`architecture-boundaries.test.ts` 與複雜度棘輪都在 CI 內，表示「重構的安全網」已經存在；缺的是模組邊界（B01-06）與幾個反向依賴（B01-07、B01-08）。
- 核心金流的耦合並非散亂，而是集中在兩個樞紐：`payment-webhooks.ts`（事件扇出）與 `commerce-orders.ts`（訂單狀態）。其他模組向它們伸出的邊有限（課程 3 個契約檔、聯盟 3–4 個檔、tracking 3 個檔）。這種形狀適合「在樞紐前面建立介面、逐模組移出」，不適合整體重寫。
- 近三個月最熱的檔案就是最需要保護的檔案（`actions.ts` 25 次、`payment-webhooks.ts` 19 次、checkout route 19 次）；重寫會同時發生在營收路徑上最頻繁變動的地方，回歸風險最高。
- 有一批程式本來就不該屬於核心（WP4／q1 harness、孤兒 action、死碼、Puck 舊路徑）；清掉它們能讓「核心」縮小約 54 個檔案（admin ops）＋約 20 個死碼檔，這比重寫便宜得多。

### 建議

1. **不重寫** checkout、payment-webhooks、auth、退款／出款／結算。以「特徵化測試＋同檔內抽函式（B01-09）＋依賴反轉（B01-07、B01-08）」推進，合計約 17–25 人天，可與封測並行。
2. 若 E-02 仍要評估 strangler，**第一個模組建議學員端 `/portal`（含課程學習與社群）**：
   - 接縫清楚：獨立 URL 前綴 `/portal`、獨立 session（`student-portal-auth`）、獨立 model（`CourseLesson`、`CourseLessonProgress`、`CourseCommunity*`、`StudentPortalAccessToken`）。
   - 與金流只有三個契約檔相連（`product-delivery.ts`、`course-policy-snapshot.ts`、`course-commission-accounting.ts`），可在重寫期間凍結為介面。
   - 封測期間可整組隱藏（B01-02），重寫期間不影響測試使用者。
   - 已有真 DB 測試（`student-course-learning.db.test.ts`、`course-community.db.test.ts`）與 4 個 E2E 可作為驗收。
   - 規模：約 70 個非測試檔、約 5,900 行。
   第二候選：追蹤（18 檔、outbox 已是接縫），但價值低。
3. 在決定任何重寫之前，先做三件便宜且與結論無關的事：B01-03（刪不可達退款碼）、B01-04（限流 IP）、B01-01（真正的功能關閉），因為它們同時是封測前必修與重構前提。

---

## 附錄 A：knip production 模式 19 個「未使用」檔案逐一判定

| # | 檔案（行數） | 引用者 | 判定 | 處置建議 |
|---|---|---|---|---|
| 1 | `components/interaction-role-form.tsx`（142） | 自己的測試；`scripts/g7-interaction-roles-browser-qa.mjs:33` 的來源清單 | 真死碼（已被 `interaction-roles-workbench` 取代） | 刪除並更新該腳本清單 |
| 2 | `lib/interaction-role-label.ts`（28） | 上列元件、自己的測試、同一腳本 | 連帶死碼 | 隨 #1 刪除 |
| 3 | `lib/ab-testing.ts`（77） | 僅自己的測試 | 真死碼（正式 A/B 在 `funnel-runtime` 的 `assignFunnelExperiment`） | 刪除 |
| 4 | `lib/ai-funnel-assistant.ts`（138） | 僅自己的測試 | 真死碼（檔頭自稱 deterministic 佔位，無接線） | 刪除或移 docs 作規格 |
| 5 | `lib/evergreen-webinar.ts`（176） | 僅自己的測試 | **半接線**：設定 UI 與 action 在用，狀態機函式沒人呼叫（B01-19） | owner 決定接線或隱藏 |
| 6 | `lib/funnel-templates.ts`（109） | 僅自己的測試 | 真死碼（推測：被 goal 式 Funnel 與 team template 取代） | 刪除前確認 |
| 7 | `lib/interaction-card-media.ts`（12） | 僅 `interaction-card-timeline.test.ts` | 真死碼 | 刪除 |
| 8 | `lib/wp4-payuni-sandbox-checkout.ts`（35） | 僅自己的測試 | 真死碼 | 刪除 |
| 9 | `lib/cloudflare-webhook-fixtures.ts`（89） | `scripts/cloudflare-webhook-fixtures.ts`、route 測試 | 測試／腳本 fixture | 搬到 `scripts/` 或 `tests/fixtures/` |
| 10 | `lib/staging-qa-finance-bootstrap.ts`（102） | 8 個以上 `scripts/*` | 腳本支援 | 搬到 `scripts/lib/` |
| 11 | `lib/payment-providers/payuni-fixtures.ts`（82） | 測試、`scripts/external-smoke.ts` 等 | fixture | 搬到 `tests/fixtures/`；不在 production bundle 內 |
| 12–16 | `components/funnel-blocks/{carousel-block,countdown-timer-block,funnel-page-renderer,lead-form-block,pricing-table-block}.tsx`（62／35／29／10／41） | 互相引用；`funnel-page-renderer` 無任何引用者 | 真死碼（#240 加入，已被 `funnel-page-document-renderer` 取代；`consultation-booking-block.tsx` 仍使用中，要保留） | 刪除 5 檔；`lib/funnel-blocks-schema.ts` 另查 |
| 17 | `(app)/billing/plans/actions.ts`（21） | 僅自己的測試 | 孤兒 Server Action（頁面走 `/api/billing/plans/select`） | 帳務相鄰：reviewer 確認後刪除 |
| 18 | `(app)/billing/plans/plan-submit-button.tsx`（19） | 僅自己的測試 | 孤兒元件 | 同上 |
| 19 | `api/admin/ops/payuni/test-support/recovery-boundary.ts`（37） | 多個 ops route 的測試 | 測試輔助 | 改名 `*.test-support.ts` 或搬到 `__tests__` |

這 19 個檔案都不可由任何 route／page 到達，所以**不在 production bundle 內**；問題是維護與審查成本，不是 bundle 大小。

## 附錄 B：其他殘留項目的判定（題 6 後半）

| 項目 | 狀態 | 是否應進正式 bundle |
|---|---|---|
| `src/app/__test/funnel-elements` | 未追蹤的空目錄（`git ls-files` 無輸出） | 不存在於 repo；刪除空目錄 |
| `src/app/sentry-example-page` | 同上，空目錄；repo 內無任何 sentry-example 檔案 | 同上 |
| `src/app/browser-qa/{funnel-editor,funnel-elements}/page.tsx` | 已追蹤；以 `NODE_ENV !== "development"` 回 `notFound()`；供 `playwright.funnel-elements.config.ts`（`next dev`）使用 | 會出現在 production 路由表；建議建置期排除（B01-16） |
| `src/app/__celebratedeal_wp187_fingerprint.json/route.ts` | 底線目錄＝App Router 私有目錄，route 不可達；實際由 `proxy.ts` 的 matcher 提供，`route.ts` 與其測試只服務於 `fin08aa-preview-route-manifest-attestation.mjs` | 端點內容在 production 也公開（B01-16）；應僅限 preview |
| `lib/wp4-*`（14 個）、`q1-downstream-readonly.ts` | 隨 28 條 ops route 一起進 bundle，另有 5 處被正式路徑 import（B01-07） | 不應；先解耦再排除 |
| 17 組重複 export 別名 | 見 04-static-scan §4.2 | 拆分時處理 |

## 附錄 C：量測方法限制

- 本檔 import 圖不處理 `require()`、非字面量動態 import、`vi.mock` 路徑；`export * from` 與 `export { x } from` 有計入。
- 「模組歸屬」依第一個符合的規則決定，所以像 `payment-method-reference.ts`（歸 billing）被 live 與 checkout 引用，是邊界本身糾纏的證據，而不是分類錯誤。
- `readFile` 型原始碼字串合約測試（`03-test-map.md` §2.3）不被計為可信覆蓋。
- 所有「近三個月 commit 數」取自 `git log --since=2026-07-01`。
