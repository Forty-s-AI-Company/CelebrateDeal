# QUAL-2026-08-08-64｜Billing-plan provider source attribution

記錄時間：2026-08-08 03:30:26（Asia/Taipei）  
結果：`PARTIAL_CLOSURE_FAIL_REMAINING_SOURCE_INVENTORY`

## 本輪目的

為 FUNC-63 的 billing-plan provider failure 修正補上 source-attributed deterministic coverage，並在 current tree 重新執行既有 global coverage gate。測試確認 provider 不可用時不建立訂閱或 payment transaction，方案頁顯示專用錯誤狀態。

## Deterministic verification

- billing plan／invoice／payment／webhook cohort：228 test files、1,590/1,590 PASS，0 failed／0 skipped。
- Node contracts：679/679 PASS。
- billing plans `actions.ts` source coverage：statements 87.50%、branches 79.41%、functions 92.85%、lines 87.96%。
- billing plans `page.tsx` source coverage：statements 92.59%、branches 90.90%、functions 100%、lines 96.00%。
- current global combined coverage：statements 43.51%（14,215/32,664）、branches 48.95%（13,113/26,787）、functions 52.51%（2,663/5,071）、lines 62.84%（12,232/19,464）。
- 相較 QUAL-60 的 43.49／48.92／52.48／62.81，分別改善 0.02／0.03／0.03／0.03 個百分點。
- 既有 global threshold 63%／57%／60%／65% 仍未達，命令 exit 1；分類為 `FAIL_REMAINING_SOURCE_INVENTORY`，不是功能測試 failure。

## 分數與未完成邊界

Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`。本地 source coverage 不冒充 CAT04 PayUni Sandbox／provider reconciliation，也不冒充 CAT10 真人 owner 或 external monitoring acceptance。

本輪沒有 staging、PayUni Sandbox、Production、正式資料庫、正式付款／退款／寄信、deployment、push 或 merge；沒有讀取或輸出 secret 內容，沒有重試 FIN-08AA、WP-196、WP-197 或既有 terminal external command。未降低 coverage threshold、inventory、exclude、skip 或 assertion；feature tests 與 E2E 不因 coverage gate 被阻擋。下一輪繼續以產品價值排序的 FUNC-CLOSURE，並並行補 source inventory。
