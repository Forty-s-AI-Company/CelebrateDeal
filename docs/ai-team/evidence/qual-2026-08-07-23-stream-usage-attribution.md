# QUAL-2026-08-07-23 — Stream usage attribution source attribution

## 判定

`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GLOBAL_GATE_REMAINS_OPEN`

本工作包補強近期 stream usage 分潤鏈的 deterministic source attribution。測試涵蓋 persisted custom allocation 重複 recipient 合併、allocation 總和不完整時 fail closed，以及 concurrent unique insert 的同 payload idempotency 與 payload drift rejection。只新增 owned tests，沒有修改 production source。

## 實際驗證

- Targeted Vitest：2 files、15 tests，0 failed、0 skipped `PASS`。
- Targeted V8 attribution：
  - `src/lib/stream-usage-attribution.ts`：statements 100%、branches 96.42%、functions 100%、lines 100%。
  - `src/lib/stream-usage.ts`：statements 96.07%、branches 95%、functions 100%、lines 100%。
- Full Vitest：204 files、1445 tests，0 failed、0 skipped `PASS`；完整 suite duration 102.51s。
- `npm run typecheck` `PASS`。
- Scoped ESLint（新增 stream usage tests）0 errors `PASS`。
- `npm run secret:scan` `secret_scan_passed`。
- `git diff --check` exit `0`；LF/CRLF 訊息是既有工作樹提示，不是 diff error。
- `node scripts/readiness-truth-reconciliation.mjs`：exit `0`，status `PASS`、10 categories、total `73.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## Global gate 與分數邊界

- 本包未重跑既有失敗的 global `npm run test:coverage` command；QUAL-19 仍是最新 authoritative global result：statements `40.73%`、branches `46.56%`、functions `49.25%`、lines `61.16%`，對 `63/57/60/65` gate `FAIL_REMAINING_SOURCE_INVENTORY`。
- 局部 stream usage coverage 不改寫 global coverage，也不替代 CAT04 的 fresh staging／PayUni provider receipt 或 CAT10 的真人 owner／external monitoring acceptance。
- canonical total：`73.5`；本工作包 `current_goal_score_change=0`；CAT01 `7.5`、CAT04 `6.0`、CAT10 `4.5`。
- reconciliation 輸出的 `score_change=0.5`／`wp131_score_change=0.5` 是歷史 metadata，不是本包加分。

## 安全與回滾

- 沒有讀取或保存 `.env*`、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料；測試資料均為 synthetic fixture。
- 沒有執行 staging、PayUni、Production、migration、付款／退款、deployment、push 或 merge；沒有重試 FIN-08AA、WP-196、WP-197。
- 沒有降低 coverage threshold、擴大 exclude、縮減 inventory、新增 skip 或弱化 assertion。
- 若需回滾，僅移除本 WP23 owned 的兩個 test case 增補與本 evidence/report；不要使用 reset、clean、stash、restore 或 checkout。
