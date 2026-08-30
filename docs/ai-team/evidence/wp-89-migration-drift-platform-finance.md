# WP-89 Platform finance migration drift remediation

狀態：`ACCEPTED`  
模式：`PRELAUNCH_DEV`

本工作包只處理平台財務總覽的 failed payout count read model，以及針對 `PayoutItem.bankAccountEncrypted` 的 disposable migration drift 偵測。

- 不修改 canonical migration `20260725230000_encrypt_payout_bank_accounts`。
- 不對既有本機 dev DB、staging 或 production 執行 migration、reset 或 schema mutation。
- 兩個唯一命名的 loopback disposable DB 分別驗證完整 migration 與刻意缺欄；後者必須被 drift detector fail-closed，但 failed payout count 查詢仍可成功，因為該 read model 不讀取加密銀行欄位。
- 加密銀行資料不得進入 dashboard query、page payload、receipt 或測試輸出。

## Deterministic evidence

- `Invoke-Wp89MigrationDriftQa.ps1`：PASS。兩個唯一命名的 loopback disposable PostgreSQL 16 databases 都完整套用 13 個 canonical migrations；clean DB 的 drift check 與 failed-payout count read model 均通過。
- 同一 runner 在第二個 disposable DB 刻意移除 `PayoutItem.bankAccountEncrypted` 後，drift detector 以非零 exit fail-closed 並明確指出該欄位；failed-payout count read model 仍通過，因它不選取加密銀行資料。兩個 disposable DB 都已刪除。
- `npx eslint`（dashboard、WP-88 Browser spec、兩個 WP-89 fixture）：PASS；`npx tsc --noEmit`：PASS；`npx vitest run scripts/local-database-safety.test.ts`：10 passed。
- `npx playwright test tests/e2e/wp88-direct-url-guard-matrix.spec.ts`：1 passed。platform admin 在既有 local DB 的 `/admin/billing/dashboard` 得到 HTTP 200 並看到「財務總覽」；原先連續發現的 `PayoutItem.bankAccountEncrypted` 與 `AffiliateCommissionStatus` read-model 500 已不再發生。

Dashboard 現在只讀取 UI 真正使用的欄位；failed payout 用 count，commission summary 是固定 SQL field allowlist，沒有使用者輸入、沒有敏感銀行欄位、也沒有 catch／空資料降級來掩蓋 query failure。

既有 local dev DB 仍未被 migration，這是刻意遵守的安全邊界：本包修復相容 read model 並提供 drift evidence，不宣稱既有 DB 已對齊 canonical schema，更不宣稱 staging／production 已完成 migration。

Sol High verdict：`ACCEPT`。CAT-05 由 `6.0 → 8.5`；本證據不涵蓋完整財務人工核帳，且 AGY Fast 兩次為 `TOOL_BLOCKED`，因此 CAT-08 不調分。G2 維持 `PASS`。完整 sanitized receipt 見 `.ai-team/reports/wp89-migration-drift-receipt.json`。
