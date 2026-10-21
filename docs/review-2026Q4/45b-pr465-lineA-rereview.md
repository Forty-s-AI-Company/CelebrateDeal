# PR #465 複審：Line A 封測閘門修正範圍

- 分支：`codex/beta-l1e-lineA-gates`，PR head 是 `ba7af926`。
- 複審範圍：`83481ff6`（B-1、m-2）、`37e733d0`（M-1、n-4）、`ba7af926`（m-4、m-6、n-2），也就是 `git diff 30252ae7..ba7af926`。
- 前次審查：`45-pr465-lineA-review.md`。
- 審查者：reviewer（Opus），只讀。沒有修改任何程式。

## 驗證

| 項目 | 結果 |
|---|---|
| 修正範圍的單元測試（`product-actions`、`api/payments/checkout`、`feature-gates.matrix`、`funnel-commerce-service`、`wp4-sandbox-fixture`、`vendor-beta-feature-actions`、`landing-page-service`、`checkout/[vendorId]/[productId]/page`、`(viewer)/live/[slug]/page`） | 9 個檔案、268 個測試全部通過 |
| `npx tsc --noEmit`，以及對修正範圍內的檔案跑 eslint | 都通過 |
| 斷言有沒有被放寬 | 在測試檔的 diff 裡找被刪除的行，**沒有刪掉任何 `expect`**。被刪的只有 mock 的寫法換掉，以及靜態矩陣裡的一條規則改成用 `database` 比對（對應 n-4）。`presenter-layout.db.test.ts` 只在 mock 的 vendor 補上 `browser_live` 授權，assertion 沒動 |
| CI `quality`（run 39646808377，head `ba7af926`） | **失敗**，見 B-1′ |

## 逐項結論

| 前次 ID | 狀態 | 依據 |
|---|---|---|
| B-1 | **未完全解決** → 見 B-1′ | `presenter-layout` 補授權後，unit 步驟已經通過；但 CI 在後面的步驟出現了另一個由本 PR 造成的失敗 |
| M-1 | 已解決 | 買家下單只有一個入口：`/api/payments/checkout`，主商品、加購、post-purchase 都經過這裡。主商品的查詢條件是 `vendorId = data.vendorId`，授權讀的是商品自己的 `product.vendor`（`include: { vendor: true }`），所以閘門在伺服器端、而且綁定租戶：route.ts:785 回 404 `FEATURE_DISABLED`。加購在同一家商家範圍內查詢，route.ts:796 回 409。結帳頁 page.tsx:62 回 notFound，用的是商品所屬商家的授權。漏斗商品清單用 `purchasableProductWhere(database, scope.vendorId)`；直播頁用 `live.vendor` 過濾。`mutateProduct` 只有在「既有商品（id 存在，而且商家範圍查詢找得到）而且存成下架」時才放行；新建或上架仍回 `course_feature_disabled`。**下架既有課程商品不會被擋。**偽造一個不存在的 id 會在 product-actions.ts:300 回 `not_found`，即使真的建出一筆未上架的課程商品，也無法上架或售出 |
| m-2 | 已解決 | WP4 夾具只在 `/api/admin/ops/payuni/wp4-fixture` 裡執行，這條路由要求 `JOB_SECRET`，而且只在 `VERCEL_ENV=preview` 且 `PAYUNI_ENV=sandbox` 時才開放，production 不會執行到。夾具只補上缺少的 `billing` 與 `funnel_binding` |
| m-4 | 已解決 | `docs/domain-workflows.md` 的公式已改成不扣佣金，並連到 runbook |
| m-6 | 部分解決，可以接受 | 寫入 `enabledFeatureModules` 時已加上舊值比對。audit 仍然在交易之外寫入，但這和既有 admin 操作的寫法一致，維持 MINOR，不阻擋合併 |
| n-2、n-4 | 已解決 | 不變量文件的敘述已修正；漏斗頁的諮詢閘門改用傳入的 `database` |
| m-3、m-5 | 已用文件處理 | 部署前盤點與「billing 關閉期間的帳單」已寫進 `PRISMA_INVARIANTS.md` |

## 新 findings

| ID | 等級 | 檔案:行號 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| B-1′ | BLOCKER | `tests/tracking/native-tracking-settings.browser.ts:41-42`（夾具）、`:222`（失敗的斷言）；原因在 `src/lib/vendor-feature-toggles.ts` 的 `isFeatureEnabled` 與 `src/lib/landing-page-service.ts:240` | CI 的「Tracking authoritative events database and browser gate」步驟失敗。`public published calendar books an actual slot…` 這個測試在第 222 行等日曆標題出現，30 秒後 timeout，重試仍失敗。原因：夾具商家有 `consultation_booking` 授權，但 `enabledFeatureModules` 用的是 Prisma 預設值，**預設值不含 `consultation_booking`**。`isFeatureEnabled` 要求授權和商家開關都打開，所以結果是關閉，`publicConsultationEvents` 回傳空陣列，漏斗頁上就沒有日曆。這是本 PR 造成的失敗：第一次 CI 停在更早的 unit 步驟，這一步當時沒有跑到。CI 遇到第一個失敗就停，**後面的步驟仍然沒有驗證過** | 在這個夾具建立商家時，`enabledFeatureModules` 要包含 `consultation_booking`（或改用 admin 授權那條會自動補開關的路徑），不要改任何斷言。然後讓 CI `quality` 從頭到尾完整跑綠；送審前也先把其他瀏覽器、e2e 夾具裡有諮詢功能的商家都對過一遍 |
| N-1 | NIT | `src/lib/team-funnel-pages.ts:475`、`src/lib/team-funnel-product-slots.ts:308` | 團隊漏斗等少數買家端畫面，在課程模組關閉時仍然會列出課程商品。因為唯一的下單入口已經擋住，不會收到款項，只是畫面上看得到、買的時候失敗 | 之後可以一併改用 `purchasableProductWhere` 過濾 |
| N-2 | NIT | `src/app/actions/product-actions.ts:439` | 課程模組關閉時，商家要「保持上架並修改內容」會被擋，只能先下架再改。這符合「擋上架」的原則，但 commit 訊息寫「仍可編輯」，不夠精確 | 在說明裡寫清楚：只能存成下架 |

## 結論

M-1 和其他前次 findings 都已正確修正：閘門在伺服器端、綁定商品所屬的租戶，既有課程商品可以下架，斷言沒有被放寬。但 CI `quality` 仍然因為本 PR 造成的夾具問題失敗（B-1′），而且後面的 CI 步驟還沒有驗證過。請修好夾具，讓 CI 完整跑綠後再送審。

需修正後再審
