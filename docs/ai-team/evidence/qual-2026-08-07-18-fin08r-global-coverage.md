# QUAL-2026-08-07-18：FIN-08R reconciliation source attribution 與 global coverage

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GLOBAL_GATE_REMAINS_OPEN`

## 本輪完成

本輪選擇財務核心 `FIN-08R` reconciliation runner，補上不需要外部服務的 deterministic source attribution：

- OS-temp 與 workspace marker 的 unsafe boundary。
- fake read-only candidate query 的空投影契約。
- sterile environment allowlist 與 child environment gate。
- 既有 Preview、marker、receipt 與 provider allowlist 邊界。

本輪只使用本機 fake fixture；沒有啟動 Next server、Browser、PostgreSQL、staging、PayUni 或 Production，也沒有重試 FIN-08AA、FIN-08AB、WP-196、WP-197 或既有失敗 external command。

## 實際驗證

- `node --import tsx --test --experimental-test-coverage scripts/fin08r-staging-payuni-reconciliation-runner.test.mjs`：`14/14 PASS`、0 failed、0 skipped。
- FIN-08R source-entry process coverage：lines `51.65% → 63.19%`、branches `91.49% → 66.20%`、functions `64.00% → 74.07%`。
- branch 百分比下降是因新增案例擴大 source inventory；沒有修改 threshold、exclude、skip 或 assertion。
- `npm run test:coverage`：Vitest `186 files / 1327 passed`；Node TAP `679/679 passed`；global command exit `1`，原因是既有 coverage gate 仍未達標。
- 最新 global coverage：statements `40.65%`、branches `46.46%`、functions `49.16%`、lines `61.08%`；門檻仍為 `63% / 57% / 60% / 65%`。
- scoped ESLint：PASS。
- `git diff --check`：PASS；只有 LF/CRLF normalization warning，沒有 whitespace error。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。CAT04 仍缺新的 PayUni Sandbox/provider receipt 與 staging reconciliation；CAT10 仍缺真人商家、客服、法務／隱私／退款、財務、release owner 與 external monitoring acceptance。Goal 維持 `IN_PROGRESS`。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有外部 network、staging、PayUni、付款、退款、DB、Browser 或 Production 副作用；沒有降低 coverage gate 或資料驗證強度。
