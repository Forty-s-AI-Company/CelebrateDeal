# FUNC-2026-08-07-33 — Partner Page 儲存／發布閉環

## 結果

本 WP 完成 Partner Page 的商家儲存與發布 deterministic product closure，並補齊 `src/app/actions/team-funnel-partner-actions.ts` 的主要 source attribution。

- `savePartnerPageAction`：驗證 ownership、CTA URL、欄位鎖定與四個公開產品 slot，並委派至 scoped slot service。
- `setPartnerPagePublishAction`：驗證 ownership 後，以 `PUBLIC`／`DISABLED` upsert partner share setting。
- 保留既有 CSRF、team-funnel access 與 revalidation 邊界；沒有降低 assertion 或改動 coverage threshold。

## 變更範圍

- `src/app/actions/team-funnel-partner-actions.test.ts`
- `src/app/actions/team-funnel-partner-actions.ts`（本 WP 僅以測試驗證既有 production path，未新增 production source change）

## 驗證證據

- Partner action suite：7/7 PASS。
- Combined partner-page regression：6 files／49 tests，49 PASS、0 FAIL、0 SKIP。
- Disposable PostgreSQL：container `celebratedeal-qual30-disposable-test`，database `celebratedeal_test`，28 migrations applied，status `up_to_date`，cleanup PASS，無 residual container；既有 local dev database 未修改。
- Disposable full Vitest：213 files／1485 tests，1485 PASS、0 FAIL、0 SKIP。
- Node contracts：679/679 PASS。
- Target source coverage：statements 87.36%（83/95）、branches 81.03%（47/58）、functions 85.71%（12/14）、lines 95.06%（77/81）。
- Global coverage：statements 42.29%（13470/31844）、branches 48.00%（12497/26032）、functions 51.09%（2513/4918）、lines 61.56%（11550/18760）；既有 threshold 63／57／60／65，command exit 1，分類為 `FAIL_REMAINING_SOURCE_INVENTORY`。
- `npm run lint`：0 errors、2 existing warnings。
- `npm run secret:scan`：PASS。
- typecheck、scoped ESLint、`git diff --check`：PASS。

## 分數與驗收邊界

- canonical total：73.5，沒有本 WP score uplift。
- CAT04：6.0，仍需要新的 authorized staging reconciliation 與 PayUni Sandbox/provider receipt。
- CAT10：4.5，仍需要真人 merchant／support／legal／privacy／refund／finance／release owner evidence 與 external monitoring evidence。
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`、`current_goal_score_change=0`。
- 未執行 staging mutation、PayUni、Production、正式付款／退款、deployment、push、merge；未重試 FIN-08AA、WP-196、WP-197 或其他 terminal external command。

## 真實性與回滾

本 WP 的資料庫僅限 disposable PostgreSQL；container 已清除，production source 與本機 dev database 均未被操作。若需回滾，只需移除本 WP 新增的測試與本 WP evidence/report/index/log/state metadata，不涉及 production data migration。
