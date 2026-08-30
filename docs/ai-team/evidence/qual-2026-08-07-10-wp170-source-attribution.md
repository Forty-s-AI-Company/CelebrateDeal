# QUAL-2026-08-07-10：WP170 deterministic source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

本輪只補 `WP170` staging PayUni read-only runner 的 deterministic pure-logic coverage，沒有啟動 live runner、Vercel、staging、disposable PostgreSQL、Browser 或 PayUni。新增測試涵蓋：

- canonical serialization 與 digest determinism。
- clean outside-workspace temporary boundary，以及 env-name contamination 的 fail-closed 行為。
- environment identity 的 broker、PayUni、app、DB、Supabase 與 project mismatch matrix。
- candidate 的 type、state、reference、amount validation matrix。
- read-only transaction guard 與 unexpected error normalization。
- provider exact identity 後的 unsupported status classification。
- receipt success gates、attempt budget、retry、side-effect、sensitive persistence 與 provider-before-candidate safety gates。
- freshness 與 broker malformed-output rejection。

## 實際驗證

- `node --import tsx --test --experimental-test-coverage scripts/wp170-staging-payuni-readonly-reconciliation-runner.test.mjs`：`17/17 PASS`、0 failed、0 skipped。
- WP170 source-entry process coverage：lines `58.99%`、branches `86.86%`、functions `76.00%`；相對基線 `50.53% / 63.11% / 62.50%`，分別增加 `8.46 / 23.75 / 13.50` 個百分點。
- scoped ESLint：PASS。
- `git diff --check`：PASS（只有 LF/CRLF normalization warning，沒有 whitespace error）。

直接用 plain `node --test` 會在測試開始前因 imported PayUni TypeScript module 的 `@/lib` project alias 而 loader-blocked；改用 project loader 的 `node --import tsx` 後才取得上述 authoritative result。中途一個 fixture 把合法的六字元 `unsafe` 誤當成非法 reference，已改為真正不合法的 synthetic `bad!` 並重新取得 `17/17`；這不是 production bug，也沒有弱化 assertion。

Global coverage 本輪沒有重算，最後 authoritative result 仍為 `39.42/45.15/47.80/59.74`，既有門檻仍為 `63/57/60/65`。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。WP170 deterministic coverage 不能取代 CAT04 PayUni Sandbox provider receipt，也不能取代 CAT10 真人 merchant、客服、法務／隱私／退款、財務、monitoring 與 release owner acceptance。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有執行 staging／PayUni／付款／退款／DB／Browser／Production；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 external command；沒有降低 threshold、exclude、skip 或 assertion。
