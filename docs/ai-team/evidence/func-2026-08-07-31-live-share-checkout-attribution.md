# FUNC-2026-08-07-31 — Live share → lead → checkout attribution closure

- Recorded at: `2026-08-07T19:41:18+08:00`
- Mode: `PRELAUNCH_DEV_AUTONOMOUS`
- Scope: local product source、route-level deterministic tests、disposable PostgreSQL full-suite verification。
- Canonical score before／after: `73.5 → 73.5`；本 WP `current_goal_score_change=0`。

## 發現與修正的產品 bug

B 透過 A-owned Live share link 進入直播時，server 已經能解析 B 的 active affiliate identity，也會寫入 `AffiliateClick` 與 team click attribution；但 affiliate-click route 只在 legacy referral query 情境設定 `celebratedeal_attribution` cookie。

結果是：

- B 的 click／lead attribution 有資料。
- 後續 checkout 讀不到 sticky click cookie。
- payment transaction metadata 可能缺少 `affiliateClickId` 與 verified `referralCode`，導致購買佣金歸屬中斷。

本輪修正 `src/app/api/affiliate-clicks/route.ts`：只有在 server 已驗證 `shareAttribution.referralCode` 且找到 active affiliate identity 時，才設定同一個 server-owned attribution cookie。沒有 affiliate identity 的 shared page 仍不會被強行套用佣金。

## 驗證結果

| 驗證 | 結果 |
|---|---|
| targeted attribution／playback／lead／checkout suite | 6 files／69 tests PASS |
| full Vitest in disposable PostgreSQL | 211 files／1474 tests PASS；0 failed／0 skipped |
| Node contract tests | 679/679 PASS；0 failed／0 skipped |
| disposable PostgreSQL migration deploy | 28/28 migrations PASS |
| disposable PostgreSQL migration status | `Database schema is up to date!` PASS |
| disposable container cleanup | PASS；`celebratedeal-func30-disposable-test` 無殘留 |
| typecheck | PASS |
| full lint | PASS；0 errors，2 個既有 warnings |
| secret scan | PASS |
| scoped diff check | PASS；只有既有 LF/CRLF normalization warning |

### 本機 dev database 的隔離結果

另外直接在目前本機 dev database 跑 full Vitest 得到 `210 files PASS、1472 tests PASS、2 tests FAIL`；兩個失敗都是 FIN-29 webhook 測試因本機資料庫缺少 `PlatformReferralCommissionLedgerEntry.disputeCaseId`。這個 database migration history 早已與目前 worktree 不一致，本輪沒有修改它，也沒有把這次結果當作 acceptance evidence。有效 full-suite evidence 只採用上方 28 migrations 完整套用的 disposable PostgreSQL 結果。

## Coverage 與 canonical boundary

本 WP 沒有重跑 `npm run test:coverage`；最近一次同一 Goal 的 authoritative global coverage 仍是：Statements／Branches／Functions／Lines `42.15／47.87／50.99／61.34`，對門檻 `63／57／60／65`，exit `1`。Coverage 沒有阻擋本輪功能測試，也沒有降低 threshold、縮減 inventory、擴大 exclude、新增 skip 或弱化 assertion。

最新 readiness truth：

- CAT01 `7.5`、CAT02 `8.0`、CAT03 `8.0`、CAT04 `6.0`、CAT05 `8.5`
- CAT06 `7.0`、CAT07 `9.0`、CAT08 `7.5`、CAT09 `7.5`、CAT10 `4.5`
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`
- CAT04 仍缺 fresh authorized staging reconciliation 與 PayUni Sandbox provider receipt。
- CAT10 仍缺真人 merchant／support／finance／legal／privacy／release owner evidence 與外部 monitoring delivery。

因此本輪是真實的 P1 商業歸屬修正，但不能替 CAT04／CAT10 套用分數。Goal 維持 `IN_PROGRESS`。

## 安全與 rollback

- 未讀取或輸出 `.env*`、credential、token、cookie、正式 secret、正式客戶或付款資料。
- 未操作正式 DB、正式付款／退款／轉帳／寄信、staging、PayUni、deployment、push 或 merge。
- 未重試 FIN-08AA、WP-196、WP-197 或任何既有 terminal no-go endpoint／probe／command。
- rollback 僅限本 WP 的 affiliate-click route 與測試變更；不使用 reset／clean／stash／restore／checkout 丟棄其他既有變更。

下一步轉回剩餘 P0/P1 inventory 與可取得的 CAT04／CAT10 外部／真人 evidence；coverage 仍持續補 source attribution，但不把 coverage 小幅變化當成產品完成。
