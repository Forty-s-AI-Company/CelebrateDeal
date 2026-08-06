# WP-88 G1 Direct URL shared guard-family matrix

狀態：`ACCEPTED_WITH_SEPARATE_ENVIRONMENT_GAP`  
模式：`PRELAUNCH_DEV`  
日期：2026-07-30

## 實際驗證範圍

新增的 Browser E2E 矩陣不改寫既有 41 個分散的 Direct URL specs。它先以程式碼清單鎖定 52 個受保護 page，並要求每個 page 落在一個既有共享 guard family：

| Guard family | Page 數 | Browser 契約 |
|---|---:|---|
| `vendorContext` | 7 | 匿名者導向登入；owner 可進入代表路由 |
| `vendorManager` | 31 | accountant 被拒；admin 可進入代表路由 |
| `vendorFinance` | 7 | member 被拒；完成 synthetic MFA 的 owner 可進入代表路由 |
| `authenticated` | 1 | 匿名者導向登入；owner 可進入代表路由 |
| `platformFinance` | 6 | owner 被拒；完成 synthetic MFA 的 platform admin 通過 guard |

當新增受保護 page、移除共同 guard、或 guard family 數量漂移時，矩陣會失敗，要求更新 review 與 Browser evidence；它不是靠側邊導覽存在與否來推論授權。

## Deterministic results

- `npx eslint tests/e2e/wp88-direct-url-guard-matrix.spec.ts`：PASS。
- `npx playwright test tests/e2e/wp88-direct-url-guard-matrix.spec.ts`：1 passed。
- 測試只建立並清理 synthetic vendor、users、sessions 與 MFA guard marker；trace、screenshot、video 均關閉，沒有外部請求、production 操作或 `.env*` 讀取。

## 明確保留的本機環境缺口

WP-88 當時發現 platform admin 進入 `/admin/billing/dashboard` 時，角色與 MFA guard 已允許請求保持在保護 URL，但資料載入因本機資料庫缺少 `PayoutItem.bankAccountEncrypted` 而得到 Prisma `P2022`／HTTP 500。後續 WP-89 已以 field-limited read model、disposable migration drift detector 與 Browser HTTP 200 驗證修復這條本機使用路徑；這仍不代表既有 DB 已 migration 或 production readiness。

Sol High acceptance verdict：`ACCEPT`。本證據支持「共享 Direct URL guard 的 allow/deny 契約已以 Browser 驗證」，因此 G1 已關閉，CAT-03 由 `6.0` 調整為 `8.0`。AGY Fast 的兩次唯讀 QA 均逾時 `TOOL_BLOCKED`，未被當成通過證據；既有 local DB 的 canonical migration 尚未套用，仍需在獲授權的環境維護流程處理。完整 receipt 見 `.ai-team/reports/wp88-g1-direct-url-matrix-receipt.json`。

## Ownership 與 rollback

OWNED：

- `tests/e2e/wp88-direct-url-guard-matrix.spec.ts`
- `.ai-team/reports/wp88-g1-direct-url-matrix-receipt.json`
- 本文件

其餘既有 dirty paths 均為 `PRESERVE_ONLY`，沒有修改、清理、stage、commit、push 或 deployment。若需回滾，只移除以上三個 WP-88 owned paths；不得對既有 dirty worktree 使用 reset、clean、stash、restore 或 checkout。
