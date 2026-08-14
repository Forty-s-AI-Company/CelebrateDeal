# QUAL-2026-08-07-16：FIN-08T deterministic reconciliation source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

本輪只補 `FIN-08T` staging／PayUni reconciliation runner 的 deterministic source attribution，沒有執行 `--execute-once`、`--coordinator`、live child、staging、資料庫、PayUni、Browser、Next server 或 Production。新增測試涵蓋：

- canonical JSON ordering、receipt digest 與 sterile environment projection。
- 兩次 bounded isolation child probe，確認 target environment binding 為零且 child/coordinator exit code 為 0。
- inspect JSON、identity、database、Supabase、app URL 與 production classification 的 fail-closed 邊界。
- receipt 對 dotenv read、values persisted、isolation、score claim、provider query、refund、replay audit write 與敏感 provider 值的拒絕。
- provider transaction projection、HTTPS PayUni allowlist、單次 provider attempt、redirect rejection 與 idempotent cleanup。

## 實際驗證

- `node --import tsx --test --experimental-test-coverage scripts/fin08t-staging-payuni-reconciliation-runner.test.mjs`：`9/9 PASS`、0 failed、0 skipped。
- FIN-08T source-entry process coverage：lines `78.50%`、branches `83.00%`、functions `67.86%`；基線為 `71.03% / 50.00% / 34.78%`，delta 為 `+7.47 / +33.00 / +33.08` 個百分點。
- targeted test file coverage：lines `100.00%`、branches `93.10%`、functions `100.00%`。
- scoped ESLint：PASS。
- `git diff --check`：PASS；只有 LF/CRLF normalization warning，沒有 whitespace error。

Global coverage 本輪沒有重算，最後 authoritative result 仍為 `39.42 / 45.15 / 47.80 / 59.74`，既有門檻仍為 `63 / 57 / 60 / 65`。

## 為什麼總分仍是 73.5

本輪提升的是 FIN-08T 本機 source attribution，不是新的外部驗收證據；因此 CAT04 仍為 `6.0`、CAT10 仍為 `4.5`，總分仍為 `73.5`。CAT04 仍缺新的可追溯 PayUni Sandbox/provider receipt 與 staging reconciliation；CAT10 仍缺真人商家、客服、法務／隱私／退款、財務、release owner 與 external monitoring acceptance。這些缺口不能用 deterministic local tests 代替。

## 安全邊界

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有外部 network、staging、PayUni、付款、退款、DB、Browser 或 Production 副作用；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 external command；沒有降低 threshold、exclude、skip 或 assertion。Goal 維持 `IN_PROGRESS`。
