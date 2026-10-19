# 20 死碼、歷史殘留與文件漂移審查（B-10）

- 審查日期：2026-10-19（唯讀；沒有改動任何既有檔案、沒有 git 寫入、沒有讀取 `.env*`、沒有在其他 worktree 內寫入任何檔案）
- 審查基準：分支 `codex/goal-review-2026q4` = `origin/master` `78621ca3`（#444）。本機 `master` 分支停在舊的 `efb8b7e9`，所以所有「是否已合併」都用 `origin/master` 比對。
- 方法：`git ls-files`／`git grep` 核對引用；讀 `docs/review-2026Q4/02-docs-map.md`、`04-static-scan.md`（knip production 模式）、`docs/handoff-codex-to-claude-20261017.md`、`docs/branch-cleanup-20261017.md`；worktree 只用 `git -C <path> status --porcelain`、`git log`、`git cherry`、`git merge-base --is-ancestor`、`git tag --contains` 等唯讀指令。
- 與其他軸線的關係：ops 端點守門見 B03-21；PRISMA_INVARIANTS 內容漂移見 B04-23；SQLite 遺物見 B04-24；本文件補足它們沒有量到的部分（誰還在用、刪了會不會壞 CI）。

---

## 0. 先講結論

1. **正式 bundle 內最需要處理的是兩件事**：28 條 `/api/admin/ops/**` 端點（其中 22 條 PayUni 端點有完整的環境閘門，但 6 條只靠 `JOB_SECRET`），以及 `wp4-*` 沙盒測試輔助程式碼已經編進正式的登入、結帳、發票路徑（`auth.ts:142` 的 `createWp4PreviewMfaVerifiedSession` 可以替固定測試帳號建立已通過 MFA 的 session，只靠環境判斷保護）。
2. `src/app/__test`、`src/app/sentry-example-page` 在 master 上是**空資料夾**（git 不追蹤，只存在這台電腦），`sentry-example-api` 根本不存在，這部分的疑慮不成立。`src/app/browser-qa` 兩個頁面有 `NODE_ENV !== "development"` 就 `notFound()` 的閘門；`__celebratedeal_wp187_fingerprint.json` 由 `src/proxy.ts` 公開提供，沒有環境閘門，路由資料夾裡那份 `route.ts` 因為以底線開頭是私有資料夾，永遠不會被路由到（死碼，但有測試）。
3. **knip 的 19 個「未使用檔案」逐一判定**：4 個是測試／腳本支援（保留），9 個可以安全刪除（有後繼實作或已無入口），2 個是帳務相鄰的死碼（刪除前需 reviewer 看過），4 個要 owner 決定是不是路線圖功能。
4. **9 個 worktree 中，只有主目錄與 PR #436 的 `codex/audit-wp10-admin-mfa` 該保留**。其餘 7 個都有 `archive/*` tag 備份（82 個 tag 全部已在 origin），可以移除；其中 1 個（notifications）的本機 merge commit 沒有 tag，移除前要先補一個；2 個（commission policy、staging 回復點）建議 owner 先看一眼。`~/.codex/worktrees` 底下另有 23 個**未登記**的目錄。
5. **文件**：master 的 `docs/` 有 1,885 個檔案、約 76 MB，其中約 1,725 個（91.5%）可以第一批封存。**但有 43 個檔案被測試或 CI 腳本以固定路徑讀取**（02 號文件估 22 個，本次交叉比對加入 `readiness-truth-reconciliation.mjs` 對快照 provenance 的存在性檢查後是 43 個），搬動前必須先改引用，否則 CI 會紅。
6. **`.ai-team` 的 133 個 scripts 引用沒有壞掉**：其中 11 個在 CI 內使用，但都只是把它當作「被 gitignore 的收據輸出資料夾」（會自己 `mkdir -p`），master CI 是綠的。真的會壞的是 9 個「讀取舊收據」的歷史 runner，它們不在 CI 內。

---

## 1. Findings

| ID | 嚴重度 | 檔案:行號 | 問題 | 影響 | 建議 | 估工 | 需 owner 決策 | 封測前必修 |
|---|---|---|---|---|---|---|---|---|
| B10-01 | MAJOR | `src/app/api/admin/ops/**/route.ts`（28 條）；`cloudflare/direct-upload/route.ts`、`cloudflare/live-input/route.ts`、`test-email/route.ts`、`test-analytics/route.ts`、`test-monitoring/route.ts`、`provider-runtime/route.ts` | 28 條 ops 端點全在正式 bundle：22 條 PayUni（`pending-refund-proof`、`q1-*`×4、`wp4-*`×17）經 `wp4-runtime-boundary`／`authorizeWp4Ops` 要求 `VERCEL_ENV=preview`＋`PAYUNI_ENV=sandbox`＋執行旗標＋staging 專案與資料庫身分＋來源 SHA；`provider-runtime` 在驗證 secret 後檢查 `VERCEL_ENV=preview`。**其餘 5 條只靠 `JOB_SECRET`**，沒有環境閘門：`test-email` 會從正式環境寄信（限 allowlist 收件人）、`test-analytics` 會寫入正式 PostHog（事件 `production_smoke_test`）、`cloudflare/direct-upload` 與 `live-input` 會建立 Cloudflare Stream 資源（成本）、`test-monitoring` 會對 Sentry 丟合成錯誤。所有端點先回 401 再判斷環境（B03-21 已指出會透露端點存在）。 | `JOB_SECRET` 同時用於 cron 與這些端點，一旦外洩，攻擊者可以在正式環境寄信、建立付費資源、汙染分析資料。維護面也大：28 條路由＋28 個測試。 | ①短期（0.5 天）：在 `src/proxy.ts` 新增 matcher `/api/admin/ops/:path*`，`VERCEL_ENV==="production"` 時一律回 404（在驗證 secret 之前）。實作前依 AGENTS.md 先讀 `node_modules/next/dist/docs` 的 proxy 文件。②中期：`test-email`／`test-analytics`／`test-monitoring` 若仍要在正式環境做 go-live smoke，改用獨立的 `OPS_SMOKE_SECRET`，不與 cron 共用。③長期：22 條 PayUni 沙盒端點隨 B10-02 一併移出正式 bundle。 | ①0.5 天；②1 天；③見 B10-02 | 是（正式環境是否仍需要 smoke 端點） | 建議（① 低成本） |
| B10-02 | MAJOR | `src/lib/auth.ts:1-2,142-165`；`src/lib/platform-plan-checkout.ts:1,19,272,303-304,433,535`；`src/app/api/payments/checkout/route.ts:63,255`；`src/app/actions/invoice-actions.ts:17,181,241`；`src/app/(app)/billing/plans/page.tsx:1-2,167`；`src/lib/wp4-runtime-boundary.ts`、`wp4-sandbox-fixture.ts`（282 行）、`wp4-source-bound-transaction.ts` | `src/lib/wp4-*`（14 個非測試檔，約 1,390 行）與 `q1-downstream-readonly.ts`（147 行）大部分只被 ops 路由使用，但其中 `wp4-runtime-boundary`、`wp4-sandbox-fixture`、`wp4-source-bound-transaction` 被**正式的 auth、結帳、發票、方案頁**直接 import。`createWp4PreviewMfaVerifiedSession` 在 `isWp4BoundNonProductionRuntime()` 且 userId／vendorId 等於固定 fixture 時，會建立 `mfaVerifiedAt = now` 的 session。 | 目前保護是環境條件的組合（`VERCEL_ENV=preview`、`PAYUNI_ENV=sandbox`、`WP4_SANDBOX_EXECUTOR_ENABLED=true`、專案 ID 與資料庫身分、來源 SHA 與 `JOB_SECRET`），`wp4-runtime-boundary.test.ts` 與路由測試都有覆蓋，正式環境沒有已知繞過路徑；風險是「把一個能跳過 MFA 的函式編進正式 bundle」本身，日後任何環境變數誤設（例如 Preview 專案沿用正式資料庫）都會變成實際漏洞。 | 先確認 staging PayUni QA 新流程不再需要 `wp4-session`，然後把 `createWp4PreviewMfaVerifiedSession` 與 fixture 判斷移到只在 staging 建置才編入的模組（以 `import()` 加建置期旗標，或乾脆移除該 ops 路由）。移除前補一個測試：`VERCEL_ENV=production` 時所有 `wp4*` 入口回 404 且 `getDb` 不被呼叫（`recovery-boundary.ts` 已有類似案例，可擴充）。 | 2–3 天（需 `engineer-hard` 與一次獨立審查，因為動 auth 與結帳） | 是（staging QA 流程是否還需要） | 否（有多層閘門），但建議列入封測前清單 |
| B10-03 | MINOR | `src/proxy.ts:7,36`、`src/app/__celebratedeal_wp187_fingerprint.json/route.ts`、`route.test.ts`、`src/lib/preview-lineage.ts` | 公開路徑 `/__celebratedeal_wp187_fingerprint.json` 由 `proxy.ts` 直接回應，沒有環境閘門，內容是固定 JSON（`baseWorkPackage: "WP-187"`、`remediationWorkPackage: "FIN-08U"`、一個 sha256）。同名的 `route.ts` 在底線開頭的私有資料夾內，不會被路由，proxy 註解自己也承認；但測試仍然針對這份死副本寫。約 20 個一次性 `fin08*`／`wp18x`／`wp19x` scripts 依賴這個標記。 | 公開洩漏內部工作包編號與摘要（低敏感）；死碼加一份測試；與 Preview 版本辨識腳本綁在一起，無法單獨刪。 | 隨 B10-09（歷史 runner 封存）一起移除標記、`preview-lineage.ts`、死路由與測試；在那之前至少讓 proxy 只在 `VERCEL_ENV!=="production"` 時回應。 | 0.5 天 | 否 | 否 |
| B10-04 | MINOR | `src/app/browser-qa/funnel-editor/page.tsx:3-6`、`src/app/browser-qa/funnel-elements/page.tsx:3-6`、`playwright.funnel-elements.config.ts`、`tests/browser-dev/*.spec.ts` | 兩個瀏覽器 QA 頁面以 `process.env.NODE_ENV !== "development"` → `notFound()` 守門，正式環境 404；但頁面所 import 的 `funnel-editor-browser-harness`、`funnel-advanced-browser-harness` 元件仍會被編進正式 bundle 的 server 端程式碼。 | 守門有效；只是多出兩個測試用元件的建置成本，沒有外洩風險。CI 內的 `funnel-elements-browser-qa.mjs` 依賴這兩頁。 | 保留；如果要瘦身，可把 harness 路由搬到 `tests/` 底下由獨立的 dev server 載入。優先度低。 | 1 天 | 否 | 否 |
| B10-05 | NIT | 本機資料夾 `src/app/__test/funnel-elements/`、`src/app/sentry-example-page/`（皆空）；`src/app/sentry-example-api` 不存在 | 兩個空資料夾是舊分支切換留下的殘渣，git 不追蹤。任務清單提到的 `sentry-example-page`／`sentry-example-api` 在 master 沒有任何檔案。 | 無執行期影響；只會讓人誤以為還有 Sentry 範例路由。 | 本機直接刪除空資料夾。 | 1 分鐘 | 否 | 否 |
| B10-06 | MINOR | 見 §3 表格（9 個檔案約 490 行，另有對應測試） | knip production 模式的 19 個未使用檔案，9 個可以直接刪除（有後繼實作或已無入口）；另 2 個帳務相鄰的見 B10-07。 | 死碼加測試，增加 CI 時間與審查負擔；`funnel-blocks/*` 的舊渲染器容易被誤認為現行實作。 | 開一個 PR 刪除並同步刪除對應測試；PR 描述附 §3 的判定理由。 | 0.5 天 | 否 | 否 |
| B10-07 | MINOR | `src/app/(app)/billing/plans/actions.ts`（21 行）、`plan-submit-button.tsx`（19 行）、`actions.test.ts`、`plan-submit-button.test.tsx` | 方案選擇 Server Action `selectBillingPlanAction` 與按鈕沒有任何入口：`page.tsx` 現在用 `BillingPlanCheckoutForm`，直接以原生 `<form method="post">` 送到 `/api/billing/plans/select`（`billing-plan-checkout-form.tsx:15`）。`git log` 顯示 `actions.ts` 只有 #136（2026-08）一筆提交。 | 兩個死檔加兩個測試，其中 `actions.test.ts` 還會讓人以為方案選擇的 Server Action 路徑仍有覆蓋；它處理的是平台方案結帳，屬帳務相鄰。 | 刪除前請 `reviewer` 確認 `platform-plan-checkout.ts` 的所有呼叫端都走 route（這也是 B-03 審查範圍）。確認後與 B10-06 同批刪除。 | 0.25 天 | 否 | 否 |
| B10-08 | MINOR | `src/lib/ab-testing.ts`（77 行）、`ai-funnel-assistant.ts`（138）、`evergreen-webinar.ts`（176）、`interaction-card-media.ts`（12） | 4 個 lib 只被自己的測試引用，沒有任何 route、action、頁面或腳本使用。`ab-testing`（#229）、`ai-funnel-assistant`（#215）、`evergreen-webinar`（#224，但 `evergreen-webinar-settings.tsx` 設定 UI 與 `evergreen-webinar-actions.ts` 已上線）、`interaction-card-media`（#223，DB 測試存在）。 | 無法判斷是「尚未接線的功能」還是「被取代」。其中 evergreen 的 UI 已存在而排程核心未接線，可能是半成品功能。 | 請 owner 決定：列入路線圖就保留並在檔頭註明；否則連同測試刪除。不要現在就刪。 | 0.25 天（決定後） | 是 | 否 |
| B10-09 | MINOR | `scripts/wp*`（131 檔，60 個測試）、`scripts/fin*`（24 檔，12 個測試）；`package.json` 與 `ci.yml` 對這些檔案的引用為 0 | 155 個 WP／FIN 編號的一次性 runner（每個對應 `docs/ai-team/evidence` 的一份收據）仍在 repo 內，其中 `scripts/*` 共 423 個檔案。其中 5 個非 WP 編號的測試（`cat10-operational-source-attribution.test.ts`、`scripts/qa/wp191…wp194` 的測試）反過來 import 它們。 | 它們的 TAP 測試每次 CI 都跑（`test:contracts` 1,225 tests 的一部分），並把全域覆蓋率分母撐大；多數預設寫入／讀取 `.ai-team` 與 `docs/ai-team/evidence`。與 B10-10、B10-11 互相綁定，必須一起搬。 | 與證據檔一起封存到 `reports/archive/2026/scripts/`，並從 `test:contracts` 排除；先處理 5 個反向依賴。估計可減少 TAP 測試數與 CI 時間（需實測）。 | 2 天 | 是（是否仍要保留舊 runner 以便稽核重現） | 否 |
| B10-10 | MAJOR | `docs/`（1,885 個檔案、76 MB） | 第一批可封存 **1,725 個檔案（91.5%）**，明細見 §5.1。 | 搜尋、審查與新人閱讀都被收據淹沒；`DOCUMENT_AUTHORITY.md` 把人導向過期文件（02 號文件）。 | 照 §5.1 分批 `git mv` 到 `reports/archive/2026/`（不刪除，git 歷史保留）；先處理 B10-11 的 43 個釘住檔。 | 2 天（搬移＋改引用＋CI 驗證） | 是（封存位置與是否保留 PNG） | 否 |
| B10-11 | MAJOR | 43 個檔案，明細見 §5.2；`scripts/readiness-truth-reconciliation.mjs:8-10,130-135`（CI 步驟「Readiness truth reconciliation」）、`scripts/api-contract-registry.test.ts:6`、`scripts/prisma-invariant-inventory.test.ts:7`、`scripts/subscription-recovery-disposable-qa.mjs:11` 等 | 有 43 個 `docs/` 檔案被測試或 CI 腳本以固定路徑讀取：12 個被測試讀取、30 個被 `readiness-truth-reconciliation.mjs` 檢查存在性與 SHA-256（快照＋ provenance 清單）、1 個被 CI 的瀏覽器 gate 讀取。直接 `git mv` 會讓 CI 變紅。 | 封存批次若漏掉這些，CI 會在最不合適的時機失敗；同時 `readiness-truth-reconciliation` 驗證的 2026-08-02 快照本身已被取代（02 號文件 §2.2 #1、#2）。 | 先判斷 `readiness-truth-reconciliation`（快照）是否仍有保護價值：若無，連同它的 30 個釘住檔一起退役（從 `ci.yml` 移除該步驟）；若有，改成讀取 `docs/launch/fixtures/`。其餘 13 個移到 `scripts/fixtures/` 並改測試路徑，在拋棄式 worktree 內先 `git mv` 再跑 `npm run test:contracts` 確認。 | 1.5 天 | 是（快照驗證是否退役） | 否 |
| B10-12 | MINOR | `docs/codex-goal/`（12 個 tracked 檔案）、`docs/DOCUMENT_AUTHORITY.md` | 2 個要重寫（被測試釘住），10 個歸檔；另有 8 個被 gitignore 的本機檔案是死連結目標。明細見 §5.3。 | `PRISMA_INVARIANTS.md` 內容重複且互相矛盾（B04-23）；`API_CONTRACT_REGISTRY.md` 檔頭日期與基準 revision 過期；`DOCUMENT_AUTHORITY.md` 指向過期快照。 | 見 §5.3。 | 1.5 天 | 否 | 否 |
| B10-13 | MINOR | 9 個 worktree（§4）、`C:\Users\eden\.codex\worktrees\*` | 7 個次要 worktree 都有 tag 備份（其中 #5 的 HEAD 需先補 tag）；`codex/audit-wp10-admin-mfa` 對應開放中的 PR #436，不可移除；`~/.codex/worktrees` 底下有 26 個目錄但只有 3 個是已登記的 worktree（23 個未登記）；本機磁碟殘留：`.ai-team` 6.2 GB、`.next` 1.9 GB、`tmp` 1.3 GB、`coverage` 180 MB。 | 磁碟與認知負擔；上次移除 worktree 時 NTFS junction 把主目錄 `node_modules` 清空過（交接事故）。 | 照 §4.3 的步驟逐個移除；未登記的 23 個目錄請 owner 逐一確認後再處理。 | 0.5 天 | 是（commission policy 與 staging 回復點兩個） | 否 |
| B10-14 | NIT | 已追蹤：`reports/ai-team/qa-payuni-sandbox/*.json`（3）、`reports/manual-handoff/{SOL_CURRENT_STATE,SOL_FINDING_TRIAGE,TERRA_TASK_PACKET}.md`、`reports/night-review/20260725T194948Z/*.md`（3）、`tmp/pdfs/agy-review/*.png`（3）、`prisma/migrations_sqlite_archive/`（9 個檔案）、`.impeccable/live/config.json`；未追蹤但在本機：`error.log`（Codex 日誌，含 ChatGPT 帳號識別）、`GOAL-AI-TEAM-PROMPT.md` | 舊 AI Team 時期的交接與暫存檔仍在 repo 內；本機兩個被 gitignore 的檔案含舊工具資訊。 | 與 B10-10 一起封存或刪除；`error.log` 含帳號識別，建議在本機直接刪除（不在 git 內，不會外洩到 repo）。 | 0.25 天 | 否 | 否 |
| B10-15 | MINOR | `scripts/build/controlled-production-build.mjs:10`、`scripts/{affiliate-portal-browser-qa,learner-notification-disposable-qa,q1-original-refund-proof-disposable-qa,q1-original-refund-target-disposable-qa,subscription-recovery-disposable-qa,tracking-settings-disposable-qa}.mjs`、`scripts/readiness-truth-reconciliation.mjs:24,96-98,126-128`、`scripts/validate-{external-provider,staging-migration,staging-release}-evidence.test.mjs` | 133 個 scripts 引用 `.ai-team`，其中 11 個在 CI 內使用。**全部沒有壞**：CI 內的 8 個 runner 只把 `.ai-team/reports/` 當輸出資料夾（`mkdir -p` 後寫收據，該資料夾被 `.gitignore:54-57` 排除）；3 個 `validate-*.test.mjs` 只是把它當路徑字串範例；`readiness-truth-reconciliation.mjs` 對 `.ai-team/reports/*` 的檢查是「檔案存在才比對 SHA」。 | 沒有功能影響，只是名稱帶來錯誤印象（以為 AI Team 流程還在）。9 個歷史 runner 會讀取舊收據（`fin08r`、`fin08w`、`wp149/151/153/158/159/160`、`payuni-sandbox-payment-handoff.test.mjs`），若單獨執行會因缺檔失敗，但都不在 CI。 | 抽一個常數（例如 `RECEIPT_DIR = process.env.RECEIPT_DIR ?? "reports/receipts"`），逐步替換；歷史 runner 隨 B10-09 封存。不急。 | 1 天 | 否 | 否 |

---

## 2. 正式 bundle 內的殘留逐項判定

| 項目 | 用途 | 環境守門 | 現況 | 建議 |
|---|---|---|---|---|
| `src/app/__test/` | 舊分支留下的空資料夾 | — | master 無任何追蹤檔案 | 本機刪除（B10-05） |
| `src/app/browser-qa/{funnel-editor,funnel-elements}` | 漏斗編輯器／進階元素的瀏覽器 QA harness（Playwright `funnel-elements` gate 使用，CI 內執行） | `NODE_ENV !== "development"` → `notFound()` | 有效；元件仍編進 bundle | 保留；可選擇搬出 `src/app`（B10-04） |
| `src/app/sentry-example-page/` | Sentry 精靈範例頁 | — | 空資料夾，master 無檔案 | 本機刪除 |
| `src/app/sentry-example-api/` | Sentry 精靈範例 API | — | 不存在 | 不需處理 |
| `src/app/__celebratedeal_wp187_fingerprint.json/` | Preview 部署辨識標記（WP-187），由 `proxy.ts` 實際提供；資料夾內的 `route.ts` 為死副本（`_` 開頭為私有資料夾） | 無 | 公開、固定內容 | 隨歷史 runner 封存後移除（B10-03） |
| `src/lib/wp4-*`（14 個非測試檔） | WP4 PayUni Sandbox 的買家／訂閱／退款／對帳輔助與固定測試帳號 | `isWp4BoundNonProductionRuntime`（preview＋sandbox＋旗標＋專案與資料庫身分） | 其中 3 個被正式 auth／結帳／發票／方案頁 import | B10-02 |
| `src/lib/q1-downstream-readonly.ts` | Q1 下游唯讀查詢（僅 ops 路由使用） | 經 `wp4-runtime-boundary` | 只被 ops 路由使用 | 隨 B10-01③ 一併處理 |
| `/api/admin/ops/payuni/*`（22 條） | 沙盒付款／退款／對帳／復原的受保護 runner 入口（`pending-refund-proof`、`q1-downstream-readonly`、`q1-original-callback-retry`、`q1-original-refund-proof`、`q1-original-schema-recovery`、`wp4-*`×17） | `JOB_SECRET`＋`authorizeWp4Ops`（全部要求 preview＋sandbox＋旗標＋staging 身分＋來源 SHA、禁止 body 與 query） | 正式環境回 404；先 401 後 404 | B10-01 |
| `/api/admin/ops/cloudflare/*`（2 條） | 建立 Stream direct upload／live input 的營運入口 | 僅 `JOB_SECRET` | 無環境閘門 | B10-01 |
| `/api/admin/ops/provider-runtime` | 讀取 Preview 部署綁定與唯讀 provider probe | `JOB_SECRET`；非 preview 回 403；probe 需來源 SHA 吻合 | 守門足夠，但仍在正式 bundle | 納入 B10-01① |
| `/api/admin/ops/test-email`、`test-analytics`、`test-monitoring` | 正式環境上線 smoke（Resend、PostHog、Sentry） | 僅 `JOB_SECRET`；`test-email` 限制收件人 allowlist | 文件 `external-service-validation-runbook`、`production-readiness-review` 仍引用 | B10-01 |

呼叫端核對：28 條端點每一條都至少被一支 `scripts/*` 非測試檔引用（`git grep 'admin/ops/<route>'`），沒有任何 `.github/workflows` 直接呼叫（workflow 透過 scripts 間接使用），所以都不是孤兒路由。

---

## 3. knip 未使用檔案（19 個）逐一判定

來源：`reports/review-2026Q4/A-04-knip-production.txt`。引用核對用 `git grep`，排除 `docs/`、`reports/`、`package-lock.json`。

| # | 檔案 | 行數 | 目前引用者 | 判定 | 理由與建議 |
|---|---|---:|---|---|---|
| 1 | `src/components/funnel-blocks/funnel-page-renderer.tsx` | 29 | 無（只 import 同資料夾 4 個區塊） | **刪除** | 舊渲染器，現行為 `landing-pages/funnel-page-document-renderer.tsx`（#240）。同資料夾的 `consultation-booking-block.tsx` 仍被現行渲染器使用，**不要刪** |
| 2 | `src/components/funnel-blocks/carousel-block.tsx` | 62 | 僅 #1 | **刪除** | 同上 |
| 3 | `src/components/funnel-blocks/countdown-timer-block.tsx` | 35 | 僅 #1 | **刪除** | 同上 |
| 4 | `src/components/funnel-blocks/lead-form-block.tsx` | 10 | 僅 #1 | **刪除** | 同上 |
| 5 | `src/components/funnel-blocks/pricing-table-block.tsx` | 41 | 僅 #1 | **刪除** | 同上；這 5 個檔案 0 測試 |
| 6 | `src/components/interaction-role-form.tsx` | 142 | `interaction-role-form.test.tsx` | **刪除** | 現行互動角色 UI 為 workbench；`interaction-role-action-state.ts` 與 `interaction-actions.ts` 仍使用，需保留 |
| 7 | `src/lib/interaction-role-label.ts` | 28 | 僅 #6 與其測試 | **刪除** | 連帶死碼 |
| 8 | `src/lib/funnel-templates.ts` | 109 | 僅 `funnel-templates.test.ts` | **刪除** | #216 的基礎版，已被 `funnel-template-gallery.ts`、`funnel-template-transaction.ts` 取代（WP-09 #442 的六個模板走新路徑） |
| 9 | `src/lib/wp4-payuni-sandbox-checkout.ts` | 35 | 僅其測試 | **刪除** | WP4 沙盒輔助，無入口；隨 B10-02 清理 |
| 10 | `src/app/(app)/billing/plans/actions.ts` ＋ #11 `plan-submit-button.tsx` | 21＋19 | 各自的測試 | **刪除，需 reviewer 先看**（B10-07） | 方案選擇已改走 `/api/billing/plans/select` 原生 POST；帳務相鄰 |
| 12 | `src/lib/ab-testing.ts` | 77 | 僅其測試 | **owner 決定** | A/B 實驗契約（#229），無任何接線 |
| 13 | `src/lib/ai-funnel-assistant.ts` | 138 | 僅其測試 | **owner 決定** | AI 漏斗文案助手（#215），無接線；另含 3 組重複 export（`generateFunnelSalesCopy`／`createFunnelSalesCopy` 等） |
| 14 | `src/lib/evergreen-webinar.ts` | 176 | 僅其測試 | **owner 決定** | 常青研討會核心；設定 UI 與 action 已上線但核心未接線，可能是半成品 |
| 15 | `src/lib/interaction-card-media.ts` | 12 | 僅 `interaction-card-timeline.test.ts` | **owner 決定** | 卡片時間軸的媒體觀察函式；先確認時間軸功能是否上線 |
| 16 | `src/lib/cloudflare-webhook-fixtures.ts` | 89 | `scripts/cloudflare-webhook-fixtures.ts`、route 測試 | **保留** | 測試／腳本支援，非死碼。建議移到 `tests/support/` 避免誤被正式程式 import |
| 17 | `src/lib/staging-qa-finance-bootstrap.ts` | 102 | 6 支 `scripts/*`（`bootstrap-staging-qa-finance.ts`、`f2-issued-pending-state.ts`、`q1-*`） | **保留** | 腳本支援；日後隨 q1 runner 封存 |
| 18 | `src/lib/payment-providers/payuni-fixtures.ts` | 82 | `scripts/external-smoke.ts`、`scripts/payuni-webhook-fixtures.ts`、`payuni.test.ts`、`wp4-buyer-ops.db.test.ts`、`tests/subscription-recovery/*` | **保留** | 測試支援。注意此檔放在 `src/lib` 底下：若有人從正式程式 import 會被編入 bundle。也是 B08-02 修 fixture 時的落腳處 |
| 19 | `src/app/api/admin/ops/payuni/test-support/recovery-boundary.ts` | 37 | 6 個 ops route 測試 | **保留** | 測試輔助（`registerRecoveryBoundaryTests`），不在 route 圖裡；隨 B10-01 處理 |

統計：直接刪除 9 個檔案（#1–#9，約 490 行）、帳務相鄰 2 個（#10 與 #11，約 40 行，需 reviewer 先看）、owner 決定 4 個（#12–#15，約 400 行）、保留 4 個（#16–#19）。表中 #10 為兩個檔案合併成一列。

另外 04 號文件列的其他死碼候選：`src/lib/ai-funnel-assistant.ts` 的 3 組重複 export、17 組重複 export 別名，以及 madge 的循環依賴 `funnel-page-document-renderer` ⇄ `funnel-survey`，不屬本審查範圍，未重複處理。

---

## 4. Worktree 與分支

### 4.1 盤點（`git worktree list` 的 9 個）

比對基準：`origin/master` `78621ca3`。「ahead／behind」是該分支相對 `origin/master` 的領先與落後提交數；「patch 重複」是 `git cherry` 的結果（`+` 為 master 內沒有等價 patch、`-` 為已有等價 patch）。

| # | 路徑 | 分支 | HEAD | ahead／behind | 已進 master？ | 未提交變更（`status --porcelain`） | node_modules | archive tag 備份 | 處置建議 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `C:/Users/eden/Downloads/AI/CelebrateDeal` | `codex/goal-review-2026q4` | `78621ca3` | 0／0 | 是（`--is-ancestor` 通過） | 6 項（本輪審查文件，未追蹤） | 實體目錄（唯一主要副本） | 不適用 | **保留**（目前工作目錄；不要動 `node_modules`） |
| 2 | `~/.codex/worktrees/celebratedeal-browser-phase-diagnostic-20260926` | `codex/staging-release-20260926` | `29ba9f6a` | 13／93 | 否（1 個 `+`） | `?? .run-receipts/`（99 KB，22 個檔案，已在 wip tag） | 無 | `archive/branch/…` ＝ HEAD；`archive/wip/…-20261017` 含 `.run-receipts` | **可移除**。但 `docs/launch/CURRENT.md` 把 `29ba9f6a` 列為 staging 回復點，tag 已保存該 commit；請 owner 確認不再需要以工作樹形式保留 |
| 3 | `~/.codex/worktrees/remaining-post-purchase-commerce/CelebrateDeal` | `codex/post-purchase-commerce-20261007` | `cb21db70` | 26／52 | 否（22 個 `+`；handoff 記載只移植 5 個功能 commit 到 #423，後段沙盒工具已由 #407–#422 取代） | 無（乾淨） | 實體目錄 | `archive/local/…` ＝ HEAD；`archive/branch/…` 指向 `1300f62d`（遠端舊 tip） | **可移除** |
| 4 | `~/.codex/worktrees/remaining-server-tracking/CelebrateDeal` | `codex/server-tracking-webhooks-20261007` | `831a2bf2` | 8／53 | 否（7 個 `+`，由 #424、#429 取代） | 3 個未追蹤收據 JSON（已在 wip tag） | 實體目錄 | `archive/branch/…` ＝ HEAD；`archive/wip/…` 含 3 個 JSON | **可移除** |
| 5 | `~/Documents/Codex/2026-10-05/new-chat/work/CelebrateDeal` | `codex/notifications-main-20261011` | `da2de930` | 39／21 | 否（34 個 `+`；內容由 #431 取代） | 6 個未追蹤收據 JSON（已在 wip tag `a715746b`） | 實體目錄 | `archive/branch/…` 指向 `c1b694ce`（是 HEAD 的祖先，但 **HEAD `da2de930` 這個本機 merge commit 沒有被任何 tag 包含**） | **需 owner 確認**：移除前先補 tag（見 §4.3 步驟 0）。內容已被 #431 取代，風險低 |
| 6 | `~/Documents/Codex/2026-10-05/new-chat/work/CelebrateDeal-course` | `codex/remaining-affiliate-commission-policy-20261006` | `f3e65b97` | 2／65 | 否（1 個 `+`：`aff82f77 feat: freeze tiered merchant affiliate commission and refund accounting`） | 3 項：`M docs/codex-goal/PRISMA_INVARIANTS.md`、`M docs/remaining-capabilities-f2.2-…json`、`?? docs/remaining-capabilities-f2.1-…json`（皆在 wip tag） | 實體目錄 | `archive/branch/…` ＝ HEAD；`archive/wip/…` 含三項 | **需 owner 確認**：這是 commission／退款帳務的功能 commit，handoff 沒有明確說明被誰取代（master 已有 `affiliate-tier-policy.ts`、`merchant-affiliate-policy`，疑似已吸收）。請 `reviewer` 比對後再移除；tag 已保存，物理移除本身可逆 |
| 7 | `C:/Users/eden/Downloads/AI/CelebrateDeal-staging-migration-apply-gate` | `codex/staging-migration-apply-gate` | `60132971` | 553／284（合併基底為 2026-07-19，歷史已分岔） | 否（545 個 `+`，但 4 個暫存的檔案在 master 已存在：`staging-migration-apply.yml`、`scripts/staging-migration-apply.mjs` 等） | 4 項已暫存新增（`A`，皆在 wip tag） | 無 | `archive/local/…` ＝ HEAD；`archive/wip/…` 含 4 項 | **可移除**（已被 master 的 staging migration 流程取代，#430） |
| 8 | `C:/Users/eden/Downloads/AI/CelebrateDeal-wp4-secure-runner-cbae30af` | `codex/wp4-secure-runner-cbae30af` | `cf33299a` | 1／266 | 內容已進（`git cherry` 為 `-`，patch 等價） | `?? node_modules.incomplete-20260902/`（**880 MB** 的未完成安裝殘渣，不在任何 tag） | **指向不存在目標的 SymbolicLink**（`…\CelebrateDeal-wp4-exact-004ac887\node_modules`） | `archive/local/…` ＝ HEAD | **可移除**。需先拆 symlink；`node_modules.incomplete-*` 是垃圾，但移除需要 `--force`，請 owner 同意 |
| 9 | `C:/Users/eden/Downloads/AI/CelebrateDeal-wt-wp10` | `codex/audit-wp10-admin-mfa` | `78564ddc` | 3／11 | 否（2 個 `+`） | 無（乾淨） | 實體目錄 | 無（遠端分支存在，PR #436） | **保留**：這是 B02-01（平台 admin 無 MFA）的修復 PR，需 rebase 後合併（見 `21-open-prs.md`）。合併後再移除 |

補充事實：
- 82 個本機 `archive/*` tag 與 `git ls-remote --tags origin 'refs/tags/archive/*'` 的 82 個一致，全部已推送；其中 `archive/wip/*` 25 個。
- 本機 `master` 分支（`efb8b7e9`）已落後 `origin/master` 數十個提交；任何「是否已合併」的檢查都不應使用本機 `master`。
- `~/.codex/worktrees` 底下有 26 個目錄，只有 #2、#3、#4 是已登記 worktree；其餘 23 個（如 `product-audit-goal-plan`、`q1-original-refund-proof`、`tracking-ci-diagnosis`…）`git worktree list` 看不到。handoff 說這些 worktree 的未提交內容已做成 `archive/wip/*` tag，但目錄本身是否還有獨立內容，本次未逐一檢查（不在唯讀 git 指令範圍內）。請 owner 確認後再處理。

### 4.2 Windows junction 事故的重點

`docs/handoff-codex-to-claude-20261017.md`「事故」段：移除 Codex worktree 時，指向主目錄 `node_modules` 的 NTFS junction 被 git 一併清空了目標內容，事後以 `npm ci` 重裝。本次檢查結果：7 個次要 worktree 中，6 個的 `node_modules` 是**獨立的實體目錄**（`LinkType` 為空），1 個（#8）是**指向不存在目標的 SymbolicLink**，目前沒有任何 worktree 的 `node_modules` 指向主目錄。仍然要先確認，因為狀況可能隨時間改變。

### 4.3 安全移除步驟（每個 worktree 都做一次）

0. **補備份（僅 #5）**：`git tag archive/local/codex/notifications-main-20261011-da2de930 da2de930` 然後推送該 tag。其他 worktree 的 HEAD 都已被 tag 涵蓋。
1. **確認乾淨或已備份**：`git -C <path> status --porcelain`；有未提交內容就對照 §4.1 的 wip tag。tag 是 2026-10-17 的快照，之後若又改過檔案要重新比對（用 `git -C <path> diff` 與 `git show <tag>:<file>`）。
2. **確認備份在遠端**：`git ls-remote --tags origin 'refs/tags/archive/*'`。
3. **檢查 `node_modules` 型態**（PowerShell）：`Get-Item <path>\node_modules -Force | Select-Object LinkType, Target`。
   - `LinkType` 為空（實體目錄）：可由 `git worktree remove` 一併刪除。
   - `Junction` 或 `SymbolicLink`：**先只拆連結本身**——`cmd /c rmdir "<path>\node_modules"`（不加 `/s`，只移除連結不碰目標），再確認主目錄 `Test-Path C:\Users\eden\Downloads\AI\CelebrateDeal\node_modules` 仍存在。**不要**對連結使用 `Remove-Item -Recurse`，也不要讓 `git worktree remove` 去處理它。
4. 執行 `git worktree remove <path>`。若因未追蹤垃圾（#2 的 `.run-receipts`、#8 的 `node_modules.incomplete-*`）被拒絕，只有在確認它們已在 tag 內或是垃圾、且 owner 同意之後，才使用 `--force`（AGENTS.md 禁止丟棄不明變更）。
5. `git worktree prune`；`git worktree list` 驗證。
6. 本機分支（如 `codex/staging-release-20260926`）的刪除另行決定；因為有 tag，可用 `git branch -D`，但不要在同一步驟做。
7. 所有 git 寫入（`tag`、`worktree remove`、`prune`、`branch -D`）由主對話執行並親自檢查；本審查沒有執行任何一項。

建議順序：#7（無 node_modules）→ #2 → #3 → #4 → #8（需拆 symlink）→ #5（補 tag 後）→ #6（owner 確認後）；#9 等 #436 合併後再處理。

---

## 5. 文件殘留

### 5.1 第一批可封存的檔案（建議 `git mv` 到 `reports/archive/2026/`，不刪除）

數量以 `git ls-files`（master）計算，已扣除 §5.2 的釘住檔案。

| 路徑模式 | 總數 | 扣除釘住後 | 備註 |
|---|---:|---:|---|
| `docs/ai-team/evidence/**` | 1,376 | **1,327** | 扣除 CI 釘住 26 個與「歷史 runner 專用」23 個（23 個隨 B10-09 的 scripts 一起搬）。518 張 PNG 是最大的磁碟占用，可考慮不入封存（git 歷史保留） |
| `docs/remaining-capabilities-*.json` | 255 | **254** | 扣除 `…-q2-review-fixes-20261007.json`（CI 瀏覽器 gate 讀取） |
| `docs/remaining-capabilities-session-handoff-20261006.md` | 1 | 1 | 另一份 `…-work-matrix-20261005.md` 被 `domain-workflows.md` 引用，**保留**（或改名並更新引用） |
| `docs/branch-integration-*`（json 82、md 6、patch 3） | 91 | **91** | 3 個 `.patch` 先確認內容已進 master |
| `docs/launch/` 歷史快照、舊 Goal 計畫與收據 | 約 35 | **約 29** | 保留 `CURRENT.md`、`NEXT-CYCLE.md`、`local-database-development.md`、10 份 runbook、被釘住的契約 JSON 等 |
| `docs/ai-team/*.md`（`LINE-OA-CLOSURE-DELIVERY…`、`master-execution-plan`、`master-planning-input`） | 3 | 3 | |
| 根目錄歷史報告（`release-readiness-audit-2026-07-21/22`、`staging-validation-report-2026-07-21`、`staging-backup-restore-drill-2026-07-22`、`external-service-validation-report`、`report-1`、`report-2`、`agy-claude-transport-repair-20261006.json`、`sharp-security-patch-20261007.json`、…） | 10 | 10 | |
| `docs/codex-goal/` 的 10 份歷史快照 | 10 | 10 | 見 §5.3 |
| 合計 | | **約 1,725（91.5% of 1,885）** | |

不封存、但建議搬位置：`docs/codex_review/`（26）與 `docs/bombmy_analysis/`（20）→ `docs/research/`；13 份根目錄 runbook／SOP → `docs/runbooks/`（連結要更新，且 `ai-team-payuni-sandbox-qa.md` 內容引用已刪除的 AI Team，需改寫改名）。

### 5.2 必須先改引用的 43 個檔案（被測試或 CI 以固定路徑讀取）

02 號文件估 22 個；本次逐一核對 `scripts/readiness-truth-reconciliation.mjs`（CI 步驟「Readiness truth reconciliation」）會對快照 provenance 的 27 個 `docs/` 路徑逐一 `existsSync`，把釘住檔案數修正為 **43**。

**A 組：被測試直接讀取（12 個；搬動會讓 `test:contracts` 或 `test:release-readiness` 變紅）**

| 檔案 | 讀取者 |
|---|---|
| `docs/codex-goal/API_CONTRACT_REGISTRY.md` | `scripts/api-contract-registry.test.ts:6` |
| `docs/codex-goal/PRISMA_INVARIANTS.md` | `scripts/prisma-invariant-inventory.test.ts:7` |
| `docs/ai-team/evidence/release-evidence-bundle-current-status-20260821.json` | `scripts/current-release-gate-handoff.test.mjs` |
| `docs/launch/current-release-gate-handoff-20260821.md` | 同上 |
| `docs/launch/cat10-policy-review-matrix-20260821.md` | 同上 |
| `docs/launch/solo-founder-launch-score.json` | `scripts/solo-founder-launch-score-report.test.mjs` |
| `docs/launch/wp122-merchant-onboarding-contract.json` | `scripts/wp122-merchant-onboarding-validator.test.mjs`、`cat10-operational-source-attribution.test.ts` |
| `docs/launch/wp123-observability-rehearsal-contract.json` | `scripts/wp123-observability-rehearsal.test.mjs` |
| `docs/launch/wp125-build-failure-classification-contract.json` | `scripts/wp125-build-failure-classifier.test.mjs` |
| `docs/launch/wp126-build-boundary-audit-contract.json` | `scripts/wp126-build-boundary-auditor.test.mjs`、`…-audit-runner.test.mjs` |
| `docs/launch/wp195-launch-owner-acceptance-contract.json` | `scripts/cat10-operational-source-attribution.test.ts` |
| `docs/launch/current-function-scorecard-20260809.json` | `scripts/g7-function-scorecard-reconciliation.test.mjs:9`（路徑以 `path.join` 動態組成，字串搜尋找不到，容易漏） |

**B 組：被 `readiness-truth-reconciliation.mjs` 檢查存在性與 SHA（30 個）**

- `docs/launch/current-readiness-snapshot-20260802.json`、`.md`、`current-readiness-provenance-manifest.json`（3 個，另被 `wp159/160/161` 腳本讀取）。
- 快照 provenance 的 27 個 `docs/` 路徑：`docs/ai-team/evidence/` 下 25 個（`cat06-closure-20260807.md`、`cat10-closure-20260807.md`、`g7-23-live-reminder-reconciliation-20260809.md`、`g7-48/48b/49/49b/50/51/51b` 共 7 個、`wp-88/89/91/92/110/116/122/123/131/148/175/187/191/192/195` 共 15 個），加上 `docs/launch/production-readiness-baseline.md`、`docs/launch/wp08-product-browser-qa-20260728.md`。

**C 組：被 CI 瀏覽器 gate 讀取（1 個）**：`docs/remaining-capabilities-q2-review-fixes-20261007.json`（`scripts/subscription-recovery-disposable-qa.mjs:11`）。

**D 組：只被歷史 runner 引用（非 CI，但搬動後這些 runner 會壞）**：`docs/ai-team/evidence/` 下 23 個（`fin-08u…`、`wp-124/125/126/130/135–143/155/156/158–162/165/166`）、`docs/launch/wp175-sales-to-support-operational-contract.json`、`docs/launch/local-database-development.md`（由 `scripts/local-database-safety.ts` 提及，屬現行 runbook，保留）。處理方式：D 組隨 B10-09 的 scripts 一起封存。

建議做法：
1. 判斷 B 組（2026-08-02 快照）是否退役。快照自稱是「唯一 current readiness truth surface」，但已被 CURRENT.md 與之後的審查取代（02 號文件 §2.2）。若退役：從 `ci.yml` 移除「Readiness truth reconciliation」步驟，B 組 30 個檔案即可封存（連同 `readiness-truth-reconciliation.mjs`、`wp159/160/161`）。
2. A、C 組 13 個檔案搬到 `scripts/fixtures/`（或 `docs/launch/fixtures/`），同一個 PR 修改讀取路徑。
3. 在拋棄式 worktree 內先做 `git mv`，再跑 `npm run test:contracts`、`npm run test:release-readiness`、`node scripts/readiness-truth-reconciliation.mjs` 與 `npx vitest run scripts/api-contract-registry.test.ts scripts/prisma-invariant-inventory.test.ts`，全部綠燈才合併。
4. 移動時在 PR 描述附 `git grep -l "<舊路徑>"` 為零的證明。

### 5.3 `docs/codex-goal/*`

| 檔案 | 處置 | 理由 |
|---|---|---|
| `PRISMA_INVARIANTS.md` | **重寫（保留路徑）** | 被 `prisma-invariant-inventory.test.ts` 釘住，AGENTS.md 要求新增 model／migration 時登記；現況表正確（148 models、108 migrations），但檔頭有兩行互相矛盾的 blockquote、重複段落與過時數字（B04-23）。整理成「現況表＋歷史附錄」 |
| `API_CONTRACT_REGISTRY.md` | **更新檔頭（保留路徑）** | 被 `api-contract-registry.test.ts` 釘住；檔頭日期（2026-08-25）與基準 revision（`9cd7473`）過期，內文持續被 PR 追加（最近 2026-10-19） |
| `AUTHORIZATION_MATRIX.md`、`DECISIONS_NEEDED.md`、`MANUAL_ACTIONS.md` | **抽取仍有效內容後歸檔** | 沒有被腳本引用；內容部分仍相關（權限矩陣、待決策、人工操作）。抽取到 `docs/decisions/` 或 `docs/domain-workflows.md`，再歸檔原檔 |
| `ARCHITECTURE_BOUNDARIES.md`、`ARTIFACT_INDEX.md`、`CODE_REVIEW_REPORT.md`、`PROGRESS.md`、`QA_REPORT.md`、`QUALITY_SCORECARD.md`、`REQUIREMENTS_TRACEABILITY.md` | **歸檔** | 2026-07-25 至 08-13 的狀態快照，無腳本引用；`PROGRESS`、`QUALITY_SCORECARD` 的現況敘述已與 master 矛盾（51 models／9 migrations 對 148／108） |
| 本機被 gitignore 的 8 份（`CELEBRATEDEAL_PLAN`、`GOAL_RUNBOOK`、`GOAL_*_PROMPT`×3、`COMMAND_LOG`、`README`、`REPOSITORY_HYGIENE`） | **本機刪除** | clone 後不存在，是 `DOCUMENT_AUTHORITY.md` 與 `README.md` 的死連結目標 |
| `docs/DOCUMENT_AUTHORITY.md` | **改寫**（02 號文件附錄 A 已有草稿） | 目前第一順位指向過期快照 |

### 5.4 舊 AI Team 引用（133 個 scripts）

分類（`git grep -l -E '\.ai-team|\.agents/skills|\.codex/agents' -- scripts`）：133 個檔案全部是 `.ai-team`（`.agents/skills`、`.codex/agents` 在 scripts 內為 0 筆）。

| 類別 | 檔數 | 狀態 |
|---|---:|---|
| 寫入 `.ai-team/reports/` 收據 | 66 | 能執行（`mkdir -p`）；輸出被 `.gitignore:54-57` 排除 |
| 讀取舊收據 | 8＋1（讀寫皆有） | 單獨執行會因缺檔而壞：`fin08r-staging-payuni-reconciliation-runner.mjs`、`fin08w-preview-marker-recovery.mjs`、`wp149/151/153-public-unavailable-browser-runner.mjs`、`wp158-local-server-readiness-diagnostic.mjs`、`wp159/160-…-contract.mjs`、`payuni-sandbox-payment-handoff.test.mjs`（TAP 測試，CI 內但會自己先寫入） |
| 只提到字串（路徑常數、禁止清單、測試範例） | 其餘約 57 | 無影響 |
| 其中測試檔 | 8 | 隨 `test:contracts` 執行，CI 綠燈 |

**仍被 CI 使用的 11 個**（`ci.yml` 直接呼叫）：

| 腳本 | CI 步驟 | 用法 | 是否壞掉 |
|---|---|---|---|
| `scripts/affiliate-portal-browser-qa.mjs:56` | Referral sharing database and browser gate | 把收據複製到 `.ai-team/reports/affiliate-portal-browser-receipt.json` | 否 |
| `scripts/build/controlled-production-build.mjs:10,201` | Controlled production preflight and build | 預設收據路徑，寫入前 `mkdir recursive` | 否 |
| `scripts/learner-notification-disposable-qa.mjs:749-751` | Learner notification database boundaries | `mkdirSync` 後寫收據 | 否 |
| `scripts/q1-original-refund-proof-disposable-qa.mjs:24-25` | Q1 original refund proof | 同上 | 否 |
| `scripts/q1-original-refund-target-disposable-qa.mjs:24-25` | Q1 original refund reservation | 同上 | 否 |
| `scripts/readiness-truth-reconciliation.mjs:24,96-98,126-128` | Readiness truth reconciliation | 對快照 provenance 內的 `.ai-team/reports/*` 字串做斷言；檔案存在才比對 SHA | 否（見 B10-11） |
| `scripts/subscription-recovery-disposable-qa.mjs:96-98` | Subscription recovery database and browser gate | 寫收據 | 否 |
| `scripts/tracking-settings-disposable-qa.mjs:92-94` | Tracking authoritative events… | 寫收據 | 否 |
| `scripts/validate-external-provider-evidence.test.mjs:31-38` | External provider evidence contract | 只是路徑正規化的測試範例字串 | 否 |
| `scripts/validate-staging-migration-evidence.test.mjs:50-93` | Staging migration receipt validation contract | 同上 | 否 |
| `scripts/validate-staging-release-evidence.test.mjs:53-95` | Staging release evidence receipt validation contract | 同上 | 否 |

`package.json` 的 39 個 script 沒有任何一個直接引用 `.ai-team`，也沒有指向不存在檔案的 script（已驗證）。

---

## 6. 建議的處理順序

1. **（0.5 天，建議封測前）** B10-01①：在 `src/proxy.ts` 為 `/api/admin/ops/**` 加上正式環境一律 404。需 `engineer-hard`＋一次獨立審查（動 proxy 與 JOB_SECRET 路徑）。
2. **（立即，零風險）** B10-05 本機空資料夾；§4 的 worktree #7、#2、#3、#4 依步驟移除；#5 補 tag。
3. **（0.5 天）** B10-06／B10-07：刪除 11 個死檔與對應測試，帳務相鄰兩個先請 `reviewer` 看。
4. **（2 天）** 建 `reports/archive/2026/`，搬 §5.1 的第一批，同時處理 B10-11 的 43 個釘住檔；`docs/DOCUMENT_AUTHORITY.md` 同 PR 改寫。
5. **（2–3 天，owner 同意後）** B10-02（WP4 fixture 移出正式 bundle）與 B10-09（155 個歷史 runner 封存）合併成一個大型清理，包含 B10-03。

需要 owner 決定的事項：
1. 正式環境是否仍需要 `test-email`／`test-analytics`／`test-monitoring`（B10-01）。
2. staging PayUni QA 是否還需要 `wp4-session` 與 fixture 帳號（B10-02）。
3. `ab-testing`、`ai-funnel-assistant`、`evergreen-webinar`、`interaction-card-media` 是否為路線圖功能（B10-08）。
4. 2026-08-02 readiness 快照是否退役（B10-11）。
5. commission policy 分支與 staging 回復點 `29ba9f6a` 是否可移除（§4.1 #6、#2），以及 23 個未登記的 `~/.codex/worktrees` 目錄。
6. 封存位置與是否保留 518 張 PNG（B10-10）。

---

## 7. 無法驗證與限制

- 沒有執行 `next build`，無法量測哪些殘留實際進入哪個 route 的 bundle；「在正式 bundle 內」是以「被 `src/app` 路由圖可達」判斷。
- worktree 的 wip tag 內容以「檔案路徑存在於 tag」判斷，沒有逐一比對內容是否與目前工作樹相同；tag 建立於 2026-10-17，之後若有新修改需另外比對（§4.3 步驟 1）。
- `~/.codex/worktrees` 的 23 個未登記目錄沒有進入檢查（超出本任務的唯讀範圍與 git 指令能力）。
- 釘住檔案以 `git grep` 的完整路徑字串、以及人工追蹤 `path.join` 動態路徑兩種方式搜尋；仍可能有以 `readdirSync` 掃整個資料夾的情況（本次在 `scripts/` 與 `tests/` 內未找到掃描 `docs/ai-team/evidence` 全目錄的測試，但 `g7-*-browser-qa.mjs` 系列把 `docs/ai-team/evidence` 設為輸出根目錄）。搬動前務必用「先搬再跑」的方式驗證。
- knip 不看動態 import 與字串路徑；#8 `funnel-templates.ts`、#12–#15 的「無入口」判定另以 `git grep` 補核對，但框架約定（Server Action、route）以外的動態引用仍可能存在。
- 28 條 ops 端點的守門描述來自讀取原始碼，沒有對任何環境發送請求。
