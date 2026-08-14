# QUAL-2026-08-07-22 — Live funnel attribution source attribution

## 判定

`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GLOBAL_GATE_REMAINS_OPEN`

本工作包以新增的獨立測試檔補強 `team-funnel-attribution` source attribution，未修改既有 dirty tracked attribution test。測試涵蓋 referral normalization、同源 request／Referer parsing、Live share clue trust boundary、visitor／attribution cookie TTL、secure cookie options、query／cookie／legacy fallback、Live share delegation、existing-owner fallback，以及 click／lead attribution persistence。

## 實際驗證

- Targeted Vitest：2 files、21 tests，0 failed、0 skipped `PASS`。
- Targeted V8 attribution for `src/lib/team-funnel-attribution.ts`：statements 92.80%、branches 87.39%、functions 100%、lines 96.11%。
- Full Vitest：204 files、1441 tests，0 failed、0 skipped `PASS`。
- `npm run typecheck` `PASS`。
- Scoped ESLint（WP31／WP32／WP33 source／tests）0 errors `PASS`；`npm run secret:scan` `PASS`。
- `git diff --check` exit `0`；LF/CRLF 訊息是既有工作樹提示，不是 diff error。

## Global gate 與分數邊界

- 本包未重跑既有失敗的 global `npm run test:coverage` command；QUAL-19 仍是最新 authoritative global result：statements `40.73%`、branches `46.56%`、functions `49.25%`、lines `61.16%`，對 `63/57/60/65` gate `FAIL_REMAINING_SOURCE_INVENTORY`。
- 局部 attribution coverage 不改寫 global coverage，也不替代 CAT04 的 fresh staging／PayUni provider receipt 或 CAT10 的真人 owner／external monitoring acceptance。
- canonical total：`73.5`，本工作包 `current_goal_score_change=0`；CAT01 `7.5`、CAT04 `6.0`、CAT10 `4.5`。

## 安全與回滾

- 沒有讀取或保存 `.env*`、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料；cookie 測試值均為 synthetic fixture。
- 沒有執行 staging、PayUni、Production、migration、付款／退款、deployment、push 或 merge；沒有重試 FIN-08AA、WP-196、WP-197。
- 沒有降低 coverage threshold、擴大 exclude、縮減 inventory、新增 skip 或弱化 assertion。
- 若需回滾，僅回滾本 WP33 owned 新增測試與 evidence；不要使用 reset、clean、stash、restore 或 checkout。
