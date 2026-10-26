# A-03 測試地圖（2026Q4 審查）

- 盤點日期：2026-10-19（唯讀，未執行任何測試套件、未讀取 `.env*`、未改既有檔案）
- 盤點對象：工作目錄 `codex/claude-handoff-20261017`，HEAD `a0c7ffdc`
- **版本落差（重要）**：本分支落後 `origin/master`（`78621ca3`）約 15 個 PR（#434–#444）。master 比 HEAD 多：`playwright.learner-notifications.config.ts`、CI 一個步驟（Learner notification database boundaries）、`test:unit`／`test:db`／`db:check` 三個 npm script、`staging-migrate.yml`、約 39 個 `src` 測試檔。本文「設定檔」「測試檔數」以 HEAD 的實際檔案為準；「CI 實際耗時、Vitest 檔數／case 數、覆蓋率實測值」來自 master 最近一次 CI（run 39181999330），兩者差異都會註明。
- 數字來源：`find`／`grep`／`node` 靜態統計、`git ls-tree`、`gh run list`／`gh run view`。「靜態 case 數」是以正規表示式數 `it(`／`test(`，不含迴圈或 `.each` 展開，只能當相對大小。

---

## 1. 設定檔總表

共 40 個根目錄設定檔（20 vitest、15 playwright、4 prisma disposable、1 prisma playwright），另有基礎設定 `vitest.config.ts`、`playwright.config.ts`（被多數設定檔繼承，列於 1.0）。

### 1.0 基礎設定與 npm script

| 設定檔 | 範圍 | 環境 | 入口 |
|---|---|---|---|
| `vitest.config.ts` | 預設 include（`**/*.{test,spec}.*`），排除 `tests/e2e`、`tests/browser-dev`、`.ai-team/tmp`、`tmp`、Node TAP 合約測試（掃描 `scripts/**/*.test.mjs` 是否 import `node:test`）、`actions.mfa-db.test.ts`、`actions.payout-db.test.ts`。`fileParallelism:false`。HEAD 預估 717 檔（660 src + 55 scripts + `next.config.test.ts` + `tests/unit` 1），master CI 實測 757 檔／6357 tests | 預設 `localhost:54329/celebratedeal_test`，須為 loopback 拋棄式 PostgreSQL；42 個 `*.db.test.ts` 在此一併執行 | `npm test`、`npm run test:coverage`（經 `scripts/run-combined-coverage.mjs` 自建 docker PostgreSQL） |
| `playwright.config.ts` | `testDir ./tests/e2e`，無 testMatch，90 個 `*.spec.ts`（靜態 `test(` 157 個，含迴圈展開的 direct-url guard 矩陣），單 worker，`retries: CI?1:0`，webServer 先 `prisma migrate deploy` + `next build --webpack` + `next start`（timeout 600s） | loopback PostgreSQL + 本機 production build；`PAYMENT_PROVIDER=demo`、記憶體 rate limit，Resend／Sentry／R2 全部清空 | `npm run e2e`、`e2e:smoke`、`e2e:a11y`、`e2e:performance`；CI「Release browser gates」 |

### 1.1 Vitest（20 個）

共通：全部 `fileParallelism:false`、多數 `envDir:false`（不載入 dotenv）、用 `scripts/local-database-safety.ts` 的 `assertLocalTestDatabase` 拒絕非 loopback 資料庫。「檔／case」為 include 列出的檔案數／靜態 case 數。

| # | 設定檔 | include | 檔／case | 環境與保護標記 | 呼叫端（script／CI） |
|---|---|---|---|---|---|
| 1 | `vitest.affiliate-portal-db.config.ts` | `affiliate-portal.db.test.ts` | 1／7 | disposable PG，`COURSE_LEARNING_DISPOSABLE=verified-loopback`，URL 相同且 `schema=public` | **CI 直接步驟**；`affiliate-portal-disposable-qa.mjs`、`affiliate-portal-browser-qa.mjs` |
| 2 | `vitest.affiliate-remuneration-db.config.ts` | `affiliate-remuneration.db.test.ts` | 1／29 | 同 #1 | `affiliate-remuneration-disposable-qa.mjs`（CI 未執行） |
| 3 | `vitest.course-community-db.config.ts` | `course-community.db.test.ts` | 1／9 | 同 #1 | **CI 直接步驟**；`course-community-disposable-qa.mjs`、`course-community-browser-qa.mjs`、`portal-localization-browser-qa.mjs` |
| 4 | `vitest.course-learning-db.config.ts` | `student-course-learning.db.test.ts` | 1／7 | 同 #1 | **CI 直接步驟**；`course-learning-disposable-qa.mjs` |
| 5 | `vitest.g7-analytics-authenticity-db.config.ts` | `analytics-authenticity.db.test.ts` | 1／3 | disposable schema `g7_13_<16hex>` | **無任何 runner／CI 參照（孤兒）**，僅 2026-08-09 證據清單提及 |
| 6 | `vitest.g7-checkout-admission-db.config.ts` | `checkout-admission.db.test.ts`、`inventory-reservations.test.ts` | 2／15 | schema `g7_14_<hex>`，固定合成 CSRF | `g7-checkout-admission-disposable-qa.mjs` |
| 7 | `vitest.g7-commerce-db.config.ts` | `commerce-orders.db.test.ts`、`inventory-reservations.test.ts`、`payment-webhooks.test.ts`、`payuni-refund-reconciliation.test.ts` | 4／81 | schema `g7_04_<hex>` | `g7-commerce-disposable-qa.mjs` |
| 8 | `vitest.g7-email-db.config.ts` | 依 `G7_EMAIL_DISPOSABLE_SUITE` 三選一：`email-delivery.db`／`live-reminder-reconciliation.db`／`payuni-refund-ambiguous.db` | 執行時 1 檔（三檔各 5–9 case） | schema `g7_email_<hex>` + suite 標記 | `g7-email-disposable-qa.mjs` |
| 9 | `vitest.g7-finance-db.config.ts` | `src/app/actions.payout-db.test.ts` | 1／5 | schema `wp18_g7_<hex>`，合成銀行 keyring | `g7-finance-disposable-qa.mjs` |
| 10 | `vitest.g7-form-verification-db.config.ts` | `form-submission-verification.db.test.ts`、`api/form-submissions/route.db.test.ts` | 2／8 | schema `g7_13b_<hex>` | **孤兒（同 #5）** |
| 11 | `vitest.g7-stream-db.config.ts` | `live-studio-draft.db.test.ts` | 1／3 | schema `g7_11_<hex>` | **孤兒**（同一測試改由 `g7-live-draft-disposable-qa.mjs` 用預設設定跑） |
| 12 | `vitest.g7-stream-reconciliation-db.config.ts` | `stream-usage-reconciliation.db.test.ts` | 1／2 | schema `g7_12_<hex>` | **孤兒** |
| 13 | `vitest.live-private-commerce-db.config.ts` | `live-purchase-broadcasts.db.test.ts`、`live-private-chat-storage.db.test.ts` | 2／25 | 由 runner 注入 loopback URL（設定檔本身無 assert） | `live-private-commerce-disposable-qa.mjs` |
| 14 | `vitest.merchant-affiliate-policy-db.config.ts` | `merchant-affiliate-policy.db.test.ts`、`payment-webhooks.test.ts` | 2／53 | 同 #1 | `merchant-affiliate-policy-disposable-qa.mjs`、`-browser-qa.mjs` |
| 15 | `vitest.pending-refund-db.config.ts` | `payuni-pending-refund-proof.db`、`payuni-refund-execution-full.db`、`payuni-refund-execution.db`、`payuni-refund-ambiguous.db` | 4／10 | `PENDING_REFUND_DISPOSABLE=verified-loopback`，`schema=public` | `pending-refund-disposable-qa.mjs` |
| 16 | `vitest.post-purchase-db.config.ts` | `post-purchase-upsell-access.test.ts`、`post-purchase-upsell.test.ts`、`post-purchase-credit.db.test.ts` | 3／69 | 資料庫名必須是 `/celebratedeal_test` | `post-purchase-commerce-disposable-qa.mjs` |
| 17 | `vitest.subscription-recovery-db.config.ts` | `platform-subscription-refund.db`、`wp4-buyer-ops.db`、`wp4-subscription-ops.db`、`payment-webhooks.test.ts` | 4／64 | `WP4_DISPOSABLE_RUNNER_MARKER=verified-loopback`，`testTimeout 20s` | `subscription-recovery-disposable-qa.mjs`（**CI 以 `--browser` 執行**） |
| 18 | `vitest.synthetic-db-coverage.config.ts` | 預設 include 全部（兩個 project：`wp18-main` 排除 mfa-db；`wp17-db` 只跑 `actions.mfa-db.test.ts`） | CI 實測 759 檔／6363 tests | 需 `WP17_COVERAGE_*`、`WP18_COVERAGE_*` 兩組資料庫 URL + schema（`wp17_*`、`wp18_*`） | `npm run test:db:concurrency`；**CI「PostgreSQL concurrency tests」**（外包 `timeout 10m`） |
| 19 | `vitest.tracking-payment-boundaries-db.config.ts` | `payment-webhooks.test.ts`、`commerce-orders.db.test.ts`（繼承 #20） | 2／51 | `TRACKING_DISPOSABLE=verified-loopback`，`testTimeout 30s` | `tracking-settings-disposable-qa.mjs`（**CI**） |
| 20 | `vitest.tracking-settings-db.config.ts` | `tracking-settings.db`、`tracking-purchase-outbox.db`、`tracking-event-sources.db` | 3／40 | 同 #19 | `tracking-settings-disposable-qa.mjs`（**CI**，runner 回報 45 tests） |

重複觀察：`payment-webhooks.test.ts` 出現在 #7、#14、#17、#19（4 個設定檔）；`inventory-reservations.test.ts` 出現在 #6、#7；`commerce-orders.db.test.ts` 在 #7、#19；`payuni-refund-ambiguous.db.test.ts` 在 #8、#15。而所有 `*.db.test.ts` 同時被預設 `vitest.config.ts` 掃到。

### 1.2 Playwright（15 個）

共通：繼承 `playwright.config.ts`（單 worker、`retries: CI?1:0`、webServer 在 mirror 目錄做 `next build --webpack` + `next start`），多數 reporter 為 `scripts/playwright-ci-reporter.ts` + JSON 報告；全部需要 runner 預先建立 source mirror 與拋棄式 PostgreSQL（`COURSE_BROWSER_MIRROR`／`*_REPORT` 等環境變數，缺少即 throw）。瀏覽器只有 chromium。

| # | 設定檔 | testMatch | 靜態 test 數 | 特有環境 | 呼叫端 |
|---|---|---|---|---|---|
| 1 | `playwright.affiliate-portal.config.ts` | `affiliate-portal.spec.ts`、`verified-registration-share.spec.ts` | 2 | mirror + DB | `affiliate-portal-browser-qa.mjs`（**CI `--browser`**，斷言 expected===2） |
| 2 | `playwright.affiliate-remuneration.config.ts` | `affiliate-remuneration.spec.ts` | 1 | mirror + DB | `affiliate-remuneration-disposable-qa.mjs` |
| 3 | `playwright.course-community-guard.config.ts` | `wp88-direct-url-guard-matrix.spec.ts`（迴圈矩陣） | 1（展開後更多） | 沿用 #4 的 mirror | `course-community-browser-qa.mjs` |
| 4 | `playwright.course-community.config.ts` | `course-community.spec.ts` | 1 | mirror + DB | `course-community-browser-qa.mjs` |
| 5 | `playwright.course-learning.config.ts` | `native-course-learning.spec.ts` | 1 | mirror + DB | `course-learning-disposable-qa.mjs` |
| 6 | `playwright.funnel-elements.config.ts` | `tests/browser-dev/` 兩支 spec | 16（4+12，CI log 實測 16 passed） | **不需資料庫**、`next dev` port 31025、`page.setContent`；retries 預設 0 | `funnel-elements-browser-qa.mjs`（**CI**、`npm run e2e:funnel-elements`） |
| 7 | `playwright.funnel-workspace.config.ts` | `funnel-workspace-persistence.spec.ts` | 1 | mirror + DB | `funnel-workspace-disposable-qa.mjs` |
| 8 | `playwright.g7-commerce.config.ts` | `commerce-orders.spec.ts`（17）或 `wp7-one-stop-webinar-flow.spec.ts`（2），依 `G7_COMMERCE_BROWSER_E2E_TARGET` | 17／2 | 獨立（不繼承 base）：`E2E_BASE_URL` 必須 `http://127.0.0.1:<port>`、schema `g7_04_browser_<hex>`；`retries:0` | `g7-commerce-browser-qa.mjs` |
| 9 | `playwright.live-private-commerce.config.ts` | `wp88-direct-url-guard-matrix`、`live-private-commerce-journey`、`live-purchase-broadcast-journey` | 3 spec（含矩陣） | port 31045 + 本機信任 ingress | `live-private-commerce-disposable-qa.mjs` |
| 10 | `playwright.merchant-affiliate-policy.config.ts` | `merchant-affiliate-policy.spec.ts` | 1 | mirror + DB | `merchant-affiliate-policy-browser-qa.mjs` |
| 11 | `playwright.portal-localization.config.ts` | `student-portal-localization-pwa`、`course-community`、`native-course-learning` | 3 | mirror + DB（與 #4、#5 重疊兩支 spec） | `portal-localization-browser-qa.mjs` |
| 12 | `playwright.post-purchase-commerce.config.ts` | `post-purchase-commerce.spec.ts` | 1 | `POST_PURCHASE_BROWSER_*` | `post-purchase-commerce-disposable-qa.mjs` |
| 13 | `playwright.subscription-recovery.config.ts` | `tests/subscription-recovery/*.browser.ts`（2 支） | 2 | `Q2_BROWSER_*`、`Q2_BROWSER_SOURCE_SHA`（40 hex）、合成 PayUni Sandbox 金鑰（瀏覽器阻擋對外請求）；timeout 120s | `subscription-recovery-disposable-qa.mjs`（**CI `--browser`**） |
| 14 | `playwright.team-video.config.ts` | `team-video-persistence-isolation`、`wp86-team-template-direct-url-owner-boundary` | 2 | `TEAM_VIDEO_*` | `team-video-disposable-qa.mjs`、`team-video-source-snapshot.mjs` |
| 15 | `playwright.tracking.config.ts` | `tests/tracking/native-tracking-settings.browser.ts` | 5 | `TRACKING_BROWSER_*`、`META_TRACKING_TEST_DELIVERY_ENABLED=true`；timeout 120s | `tracking-settings-disposable-qa.mjs`（**CI `--browser`**） |

### 1.3 Prisma（5 個）

| 設定檔 | 範圍 | 保護 | 呼叫端 |
|---|---|---|---|
| `prisma.playwright.config.ts` | `migrate deploy`／`generate` 用 | DATABASE_URL／DIRECT_URL 須 loopback 且資料庫名符合 `celebratedeal_(test\|e2e\|ci)` | `playwright.config.ts` webServer 命令；13 個 browser／disposable runner 的 mirror 複製清單 |
| `prisma.g7-stream-disposable.config.mjs` | schema `g7_11_<hex>` | 僅 `127.0.0.1`、schema 標記 | **無 runner（孤兒）** |
| `prisma.g7-stream-reconciliation-disposable.config.mjs` | `g7_12_<hex>` | 同上 | **孤兒** |
| `prisma.g7-analytics-authenticity-disposable.config.mjs` | `g7_13_<hex>` | 同上 | **孤兒** |
| `prisma.g7-form-verification-disposable.config.mjs` | `g7_13b_<hex>` | 同上 | **孤兒** |

另：多數 disposable runner 其實是在 mirror 內即時產生 `prisma.config.mjs`（`scripts/prisma-loopback-disposable-migration-runner.mjs`），不使用上面這四個根目錄 prisma 設定。

### 1.4 「最近一次通過紀錄」位置

- 在 CI 內的設定檔（#1、#3、#4、#17–#20、playwright #1、#6、#13、#15、root vitest、root playwright）：master 最近一次綠燈為 CI run **39181999330**（2026-10-19，job 32.6 分鐘）。
- 不在 CI 的設定檔：只有 `docs/remaining-capabilities-*.json`、`docs/ai-team/evidence/g7-*` 內的本機收據（2026-10-07 至 10-08），皆是階段性本機驗證，不是對目前 master 的重跑。g7-* 對應 `remaining-capabilities-f3-mainline-validation-20261007.json`；pending-refund → `…q1-main-integrated-validation-20261007.json`；post-purchase → `…f2-post-purchase-source-credit-20261007.json`；live-private-commerce 最新相關檔 `…private-memory-inbox-prior-failure-20261007.json` 是**失敗**紀錄（較早的 `…private-canonical-acceptance-20261007.json` 為通過）。**這些收據未對 HEAD／master 重驗，不能視為目前通過**。

---

## 2. 測試檔分布

### 2.1 總量（HEAD `a0c7ffdc`）

| 區域 | 檔數 | 備註 |
|---|---|---|
| `src/**/*.test.ts(x)` | **662**（lib 318、app 280、components 63、`src/proxy.test.ts` 1） | 其中 `*.db.test.ts` 42 |
| `scripts/**/*.test.{ts,mjs}` | 190（`.mjs` 148 + `.ts` 42） | **135 個 `.mjs` 用 `node:test`（Node TAP）**；其餘 55 個由 Vitest 執行 |
| 其他單元 | 2（`next.config.test.ts`、`tests/unit/wp130-…test.ts`） | |
| `tests/e2e/*.spec.ts` | 90 | + `tests/e2e/helpers`／`tests/fixtures` 輔助 |
| `tests/browser-dev` | 2 spec（16 case） | funnel-elements |
| `tests/tracking`、`tests/subscription-recovery` | 1 + 2（`.browser.ts`） | |
| `tests/recovery/*.ts` | 3 | 非 spec，由 migration 復原腳本使用 |

master 對照（`git ls-tree`）：src 測試 701（`.db.test` 45）、scripts `.mjs` 149（TAP 136）、scripts `.ts` 43、e2e spec 93。master 預設 Vitest = 701−2+(149−136)+43+2 = **757**，與 CI 實測 757 檔吻合，用來交叉驗證計算方式。

來源檔：`src` 非測試 `.ts/.tsx` 815 個（lib 323、app 354、components 135、其他 3）。

### 2.2 依主題分群（以路徑／檔名關鍵字分群，屬啟發式，僅供相對比較）

「無同名測試」指沒有 `<name>.test.ts(x)` 或 `<name>.db.test.ts` 與之並列。

| 主題 | 來源檔 | 測試檔 | `.db` 測試 | 無同名測試 % |
|---|---|---|---|---|
| ui 元件（其他，`src/components` 通用） | 21 | 6 | 0 | **71%** |
| funnel／landing | 81 | 49 | 0 | **41%** |
| course／student | 25 | 19 | 3 | **40%** |
| app（其他） | 78 | 50 | 1 | 37% |
| affiliate | 56 | 43 | 3 | 32% |
| auth／mfa／session／csrf／rate-limit | 28 | 21 | 0 | 32% |
| commerce／checkout | 99 | 75 | 4 | 31% |
| billing／subscription | 27 | 22 | 1 | 30% |
| form | 38 | 32 | 3 | 24% |
| live／stream | 134 | 125 | 13 | 21% |
| lib（其他） | 64 | 59 | 2 | 20% |
| tenant／team／admin | 34 | 29 | 0 | 18% |
| tracking | 23 | 21 | 4 | 17% |
| refund／payout／settlement | 32 | 34 | 2 | 16% |
| payuni | 43 | 44 | 4 | 12% |
| line | 19 | 19 | 1 | 11% |
| email／notification | 13 | 14 | 1 | 8% |

依區域：lib 323 個來源有 264 個有同名測試；app 354 有 264；**components 135 只有 60**。

### 2.3 以「是否被任何測試 import」交叉驗證（直接＋遞移）

同名測試法會高估缺口（例如 `platform-plan-checkout.ts` 沒有同名測試，但被 route 測試與 `payment-webhooks.test.ts` import）。另以 import 圖（`@/`、相對路徑；含 `vi.mock`、動態 import）計算：

| 區域 | 來源檔 | 被測試直接 import | 被測試遞移觸及 |
|---|---|---|---|
| lib | 323 | 308 | 323 |
| app | 354 | 267 | 273 |
| components | 135 | 71 | 110 |

沒有任何測試觸及的 108 個來源檔中，Next.js 特殊檔（page 48、route 10、loading 8、error 3、layout 2、not-found 2、default 1、global-error 1，共 75）屬 E2E 範疇，其餘 33 個為真缺口，**集中在 components 與少數 server action**：

- components：`landing-page-workspace.tsx`（256 行）、`course-community.tsx`（175）、`presenter-studio.tsx`（136）、`personalized-onboarding-questionnaire.tsx`（131）、`landing-pages/funnel-step-pages-editor.tsx`（127）、`landing-pages/landing-page-puck-config.tsx`（103）、`support-refund-selection.tsx`（76）、`funnel-blocks/*`（6 個來源檔、0 測試檔）等。
- server actions：`customer-crm-actions.ts`（137）、`mobile-consultation-actions.ts`（76）、`course-curriculum-actions.ts`、`course-community-actions.ts`、`affiliate-portal-actions.ts` 沒有被任何測試以 import 觸及；其中 customer-crm 與 mobile-consultation 有同名測試，但那些測試是 `readFile` 讀原始碼後 `toContain`（原始碼字串合約），**不會執行程式、也不產生 v8 覆蓋**。

附註：lib 層 323/323 被觸及不等於被覆蓋（觸及僅表示會被載入）。`src` 測試中以 `readFile` 讀檔的約 16 檔，其中 6 檔讀取相鄰 `.ts/.tsx` 原始碼做字串斷言。

### 2.4 測試檔為 0 或極少的重要模組（證據導向）

| 模組 | 證據 |
|---|---|
| `src/components/funnel-blocks/`（Funnel 區塊） | 6 來源檔／0 測試檔；E2E 僅整頁層級 |
| `src/components/landing-pages/`（Landing／Funnel 編輯器） | 25 來源檔／7 測試檔；編輯器核心 `funnel-step-pages-editor`、`landing-page-puck-config`、`landing-page-workspace` 無測試（`playwright.funnel-*` 與 browser-dev 部分補強） |
| 課程與推廣入口的 server actions | `course-community-actions.ts`、`course-curriculum-actions.ts`、`affiliate-portal-actions.ts` 無測試觸及；`src/app/affiliate-portal` 3 來源檔／0 測試檔 |
| 平台方案結帳 `src/lib/platform-plan-checkout.ts`（566 行，最大的無同名測試 lib 檔） | 僅 2 個測試檔 import（`api/billing/plans/select/route.test.ts`、`payment-webhooks.test.ts`） |
| auth：`src/app/actions/auth-security-actions.ts` 無同名測試；`src/lib/mfa-recovery-regeneration.ts`（110 行）僅 1 個測試檔 import | auth 主題 21 測試／28 來源 |
| `src/lib/cloudflare-webhook-signature.ts`（131 行，webhook 簽章驗證） | **0 個測試直接 import**（僅遞移觸及，無獨立斷言） |
| 租戶邊界 | lib 側只有 `tenant-ledger-invariants.test.ts` 等少數；主要靠 55 個 E2E direct-url／cross-tenant spec 與 `scripts/*tenant-contract.test.ts` |
| PayUni、LINE、tracking、refund | 測試／來源比例最健全（約 1.0）；但 PayUni 無專屬 E2E（E2E 全用 `demo` provider），LINE 無 E2E |

API 路由：`src/app/api` 102 個 `route.ts` 全部都有同目錄 `route*.test.ts`（104 個測試檔）。

E2E 主題分布（90 個 spec，依檔名）：租戶／權限邊界類（direct-url、cross-tenant、owner-boundary、guard-matrix）55；funnel／webinar 9；live 7；course／portal 4；affiliate 3；commerce 2；其餘 10（smoke、a11y、performance…）。**沒有 PayUni、LINE、MFA 登入專屬的 E2E spec**（`smoke.spec.ts` 為通用）。

---

## 3. CI 實際跑什麼

### 3.1 workflow 一覽

`.github/workflows/` 共 24 個 yml（HEAD；master 多 `staging-migrate.yml`）：

- **`ci.yml`**：唯一的自動 workflow，觸發 `push`（所有分支）＋`pull_request`，一個 job `quality`（`ubuntu-latest`）。
- 其餘 23 個（`staging-*`、`q1-*`、`f2-issued-pending-state`、`secure-staging-validation`、`payuni-live-probe`…）**全是 `workflow_dispatch` 手動觸發**，使用 environment `Preview – celebrate-deal-staging`，依賴 staging 密鑰／PayUni Sandbox／Cloudflare／R2 等外部服務；各自有 `timeout-minutes`（3–30 分）。`secure-staging-validation.yml` 另有 4 個步驟設 `continue-on-error: true`。

### 3.2 `quality` job 命令順序（HEAD 的 `ci.yml`；耗時取自 master run 39181999330，共 49 個 step）

| 序 | 步驟 | 命令 | 耗時 |
|---|---|---|---|
| 1 | 啟動拋棄式 PostgreSQL | docker pull（ECR→Docker Hub，pin digest，最多 3 輪重試）+ `docker run` + `pg_isready` 迴圈 | 7s |
| 2 | checkout（fetch-depth 0）＋匯入固定 Preview 來源 | `git fetch origin refs/pull/277/head` 並比對 SHA | 5s |
| 3 | Node 22 + `npm ci` | | 26s |
| 4 | 依賴稽核／密鑰掃描 | `npm audit --omit=dev --audit-level=high`、`npm run secret:scan` | 2s |
| 5 | Prisma | `db:generate`、`db:migrate:deploy` | 5s |
| 6 | 靜態檢查 | `npm run lint`（39s）、`npm run typecheck`（46s）、`typecheck:strict-index`（22s） | 107s |
| 7 | 3 個 DB 邊界 | `npx vitest run --config vitest.affiliate-portal-db／course-learning-db／course-community-db.config.ts` | 5s |
| 8 | 契約測試（約 14 步） | `src/lib/env.test.ts`、`test:release-readiness`、readiness-truth、staging evidence 系列（`node --test`）、外部 smoke 安全、Stream resource、`pwsh Test-BackupTooling.ps1` | 約 10s |
| 9 | **單元測試＋覆蓋率** | `npm run test:coverage`（→ `run-combined-coverage.mjs`） | **295s** |
| 10 | LINE 合約 | `npm run test:line`（16 檔子集） | 3s |
| 11 | Node TAP | `npm run test:contracts`（1225 tests） | 25s |
| 12 | **PostgreSQL 併發** | 建 2 個資料庫＋schema＋pg_trgm＋兩次 migrate deploy，再 `timeout --preserve-status 10m npm run test:db:concurrency` | **217s** |
| 13 | （僅 master）Learner notification DB | `node --import tsx scripts/learner-notification-disposable-qa.mjs` | 13s |
| 14 | Playwright 安裝 | `npx playwright install --with-deps chromium` | 23s |
| 15 | 6 個 disposable browser／DB gate | tracking（152s）、q1 refund proof（7s）、q1 refund reservation（6s）、referral sharing（136s）、funnel dev harness（56s）、subscription recovery（139s） | 496s |
| 16 | **Release browser gates** | `npm run e2e -- --fail-on-flaky-tests` | **555s** |
| 17 | Build | `npm run build`（38s）、`controlled-production-build.mjs`（123s）、`NODE_ENV=production npm run preflight` | 161s |

步驟小計約 29–30 分，job 實測 32.6 分（含啟動與 post 步驟）。

### 3.3 retry／timeout／flaky 政策

| 項目 | 實際設定 |
|---|---|
| Job 層級 `timeout-minutes` | **ci.yml 沒有**（GitHub 預設 360 分）。唯一限時是 PostgreSQL 併發步驟的 shell `timeout --preserve-status 10m` |
| `concurrency`／`cancel-in-progress` | **沒有**；`push` 與 `pull_request` 雙觸發，同一個 PR 每次更新會跑兩輪（以 `gh run list` 驗證：同一 head 成對出現） |
| 步驟 retry | 只有 docker pull 迴圈（基礎設施）；ci.yml 無 `continue-on-error`、無 retry action |
| Playwright retries | `playwright.config.ts`：`retries: process.env.CI ? 1 : 0`；`playwright.g7-commerce.config.ts`：`retries:0`；`funnel-elements`：預設 0 |
| fail-on-flaky | `npm run e2e -- --fail-on-flaky-tests`（CI）；13 個 browser／disposable runner 內建 `--fail-on-flaky-tests` 並斷言 `flaky===0`、`skipped===0`。**未帶旗標的 runner**：`funnel-elements-browser-qa.mjs`（retries=0 故無影響）、`g7-email-operations／form-builder／interaction-roles／live-advanced-interactions`、`payuni-*`、`pending-refund`（均不在 CI） |
| 實際效果 | 第一次失敗＋retry 通過＝job 失敗（flaky 即紅燈）；兩次都失敗則 reporter 輸出 `failed=1 flaky=0`（見 §5） |
| Vitest | 無 `retry` 設定；`testTimeout` 僅在部分 DB 設定覆寫（15s／20s／30s） |

### 3.4 覆蓋率門檻來源

三處**相同數值**的重複定義：

1. `vitest.config.ts` `coverage.thresholds`：全域 statements 63／branches 57／functions 60／lines 65；`"src/lib/**.ts"`：86／80／88／88。**`COMBINED_COVERAGE_COLLECTION==="true"` 時設為 `undefined`（不在 Vitest 內判斷）**。
2. `scripts/run-combined-coverage.mjs`：硬編 `coverageThresholds`（63/57/60/65）與 `libThresholds`（86/80/88/88），在合併後自行判斷。
3. `vitest.synthetic-db-coverage.config.ts`：同樣的 thresholds 區塊（見 §4）。

`run-combined-coverage.mjs` 邏輯摘要：
1. 自建 docker `postgres:16-alpine` 容器（`--tmpfs`、僅綁 `127.0.0.1`），寫入擁有者標記，產生 mirror 並跑 `prisma validate／migrate deploy／migrate status`（`RT01_D2_DISPOSABLE_DB=true`）。
2. `vitest run --coverage`（v8），環境 `COMBINED_COVERAGE_COLLECTION=true`。
3. 以 `NODE_V8_COVERAGE` 跑 `scripts/run-node-tap-contracts.ts`（所有 import `node:test` 的 `scripts/**/*.test.mjs`）。
4. 讀 `coverage-final.json`，**移除 Vitest 對 `scripts/*.{mjs,ts}`（非 test）的零計數佔位**，再合併 Node TAP 的 V8 覆蓋（經 `ast-v8-to-istanbul` 轉換）。
5. 以 `libCoverage` 重新彙總，檢查全域與「路徑含 `/src/lib/` 且副檔名 `.ts`」兩組門檻；任何一項不足即 throw。
6. 無論成敗皆驗證擁有者標記後刪除容器與暫存目錄。

master 最近一次實測（run 39181999330）：Statements 65.52%（38571/58865）、Branches 63.96%、Functions 68.64%、Lines 70.78%；對全域門檻的餘裕：statements 約 2.5 點、lines 約 5.8 點（`src/lib` 專屬數字未印在 text-summary）。

---

## 4. synthetic-db-coverage 疑慮（只描述機制）

檔案：`vitest.synthetic-db-coverage.config.ts`；入口：`npm run test:db:concurrency` = `vitest run --config vitest.synthetic-db-coverage.config.ts`（**命令列沒有 `--coverage`**）。

機制：
1. 設定檔內有完整 `coverage` 區塊（v8，include `src/**` 與 `scripts/**`，thresholds 同 §3.4），但 `coverage.enabled` 未設，CI 命令也不帶 `--coverage`。CI log 中該步驟（run 39181999330，約 00:50:57–00:54:34）沒有「Coverage enabled with v8」，只有單元步驟那一次出現。因此**目前呼叫方式下，這份設定檔的 thresholds 不會被評估，也不產生覆蓋資料**。
2. 它定義兩個 Vitest project：`wp18-main`（預設 include 的幾乎整個測試集，只排除 `actions.mfa-db.test.ts`、`tests/e2e`、`tests/browser-dev`、`.ai-team/tmp`、Node TAP 檔）與 `wp17-db`（只跑 `actions.mfa-db.test.ts`）。各自注入不同資料庫 URL／schema（`celebratedeal_wp17_ci`／`wp18_ci`）與 `RT01_D2_DISPOSABLE_DB=true`，`fileParallelism:false`。
3. 與根 `vitest.config.ts` 的差異：根設定排除 `actions.mfa-db`、`actions.payout-db`；`wp18-main` 只排除前者，所以**多跑 `actions.payout-db.test.ts`**。CI 實測此步驟 759 檔／6363 tests，單元步驟 757 檔／6357 tests，差 2 檔／6 tests，吻合。另外根設定排除 `tmp/**`，synthetic 設定沒有（本機 `tmp/` 目錄存在且含 `live-db-*` 等內容，CI checkout 則無；`docs/branch-integration-future-work.md` 第 202 列已記錄「排除規則須先對齊」）。
4. 覆蓋率的實際來源只有 `run-combined-coverage.mjs`（根設定＋Node TAP）。synthetic 步驟的結果**未**併入該覆蓋圖。
5. 可能造成數字失真或誤解的機制（不下結論）：
   - 名稱含 "coverage" 且內含 thresholds，容易被誤認為覆蓋率門檻的來源之一；實際該 thresholds 區塊為未啟用的重複常數，三處數值需人工保持同步。
   - 若有人加上 `--coverage` 單獨執行該設定，`wp18-main` 會把整個套件（含 DB 測試）計入，分母含 `scripts/**` 但無 Node TAP 資料（此設定沒有 `stripNodeTapOwnedVitestCoverage` 的處理，TAP 擁有的 scripts 會是零計數佔位），數字會與合併流程不同。
   - 合併流程本身的設計選擇（可再審視）：`scripts/**` 同時在分母與 Node TAP 覆蓋；`src/lib/**.ts` 門檻在合併腳本以路徑子字串判斷（含 `payment-providers/` 子目錄），而 Vitest 設定檔用 glob `src/lib/**.ts`，兩處判定範圍未必一致；合併流程使用 `RT01_D2_DISPOSABLE_DB=true` 的真實資料庫，`describe.skipIf` 的 3 個 DB 測試因此執行（本機未設則被跳過，覆蓋會不同）。
   - 「原始碼合約」型測試（`readFile`＋`toContain`）通過但不貢獻覆蓋率，也不驗證執行行為。

---

## 5. 已知 flaky 清單

| # | 測試 | 症狀 | 處理狀態 | 來源 |
|---|---|---|---|---|
| 1 | `member-billing-plans-direct-url`（E2E） | 文件 PR #348 的 run 36410824308：首次 581ms 失敗、retry 通過；另一 run 36410861112 成功 | **根因未證實**。已放寬 reporter 診斷（允許 `direct-url-guard.ts` 行號），保留 fail-on-flaky 與全部斷言；#348 已合入 master 14e23f8e，不代表根因解決 | `docs/launch/NEXT-CYCLE.md` 第 5 項；`docs/goal-plan-review-research-skills-20261017.md`（「CI flaky（direct-url-guard）」列為已知未完） |
| 2 | 數位交付（digital delivery）E2E | 舊候選 run 36372141599 首次失敗、retry 通過；#342／#343 兩組完整 CI 通過 | **根因未證實** | `docs/launch/NEXT-CYCLE.md` 第 5 項 |
| 3 | `src/app/portal/[vendorSlug]/page.test.tsx`「English dashboard preserves tenant scope…」 | run 39115688218（分支 `audit-wp06-08-15-nav-copy`）在「PostgreSQL concurrency tests」步驟 `expected … to contain 'My courses'`，其餘 6013 tests 通過 | PR #437 "remove duplicate locale mocks that made English tests flaky" 已合入（推定為同一問題，未重跑驗證） | `gh run view 39115688218 --log-failed`；`gh pr list`（#437） |
| 4 | CI 的 PostgreSQL 啟動（基礎設施） | registry 限流使服務容器失敗 | #426 改為 ECR／Docker Hub 雙來源＋重試（pin digest） | `gh pr list`（#426）；`ci.yml` 第一步 |
| 5 | 脆弱斷言（非 flaky，但造成偶發紅燈） | WP-88 精確清單：實際 91 頁／52 manager，舊斷言 90／51；migration／model 硬編總數 | 前者已修正（不刪斷言，補完整清單）；後者 #427「drop hardcoded migration and model totals」已合入 | `docs/remaining-capabilities-work-matrix-20261005.md`（CI 37616047757）；`gh pr list`（#427） |
| 6 | **非 flaky 的連續紅燈**：近 60 次 CI 中 18 次失敗（`audit-wp03-public-policies`、`audit-wp05-native-form-retry`、`audit-wp06-08-15-nav-copy` 三條分支） | 「Release browser gates」retry=0 與 retry=1 **皆失敗**（`failed=1 flaky=0`）；reporter 為保護隱私不輸出測試名稱，只能得知類別（`step_error category=expect`／`pw:api`） | 屬確定性失敗，之後在這些分支修好；事後無法從公開 log 取回具體測試名 | `gh run list --workflow CI --limit 60`、`gh run view <id> --log-failed`（例：39142581174、39158056262、39147548693） |
| 7 | 有條件跳過 | `describe.skipIf(RT01_D2_DISPOSABLE_DB!=="true" 或 DB 不安全)`：`interaction-card-timeline.db.test.ts`、`live-chat.db.test.ts`、`presenter-layout.db.test.ts`；`smoke.spec.ts` 第 1181 行 `test.skip`（記憶體 rate limit，當 `RATE_LIMIT_PROVIDER` 為 `cloudflare_waf`／`upstash_redis` 時略過） | CI job 設 `RT01_D2_DISPOSABLE_DB=true`，DB 測試會跑；`playwright.config.ts` 會把 provider 設為 `memory`，故推定不略過（由 CI log 無法直接驗證 E2E 略過數） | 程式碼 grep |

補充：
- 程式碼 grep `test.only／fixme／todo／it.skip／describe.skip`：**0 筆**（僅上表 #7 的 4 處條件式略過）；`retries` 字樣出現者均為產品邏輯 retry 的測試名稱，不是測試重跑設定。
- 本表 run ID 36372141599、36410824308 等超出 `gh run list` 可查範圍（最近 60 筆最早為 39115688218），**僅引用文件記載，未驗證**。
- Playwright reporter（`scripts/playwright-ci-reporter.ts`）刻意只輸出類別、行號與耗時，因此歷史 flaky 的實際測試名難以還原，見 §7。

---

## 6. 執行成本估計

### 6.1 CI 單次

- **Job 數**：1（`quality`），49 個 step；單 runner 串行，無平行 job。
- **每次 PR 更新**：`push`＋`pull_request` 雙觸發＝2 輪，約 **65–85 runner 分鐘**（例：39177455522 26.3 + 39177380055 42.0 ＝ 68.3；39178775362 31.8 + 39178772264 42.2 ＝ 74.0）。
- **歷史**（`gh run list --workflow CI --limit 60`，2026-10-18 09:31Z–2026-10-19 00:42Z）：成功 42、失敗 18。成功耗時（createdAt→updatedAt）最小 25.2、中位 40.4、最大 72.9 分鐘（最大值疑似含排隊或重跑）；master 最新一次 job 為 32.6 分鐘；失敗 run 在 12.6–43 分鐘之間結束。
- **大頭**（master run 39181999330，單位秒）：Release browser gates 555、6 個 disposable gate 合計 496、單元＋覆蓋率 295、PostgreSQL 併發 217、controlled production build 123＋Build 38、typecheck 46＋lint 39＋strict-index 22。
- **重複工作**（可量化）：
  1. 完整 Vitest 套件跑兩次：覆蓋率步驟（757 檔／6357 tests，245s）與 `test:db:concurrency`（759 檔／6363 tests，211s），合計約 7.6 分鐘，差異只有 mfa-db 與 payout-db 2 檔。
  2. Node TAP（1225 tests）跑兩次：含在 `test:coverage` 內一次，`test:contracts` 再一次（約 25s）。
  3. 一個 job 內 6 次 `next build`：根 Playwright webServer、tracking、referral、subscription 各一次（各自 mirror），再加 `npm run build`、`controlled-production-build.mjs`。
  4. 3 個 DB 邊界設定檔的測試也被根 Vitest 掃到（各約 1–2s，影響小）。

### 6.2 全量本機驗證（非 CI）

20 個 vitest 設定各對應一個 disposable runner，每個 runner 各起一個 docker PostgreSQL 並 migrate（master 約 108 個 migration）；13 個含瀏覽器的 runner 另外各做一次 `next build`。以 CI 內同類 gate 的 136–152 秒為基準，全部跑完粗估 **30–60 分鐘（本機、序列）**，此為由 CI 數據外推的估計，未實測。

其他 workflow：23 個 `workflow_dispatch` staging 流程，timeout 3–30 分鐘，只在需要時手動觸發。

---

## 7. 建議（只列建議，未執行）

### 7.1 可合併的設定檔

1. **5 個 `COURSE_LEARNING_DISPOSABLE` 設定檔幾乎相同**（#1 affiliate-portal、#2 affiliate-remuneration、#3 course-community、#4 course-learning、#14 merchant-affiliate-policy；錯誤訊息甚至都寫 "Course learning requires…"）：只差 include。可合成一個參數化設定（include 由 CLI 檔名／環境變數提供，守衛邏輯共用一份），同理 `pending-refund`、`subscription-recovery`、`tracking-*` 的 marker 守衛可共用 helper。
2. **g7 系列 8 個 schema-marker 設定**（analytics、checkout-admission、commerce、email、finance、form-verification、stream、stream-reconciliation）：守衛結構相同，只差 schema 正規表示式與 include，可抽 `createDisposableVitestConfig({ prefixRegex, include, env })`。
3. **4 個孤兒 vitest（#5、#10、#11、#12）＋4 個孤兒 prisma（g7-*）**：repo 內沒有任何 runner／workflow 參照，只被 2026-08-09 證據清單提及。建議先確認是否還有人用；無用就移除，或補 runner／在 README 標為歷史。需 owner 決定。
4. **15 個 playwright 衍生設定**：約 10 個是「讀 mirror／report 環境變數、覆寫 testMatch、reporter、webServer.cwd」的同形樣板，可抽 `createMirrorPlaywrightConfig`。`portal-localization` 與 `course-community`、`course-learning` 重疊兩支 spec；`course-community-guard` 與 `live-private-commerce` 都跑 `wp88-direct-url-guard-matrix`。
5. **prisma**：`prisma.playwright.config.ts` 與 4 個 g7 prisma 設定、以及各 runner 臨時產生的 `prisma.config.mjs`，可收斂為一份由環境變數驅動的 disposable 設定。
6. **`vitest.synthetic-db-coverage.config.ts`**：名稱與用途不符（沒有覆蓋率、實際是全套件在獨立 schema 重跑＋mfa-db）。可擇一：改名（例如 `vitest.db-concurrency.config.ts`）並移除未啟用的 coverage／thresholds；或只讓它跑 `wp17-db` 與真正需要隔離 schema 的檔案，避免整個套件再跑約 211 秒。門檻常數三處重複，建議抽成單一模組。

### 7.2 應補的測試（依風險排序）

1. `src/lib/platform-plan-checkout.ts`（566 行，平台收款）：補直接的單元／DB 測試（金額來自伺服器紀錄、冪等、租戶綁定）。
2. `src/lib/cloudflare-webhook-signature.ts`：0 個直接 import 的簽章驗證，補正反例（時間窗、錯簽、重放）。
3. 認證面：`auth-security-actions.ts`、`mfa-recovery-regeneration.ts`。
4. 課程與推廣入口 server actions：`course-community-actions`、`course-curriculum-actions`、`affiliate-portal-actions`（租戶邊界、CSRF、授權）。
5. 把 `customer-crm-actions`、`mobile-consultation-actions` 的「原始碼字串合約」補成執行型測試（它們處理 PII 與租戶資料，目前不產生覆蓋也不驗行為）。
6. Funnel／Landing 編輯器元件（`funnel-blocks/*` 0 測試、`landing-pages/*` 7/25）、`ui.tsx` 等共用元件，補 React Testing Library 行為測試。
7. 沒有 PayUni、LINE、MFA 登入的專屬 E2E：目前 E2E 全為 `demo` provider。可在 Sandbox 手動流程之外補一支以 mock provider 驅動的付款回呼 E2E（不依賴外部服務）。
8. 把 Playwright reporter 的 flaky 診斷改為可還原測試名稱的受控白名單（目前歷史 flaky 無法回溯到具體測試）。

### 7.3 CI 與外部服務依賴

1. `ci.yml` 加 job 層級 `timeout-minutes`（例如 60）與 `concurrency: cancel-in-progress`；考慮 `push` 僅限 `master`，避免每次 PR 更新跑兩輪。
2. 將單一 `quality` job 拆成平行 job（靜態檢查、單元＋覆蓋率、DB 併發、browser gates、build），並共用一次 production build（目前 6 次）；預估牆鐘由約 33–40 分降到約 15 分（估計值，未驗證）。
3. 移除重複執行：Node TAP 跑兩次、完整 Vitest 套件跑兩次（見 §6.1）。
4. 標示為 optional／不阻擋合併的外部依賴：`npm audit`（需 registry）、`git fetch refs/pull/277/head`（依賴 PR #277 的 ref 持續存在）、docker 公開 registry 拉取、`playwright install --with-deps`；全部 `staging-*`／`q1-*`／`secure-staging-*`／`payuni-live-probe` workflow、`npm run qa:payuni:sandbox`、`external:smoke`、`secure:staging:*`（需 Sandbox／staging 憑證）。其中 `npm audit` 屬安全門檻，是否降為排程需 owner 決定。
5. 文件層面：在 `docs/domain-workflows.md` 或測試 README 註明「哪些設定檔屬 CI、哪些屬本機 runner、哪些為孤兒」，避免 B-08 的維護成本被重複估算。

---

## 附：主要命令

見 `reports/review-2026Q4/A-03-receipt.md`。
