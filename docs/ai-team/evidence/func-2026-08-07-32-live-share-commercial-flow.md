# FUNC-2026-08-07-32 — Live share commercial flow cross-route evidence

- Recorded at: `2026-08-07T19:55:52+08:00`
- Mode: `PRELAUNCH_DEV_AUTONOMOUS`
- Scope: deterministic route-composition test for the local Live share → lead → checkout commercial lineage.
- Production source changed in this package: none; this package verifies the P1 source fix from `FUNC-2026-08-07-31`.

## Closure proved

一個 server-owned 的 Live share click lineage 現在能在同一個 synthetic flow 中完整通過：

1. A-owned Live share 解析出 active B promoter 與 `B-CODE`。
2. affiliate-click route 寫入 click attribution 並設定 `celebratedeal_attribution` cookie。
3. form-submissions route 讀取同一份 share lineage，建立 lead 並寫入 B 的 `teamLeadAttribution`。
4. checkout route 只使用 server-validated click cookie 與 form-submission cookie，把 `affiliateClickId`、`referralCode`、`formSubmissionId` 寫入 payment transaction metadata。

測試同時保留 fail-closed 邊界：沒有 active affiliate identity 的 shared page 不得自行取得佣金歸屬。付款 provider、資料庫與 inventory boundary 均為 synthetic mock，沒有產生外部付款或退款。

## Verification

| 驗證 | 結果 |
|---|---|
| 新增跨 route deterministic flow | 1 file／1 test PASS |
| 相關 click／lead／checkout／playback regression suite | 7 files／70 tests PASS；0 failed／0 skipped |
| disposable PostgreSQL full Vitest | 212 files／1475 tests PASS；0 failed／0 skipped |
| Node contract tests | 679/679 PASS；0 failed／0 skipped |
| disposable PostgreSQL migration deploy | 28/28 migrations PASS |
| disposable PostgreSQL migration status | `Database schema is up to date!` PASS |
| disposable container cleanup | PASS；`celebratedeal-flow32b-disposable-test` 無殘留 |
| typecheck | PASS |
| full lint | PASS；0 errors，2 個既有 warnings |
| secret scan | `secret_scan_passed` |
| diff check | PASS |

第一次 disposable runner 使用資料庫名稱 `postgres`，在產品自己的 `local_database_safety` guard 前置拒絕，沒有啟動 Vitest；該 container 已清理。改用 allowlisted `celebratedeal_test` 後才執行完整 suite，前置拒絕不被分類為產品測試失敗。

## Canonical boundary

- readiness truth：`PASS`；10 categories；total `73.5`。
- CAT04 `6.0`：仍缺新的授權 staging reconciliation 與 PayUni Sandbox provider receipt。
- CAT10 `4.5`：仍缺真人 merchant／support／finance／legal／privacy／release owner acceptance 與 external monitoring evidence。
- 本 package canonical score：`73.5 → 73.5`；`current_goal_score_change=0`。
- 最新 global coverage 尚未在本 package 重算；保留上一個 authoritative result `42.15／47.87／50.99／61.34` 對 threshold `63／57／60／65`，exit `1`。Coverage 沒有阻擋本輪功能測試，也沒有降低 threshold、縮減 inventory、擴大 exclude、新增 skip 或弱化 assertion。

## Safety and rollback

- 只使用 synthetic fixtures、loopback disposable PostgreSQL 與 demo provider mock。
- 未讀取或輸出 `.env*`、credential、token、cookie、正式 secret、正式客戶或付款資料。
- 未操作正式 DB、正式付款／退款／轉帳／寄信、staging、PayUni、deployment、push 或 merge。
- 未重試 FIN-08AA、WP-196、WP-197 或任何既有 terminal no-go endpoint／probe／command。
- rollback 僅限新增的 `live-share-commercial-flow.test.ts` 與本 package evidence/report/index/state/log；不使用 reset、clean、stash、restore 或 checkout。

Goal 維持 `IN_PROGRESS`；下一步是下一個非 terminal、可由 deterministic tests 覆蓋的高價值 source family，或等待可授權的 CAT04／CAT10 外部與真人 evidence。
