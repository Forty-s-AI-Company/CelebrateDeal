# PR #465 審查：封測模組伺服器端閘門、平台逐商家授權、月結不扣佣金（Line A）

- 分支：`codex/beta-l1e-lineA-gates`
- 審查範圍：`git diff origin/master..HEAD`。本機 worktree HEAD 是 `7629eaf6`；PR head 是 `30252ae7`，它多出的那個 merge commit 只帶進 #464（兩租戶夾具與 CI 設定），沒有修改本 PR 的檔案。
- 背景：B01-01、B01-02（`11-architecture.md`）、B03-08（`13-payments-finance.md`），以及 owner 決策 D-02、D-03 B、D-31 A、D-16。
- 審查者：reviewer（Opus），只讀。沒有修改任何程式。

## 我實際跑過的驗證

| 項目 | 結果 |
|---|---|
| 目標單元測試（`feature-gates.matrix`、`vendor-feature-toggles`、`vendor-beta-feature-actions`、`actions`、`payment-method-actions`、`live-quota-admission`、`landing-page-service`、`live-interaction-studio`、`(app)/layout`、`api/live-media`、`api/live-presenter`） | 11 個檔案、602 個測試全部通過 |
| `npx tsc --noEmit` | 通過 |
| 對本 PR 新增或修改的 `.ts/.tsx` 跑 eslint | 通過 |
| DB 測試（`feature-gates.db`、`settlement-affiliate-commission.db`、`settlement-carry-forward.db`） | **本機沒有跑成**：本機沒有可拋棄的 DB（`check-local-database` 回報 unavailable）。這幾個檔案在 CI 的 unit 步驟裡有跑，沒有出現在失敗清單中 |
| CI `quality`（run 39641143690，PR head） | **失敗**，見 B-1 |

## Findings

| ID | 等級 | 檔案:行號 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| B-1 | BLOCKER | `src/lib/presenter-layout.db.test.ts`（本 PR 沒有修改這個檔案）；閘門在 `src/app/api/live-presenter/route.ts:20` | CI `quality` 的「Unit tests and coverage thresholds」步驟失敗，3 個測試沒過：`restores portrait orientation…` 預期 200、實際 404；`rejects a stale layout save…` 和 `rolls back a new source…` 預期 500、實際 404。原因是這個 DB 測試的夾具商家沒有 `browser_live` 授權，請求在閘門就被擋成 404，後面要測的邏輯根本沒有執行。不能合併。 | 在該測試的夾具商家加上 `betaFeatureGrants: ["browser_live"]`，不要放寬 assertion。CI 在這一步失敗後，後面的步驟都沒有跑；請一併 grep 其他會打到封測模組、但夾具沒有授權的地方（`scripts/*-runner.mjs`、`scripts/secure-staging-line-notifications.mjs`、e2e），讓 CI 完整跑完一次再送審。 |
| M-1 | MAJOR | `src/app/checkout/[vendorId]/[productId]/page.tsx:39`、`src/app/api/payments/checkout/route.ts`（主商品與 `resolveCheckoutOrderBump`）、`src/app/actions/product-actions.ts:442`、`src/app/portal/[vendorSlug]/learn/[courseId]/page.tsx:29` | `courses` 關閉後，課程商品**還能結帳**，但學員打不開課程。情境：(a) 部署前就存在的有效課程商品；(b) 平台先開 `courses`，商家上架，之後平台關閉授權。買家照常用 `/checkout/{vendorId}/{productId}`、加購或漏斗付款，錢實際收進平台的 PayUni 帳戶；但交付的學員入口 `learn/[courseId]` 回 404，等於收了錢卻無法交付。另外，商家也**無法自行下架**：`mutateProduct` 對所有 `commerceDomain === "course"` 的編輯一律回 `course_feature_disabled`，連把 `isActive` 改成 false 都不行，也沒有其他能修改商品的路徑。 | (1) 結帳頁、`/api/payments/checkout`（主商品、加購、upsell）、直播商品綁定與漏斗商品清單：如果商品是課程，且 `isVendorFeatureEnabled(db, product.vendorId, "courses")` 為 false，就拒絕建立訂單（頁面回 notFound，API 回 404 或 409）。(2) `mutateProduct` 在模組關閉時仍允許「只下架」的編輯（`isActive=false`、其他欄位不變），只擋新建、上架與內容修改。(3) 補測試：模組關閉時課程商品無法結帳，而且可以下架。 |
| m-1 | MINOR（請 owner 知悉；不需要改程式） | `src/lib/payuni-credentials.ts:20`、`src/lib/payment-providers/payuni.ts:1182`、`src/app/checkout/[vendorId]/[productId]/page.tsx:39` | 第 (3) 點的結論：**買家付款進的不是商家自己的 PayUni**。所有買家結帳都用平台層級的 PayUni 憑證（從平台環境變數讀取），`paymentMode: "platform"`，也就是平台代收，月結時再撥給商家；這不是「平台墊付」。被綁定的那張卡是「平台服務付款方式」，用來向商家收平台費用；目前程式裡沒有任何路徑會對它扣款，只有綁定、撤銷與 live probe。直接結帳網址 `/checkout/{vendorId}/{productId}` 本來就不要求綁卡或專案已發布。所以 `funnel_binding` 關閉後「發布不再要求綁卡」，**沒有新增任何收款路徑**，也沒有讓平台先出錢，因此不列 MAJOR。但這代表封測期間，所有能發布付費漏斗的商家，買家款項都會進平台帳戶；依 D-16 封測期間不撥款，這些錢會由平台保管。這和 D-31 提到的「第三方支付登錄」法遵風險是同一件事。 | 在 `STATE.md` 或 `OWNER-ACTIONS.md` 寫清楚兩點：封測收款進平台 PayUni、平台保管到第一次撥款。如果 owner 只想讓封測客戶收款，另外開一個「收款」旗標（不屬於本 PR 範圍）。 |
| m-2 | MINOR | `src/lib/wp4-sandbox-fixture.ts:74`、`src/lib/platform-plan-checkout.ts:270` | WP4 PayUni Sandbox 夾具商家建立時沒有任何授權，所以 staging 上的 `/billing/plans` 與 `createPlatformPlanCheckout` 現在會回 404 或 `FEATURE_DISABLED`。T2／D-04 的 Sandbox 付款證據流程，在平台管理員手動授權之前都跑不起來。 | 在 runbook 加一步：staging 先到 `/admin/vendor-features` 為 WP4 商家開 `billing`；或讓夾具在 staging 建立時就帶 `billing` 授權（要有環境限制，不能影響 production）。 |
| m-3 | MINOR | `src/app/actions/consultation-actions.ts:184`、`src/app/portal/[vendorSlug]/calendar/[bookingId]/route.ts:20`、`src/app/api/live-media/route.ts:47` | 部署當下，既有商家已經在用的諮詢預約、課程、瀏覽器直播都會立刻關閉。資料不會被刪，但會有這些影響：買家手上的行事曆連結回 404；商家看不到也取消不了已經成立的預約（`editableManagementScope` 被擋）；來源是 `browser_live` 的已排程直播無法開播。這符合 D-02，但目前沒有任何部署前的盤點步驟。 | 部署前用唯讀查詢列出：有效的 `ConsultationEvent`、未來的預約、課程商品、`sourceType = "browser_live"` 的影片。逐一決定要授權給哪些商家或先通知商家，並寫進 runbook。 |
| m-4 | MINOR | `docs/domain-workflows.md:36` | 領域規則文件仍然寫著 `settlement payable = collected - refunds - fees - commissions + adjustments`，和 D-31 A 及本 PR 的新公式矛盾。之後的代理可能照這份文件把扣佣金加回去。 | 把公式改成「不扣佣金，`affiliateCommissionCents` 只回報不扣除」，並連到 `docs/operations/affiliate-commission-settlement-runbook.md`。 |
| m-5 | MINOR | `src/lib/billing-cycle-job.ts:92`、`src/app/actions/invoice-actions.ts:89` | `billing` 關閉時，月結排程仍然會開帳單，並把過期帳單標成 overdue。商家看不到也付不了（`payInvoiceAction` 被擋）。目前沒找到 overdue 會造成停權之類的後果，但之後開放 billing 時，商家會一次看到一堆逾期帳單。 | 二選一：排程跳過沒有 `billing` 授權的商家；或在 runbook 註明封測期間的帳單只是內部紀錄，開放前要先清理。 |
| m-6 | MINOR | `src/app/actions/vendor-beta-feature-actions.ts:47-62` | (a) 有比對 `betaFeatureGrants` 的舊值，但寫入 `enabledFeatureModules` 時沒有比對：如果商家同時在設定頁存檔，其中一方的修改會被覆蓋。(b) AuditLog 在 update 之後、交易之外才寫；如果寫稽核失敗，授權已經改了，卻沒有稽核紀錄。 | 把 `enabledFeatureModules` 的舊值也放進 `updateMany` 的 where 條件；update 和 audit 包進同一個 `$transaction`（如果 `writeAuditLog` 支援傳入 tx）。 |
| n-1 | NIT | `prisma/migrations/20261021171100_vendor_beta_feature_grants/migration.sql:14,19` | 其他 migration 都在 DO 區塊裡用 `PERFORM pg_catalog.set_config('lock_timeout','5s',true)`，這裡用的是 `SET LOCAL`。在 Prisma 的單一交易裡兩者效果相同，只是寫法不一致。CHECK 沒有加 `NOT VALID`，會在 ACCESS EXCLUSIVE 鎖下掃一遍 Vendor 表；Vendor 表很小，而且所有列都是空陣列，安全。 | 可以改成和既有 migration 一致的寫法。 |
| n-2 | NIT | `docs/codex-goal/PRISMA_INVARIANTS.md`（新段落第二點） | 文件寫「`parseVendorFeatureModules` 不接受封測模組」，但它其實接受 `consultation_booking`（這個模組同時是商家開關）。實際上沒有風險，因為仍然需要平台授權；只是敘述不精確。 | 改成「除了 `consultation_booking` 之外不接受；`consultation_booking` 寫入後仍需平台授權才生效」。 |
| n-3 | NIT | `src/app/admin/vendor-features/page.tsx:18-23` | 頁面只列前 100 家商家，也沒有分頁；第 101 家之後只能用搜尋找到。 | 加上分頁，或註明要用搜尋。 |
| n-4 | NIT | `src/lib/landing-page-service.ts:240` | `publicConsultationEvents` 收到的參數是 `database`，閘門卻改用 `getDb()` 查詢。 | 改用傳進來的 `database`。 |
| n-5 | NIT | `src/app/api/live-danmaku/route.ts:40` | 觀眾端在檢查觀眾 session 之前就先回 404，所以「商家存在且開了模組」（401）和「商家不存在或模組關閉」（404）的回應不同。vendorId 無法列舉，實際影響可以忽略。 | 可以不改。 |

## 逐點結論

1. **`betaFeatureGrants` 寫入權限：通過。** 整個程式碼裡唯一寫入這個欄位的地方是 `updateVendorBetaFeatureGrantsAction`。它會先檢查 CSRF，再呼叫 `requireFinanceAdmin`（必須是平台管理員、已綁 MFA、而且這次登入已通過 MFA 驗證），和其他 admin 操作的防護一致；沒有另外加 `requireRecentMfa`，這也和現有 admin 操作相同。輸入只接受白名單、vendorId 有格式檢查、寫入時比對舊值、有寫稽核（m-6 是小瑕疵）。商家的 `updateVendorFeaturesAction` 只寫 `enabledFeatureModules`。預設值 `ARRAY[]::TEXT[]` 加上 CHECK 白名單，對既有商家安全，等於全部關閉，符合 D-02。讀不到或格式不對的值一律視為關閉。`prisma/seed.ts` 有 `assertLocalTestDatabase` 保護。
2. **六個模組的入口覆蓋：除了 M-1 都完整。** 我用 grep 對照 `01-system-map.md`：billing 的 5 個頁面、匯出、`payInvoiceAction`、方案結帳（`/api/billing/plans/select` 與 `selectBillingPlanAction` 都會經過 `createPlatformPlanCheckout`）；綁卡頁與 2 個 action（State 版會轉呼叫同一個 action）；諮詢的 2 個頁面、5 個管理 action（都經過 `editableManagementScope`）、時段查詢、公開預約、行事曆 route、漏斗頁內的預約事件；課程的 2 個後台頁、2 個 action、商品寫入、學員端 3 個頁面與 7 個 route；`presenter` 頁、`live-presenter`、`live-media`（停止播放仍可執行）；彈幕的 2 個 route 與工作室的開關。刻意不擋的有三個：電子發票（買家發票，不屬於平台 billing）、PayUni 綁卡回呼（有供應商簽章）、月結排程（見 m-5）。關閉時頁面一律回 404、route 回 404 JSON；不存在的商家也當作「關閉」處理，所以不會洩漏商家是否存在；不會刪除任何資料。
3. **`funnel_binding` 關閉後發布不再要求綁卡：不列 MAJOR，理由見 m-1。** 收款走的是平台的 PayUni（平台代收），不是商家自己的 PayUni，也不是平台墊付。被綁定的卡從來不會被扣款，直接結帳網址本來也不檢查綁卡，所以這個 PR 沒有打開新的收款路徑。真正的金流風險在 M-1：課程關閉後仍可收款。
4. **月結：通過。** platform 模式下，撥款金額 ＝ 營收（已扣退款）− 金流手續費 − 平台手續費 ＋ 前期結轉。`affiliateCommissionCents` 只放在計算結果裡回傳：`generateSettlementForVendor` 寫入時是逐欄列出，沒有存這個值，也沒有拿它來扣款。新增的 DB 測試覆蓋了有佣金的月份和跨租戶互不影響；結轉測試的預期值改成 −10,000，與 runbook 一致。已鎖定的月份不會重算。`docs/domain-workflows.md` 的公式需要同步修改（m-4）。
5. **測試夾具的授權：不會在 production 生效。** 所有新加的授權只出現在 `tests/`、`scripts/*-disposable*` 與 seed，而 seed 有 local-only 保護。正式程式碼裡沒有其他寫入授權的路徑。反過來，staging 夾具沒有授權會讓既有流程跑不起來（m-2、B-1）。
6. **測試與閘門數量：** 靜態矩陣用固定的出現次數鎖住每個入口；我對過，數字和實際程式碼一致。模組 × 入口矩陣在開與關兩種狀態都有斷言「後面的程式有沒有被執行」，可信。缺口有兩個：沒有「課程商品結帳」的案例（M-1）；`presenter-layout.db.test.ts` 沒有跟著補授權，導致 CI 失敗（B-1）。

## 結論

本 PR 有 1 個 BLOCKER（CI 失敗）和 1 個 MAJOR（課程關閉後仍可收款，商家也無法下架）。兩項修正後，請讓 CI `quality` 完整跑綠，再送一次審查。

需修正後再審
