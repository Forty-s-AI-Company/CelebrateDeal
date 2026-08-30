# FUNC-2026-08-07-26：stream usage admission 與 LiveProduct tenant binding

驗證時間：2026-08-07 16:11（Asia/Taipei）  
狀態：`LOCAL_FUNCTIONAL_CLOSURE`，不是 staging、PayUni 或人工 release acceptance。

## 本輪實際修正

- `POST /api/stream-usage` 現在要求 HttpOnly live viewer admission cookie；session token 只以 hash 查詢，且必須同時符合 vendor、live 與 expiry，否則在寫入 usage ledger 前回覆 bounded 403。
- playback source resolver 與 stream usage route 共用同一個 active session boundary，避免「播放來源受保護、但 billing heartbeat 仍可被未授權 client 寫入」的斷層。
- `LiveProduct` 新增 `vendorId`，legacy rows 由 Live parent backfill；migration preflight 對 missing parent 或 cross-tenant row fail closed，並改為 vendor/live/product composite foreign keys、unique identity 與 lookup index。
- actions、seed 與 E2E fixture 均改用 vendor-scoped LiveProduct identity；沒有移除資料、DROP TABLE、TRUNCATE 或降低 assertion。

## 實際驗證

| 檢查 | 實際結果 |
|---|---|
| targeted Vitest | 7 files、35 tests PASS；0 failed、0 skipped |
| full Vitest | 196 files、1385 tests PASS；0 failed、0 skipped |
| Node contracts | 679 tests PASS；0 failed、0 skipped |
| targeted stream/admission regression | 5 files、31 tests PASS；包含缺 cookie、跨 vendor/live、過期 session與合法 session |
| LiveProduct static/schema contracts | 2 files、4 tests PASS；Prisma invariant inventory與migration contract |
| `npx prisma validate` | PASS |
| `npx prisma generate` | PASS |
| `npm run typecheck` | PASS |
| scoped ESLint | 0 errors、0 warnings in scoped files |
| `npm run secret:scan` | `secret_scan_passed` |
| disposable PostgreSQL semantic runner | 24/24 validate/deploy/status PASS；valid insert PASS；cross-vendor live FK rejection PASS；cross-vendor product FK rejection PASS；container/temp cleanup PASS |
| sanitized runner receipt | `.ai-team/reports/func-2026-08-07-26-live-product-tenant-disposable.json` |

## 分數與外部邊界

本輪 current score change 為 `0`，canonical total 仍為 `73.5`：CAT04 `6.0`、CAT10 `4.5`。本輪關閉的是本機 P1 authorization／tenant-integrity residual，不能替代：

- CAT04 的 fresh staging reconciliation、PayUni Sandbox provider receipt 與 payout/refund reconciliation external evidence。
- CAT10 的真人 merchant、客服 SLA、法務／隱私／退款、財務、release owner 與 external monitoring evidence。

本輪未執行 staging、PayUni、Production、正式付款／退款／寄信、部署、push、merge 或 terminal no-go retry；未讀取 secrets、production data 或 raw viewer token；未降低 coverage threshold、inventory、exclude、skip 或 assertion。最新 authoritative coverage 仍為 QUAL-19：40.73／46.56／49.25／61.16 對 63／57／60／65，未以 coverage 取代產品 closure。

## 回滾與下一步

回滾只可依本輪檔案與 ownership 做 inverse patch；不得使用 reset、restore、clean 或整檔覆蓋既有 dirty worktree。外部 aggregate preflight 尚未授權，因此 DB-I06 只標記為本機 candidate closure，不外推 staging／Production。

下一個最高價值工作仍是取得已授權的 CAT04 external receipt；若外部邊界不可用，則繼續處理尚未關閉的本機 P1，而不是重試 FIN-08AA、WP-196 或 WP-197。
