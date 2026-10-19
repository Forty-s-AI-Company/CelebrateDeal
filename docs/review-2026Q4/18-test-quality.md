# 18 測試品質審查（B-08）

- 審查日期：2026-10-19（唯讀；沒有改動任何既有檔案、沒有 git 寫入、沒有讀取 `.env*`、沒有執行 e2e 或完整套件）
- 審查基準：分支 `codex/goal-review-2026q4` = `origin/master` `78621ca3`（#444）。本機 `master` 分支仍停在 `efb8b7e9`，比對一律用 `origin/master`。
- 方法：以 TypeScript AST 解析全部 992 個測試檔（`src` 701、`scripts` 約 190、`tests/e2e`＋`browser-dev`＋`tracking`＋`subscription-recovery` 約 100）計算 case 與 assertion；用 `git grep` 核對引用；讀取 `vitest*.config.ts`、`scripts/run-combined-coverage.mjs`、`ci.yml`、`tests/e2e/helpers/direct-url-guard.ts` 等原始檔。實際只執行了 4 個「原始碼字串」測試（見 B08-01）來確認它們通過所花的時間。
- 數字說明：AST 解析的 case 數是靜態數量（不展開 `.each`），全部 6,269 個；CI 實測 6,357 個 Vitest tests 是展開後的數字，兩者不能互相比較。

---

## 0. 先講結論

1. **測試的量很大，但「保護金流與權限的測試」有三個結構性問題**：(a) 測試資料不是真實的 PayUni 回呼格式，所以抓不到 B-03 的兩個 BLOCKER；(b) 有一個測試把 B-02 的 BLOCKER 當成預期行為釘住；(c) 月結、鎖月後退款、幣別這幾個 B-03 問題完全沒有回歸測試。
2. **真正的「假測試」比預期少，但集中在最敏感的地方**：4 個檔案、7 個 case 只讀原始碼做 `toContain`，全部在 39 ms 內通過，沒有執行任何一行被測程式。它們剛好是處理客戶 PII 與租戶範圍的 CRM 與行動諮詢（`customer-crm-actions`、`mobile-consultation-actions`、兩個對應頁面）。沒有找到沒有任何 assertion 的 `it`（機器標出的 15 個 case 都把 assertion 放在輔助函式裡）、沒有 `expect(true)`、沒有 `it.skip`／`only`／`todo`。
3. **覆蓋率數字可以信，但保護力有限**：合併流程本身設計合理（Vitest＋Node TAP 的 V8 覆蓋合併後自行判斷），但全域門檻把 `scripts/**` 放進分母、`src/lib` 專屬百分比沒有印出、門檻常數重複三處、`vitest.synthetic-db-coverage.config.ts` 的 thresholds 目前不會被評估。`coverage.exclude` 只排除測試檔與 `.d.ts`，沒有任何高風險目錄被排除；缺口在 `include` 之外（`prisma/`、`public/portal/sw.js`、根目錄設定檔）。
4. **CI 單一 job 串行約 32.6 分鐘，且有明顯重複**：完整 Vitest 套件跑兩次、Node TAP 跑兩次、4 次 `--webpack` 的 `next build`、`push`＋`pull_request` 雙觸發。照本文建議合併與拆分，牆鐘時間預估可降到約 12–14 分鐘。
5. **flaky 的根因仍未證實**，而 CI reporter 為了不洩漏資料，連測試名稱都不輸出，等於讓「失敗後重試」蓋住問題。本文提出四個可驗證的假說與驗證方法（§4）。
6. **設定檔過多**：vitest 21、playwright 16、prisma 6，其中 4 個 vitest 與 4 個 prisma disposable 設定沒有任何 runner 或 workflow 參照（孤兒）。

---

## 1. Findings

嚴重度：BLOCKER（會讓封測資金或資料出錯）／MAJOR／MINOR／NIT。估工以一位熟悉專案的工程師計。

| ID | 嚴重度 | 檔案:行號 | 問題 | 影響 | 建議 | 估工 | 需 owner 決策 | 封測前必修 |
|---|---|---|---|---|---|---|---|---|
| B08-01 | MAJOR | `src/app/actions/customer-crm-actions.test.ts:5-20`、`src/app/actions/mobile-consultation-actions.test.ts:5-23`、`src/app/(app)/customers/page.test.tsx:5-15`、`src/app/(app)/consultations/mobile/page.test.tsx:5-20` | 4 個檔案 7 個 case 用 `readFile` 讀被測 `.ts/.tsx` 原始碼，再用 `expect(source).toContain("requireVendorManagerContext()")` 之類的字串比對。實測 4 檔 7 tests 共 39 ms 通過。被測程式從未被匯入或執行，因此不產生覆蓋率，也不驗證行為。 | 這兩個 action 處理客戶姓名、Email、電話（`revealCommerceOrderPii`）與租戶／專案範圍。有人把 `vendor.id` 篩選寫錯但字串仍在（例如放在註解、死分支），測試依然是綠的。03-test-map 已指出 `customer-crm-actions` 沒有任何測試 import 觸及。 | 改成行為測試：mock `@/lib/db` 與 `requireVendorManagerContext`，用「本商家」「外租戶」兩組資料呼叫 action，斷言 `where` 條件帶 `vendorId`、外租戶 ID 被拒、`assertServerActionSecurity` 先被呼叫、PII 只在授權後解開。兩個頁面測試改成 `renderToStaticMarkup` 或 RTL 渲染並斷言可見文字與隱藏欄位。 | 1.5–2 天 | 否 | 是 |
| B08-02 | MAJOR | `src/lib/payment-providers/payuni.test.ts:636-690`（自創 `EventId`／`EventType`）、`src/lib/payment-providers/payuni-fixtures.ts:8,15,21,29,34,41`（`EventType`、`PayStatus`）；對照 `payuni.ts:959-1002` | PayUni 回呼的測試資料全是自創欄位（`EventId`、`EventType: "paid"`、`PayStatus: "paid"`），沒有任何一個 case 使用真實 Notify 的 `Status=SUCCESS`＋`TradeStatus` 組合（`TradeStatus` 只出現在主動查詢路徑，`payuni.test.ts:108,122,144,415-535`）。也沒有「缺少 `NetAmount`／`GatewayFee`」「缺少 `EventId`」的 case。 | 這正是 B03-01（刷卡失敗也被當成已付款）、B03-04（`netAmountCents` 被覆寫成 0）、B03-13、B04-13（eventId 退化為 TradeNo）都能通過全部單元測試的原因。修好之後如果沒有真實格式的 fixture，同一類錯誤可以再回來。 | 以 PayUni 官方 Notify／Return 的實際欄位（去識別化後的 Sandbox 樣本）建立 fixture，至少涵蓋 `TradeStatus` 0／1／2／3／4／9、缺 `NetAmount`、缺 `EventId`、外層 Status 非 SUCCESS。同時加入 DB 層斷言：不應建立 paid 的 PaymentTransaction、不應產生佣金。 | 1–2 天（含 owner 提供樣本） | 是（需要 Sandbox 實際回呼樣本） | 是（與 B03-01 同批） |
| B08-03 | MAJOR | `src/lib/auth.test.ts:224-229` | 測試「allows a platform administrator without MFA to use the admin area」把 B02-01 的漏洞當成預期行為，而且目前通過。 | 只要這條測試存在，任何人修正 `requireFinanceAdmin` 都會先讓 CI 變紅；若有人為了讓 CI 變綠而放寬修正，漏洞會被保留。 | 合併 PR #436 時把它反轉成「沒有 MFA factor 的平台 admin 被導向 `/mfa/setup`」，並加入以 `/admin/**` 路由清單做表驅動的測試（含 payout CSV、退款、月結鎖定、webhook 重送）。 | 0.5 天（#436 已含部分） | 否 | 是 |
| B08-04 | MAJOR | `src/lib/billing.test.ts`、`src/lib/billing-cycle.test.ts`、`src/app/actions/product-actions.test.ts:53,129` | 搜尋 `billingPurpose`、`platform_subscription_checkout`、`invoice_payment`、鎖月後退款、非 TWD 幣別，在 billing 與 product 測試中 **0 筆命中**。product 測試所有 case 都只用 `currency: "TWD"`。 | B03-02（平台方案費被算成商家營收）、B03-03（鎖月後退款落在已鎖定月份）、B03-05（USD 商品被當台幣收）三個問題在修好之前與之後都沒有回歸網，月結金額是封測最需要對帳的數字。 | 為每個 B03 帳務問題先寫一個會失敗的 DB／單元測試（紅），修好後轉綠；斷言要寫出金額，例如 `settlement.payableCents`、`grossAmountCents` 的精確值。 | 2 天（含在 B-03 修復工時內） | 否 | 是 |
| B08-05 | MAJOR | 見 `docs/review-2026Q4/12-tenant-auth.md`「第二租戶測試缺口」12 項；`src/app/actions/team-membership-actions.test.ts`（7 case 含 12 個 `toHaveBeenCalledWith`，沒有任何外租戶 teamId／memberId） | 高風險 server action 缺少第二租戶負向案例（`vendor-member-actions` 完全沒有測試檔；`recordAffiliatePayoutOutcomeAction`、`merchant-affiliate-payout-policy-actions`、`course-curriculum-actions`、`affiliate-portal-actions` 等）。 | 新增敏感 action 必須有第二租戶負向回歸（`docs/domain-workflows.md` 規則 20），目前以人工審查補位。 | 建一個共用的「兩租戶夾具＋表驅動 action 矩陣」，每個 action 只需登記 `{ action, foreignIdField, expectedNoMutation }`。 | 3–4 天 | 否 | 是（金流、PII 相關的 6 項）；其餘封測後 |
| B08-06 | MINOR | `vitest.config.ts:60-88`、`scripts/run-combined-coverage.mjs:22-23,299-315`、`vitest.synthetic-db-coverage.config.ts:59-74` | 覆蓋率門檻在三處各寫一份相同數值；`COMBINED_COVERAGE_COLLECTION==="true"` 時 `vitest.config.ts` 的門檻被設為 `undefined`；合併腳本只輸出全域 text-summary，**不印 `src/lib` 專屬百分比**；全域分母含 `scripts/**`（423 個 scripts 檔，大量一次性 runner）。master 最新一次：Statements 65.52%（門檻 63）、Lines 70.78%（門檻 65）。 | 金流與權限相關的 lib 退步時，全域數字可能被 scripts 的覆蓋掩蓋；三處常數需要人工同步；沒有任何人看得到 `src/lib` 的實際值，下一次調整門檻只能憑感覺。 | 把常數抽成單一模組（例如 `scripts/coverage-thresholds.json`）；合併後輸出每個目錄（`src/lib`、`src/app/api`、`src/app/actions`、`src/components`、`scripts`）的百分比；對 `src/lib/payment-*`、`src/lib/billing*`、`src/lib/auth*`、`src/app/api/payments`、`src/app/api/webhooks` 設獨立的 per-path 下限。 | 1 天 | 否 | 否 |
| B08-07 | MINOR | `vitest.synthetic-db-coverage.config.ts`；`package.json:18`（`test:db:concurrency`）；`ci.yml:168-188` | 名稱含 coverage、檔內有完整 `coverage.thresholds`，但 CI 命令沒有 `--coverage`，所以門檻**不會被評估**。實際行為是把整個測試集（`wp18-main`，759 檔）再跑一次（約 211–217 秒），另加 `wp17-db`（`actions.mfa-db.test.ts`）。與根設定相比只多跑 `actions.payout-db.test.ts`，並且漏了 `tmp/**` 排除。 | 浪費約 3 分鐘；名稱誤導；若有人單獨加 `--coverage` 執行，TAP 擁有的 scripts 會是零計數，數字與合併流程不同。 | 改名為 `vitest.db-isolation.config.ts`，移除未啟用的 `coverage` 區塊；`wp18-main` 只跑真正需要獨立 schema 的檔案（`actions.payout-db.test.ts` 與標示需要隔離的 `*.db.test.ts`），其餘已由 `test:coverage` 在同一個 PostgreSQL 內執行。 | 0.5 天 | 否 | 否 |
| B08-08 | MINOR（需驗證） | `tests/e2e/member-billing-plans-direct-url.spec.ts:216-395`、`tests/e2e/helpers/direct-url-guard.ts:78-335`、`scripts/playwright-ci-reporter.ts:8,99-133`、`tests/e2e/commerce-orders.spec.ts:885-1000` | 兩個已知 flaky 的根因未證實。guard helper 把 `streaming-redirect` 的狀態碼硬編為 200，並在 `waitUntil: "commit"` 之後立刻斷言「恰好一個」同路徑 document request／response；CI reporter 不輸出測試名稱、訊息與堆疊，只留類別與行號。 | 失敗後重試通過會被當成 flaky 紅燈（`--fail-on-flaky-tests`），但沒有任何資料可以判定是 Next.js 傳輸層時序、DB 競爭還是共用記憶體 rate limit。 | 見 §4：先用 `--repeat-each` 與狀態碼直方圖驗證假說 H1，再決定是放寬 helper 還是補同步點；同時讓 reporter 在白名單內輸出測試檔名（不含訊息）。 | 1–2 天 | 否 | 否 |
| B08-09 | MINOR | `.github/workflows/ci.yml:3-6,9,159-166,168-188,193-227` | 單一 `quality` job 串行 49 個 step（32.6 分鐘）；`push` 與 `pull_request` 同時觸發；沒有 `timeout-minutes` 與 `concurrency`；完整 Vitest 套件跑兩次（245s＋211s）、Node TAP 跑兩次（含在覆蓋率內一次＋`test:contracts` 25s）、4 次 `--webpack` 的 `next build`＋`npm run build`＋controlled build。 | 每次 PR 更新花約 65–85 runner 分鐘；等待回饋 30 分鐘以上；卡住的 job 最長可跑 360 分鐘。 | 見 §5 的合併步驟與預估。 | 1.5–2 天 | 否 | 否 |
| B08-10 | MINOR | `vitest.g7-analytics-authenticity-db.config.ts`、`vitest.g7-form-verification-db.config.ts`、`vitest.g7-stream-db.config.ts`、`vitest.g7-stream-reconciliation-db.config.ts`、`prisma.g7-*-disposable.config.mjs`（4 個） | 8 個設定檔在 repo 內沒有任何 runner、workflow、package script 參照（`git grep` 確認，只被 2026-08 的證據清單提及）。其餘 vitest 設定（20 個）高度同形，playwright 15 個衍生設定約 10 個是同一個樣板。 | 維護成本與新人誤用風險；改一個守衛邏輯要改十幾個地方。 | 見 §6.1：先移除 8 個孤兒（或補 runner），再把 20 個 vitest 設定收斂為一個 `test.projects` 設定，playwright 抽工廠函式。 | 3–4 天 | 是（孤兒是否保留） | 否 |
| B08-11 | MINOR | 97 個會讀檔的測試：`scripts/g7-commerce-browser-qa.test.mjs`（33 case、約 280 個 assertion）、`scripts/secure-staging-workflow-contract.test.mjs`（243）、`scripts/staging-browser-smoke.test.mjs`（189）、`src/lib/*-schema-contract.test.ts` 等 | 大量測試以「讀 workflow YAML、migration SQL、QA runner 原始碼」再用字串或 regex 當唯一斷言：workflow 文字 18 檔、migration／schema 文字 23 檔、runner 原始碼／收據／fixture 47 檔，另有 4 檔是 B08-01 的純原始碼測試。 | 這類測試保護的是「設定文字沒被改」，不是「行為正確」；任何排版或重構都會觸發紅燈，維護者容易放寬或刪掉，也混淆了 `test:contracts` 的 1,225 tests 的實際保護力。其中 migration 文字契約有價值（防止 RLS／trigger 被改掉），但應與行為測試分開標示。 | 分三類標示：①行為測試 ②設定／schema 契約（保留，命名 `*.contract.test`）③歷史 runner 測試（隨 runner 封存，見 20-dead-code-residue B10-09）。不要再新增類別④（對 TS 原始碼做字串斷言）。 | 持續性（2 天做分類與命名） | 否 | 否 |
| B08-12 | NIT | `src/lib/env.test.ts`（16 處 `toBeDefined`／`toBeTruthy`）、`src/components/live-stepper-form.test.tsx`（20 處）、`src/lib/payment-webhooks.test.ts:1365-1366,1403-1405` | 全專案 72 處 `toBeDefined`、18 處 `toBeTruthy`。`check(report, key, "fail")` 回傳物件後只確認「有東西」。 | 斷言太弱，改壞內容時不一定會失敗。（`payment-webhooks.test.ts` 這幾處之後都有金額斷言，風險低。） | 改為 `toMatchObject({ status: "fail", ... })`。 | 0.5 天 | 否 | 否 |

---

## 2. 假測試與弱測試盤點

### 2.1 搜尋條件與結果

| 搜尋條件 | 結果 |
|---|---|
| `expect(true)`、`it.todo`、`test.fixme`、`.only` | 0 筆 |
| `it.skip`／`describe.skip`／`skipIf` | 4 處條件式略過：`interaction-card-timeline.db.test.ts`、`live-chat.db.test.ts`、`presenter-layout.db.test.ts`（皆在 `RT01_D2_DISPOSABLE_DB!=="true"` 或 DB 不安全時略過，CI 已設為 true）、`smoke.spec.ts` 一處（雲端 rate limit provider 時略過，e2e 固定使用 memory） |
| 沒有 assertion 的 `it` | AST 標出 15 個 case／6 檔（`payment-methods/route.test.ts` 3、`dashboard-read-model.query-event.test.ts` 2、`wp4-buyer-ops.db.test.ts` 2、`g7-commerce-order-schema-contract.test.ts` 1、`accessibility.spec.ts` 1、`smoke.spec.ts` 6）。逐一確認：全部把 assertion 放在輔助函式（`expectBrowserRedirect`、`verifyOriginalCallbackRecovery`、`requireText`、`runDashboardKpiEvidence` 內含 7 個 `expect`）。**沒有真正無斷言的 case** |
| 只有 `toBeDefined`／`toBeTruthy`／`not.toHaveBeenCalled` 的 case | 73 個 case／43 檔，絕大多數是負向案例（`not.toHaveBeenCalled` 是合理斷言）；真正偏弱的是 B08-12 |
| `vi.mock` 把被測模組自己 mock 掉 | 0 筆（機器唯一命中的 `src/app/@checkout/(.)checkout/.../page.test.tsx` 是 mock 另一個路由的頁面，不是自己） |
| 讀原始碼＋`toContain`（假測試） | **4 檔 7 case 為純原始碼字串**（B08-01）；另有 `announcement-center.test.tsx` 1 個 case（`:16`，同檔另一個 case 是真渲染）、`scripts/live-product-tenant-contract.test.ts`、`scripts/stream-usage-attribution-contract.test.ts`、`scripts/rt01-live-chat-disposable-qa.test.ts`（部分 case 對 `.ts` 原始碼做字串斷言，同檔仍有行為 case） |

### 2.2 純原始碼字串測試清單

| 檔案 | case | 字串斷言數 | 被測程式是否被執行 |
|---|---|---|---|
| `src/app/actions/customer-crm-actions.test.ts` | 2 | 10 | 否 |
| `src/app/actions/mobile-consultation-actions.test.ts` | 2 | 13 | 否 |
| `src/app/(app)/customers/page.test.tsx` | 1 | 8 | 否 |
| `src/app/(app)/consultations/mobile/page.test.tsx` | 2 | 9 | 否 |
| `src/components/announcement-center.test.tsx`（其中 `:16` 一個 case） | 1／2 | 3 | 否（另一個 case 有 SSR 渲染） |

驗證指令與結果：`npx vitest run` 這 4 檔，`Test Files 4 passed (4)`、`Tests 7 passed (7)`、`tests 39ms`。

### 2.3 讀檔型測試的分類（97 檔）

| 類別 | 檔數 | case 數 | 判讀 |
|---|---|---|---|
| migration／schema SQL 文字契約 | 23 | 92 | 保留，但以 `*.contract.test` 命名，與行為測試分開 |
| workflow YAML 文字契約 | 18 | 93 | 保留作為 CI 防呆；封存的 workflow 一併封存 |
| TS／MJS 原始碼、fixture、收據、憑證 | 47 | 461 | 多數是 runner 的輸入輸出驗證，合理；`g7-*-browser-qa.test.mjs` 系列是對 runner 原始碼做 regex，屬脆弱類 |
| JSON 契約（`docs/launch/*.json`） | 9 | 73 | 被這些測試釘住的文件，搬動前必須先改測試（見 20 號文件） |
| 純 TS 原始碼字串 | 4（＋1 個 case） | 7 | B08-01 |

---

## 3. Assertion 強度抽查（28 個金流／權限相關檔案）

欄位：`case` 為靜態 case 數；`expect` 為 assertion 數；`金額` 為斷言行含 Cents／amount／commission 等字樣的行數；`狀態` 為含 status／state 的斷言行；`calledWith` 為 `toHaveBeenCalledWith` 類；`弱` 為 `toBeDefined`／`toBeTruthy`。

| 檔案 | case | expect | 金額 | 狀態 | calledWith | 弱 | 評語 |
|---|---:|---:|---:|---:|---:|---:|---|
| `src/lib/payment-webhooks.test.ts` | 44 | 146 | 36 | 32 | 0 | 5 | 強：金額與狀態斷言多；但輸入是自創 payload（B08-02） |
| `src/lib/payment-providers/payuni.test.ts` | 40 | 111 | 10 | 5 | 3 | 0 | 中：簽章、加解密、查詢路徑完整；Notify 路徑缺真實格式；沒有 `netAmountCents` 斷言 |
| `src/app/api/webhooks/payments/route.test.ts` | 35 | 159 | 0 | 39 | 5 | 0 | 中：狀態與審計齊全；金額由下游測試覆蓋 |
| `src/app/api/payments/checkout/route.test.ts` | 66 | 273 | 7 | 71 | 40 | 0 | 強：呼叫參數與狀態碼斷言多，包含負向案例 27 個 |
| `src/lib/payuni-refund-execution.test.ts` | 1 | 3 | 0 | 0 | 0 | 0 | 弱：僅驗證非法金額在呼叫 provider 前被拒；實際執行靠 4 個 `.db.test` |
| `src/lib/payuni-refund-reconciliation.test.ts` | 16 | 71 | 3 | 10 | 1 | 0 | 強 |
| `src/lib/payment-refund-accounting.test.ts` | 3 | 4 | 2 | 0 | 1 | 0 | 弱：只有 3 case，未涵蓋全額退款與佣金回沖的組合 |
| `src/lib/billing.test.ts` | 25 | 49 | 12 | 4 | 5 | 0 | 中：有精確金額，缺 B03-02／03（B08-04） |
| `src/lib/billing-cycle.test.ts` | 8 | 28 | 3 | 1 | 8 | 0 | 中：mock 為主，鎖月案例只驗證錯誤代碼 |
| `src/app/api/billing/plans/select/route.test.ts` | 5 | 17 | 0 | 5 | 3 | 0 | 中 |
| `src/lib/inventory-reservations.test.ts` | 14 | 52 | 1 | 7 | 0 | 0 | 強：庫存數量斷言完整；缺「保留過期後才付款」（B03-07） |
| `src/lib/affiliate-commission-accounting.test.ts` | 10 | 28 | 11 | 0 | 0 | 0 | 強：金額導向 |
| `src/lib/course-commission-accounting.test.ts` | 3 | 6 | 1 | 0 | 0 | 0 | 弱：case 少 |
| `src/lib/tenant-ledger-invariants.test.ts` | 4 | 19 | 3 | 0 | 0 | 0 | 強：真 PostgreSQL，驗證 trigger、constraint 名稱與 append-only（這是 B02-03 之外唯一的 DB 層租戶防線證據） |
| `src/lib/payment-webhook-invariants.test.ts` | 8 | 15 | 2 | 5 | 0 | 0 | 中 |
| `src/lib/platform-subscription-refund.test.ts` | 4 | 7 | 1 | 3 | 2 | 0 | 弱：4 case |
| `src/app/actions.test.ts` | 255 | 962 | 9 | 35 | 240 | 0 | 強但龐大（6,830 行）：呼叫參數斷言為主，金額斷言只有 9 行，退款解析（B03-15）無嚴格案例 |
| `src/app/actions/affiliate-actions.test.ts` | 4 | 19 | 2 | 0 | 8 | 0 | 弱：缺 B03-20 |
| `src/app/actions/course-payout-actions.test.ts` | 3 | 9 | 0 | 1 | 4 | 0 | 中：有 `where`／ledger 參數斷言；缺「商家 finance 角色被拒」 |
| `src/app/actions/invoice-actions.test.ts` | 7 | 23 | 1 | 0 | 5 | 0 | 中 |
| `src/app/actions/team-membership-actions.test.ts` | 7 | 25 | 0 | 3 | 12 | 0 | 中：缺外租戶 ID（B08-05） |
| `src/app/actions/commerce-order-actions.test.ts` | 5 | 10 | 0 | 0 | 4 | 0 | 弱 |
| `src/app/api/webhooks/payment-methods/route.test.ts` | 29 | 84 | 0 | 22 | 13 | 0 | 強：綁卡回呼的重導、審計、去重完整（#444 後） |
| `src/lib/auth.test.ts` | 29 | 48 | 0 | 0 | 4 | 0 | **有誤**：`:224` 釘住漏洞（B08-03） |
| `src/lib/mfa.test.ts` | 7 | 16 | 0 | 0 | 0 | 0 | 中：純密碼學與 TOTP；強制 MFA 的流程在 `auth.test.ts` |
| `src/lib/csrf.test.ts` | 14 | 19 | 0 | 0 | 0 | 0 | 強 |
| `src/lib/merchant-api-security.test.ts` | 4 | 11 | 0 | 4 | 1 | 0 | 中 |
| `src/lib/commerce-checkout.test.ts` | 8 | 32 | 1 | 2 | 0 | 0 | 中 |

整體判讀：
- **斷言風格是好的**：多數檔案用 `toHaveBeenCalledWith`、`toMatchObject`、精確金額（例如 `payment-refund-accounting.test.ts` 的 `77_600`），不是「不丟錯就好」。沒有發現只斷言「不丟錯」的檔案。
- **輸入不真實與案例缺漏才是問題**：強斷言建立在自創輸入上（B08-02），且 B03 已發現的金額問題都沒有對應案例（B08-04）。
- **222／701 個 `src` 測試 mock `@/lib/db`（32%）**：這些測試驗證的是呼叫形狀，不是資料庫行為。serializable 衝突、unique／CHECK、trigger 只靠 50 個 `*.db.test.ts`（只在 `test:coverage`＋DB 併發兩處執行）。

---

## 4. Flaky 根因假說與驗證方法

### 4.1 `member-billing-plans-direct-url`

已知事實（來自 `docs/launch/NEXT-CYCLE.md` 第 5 點）：PR #348 的 run 36410824308 首次在 581 ms 失敗、重試通過；reporter 為了不洩漏資料只輸出類別（`step_error category=expect`）與 helper 行號。

測試流程：建立 vendor／member／plan／subscription／usageLimit → 以 UI 登入 → 取 DB 快照 → `navigateAndAssertDirectUrlGuard(... kind: "streaming-redirect", status: 200 ...)` → 一串 UI 斷言 → `expect.poll(snapshot).toEqual(before)`。

| 假說 | 理由（檔案:行號） | 預期症狀 | 驗證方法 |
|---|---|---|---|
| **H1：傳輸型態競爭（200 streaming 與 307 轉址）** | `direct-url-guard.ts:264` `expect(protectedResponse.status()).toBe(transport.status)` 把 `streaming-redirect` 固定為 200。`(app)/loading.tsx` 與 `billing/loading.tsx` 讓頁面外殼先送出；若 `requireVendorFinance` 的 session 查詢夠快，轉址可能在第一次 flush 之前就完成，回應變成 307。36 個 spec 使用同一型態，但 billing/plans 的守門在 `page.tsx:167`，比多數頁面更晚、更依賴資料庫。 | 失敗訊息為狀態碼不符（`expected 307 to be 200`），在慢機器或快機器都可能；通常很快（< 1 秒，與 581 ms 吻合） | ① 非瀏覽器：以該成員 session cookie 對 `/billing/plans` 發 200 次 `fetch(..., { redirect: "manual" })`，統計狀態碼分布（只需 loopback production build）。② `npx playwright test member-billing-plans-direct-url --repeat-each=50 --retries=0 --workers=1`，在本機以 CPU 限速（`cpulimit` 或 Docker `--cpus=1`）重現。③ 暫時在 helper 內 `test.info().annotations.push` 記錄 `protectedResponse.status()`。 |
| **H2：`commit` 後立即斷言事件數量** | `direct-url-guard.ts:250-253` 在 `page.goto(..., { waitUntil: "commit" })` 之後立刻斷言 `navigationRequests`／`matchingResponses` 恰為 1。Playwright 的 `response` 事件與 `goto` 解析是不同的非同步通道。 | `expected one matching same-frame document response` 長度為 0；與機器負載有關 | 同 ②；另在 helper 內加入 `await expect.poll(() => matchingResponses.length).toBe(1)` 做 A/B，比較失敗率。 |
| **H3：非預期的 POST 請求** | `direct-url-guard.ts:306` 與 spec `:383` 都斷言期間沒有任何 POST。頁面載入期間若有 analytics beacon、RSC prefetch 或 session 刷新的 POST，會偶發出現。 | 失敗訊息列出 POST URL | 在 helper 失敗訊息已含 URL，但被 CI reporter 吃掉；本機重跑時查看。可在 reporter 白名單輸出 POST 的 `pathname`（不含 query）。 |
| **H4：session／資料庫快照被背景寫入改變** | spec `:386` `expect.poll(snapshot).toEqual(before)` 的快照包含 `userSession.updatedAt`、`vendor.updatedAt`、`user.lastLoginAt`。若 session 有以時間節流的刷新（例如超過一定秒數才更新 `updatedAt`），會跨過門檻才失敗，屬於時間相關的偶發。 | 失敗在最後一個 poll，diff 指向 `updatedAt` 類欄位 | 搜尋 session 刷新邏輯；在 `before`／`after` 之間 `sleep` 以重現；若成立，快照改為排除 `updatedAt`。 |

建議順序：先做 H1 的非瀏覽器統計（成本最低、一小時內可得結論），再做 `--repeat-each`。

### 4.2 數位交付（`commerce-orders.spec.ts:885`）

事實：測試已內建診斷（`:957-980`），失敗時會把 checkout 非 200 的分支編碼為 `G748:<status>:<A|P|I|S|U>:T..O..S..G..`，代表曾在 checkout 或 admission 看到非預期狀態碼，原因同樣未證實。

| 假說 | 理由 | 驗證方法 |
|---|---|---|
| **H5：共用的記憶體 rate limit** | e2e 固定 `RATE_LIMIT_PROVIDER=memory`（`playwright.config.ts`），計數在同一個 Next 程序內跨 spec 累積；`smoke.spec.ts:1186,1195` 等會刻意打滿 429。admission 失敗（`A`）正好對應這個。 | 在該 spec 之前插入大量 checkout，看是否出現 `admission` 429；或每個 spec 用唯一的 `x-forwarded-for`。 |
| **H6：Serializable 衝突在三次重試後仍失敗** | `inventory-reservations.ts:159-176` 最多 3 次、無退避，失敗回 502（對應診斷碼 `P`）。CI 上背景工作（`after()`、analytics 寫入）與測試程序的 `PrismaClient` 同時存取同一 DB。 | 在 CI 加 `DEBUG=prisma:error` 的受限輸出，只計 P2034 次數；本機以 `--cpus=1` 重現並統計 502。 |
| **H7：測試程序與伺服器共用小連線池** | `playwright.config.ts:87-88` 註解自承 DB 連線池很小；每個 spec 檔建立自己的 `PrismaClient`（預設池大小）。 | 觀察 `pg_stat_activity` 在失敗時的連線數。 |

### 4.3 reporter 讓診斷變難

`scripts/playwright-ci-reporter.ts` 不輸出測試標題。建議改成「白名單」：輸出測試檔名＋test 在檔內的序號、失敗 step 的 category、helper 檔案與行號、狀態碼／pathname 這類固定詞彙欄位，不輸出訊息、payload 或 secret。這樣歷史 flaky 才能回溯到具體測試。

---

## 5. 覆蓋率可信度

### 5.1 數字如何合成

1. `npm run test:coverage` → `scripts/run-combined-coverage.mjs`：自建 `postgres:16-alpine` 容器（tmpfs、僅綁 127.0.0.1、擁有者標記），跑 migration，再執行：
   - `vitest run --coverage`（環境 `COMBINED_COVERAGE_COLLECTION=true`；此時 `vitest.config.ts` 的 `thresholds` 被設為 `undefined`，所以 Vitest 本身不判斷門檻）。757 檔／6,357 tests，約 245 秒。
   - `NODE_V8_COVERAGE=... run-node-tap-contracts.ts`：所有 import `node:test` 的 `scripts/**/*.test.mjs`（1,225 tests）。
2. 讀 `coverage/coverage-final.json`，**移除 Vitest 對 `scripts/*.{mjs,ts}`（非測試）的零計數佔位**（`stripNodeTapOwnedVitestCoverage`），再把 Node TAP 的 V8 覆蓋經 `ast-v8-to-istanbul` 轉換後 merge。
3. 在合併後的 coverage map 上自行判斷兩組門檻：全域（statements 63／branches 57／functions 60／lines 65）與路徑含 `/src/lib/` 且副檔名 `.ts` 的檔案（86／80／88／88）。任何一項不足即 throw。
4. master 最近一次（run 39181999330）：Statements 65.52%、Branches 63.96%、Functions 68.64%、Lines 70.78%。`src/lib` 專屬值沒有輸出。

### 5.2 `vitest.synthetic-db-coverage.config.ts` 的 thresholds 是否被評估

**否。** `package.json:18` 的命令是 `vitest run --config vitest.synthetic-db-coverage.config.ts`，沒有 `--coverage`，設定檔也沒有 `coverage.enabled: true`；CI log 的 DB 併發步驟沒有 "Coverage enabled with v8" 字樣。該檔的 `coverage` 區塊是未啟用的重複常數（B08-06、B08-07）。

### 5.3 被排除與未納入的範圍

- `coverage.exclude` 只有 `**/*.test.{ts,tsx,mjs}` 與 `**/*.d.ts`，**沒有排除任何高風險目錄**。`src/lib/payment*`、`src/app/api/payments`、`src/app/api/webhooks`、`src/app/actions*`、`auth*` 都在分母內。
- `include` 只涵蓋 `src/**` 與 `scripts/**`。不在分母內：`prisma/`（migration 的 SQL trigger 與 CHECK 靠文字契約測試）、`public/portal/sw.js`（Service Worker，另有 `student-portal-service-worker.test.ts` 但不計入覆蓋）、根目錄 `next.config.ts`、`sentry.*.config.ts`、`tests/`。
- 分母含 423 個 `scripts/` 檔案，其中約 155 個是 WP／FIN 編號的一次性 runner。它們被 Node TAP 測試執行時會把全域數字拉高，與金流程式碼的覆蓋無關。
- 「觸及」不等於「覆蓋」：03-test-map 指出 `src/lib` 323 個檔案全部被測試 import，但 v8 行覆蓋率才是實際值；B08-01 的 4 個假測試正是 import 都沒有的例子。
- 三個 DB 測試（`interaction-card-timeline.db`、`live-chat.db`、`presenter-layout.db`）在本機未設 `RT01_D2_DISPOSABLE_DB` 時會被略過，所以本機覆蓋率數字會低於 CI。

### 5.4 建議

見 B08-06。另外建議把「`COMBINED_COVERAGE_COLLECTION` 改變 thresholds」這種隱含行為，改成 `vitest.config.ts` 完全不放 thresholds，註解指向合併腳本，避免有人誤以為單獨跑 `vitest --coverage` 就有同樣的保護。

---

## 6. CI 重複與耗時：具體合併方案

基準：master run 39181999330，job 32.6 分鐘（49 個 step）。下表的節省是由該次 log 的步驟秒數推估，**未實測**。

| # | 變更 | 位置 | 預估節省 | 風險與前提 |
|---|---|---|---|---|
| 1 | 把 `push` 限縮到 `master`（`on.push.branches: [master]`），其餘靠 `pull_request`；加 `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` 與 job `timeout-minutes: 45` | `ci.yml:3-6,9` | runner 時間每次 PR 更新少約 32 分鐘（牆鐘不變）；卡住的 job 從 360 分降到 45 分上限 | 需確認 branch protection 要求的 check 名稱是 PR 觸發的那一個 |
| 2 | 縮小 `test:db:concurrency`：`wp18-main` 只跑 `actions.payout-db.test.ts`＋需獨立 schema 的 `*.db.test.ts`，保留 `wp17-db`；其餘已在 `test:coverage` 內跑過 | `vitest.synthetic-db-coverage.config.ts:87-123`、`ci.yml:168-188` | 約 3.0–3.5 分鐘（217s → 約 30–40s，含建兩個 schema 與 migrate） | 先列出「只在此設定下才通過」的檔案：以 `--project wp18-main --reporter=json` 比對與 `test:coverage` 的差集（現知只差 `actions.payout-db`） |
| 3 | 移除單獨的 `test:contracts` step（Node TAP 在 `test:coverage` 內已跑一次），或讓覆蓋流程改為輸出 TAP 摘要供 step 檢查 | `ci.yml:165-166` | 約 0.4 分鐘 | 需確認合併腳本在 TAP 失敗時會 fail（目前 `run()` 失敗即 throw） |
| 4 | 4 個 `--webpack` 的瀏覽器 gate（根 e2e、tracking、referral sharing、subscription recovery）共用一個預先 build 好的 mirror，runner 以 `E2E_REUSE_BUILD=1` 之類旗標跳過 build | `scripts/*-disposable-qa.mjs`、`playwright.config.ts` webServer | 約 3–5 分鐘（每次 build 60–100 秒的推估） | 需要 runner 支援「已有 `.next`」；各 runner 的 `NEXT_PUBLIC_*` 不同可能需要分開 build，需逐個確認 |
| 5 | 把單一 job 拆成平行 job：`static`（secret scan、lint、typecheck、strict-index，約 2.5 分）、`unit`（coverage＋TAP＋LINE，約 5.5 分）、`db`（縮小後約 1 分）、`gates`（6 個 disposable gate，約 8 分）、`e2e`（約 9.5 分＋build）、`build`（約 3 分）。每個 job 自帶 PostgreSQL service 與 `npm ci`（約 1 分額外開銷）。 | `ci.yml` 整體 | 牆鐘由約 32.6 分降到約 12–14 分（關鍵路徑為 e2e 或 gates 加上 setup）；runner 總分鐘數約持平或略增 5 分 | `quality` 這個 required check 名稱要保留：新增一個 `quality` job `needs:` 其他全部並只做彙整，避免動 branch protection |
| 6 | `typecheck` 與 `typecheck:strict-index` 合併為 `tsc -b` 或共用 `incremental` 快取 | `package.json:10-11` | 約 0.3 分鐘 | 低；非必要 |

合計：牆鐘約 −19 至 −20 分鐘（#2、#3、#4、#5 疊加），PR 更新的 runner 總時間約 −35 分鐘（#1）。

---

## 7. 測試結構建議

### 7.1 設定檔合併（以現況計數：vitest 21、playwright 16、prisma 6）

**Vitest：改成單一 `vitest.config.ts` 加 `test.projects`**

- `unit`（預設）：現有根設定。
- `db-<name>`：把 20 個 `vitest.*-db.config.ts` 各自變成一個 project，使用共用工廠 `createDisposableProject({ name, include, markerEnv, schemaPattern })`，守衛邏輯只寫一份。
- Runner 由 `--config vitest.X.config.ts` 改為 `--project X`。
- **關鍵限制**：現在這些設定在載入時就 throw（缺少 disposable 標記就拒絕載入）。合併後所有 project 會在同一次載入中被評估，所以守衛必須改到各 project 的 `globalSetup`（只在被選中的 project 啟動時才檢查）。
- 先移除 4 個孤兒（`g7-analytics-authenticity`、`g7-form-verification`、`g7-stream`、`g7-stream-reconciliation`）與 4 個 `prisma.g7-*-disposable.config.mjs`；`payment-webhooks.test.ts` 同時出現在 4 個設定（#7、#14、#17、#19）可靠 project 的 `include` 共用。
- 覆蓋率門檻與合併腳本共用同一份 `scripts/coverage-thresholds.json`（B08-06）。

**Playwright：一個工廠函式＋保留少數獨立設定**

- 抽 `tests/playwright/create-mirror-config.ts`：吃 `{ testMatch, reporter, mirrorEnv, webServer }`，15 個衍生設定中約 10 個（affiliate-portal、affiliate-remuneration、course-community、course-community-guard、course-learning、funnel-workspace、merchant-affiliate-policy、portal-localization、post-purchase-commerce、team-video）只剩 5–10 行。
- 保留獨立：`funnel-elements`（`next dev`、不需 DB）、`g7-commerce`（不繼承 base）、`subscription-recovery`、`tracking`、`live-private-commerce`（各有特殊 webServer／timeout）。
- Playwright 的 `projects` 不能為不同 project 配置不同的 `webServer`，所以不建議把全部塞進單一 `projects` 陣列；工廠函式比較實際。
- `portal-localization` 與 `course-community`、`course-learning` 重疊兩支 spec；`course-community-guard` 與 `live-private-commerce` 都跑 `wp88-direct-url-guard-matrix`：合併 gate 時去重。

**Prisma：** `prisma.playwright.config.ts` 與 runner 臨時產生的 `prisma.config.mjs` 收斂成由環境變數驅動的一份。

估工：vitest 1.5–2 天、playwright 2 天、孤兒清理 0.5 天。順序：先清孤兒（零風險），再做 vitest projects（有 CI 步驟直接依賴），最後 playwright 工廠。

### 7.2 封測前最值得補的 10 個測試

排序依「錢或個資出錯時的後果」。「紅」表示先寫成會失敗的測試（記錄現況缺陷），修好後轉綠。

| # | 測試 | 對應 | 層級／位置 | 要斷言什麼 |
|---|---|---|---|---|
| 1 | PayUni 真實格式 Notify：`Status=SUCCESS` 搭配 `TradeStatus` 0／2／3／4／9 不得入帳；缺 `NetAmount`／`EventId` 的處理 | B03-01、B03-04、B03-12、B03-13、B04-13、B08-02 | 單元（`payuni.test.ts`）＋DB（`payment-webhooks`） | 無 paid 的 `PaymentTransaction`、無佣金、`WebhookEvent` 的 eventId 與 `netAmountCents` 符合預期；紅 |
| 2 | 月結排除平台自收款：`billingPurpose` 為 `platform_subscription_checkout`／`invoice_payment` 的交易不計入商家營收 | B03-02、B08-04 | `billing.test.ts`＋DB 對帳 | `settlement.grossCents`、`payableCents` 的精確值；紅 |
| 3 | 鎖月後的退款：歸入下一個可用月份或以 adjustment 追加，不被 `Math.max(0, ...)` 吃掉 | B03-03 | `billing-cycle.test.ts`＋DB | 兩個月份的 settlement 金額與 adjustment 記錄；紅 |
| 4 | 沒有 MFA factor 的平台 admin 被拒，涵蓋 `/admin/**`、payout CSV、退款、月結鎖定、webhook 重送 | B02-01、B03-09、B08-03 | 單元（表驅動）＋e2e 一支 | 導向 `/mfa/setup`、不呼叫 PayUni、不解密銀行帳號；反轉 `auth.test.ts:224` |
| 5 | 夥伴（portal-only）身分不得進後台、客服、佣金頁，accountant 不可標記他人出款 | B02-02、第二租戶缺口 #4、#10 | e2e＋action 單元 | 403／導向、未寫入 `AffiliatePayout` |
| 6 | 兩租戶 server action 矩陣：`vendor-member-actions`、`team-membership-actions`、`merchant-affiliate-payout-policy-actions`、`course-curriculum-actions`、`affiliate-portal-actions`、`form-submission-search-actions` | B08-05、第二租戶缺口 #1–#9 | 共用夾具的表驅動單元測試 | 外租戶 ID 無任何寫入、回應不洩漏存在性 |
| 7 | 資料庫 catalog：每張 public 表 `relrowsecurity=true` 且 `anon`／`authenticated` 無權限；`prisma migrate diff --exit-code` 無漂移；migration 時序單調 | B02-03、B04-04、B04-08、B04-09 | CI DB 測試（`tenant-ledger-invariants` 風格） | 清單為空；紅（目前 77 張表未開 RLS） |
| 8 | DB 不變式：`(providerName, orderNumber)` 唯一、`refundedAmountCents <= grossAmountCents`、`grossAmountCents > 0`、`PayoutItem(vendorId, settlementId)` 唯一、金額欄位超過 int4 的行為 | B03-16、B04-06、B04-07、B04-12、B04-15 | `.db.test.ts` | 重複寫入被資料庫拒絕；紅 |
| 9 | 排程與庫存釋放：`vercel.json`／`vercel.staging.json` 必須宣告 `/api/jobs/webhook-retry`；保留過期後才收到 paid 且已售完時，結果必須是可處理狀態而非靜默 exhausted | B03-06、B03-07 | 契約測試（仿 `scheduler-config.test.ts`）＋DB | cron 存在；事件進入 `needs_manual_review` 之類的明確狀態並有 audit |
| 10 | 取代 B08-01 的 4 個假測試，加上外租戶 PII 否定案例 | B08-01 | action／頁面單元 | `where` 帶 `vendorId`、外租戶被拒、PII 解開前先授權 |

備選（封測後第一批）：`platform-plan-checkout.ts` 直接測試（566 行，僅間接觸及）、`cloudflare-webhook-signature.ts`（0 個直接 import）、金額與幣別（B03-05 只允許 TWD、B03-15 嚴格解析、B03-23 checkout 金額等於伺服器報價）、以 mock provider 驅動的 PayUni 付款回呼 E2E（目前 e2e 全為 `demo`）。

---

## 8. 無法驗證與限制

- 沒有執行 e2e、完整 Vitest、覆蓋率或任何 DB 測試；§4 的 flaky 根因全是假說，需依驗證方法實測。
- §6 的節省分鐘數由 master run 39181999330 的步驟秒數推估；`next build` 單次耗時（60–100 秒）是由含 build 的 gate 總秒數推算，未單獨量測。
- 「靜態 case 數」不展開 `.each`；`vi.mock` 自我 mock 的偵測以檔名比對，會漏掉別名匯入的情況（已抽查，無發現）。
- 假測試的判定看 assertion 的對象是否為讀入的原始碼字串；若有人把原始碼字串先經過函式處理再斷言，機器分類會漏掉，抽查範圍內沒有發現。
- 分類時 workflow YAML、SQL、runner 原始碼的邊界以讀檔路徑副檔名判斷，個別檔案可能跨類。
