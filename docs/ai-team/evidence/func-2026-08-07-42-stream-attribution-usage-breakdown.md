# FUNC-2026-08-07-42｜Stream member／page attribution usage breakdown

## 結果

修正 billing usage page 只顯示 vendor aggregate、看不到 B 或推廣頁實際承擔多少 Stream 用量的產品缺口。現在財務使用者可看到本月 immutable `StreamUsageAllocationEntry` 的成員歸屬，以及 `StreamUsageLedgerEntry` 的推廣頁／直接播放歸屬；查詢仍綁定當前 vendor 與 finance authorization。

頁面同時明確說明：目前是可稽核的歸屬明細，商家 Stream 上限仍以 vendor aggregate enforce，這不代表每位成員已經有獨立額度或自動扣款。

## 實作範圍

- `src/app/(app)/billing/usage/page.tsx`
  - 依本月分組成員 allocation seconds。
  - 依本月分組推廣頁與直接播放 watch seconds。
  - 以 vendor-scoped membership／partner page lookup 顯示名稱；找不到名稱時保留 bounded identifier label。
  - 將秒數顯示為原始秒數與向上取整的分鐘參考，不改動 quota 計算來源。
- `src/app/(app)/billing/usage/page.test.tsx`
  - 覆蓋成員、推廣頁、直接播放三種明細，以及不誤稱獨立成員額度的產品文案。

## 驗證

- billing usage attribution regression：1 file／9 tests，9 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- 沒有 schema／migration 變更；沒有執行 migration。

## 分數與限制

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false；current Goal score change=0。
- per-member independent quota、payment method validation、overage auto-charge、通知、retry、grace 與停用政策仍未完成，本輪不宣稱完成。
- 最新 current-tree global coverage 沿用 QUAL-2026-08-07-30 的真實結果：statements／branches／functions／lines 42.53／48.19／51.34／61.86 對 63／57／60／65，exit 1 `FAIL_REMAINING_SOURCE_INVENTORY`；本輪沒有重新執行 coverage。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有 staging、PayUni、Production、部署、push 或 merge，也沒有重試 FIN-08AA、WP-196、WP-197。

下一步仍是產品功能：決定並實作 per-member／per-page quota 的資料模型與 fail-closed policy，再補通知／retry／grace／停用流程；不能只靠這張明細表宣稱 B16／B19 全部完成。
