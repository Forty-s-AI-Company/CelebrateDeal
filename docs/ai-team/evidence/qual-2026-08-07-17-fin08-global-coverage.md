# QUAL-2026-08-07-17：FIN-08 legacy reconciliation source attribution 與 global coverage

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GLOBAL_GATE_REMAINS_OPEN`

## 本輪完成

本輪選擇財務核心 `FIN-08` legacy reconciliation runner，補上不需要外部服務的 deterministic source attribution：

- Preview／marker／app／database／Supabase identity 的 fail-closed 邊界。
- receipt shape、attempt budget、forbidden side effect、replay 與 score drift rejection。
- PayUni HTTPS allowlist、redirect 與單次 query budget；provider fetch 只使用 local stub。
- OS-temp cleanup、child environment gate 與 sanitized output。
- fake read-only transaction 的 bounded candidate selection；沒有連 PostgreSQL。

沒有執行 `--execute-once`、staging、PayUni、Browser、Next server、正式服務或 Production；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 external command。

## 實際驗證

- `node --import tsx --test --experimental-test-coverage scripts/fin08-staging-payuni-reconciliation-runner.test.mjs`：`13/13 PASS`、0 failed、0 skipped。
- FIN-08 source-entry process coverage：lines `43.23% → 61.79%`、branches `84.42% → 66.67%`、functions `60.00% → 64.29%`。
- branch 百分比下降是因新增案例擴大 source inventory；沒有修改 threshold、exclude、skip 或 assertion。
- `npm run test:coverage`：Vitest `186 files / 1327 passed`；Node TAP `676/676 passed`；global command exit `1`，原因是既有 coverage gate 仍未達標。
- 最新 global coverage：statements `40.57%`、branches `46.40%`、functions `49.07%`、lines `60.98%`；門檻仍為 `63% / 57% / 60% / 65%`。
- scoped ESLint：PASS。
- `git diff --check`：PASS；只有 LF/CRLF normalization warning，沒有 whitespace error。

## 中途診斷與修正

補測初次執行時發現三個測試 fixture 問題，均已修正後重新通過：

1. 明確 `:443` 會被 Windows URL parser 正規化成空 port，測試改用非 default `8443`。
2. sanitized child receipt 合法保留固定 schema key 名稱，測試改為禁止值／credential-like material，而非禁止欄位名稱。
3. fake `$queryRaw` 回傳 `null` 不符合 Prisma array contract，測試改為合法空陣列。

沒有為了通過測試修改 production safety gate，也沒有把中途失敗標成 PASS。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。CAT04 仍缺新的 PayUni Sandbox/provider receipt 與 staging reconciliation；CAT10 仍缺真人商家、客服、法務／隱私／退款、財務、release owner 與 external monitoring acceptance。Goal 維持 `IN_PROGRESS`。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有外部 network、staging、PayUni、付款、退款、DB、Browser 或 Production 副作用；沒有降低 coverage gate 或資料驗證強度。
