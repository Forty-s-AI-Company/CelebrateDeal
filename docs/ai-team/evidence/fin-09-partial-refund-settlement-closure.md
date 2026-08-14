# FIN-09：部分退款 commission／settlement／payout 閉環

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_LOCAL_FUNCTIONAL_CANDIDATE`，尚未授權為 staging／PayUni 上線證據

## 結論

這輪找到並修正一個真實的 P1 財務功能缺口：部分退款會新增負向 commission ledger，卻把尚未付款的 source commission 直接標成 `void`；settlement 也以不可變的原始 commission amount，而不是 ledger net 計算。若 commission 已鎖定且尚未建立 payout item，既有 AffiliatePayout 亦不會跟著退款下降。

修正後：

- commission 只有在 ledger balance 歸零時才會變成 `void`。
- settlement 以 pending／approved／locked commission 的 ledger net 扣除佣金。
- locked commission 的部分退款會在同一 transaction 內重算仍未付款的 AffiliatePayout；已建立 payout item 的狀態則 fail closed，不暗中改變出款指示。

## 可追溯變更

- `src/lib/payment-webhooks.ts`
- `src/lib/payment-webhooks.test.ts`
- `src/lib/billing.ts`
- `src/lib/billing.test.ts`

修正前的 deterministic regression 確實失敗：部分退款後預期 `pending` 卻觀察到 `void`；已鎖定未付款 payout 預期 6400 cents 卻仍是 8000 cents。修正後沒有以降低 assertion、skip 或 exclude 掩蓋問題。

## 驗收證據

| 項目 | 實際結果 |
| --- | --- |
| FINANCE deterministic cohort | 12 files，291 passed，0 failed |
| 部分退款 regression | 3 passed，另 31 個因 target filter skipped |
| TypeScript／strict index | PASS |
| ESLint | PASS；僅 2 個既有 warning |
| Node TAP contracts | 566 passed，0 failed |
| `git diff --check` | PASS |
| disposable PostgreSQL migration／targeted tests | wp17、wp18 migration/status 與 targeted tests PASS；150 + 153 tests |
| disposable cleanup／source hash／protected hash | PASS |
| `npm audit --omit=dev --json` | high、critical、moderate、low、total 皆為 0 |

完整 sanitized receipt 位於：

- `.ai-team/reports/fin09-partial-refund-settlement-closure.json`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260807045035242/command-receipts.sanitized.json`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260807045035242/schema-cleanup.sanitized.json`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260807045035242/coverage-project-schema-identity.sanitized.json`

Disposable runner 的 coverage 仍是 `FAIL_REMAINING_SOURCE_INVENTORY`：566 tests 中 546 passed、20 failed，失敗落在既有歷史 preview／staging diagnostic fixture inventory，不是本輪 finance source 的 migration 或 targeted test 失敗。這個結果已保留，沒有標成 PASS。

## 評分與上線邊界

本地產品邏輯已完成候選閉環，但 staging／PayUni Sandbox 的外部 evidence 尚未取得；既有 WP-196／WP-197 fail-closed 結果與 FIN-08AA terminal no-go 均保留，沒有重試相同 endpoint、deployment probe 或命令。因此 CAT04 維持 6.0、總分維持 73.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## 回滾與安全

回滾範圍限於上述四個 source／test 檔的 FIN-09 hunks；disposable schemas 已清理，不需要 production database rollback。這輪未讀取 `.env*`、credential、cookie、正式資料或付款資料，未觸碰 production database、payment、email、deployment 或外部 mutation。
