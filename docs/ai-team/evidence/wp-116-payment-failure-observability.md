# WP-116 — 付款 processing failure 固定格式可觀測性

結果：`LOCAL_FIX_VERIFIED_PENDING_SOL_ACCEPTANCE`。候選分數僅為 CAT08 **6.0→6.5**；CAT04 維持 **6.0**。

- `processing_claim_lost` 是封閉 failure code；未知例外仍降級為 `processing_failed`。
- Preview-only `payment_webhook_failure_v1` 只記錄固定 event、method、path、source、status、code、timestamp。它不記錄錯誤訊息、URL/query、body、header、cookie、識別碼、provider reference 或秘密。
- 只有未收斂的 500 會產生 failure record；同一 event 已 processed 的 duplicate 200 不產生它。記錄 sink 拋錯也不改變既有 HTTP 或 DB/audit failure 語意。
- deterministic：route／failure-code／PayUni 3 files、54 passed；scoped ESLint、TypeScript、`git diff --check`、staged-empty與四檔 WP-only reverse patch 均通過。
- AGY Fast 的 canonical wrapper 沒有可用 structured output，記為 `TOOL_BLOCKED`，未當成通過。

沒有執行任何 Sandbox、Preview、Vercel、退款、provider query、付款、callback replay、部署、DNS、Production 或 `.env*` 存取。這不歸因 WP-114 的歷史 notify 500，也不提供外部 delivery 或 Production claim。
