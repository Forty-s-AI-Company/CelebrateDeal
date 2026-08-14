# QUAL-2026-08-08-74｜Current-tree coverage after finance identity closure

記錄時間：2026-08-08 04:37:44（Asia/Taipei）  
結果：`PARTIAL_CLOSURE_FAIL_REMAINING_SOURCE_INVENTORY`

## Deterministic verification

- Full Vitest：228 test files、1,601/1,601 PASS，0 failed、0 skipped；coverage command exit 1 的原因是 global threshold，不是測試 failure。
- Node contracts：679/679 PASS。
- Current global combined coverage：statements 43.54%（14,240/32,700）、branches 49.00%（13,151/26,835）、functions 52.51%（2,664/5,073）、lines 62.86%（12,254/19,493）。
- 既有門檻：statements 63%、branches 57%、functions 60%、lines 65%；仍分類為 `FAIL_REMAINING_SOURCE_INVENTORY`。
- 與 QUAL-70 相比：statements ±0.00、branches +0.02、functions ±0.00、lines +0.01 個百分點；沒有降低 threshold、inventory、exclude、skip 或 assertion。

## 分數與邊界

本輪 coverage 包含 FIN-71～73 的 provider／transaction identity 修正與回歸測試。Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

未執行 staging、PayUni Sandbox、Production、正式資料庫、付款、退款、寄信、deployment、push 或 merge；未讀取或輸出 secret，未重試 FIN-08AA、WP-196、WP-197。Coverage gate 不阻擋後續功能／E2E，下一輪仍以產品價值排序推進 FUNC／FINANCE closure。
