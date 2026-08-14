# FIN-2026-08-07-30 — PayUni 退款終態對帳頁閉環

## 發現與修正

本 WP 找到並修正一個真實的 finance P1：退款對帳頁的成功路徑把 Next.js `redirect()` 放在 `try/catch` 內。Next.js redirect 以 exception 結束 request，因此成功 reconciliation 會被 catch 再導向 `status=error`，使用者看不到成功結果。

同時，頁面原本對非 PayUni provider 仍可能顯示 PayUni Sandbox 操作按鈕；雖然 action 後端會拒絕，UI 與能力不一致。本 WP 改為非 PayUni transaction 直接顯示不可用狀態，不建立 provider query path。

## 產品變更

- `src/app/admin/billing/refund-reconciliation/[id]/page.tsx`
  - 將成功 redirect 移到 provider query／reconciliation `try/catch` 外。
  - 非 `payuni` provider fail closed，不顯示 Sandbox reconcile button。
- `src/app/admin/billing/refund-reconciliation/[id]/page.test.tsx`
  - 覆蓋 pending render、terminal idempotency、missing transaction、unsupported provider、id mismatch、成功 reconciliation、provider failure。

## 驗證證據

- Page suite：8/8 PASS。
- Finance targeted suite：6 files／97 tests，97 PASS、0 FAIL、0 SKIP。
- 本機 dev targeted run：95/97 PASS；2 個 payment webhook tests 因既有 local dev schema 缺少 `disputeCaseId` 而失敗，未採為 evidence，未修改本機 dev DB。
- Corrected disposable PostgreSQL：container `celebratedeal-func34b-disposable-test`，database `celebratedeal_test`，28 migrations applied，status up to date，finance targeted 6 files／97 tests 全 PASS，cleanup PASS，無 residual container。
- Corrected disposable full regression：Vitest 213 files／1490 tests 全 PASS；Node contracts 679/679 PASS。
- Disposable runner diagnostic：第一次 `func34` attempt 在 Prisma／Vitest safety preflight 因 PowerShell synthetic URL interpolation 造成 unsafe database parse 而未啟動測試；finally cleanup PASS，未分類為產品失敗。改用明確 `${...}` interpolation 的 `func34b` route 後才取得上述 PASS；`func34b` container 亦已清除。
- Target page coverage：statements 94.44%（34/36）、branches 87.80%（36/41）、functions 100%（4/4）、lines 94.11%（32/34）。
- Global coverage：statements 42.36%（13493/31846）、branches 48.07%（12517/26034）、functions 51.11%（2514/4918）、lines 61.68%（11573/18762）；既有 threshold 63／57／60／65，exit 1，分類 `FAIL_REMAINING_SOURCE_INVENTORY`。
- typecheck、scoped ESLint、full lint（0 errors／2 existing warnings）、secret scan、diff-check PASS。

## 分數與安全邊界

- canonical total：73.5，`current_goal_score_change=0`。
- CAT04：6.0；本 WP 只完成 local finance path，未產生新的 staging／PayUni Sandbox provider receipt，因此不預支 CAT04 分數。
- CAT10：4.5；真人 owner 與 external monitoring evidence 仍缺，AI 不代簽。
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- 未操作 Production、正式 DB、正式付款／退款、寄信、deployment、push、merge；未重試 FIN-08AA、WP-196、WP-197 或任何既有 terminal external command。

## 回滾

回滾範圍僅為本 WP 的 page source／test 與本 WP evidence metadata；沒有 migration、資料刪除或外部副作用。disposable container 已清除。
