# QUAL-2026-08-08-70｜Current-tree coverage baseline

記錄時間：2026-08-08 04:11:19（Asia/Taipei）  
結果：`PARTIAL_CLOSURE_FAIL_REMAINING_SOURCE_INVENTORY`

## 本輪目的

在 FUNC-65～68 產品修正與 SEC-69 dependency audit 後，重新執行既有 combined coverage gate，確認目前整棵測試樹的真實結果。Coverage 只作品質訊號，不取代功能測試，也不阻擋後續產品閉環。

## Deterministic verification

- Full Vitest：228 test files、1,598/1,598 PASS，0 failed、0 skipped；coverage command 最終 exit 1 的原因是 global threshold，不是測試 failure。
- Node contracts：679/679 PASS。
- Current global combined coverage：statements 43.54%（14,239/32,700）、branches 48.98%（13,144/26,835）、functions 52.51%（2,664/5,073）、lines 62.85%（12,252/19,492）。
- 既有門檻：statements 63%、branches 57%、functions 60%、lines 65%；目前仍分類為 `FAIL_REMAINING_SOURCE_INVENTORY`。
- 與 QUAL-64 相比：statements +0.03、branches +0.03、functions ±0.00、lines +0.01 個百分點。

## 分數與邊界

Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`。本輪沒有 staging、PayUni Sandbox、Production、正式資料庫、付款、退款、寄信、deployment、push 或 merge；沒有讀取或輸出 secret 內容，沒有重試 FIN-08AA、WP-196、WP-197 或既有 terminal external command。

沒有降低 coverage threshold、source inventory、exclude、skip 或 assertion。下一輪繼續以產品價值排序處理 FUNC-CLOSURE／CAT06／CAT10；CAT04、CAT10 的外部與真人 acceptance 仍須由授權人員完成。
