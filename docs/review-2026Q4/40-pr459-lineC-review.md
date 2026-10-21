# PR #459 輕審：Line C UX（F-142 readiness、F-120 台幣格式、F-133 兩租戶 DB 測試、F-122 底部導覽、F-118 stepper、F-121／F-126／F-127／F-128）

- 分支：`codex/beta-l1c-lineC-ux`（14 個 commit，cc6385b7 至 7d9adf5f），worktree `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineC`
- 範圍：`git diff origin/master..HEAD`（已 `git fetch origin master`，origin/master＝8f5f9c5c），104 個檔案，+1283／-291
- 審查日期：2026-10-21
- 審查者：reviewer（Opus），只讀，未修改程式

## 本機驗證

| 項目 | 結果 |
|---|---|
| `npx vitest run` format-twd、api/readiness/route、live-stepper-form、dialog-focus、app-shell、globals-contrast、scripts/api-contract-registry | 7 檔、67 測試通過（另指定的 `affiliate-remuneration-format.test.ts` 不存在，未列入） |
| `npm run typecheck` | 通過（無錯誤輸出） |
| `npx eslint`（本 PR 新增或修改的 ts/tsx） | exit 0 |
| 4 個新 `*.db.test.*` | **未能在本機執行**：測試 DB `localhost:54329` 未啟動，14 個測試全部因連線失敗而失敗。以下只做靜態判讀，需以 CI `quality` 的 `test:coverage` 結果為準（審查時 CI 仍是 pending） |
| e2e | 未執行，以下只做靜態判讀 |

## 六個重點的判讀

1. **`/api/readiness` 授權與 PII**：沒有問題。`requireCronSecret` 走 `isAuthorizedBearer`，比對用 `timingSafeEqual`（`src/lib/api-security.ts:8-36`）。`JOB_SECRET` 不會被接受，測試也證明 401 發生在任何 DB 呼叫之前。回應只有 ISO 時間與筆數，標頭是 `no-store`，失敗時回 503 泛用訊息，`proxy.ts` 的 matcher 不會攔截。**查詢範圍與成本則有問題**，詳見 M-1、M-2。
2. **`formatTwd` 的金額語意**：維持不變。輸入仍是分，顯示時除以 100。負數顯示為 `-NT$`，0 顯示為 `NT$0`，四捨五入到 0 的負數不會出現 `-NT$0`，比舊的 Intl 行為更好。對絕對值做 half-expand 捨入，與舊版對稱。分潤（`formatAffiliateRemuneration`，仍保留 safe-integer 檢查）與加購優惠仍顯示 2 位小數。checkout、訂單、支援單原本顯示 2 位小數，現在改為整數；但買方金額在伺服器端已強制為整數元（`product-actions.ts:173`、`payuni-amount.ts:9`、`live-flash-sale.ts:50`、`post-purchase-product-policy.ts:41`），所以不會丟失資訊。所有變更都只影響顯示，沒有改到任何伺服器端金額計算。非 TWD 幣別的副作用見 m-1。
3. **4 個兩租戶 DB 測試**：確實有斷言隔離。頁面測試同時斷言 A 看得到自己的資料、看不到 B 的名稱，也反向切換 tenant 驗證一次。action 測試涵蓋：以 B 的 email 搜尋回傳空結果；用 B 的 bookingId 被拒，且兩個 tenant 的 CRM 都寫入 0 筆；用 B 的商品派券被拒；以專案範圍拒絕非成員。這些是行為測試，不是原始碼 `toContain`。但刪掉舊測試後，CSRF 與權限的接線失去覆蓋，見 M-3。
4. **底部導覽與抽屜對 e2e 的影響**：沒有發現衝突。導覽保留 `aria-label="行動版主要導覽"`，`app-shell.test` 與 `globals.css` 的 `:has()` 都依賴這個標籤。導覽加了 `lg:hidden`，桌機的 `getByRole` 會排除它。`getByRole("navigation", { name: "主要導覽" })` 雖然是子字串比對，但隱藏元素不會被選中。主要入口只從 `visibleGroups` 挑選，所以 accountant 測試對 `a[href="/lives"]`、`a[href="/products"]` 的 `toHaveCount(0)` 不受影響。抽屜只在開啟時渲染。帳務金絲雀：e2e 都 import 同一個 `formatCurrency` 產生預期字串，金額格式會跟著改；所有種子金額都不是 0，也沒有 e2e 寫死 `$` 字串。殘留的 `"$0"` 過濾見 n-1。
5. **stepper 在桌機的 DOM**：基本上不變。SSR 與桌機的 `compactStepper` 都是 false，所以不會渲染 `<select>`。8 顆步驟按鈕的結構不變，只把 class 換成 `hidden md:grid`。唯一新增的是一個 `md:hidden` 容器，裡面有 `<p role="status">第 N 步／共 8 步</p>`。它在桌機是 `display:none`，`getByRole("status")` 會排除；e2e 中未加 filter 的 `getByRole("status")` 都出現在 checkout 頁，不在 `/lives/new`。640–767px 這段寬度也改用下拉，符合 F-118 的設計。
6. **API registry 編號 85 重複**：需要修正，但不阻擋合併，見 n-2。`scripts/api-contract-registry.test.ts` 只比對 `METHOD path` 是否存在，不驗證編號。

## Findings

| 編號 | 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| M-1 | MAJOR | `src/app/api/readiness/route.ts:6`、`:49-50`（以及 email／line／learner／tracking 的 pending 條件） | **pending 的定義與各 worker 實際使用的狀態不一致，可能在 job 停擺時仍顯示健康，或在健康時誤報停擺。** 逐項說明：(a) webhook 真正待重試的是 `status="failed"` 且有 `nextRetryAt` 的事件，`"retrying"` 只是處理中的短暫 lease（`webhook-retry.ts:97-115、168-180`），所以 `webhookRetry.queueDepth` 看不到待重試的積壓。(b) email／LINE 的重試候選是 `["queued","failed"]`（`email-delivery.ts:351`、`line-notification.ts:203`），`failed` 沒被算進去。(c) learner notification 與 tracking 處理中的狀態是 `"processing"`，不是 `"sending"`（`learner-notification-outbox.ts:74`、`tracking-purchase-worker.ts`）。learner 的 processing 列「永不自動回收」，正是 readiness 最該看到的卡住狀態，現在卻完全看不到。(d) email 提醒會提前很多天以 `queued` 建立，`nextAttemptAt` 是未來時間（`email-delivery.ts:298`），`oldestPendingAt` 卻用 `createdAt`。照 runbook 第 14 節「超過排程間隔數倍即視為停擺」的判斷方式，健康環境也會一直誤報。 | 每個 job 分開定義兩組指標。**due**：重試候選狀態且 `nextAttemptAt`（webhook 用 `nextRetryAt`）`<= now`，回傳筆數與 `min(nextAttemptAt)` 作為 `oldestDueAt`。**inFlight**：`sending`／`processing`／`retrying`，回傳筆數，並另外計算 `claimedAt`／`updatedAt` 超過 lease 的 stale 筆數。這樣也能直接用到現有的 `[status, nextAttemptAt]` 索引。測試補上每個 model 實際傳入的 `where`。 |
| M-2 | MAJOR | `src/app/api/readiness/route.ts:38、43、48、53、58` | **最後成功時間的查詢會做全表掃描。** `_max(sentAt / processedAt / dispatchedAt / acceptedAt)` 沒有加任何 `where`，而 schema 中這 5 個欄位都沒有索引（EmailDelivery 只有 `[status,nextAttemptAt]`、`[vendorId,…]` 等）。PostgreSQL 只能 seq scan，每次呼叫就是 5 張持續成長的 append-only 表各掃一次。如果日後接上 uptime monitor 每分鐘輪詢，DB 負載與 serverless 延遲會隨資料量線性成長。這不符合「不會全表掃描」的驗收條件。 | 二選一：(1) 新增 forward-only migration，對 5 個成功時間欄位建立索引（大表需評估 `CREATE INDEX CONCURRENTLY`；依規定登記到 `PRISMA_INVARIANTS.md`，並另走 migration 審查）；(2) 不改 schema，改以有索引的條件近似。例如成功時間改取 `status` 為成功狀態、`nextAttemptAt`／`updatedAt` 落在最近時間窗內的資料，但要先確認能用到既有的複合索引。若本 PR 不想動 schema，可以先把 F-142 拆到獨立 PR。 |
| M-3 | MAJOR | `src/app/actions/customer-crm-actions.db.test.ts:12-22`、`src/app/actions/mobile-consultation-actions.db.test.ts:8-18`（刪除的 `customer-crm-actions.test.ts`、`mobile-consultation-actions.test.ts` 以及兩個 `page.test.tsx`） | **舊測試刪除後，CSRF、manager 權限與可編輯專案範圍的接線不再有任何斷言。** 舊的原始碼測試雖然粗糙，但確實守住了 `assertServerActionSecurity(formData)`、`requireVendorManagerContext()`、`requireEditableSalesProjectScope(...)` 以及「全部專案總覽為唯讀模式」的條件渲染。新測試把這幾個模組 mock 成固定成功、而且不是 `vi.fn`，所以就算有人移除 action 裡的 CSRF 檢查，或改呼叫不檢查可編輯性的 `getSalesProjectScope`，測試仍會通過。這違反 AGENTS.md「不降低 assertion」的規則，而且是 auth／租戶範圍的覆蓋。另外，「單一 transaction」的保證也只剩「驗證失敗時寫入 0 筆」能間接證明，沒有直接測試。 | 把 mock 改成 `vi.fn`，每個 mutation 測試加上斷言：`expect(assertServerActionSecurity).toHaveBeenCalledWith(form)`，以及 `requireEditableSalesProjectScope` 有被呼叫。各補一個「`assertServerActionSecurity` 拋錯時兩個 tenant 都寫入 0 筆」，以及「`requireEditableSalesProjectScope` 拋錯（aggregate 唯讀）時寫入 0 筆」的案例。大約 20 行。 |
| m-1 | MINOR | `src/lib/format.ts:21-22` | 非 TWD 幣別現在一律 `minimumFractionDigits: 2`。舊版沿用 Intl 依幣別決定的預設值，所以 JPY 原本顯示 `¥500`，現在會變成 `¥500.00`。`funnel-operations-service.ts:14` 允許 JPY，`checkout/result`、`support/orders` 等頁面也會帶入訂單的 currency。 | 沒指定 `fractionDigits` 時，不傳 min／max，交給 Intl 依幣別決定；或只在未指定時套用 `maximumFractionDigits: 2`。補一個 JPY 測試。 |
| m-2 | MINOR | `src/components/app-shell-mobile-nav.tsx:39、65` | 抽屜宣告 `aria-modal="true"`，但沒有 focus trap，Tab 可以移到背景頁面與底部導覽。另外 `pathname` 變更時（例如瀏覽器上一頁）抽屜不會自動關閉。 | 加上簡單的 Tab／Shift+Tab 循環，或對背景加 `inert`；用 `useEffect(() => close(), [pathname])` 在路由變更時關閉。 |
| n-1 | NIT | `tests/e2e/member-billing-*-direct-url.spec.ts`（invoice-detail:308、invoice-export:338、invoices:306、plans:288、settlements:389） | 金絲雀過濾的 `value !== "$0"` 已經過時，現在 0 會格式化成 `NT$0`。目前所有種子金額都不是 0，所以沒有實際影響；但日後如果新增 0 元欄位，會被當成金絲雀，導致「Dashboard 不得出現」的斷言誤判。 | 改成 `value !== formatCurrency(0)`。 |
| n-2 | NIT | `docs/codex-goal/API_CONTRACT_REGISTRY.md:121` | 新的 `GET /api/readiness` 使用編號 85，與 `:146` 的 `DELETE /api/admin/ops/payuni/wp4-session` 重複。master 上原本就有 61、65、78、79、80 重複，目前最大編號是 93。 | 本列改成 94。既有的重複另開一次文件整理處理，不在本 PR 範圍。 |
| n-3 | NIT | `src/components/live-stepper-form.tsx:153`、`:1134-1146` | 切換步驟時，`role="status" aria-live="polite"` 會朗讀「第 N 步」，同時焦點又移到新標題，螢幕閱讀器會念兩次。程式也直接對 React 管理的標題 `setAttribute("tabindex")`。 | 擇一保留，建議只保留聚焦；或直接在 StepPanel 的標題 JSX 寫上 `tabIndex={-1}`。 |
| n-4 | NIT | `src/app/actions/customer-crm-actions.db.test.ts`（第 2 個 it） | 測試把「A 可以用不屬於自己的 hash，在 A 名下建立 tag／note／CRM 列」固化成預期行為。由於 hash 有用 vendor 加鹽，不會跨租戶外洩；但在 legacy（無專案）模式下會產生孤兒資料。這是既有行為。 | 可以另開議題，評估在無專案模式下要求 hash 必須對應 A 已驗證的學員。 |

- BLOCKER：無。
- MAJOR：3 項。M-1、M-2 集中在 F-142 readiness，M-3 是 F-133 測試的 auth 覆蓋退化。
- 金流金額：本 PR 只改顯示格式，沒有伺服器端金額、checkout、退款或佣金計算的變更，沒有發現問題。
- 租戶邊界：新的 readiness 回傳的是全站彙總，不含任何 tenant 資訊；兩租戶測試的斷言是有效的。
- Migration：本 PR 沒有 schema 變更。如果 M-2 採方案 (1)，需要另外審查 migration。

需修正後再審（M-1、M-2、M-3 修完後，只需重審 `src/app/api/readiness/**` 與兩個 action 的 `*.db.test.ts`；若把 F-142 拆出本 PR，其餘部分只要修完 M-3 即可合併）。
