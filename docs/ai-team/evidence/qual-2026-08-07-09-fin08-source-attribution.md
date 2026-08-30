# QUAL-2026-08-07-09：FIN-08 legacy pure-helper source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

本輪只處理 `FIN-08` legacy staging runner 的純 helper source attribution，沒有執行 live runner、staging、PayUni、disposable PostgreSQL、Browser 或 Production。新增 deterministic 測試涵蓋：

- canonical serialization 與 digest determinism。
- broker argv 的 bounded construction 與 absolute-path fail-closed 驗證。
- synthetic provider transaction projection。
- malformed identity、marker classification 的 fail-closed 行為。
- schema、side-effect、replay、score 與 URL 等 forbidden receipt outcome families。

## 實際驗證

- `node --test --experimental-test-coverage scripts/fin08-staging-payuni-reconciliation-runner.test.mjs`：`8/8 PASS`、0 failed、0 skipped。
- FIN-08 target source-entry process coverage：lines `43.23%`、branches `84.42%`、functions `60.00%`。
- scoped ESLint：PASS。
- `git diff --check`：PASS（僅既有 LF/CRLF 警告，沒有 whitespace error）。

同一測試程序也列出 imported WP174 helper 的 coverage；那是依賴檔案的觀測值，不列為 FIN-08 target progress。全域 coverage 本輪沒有重算，最後 authoritative result 仍為 `39.42/45.15/47.80/59.74`，既有門檻仍為 `63/57/60/65`。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。純 helper coverage 不能取代 CAT04 PayUni provider receipt，也不能取代 CAT10 真人法律、客服、財務、merchant 與 release owner acceptance。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有執行 staging／PayUni／付款／退款／DB／Browser／Production；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗外部命令；沒有降低 threshold、exclude、skip 或 assertion。這裡的 FIN-08 是 legacy 純 helper 測試，不是 FIN-08AA route-manifest attestation。
