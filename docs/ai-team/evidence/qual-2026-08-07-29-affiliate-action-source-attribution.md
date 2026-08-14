# QUAL-2026-08-07-29 — Affiliate commission void action source attribution

- Recorded at: `2026-08-07T20:05:02+08:00`
- Mode: `PRELAUNCH_DEV_AUTONOMOUS`
- Source family: `src/app/actions/affiliate-actions.ts`
- Scope: deterministic source-attribution tests for finance-admin commission void／ledger reversal／audit boundaries.

## Source attribution closure

新增 `src/app/actions/affiliate-actions.test.ts`，實際涵蓋：

- CSRF／server-action security 必須先於 finance data read。
- missing commission 與 already-void commission fail closed 並導向錯誤狀態。
- pending／non-paid commission 先 append 一筆 immutable reversal，再以 optimistic status predicate 轉為 `void`。
- paid commission 不重跑 status transition；ledger balance 為零時不新增 reversal、不重寫 commission。
- audit snapshot、finance actor、revalidation 與 success redirect 的完整閉環。

## Verification

| 驗證 | 結果 |
|---|---|
| new affiliate action suite | 1 file／5 tests PASS |
| disposable finance regression | 6 files／225 tests PASS；0 failed／0 skipped |
| disposable global Vitest with coverage | 213 files／1480 tests PASS；0 failed／0 skipped |
| Node contract tests in coverage run | 679/679 PASS；0 failed／0 skipped |
| disposable PostgreSQL migration deploy | 28/28 migrations PASS |
| target source coverage | statements `96.15%`／branches `82.35%`／functions `100%`／lines `100%` |
| typecheck | PASS |
| scoped lint before coverage run | PASS |
| disposable cleanup | PASS；`celebratedeal-qual29-disposable-test` 無殘留 |

本機 dev database 的同一 finance regression 為 `223/225` 通過，2 個 payment webhook failures 都是既有 `PlatformReferralCommissionLedgerEntry.disputeCaseId` 欄位缺失；未修改該 database，也未把它當作 acceptance evidence。有效結果採用 migration 完整的 disposable schema。

## Global coverage boundary

本輪在新增 test inventory 後重新執行 `npm run test:coverage`，實際結果：

- statements `42.22%` (`13447/31844`)
- branches `47.95%` (`12484/26032`)
- functions `51.05%` (`2511/4918`)
- lines `61.47%` (`11532/18760`)
- threshold `63/57/60/65`
- exit `1`：`FAIL_REMAINING_SOURCE_INVENTORY`

相較上一個 authoritative global result `42.15／47.87／50.99／61.34`，本輪為 `+0.07／+0.08／+0.06／+0.13` 個百分點。這是 source attribution 的真實進展，不是 global gate PASS；沒有修改 threshold、inventory、exclude、skip 或 assertion，coverage 也沒有阻擋功能或 E2E。

## Canonical boundary

- readiness truth：`PASS`；10 categories；total `73.5`。
- CAT04 `6.0`：仍缺新的授權 staging reconciliation 與 PayUni Sandbox provider receipt。
- CAT10 `4.5`：仍缺真人 merchant／support／finance／legal／privacy／release owner acceptance 與 external monitoring evidence。
- 本 package canonical score：`73.5 → 73.5`；`current_goal_score_change=0`。
- Goal 仍為 `IN_PROGRESS`。

## Safety and rollback

- 只使用 synthetic fixtures、loopback disposable PostgreSQL，未操作正式 DB、付款、退款、銀行、寄信、staging、PayUni 或 Production。
- 未讀取或輸出 `.env*`、credential、token、cookie、正式 secret、正式客戶或付款資料。
- 未重試 FIN-08AA、WP-196、WP-197 或任何既有 terminal no-go endpoint／probe／command。
- rollback 僅限新增的 `affiliate-actions.test.ts` 與本 package evidence/report/index/state/log；不使用 reset、clean、stash、restore 或 checkout。
