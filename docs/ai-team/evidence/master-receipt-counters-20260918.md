# Master 整合：PayUni receipt 副作用計數

- Scope：從 `5f7fe65f` 手工移植最小 receipt finalization 修正；保留 master `47473147` 的 workflow、固定 task、lineage、LINE 及 WP4 後續實作。
- 問題：buyer runner 最後的 schema validation 失敗時，重新建立 receipt 會清掉已執行的付款／退款計數。
- 修正：原 receipt 標為 `BLOCKED / INTERNAL_REJECTED`，保留 sideEffects 與 checks；獨立 validator 仍拒絕損壞 schema。
- 驗證：`node --import tsx --test scripts/mvp-payuni-sandbox-e2e.test.mjs scripts/secure-staging-workflow-contract.test.mjs`：67 passed、0 failed、0 skipped。
- ESLint：兩個修改的 `.mjs` 檔案通過；`git diff --check` 通過。
- 執行界線：allowlist process environment、mock dependencies；未觸發 GitHub secret runner、付款、退款、外部資料庫或 deployment。
- Typecheck：此批僅 `.mjs` 與測試，不改 TypeScript；完整 required quality 仍由受保護 PR CI 驗證。
- 回滾：以新 revert commit 還原本批兩個程式檔；不移除後續 master 安全強化。

整合分支的本機通過不等於 master 已合併，合併須等待受保護 PR 的 required `quality` 通過。
