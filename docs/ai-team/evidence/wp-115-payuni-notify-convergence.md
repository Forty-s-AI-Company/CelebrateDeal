# WP-115 — PayUni notify 500 本機收斂修復

結果：`LOCAL_FIX_VERIFIED_PENDING_SOL_ACCEPTANCE`。CAT04 維持 **6.0/10**。

## 本機可驗證結果

- 在受控 mock 中重現：同一已接收事件的第一個 callback 成功，而第二個 callback 因處理權競爭失敗時，原路由回傳 500。
- 修復僅在既有 processing catch 內重新讀取同一個 event；**只有**它已是 `processed` 時，才回既有 duplicate 200 語意。
- event 仍未完成或重新讀取失敗時，維持既有 failure update、audit 與 500；無 catch-all 200，也沒有更改簽章、payload、provider、金額／商家 invariant、Prisma、retry worker 或 Preview 安全 log schema。
- 路由／PayUni／錯誤分類 targeted Vitest：3 files、51 passed。scoped ESLint、TypeScript、`git diff --check` 均通過。
- WP-only reverse patch check 通過，且 staged index 為空；原有 179 個 dirty entries 保留。pre/post 檔案 SHA-256 與 rollback patch 位於 sanitized receipt。

## 邊界與未證實事項

這證實本機的收斂機制與修復；現有 Preview 六欄 log 沒有 failure code，因此 WP-114 的實際 `notify 500` **不可標記為已歸因**。本包沒有讀取 callback body、query、headers、識別碼、憑證或 `.env*`，也沒有執行 PayUni query、退款、第二筆付款、callback replay、Vercel 操作、部署或任何 Production 動作。

AGY Fast 依 canonical wrapper 最多兩次嘗試後沒有可用 structured output，記為 `TOOL_BLOCKED`，不取代 deterministic tests。

WP-114 的既有 Sandbox 交易仍是 `PENDING_REFUND`。退款、退款供應商 query、狀態確認與 duplicate-refund 試驗都須另立工作包並取得明確外部副作用授權。
