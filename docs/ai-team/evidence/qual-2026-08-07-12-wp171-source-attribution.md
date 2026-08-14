# QUAL-2026-08-07-12：WP171 corrected Preview broker source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

本輪只補 `WP171` corrected Preview broker verifier 的 deterministic pure-logic contract coverage，沒有執行 `runParent`、staging、disposable PostgreSQL、Browser 或 PayUni。新增測試涵蓋：

- 全部 WP170 child status mapping 與 unknown fail-closed mapping。
- canonical／digest stability。
- `mergeChild` state projection。
- bounded temporary cleanup 與 missing-path idempotent cleanup。
- startup、freshness、broker、database、provider success-gate 完整矩陣。
- package manager、retry、side-effect、sensitive persistence 與 provider-before-candidate rejection。

## 實際驗證

- `node --import tsx --test --experimental-test-coverage scripts/wp171-corrected-preview-broker-reverification-runner.test.mjs`：`12/12 PASS`、0 failed、0 skipped。
- WP171 source-entry process coverage：lines `63.48%`、branches `88.71%`、functions `68.75%`；相對基線 `57.43% / 45.65% / 46.15%`，分別增加 `6.05 / 43.06 / 22.60` 個百分點。
- scoped ESLint：PASS。
- `git diff --check`：PASS（只有 LF/CRLF normalization warning，沒有 whitespace error）。

直接用 plain `node --test` 會在測試開始前因 imported PayUni TypeScript module 的 `@/lib` project alias 而 loader-blocked；改用 project loader 的 `node --import tsx` 後才取得上述 authoritative result。中途一個 `mergeChild` fixture 把 status 放在 child envelope 而不是 `child.receipt`，已修正後重新取得 `12/12`；這不是 production bug，也沒有弱化 assertion。

Global coverage 本輪沒有重算，最後 authoritative result 仍為 `39.42/45.15/47.80/59.74`，既有門檻仍為 `63/57/60/65`。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。WP171 local broker contract coverage 不能取代 fresh staging deployment、PayUni Sandbox provider receipt 或 CAT04 acceptance。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有執行 staging／PayUni／付款／退款／DB／Browser／Production；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 external command；沒有降低 threshold、exclude、skip 或 assertion。
