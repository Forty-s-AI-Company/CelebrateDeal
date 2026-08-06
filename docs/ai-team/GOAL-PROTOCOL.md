# Goal Protocol

每個 `/goal` 只處理一個 30～90 分鐘 Work Package，主代理必須為 `gpt-5.6-terra`／High。

1. Terra 先做唯讀 scan；沒有可執行計畫時，交由 Sol 產生一次唯讀計畫與完整 handoff，Sol 隨即停止。
2. Terra 依 Sol handoff 建立或更新 control-plane packet，並以 `goal_bootstrap` 建立含下列 phases 的 state：`terra_scan`、`sol_plan`、`terra_implement_and_tests`、`agy_qa`、`sol_acceptance_review`。
3. 每個 phase 完成後由 Terra 使用 `goal_checkpoint` 記錄摘要、evidence、deterministic tests 與下一步；Sol 不寫入 control plane。
4. Terra 實作後先跑適用 deterministic tests，再預設交 AGY Fast 做唯讀 QA。Fast wrapper 固定 plan + sandbox、預設自動同意 headless 權限提示、最多兩次；`TOOL_BLOCKED`／`LOGIN_REQUIRED` 必須保留，不能取代 tests。
5. AGY QA 後，Sol 以唯讀方式做 acceptance review，結論只能是 `ACCEPT`、`CONTINUE_CURRENT_WP` 或 `PLAN_REMEDIATION`。Terra 將該結論記入 `sol_acceptance_review` checkpoint。
6. `CONTINUE_CURRENT_WP` 留在同一 Terra Task；`PLAN_REMEDIATION` 交給 Sol 規劃；只有 `ACCEPT` 才能繼續。
7. 所有 phases 完成、無未解決人工阻擋、handoff 已驗證且 acceptance 為 `ACCEPT` 時，主代理才可使用 `goal_finalize`。
8. finalize 前後皆檢查 Git diff 與 Git status，保存證據後停止；不得因 finalize 自動開始下一個 WP。

狀態檔：`.ai-team/state/goal-state.json`；進度檔：`.ai-team/logs/goal-progress.md`。

## 每輪價值檢查與迴圈停止規則

每輪開始前，主代理必須先回答：「下一個動作是否會有效推進重要產品功能、產品安全、上線必要證據，或解除目前阻擋？」若否，必須重新規劃，不得繼續低價值重跑、補測或只追求 coverage 小幅上升。

若同一 Work Package、同一根因、同一失敗命令或同一指標連續兩次沒有可量化改善，必須標記 `LOOP_DETECTED`、保存精確證據並停止，向使用者詢問是否改變方向；不得自動重試形成迴圈。AGY `TOOL_BLOCKED` 最多保留兩次事實結果，不得藉此無限重試。

每次 handoff 都要記錄 `VALUE_CHECK`：本輪要改善的產品結果、預期驗收、實際結果與迴圈狀態。對使用者明確要求的長程 Goal，單一 WP acceptance 後可銜接下一個已核准 WP；但價值檢查失敗、偵測迴圈、範圍／風險改變或需新授權時，必須停下詢問使用者。

## AGY fallback 順序

重要產品 Work Package 在 deterministic tests 完成後，依序使用 **AGY Fast → AGY Deep → Luna**：Fast 最多兩次；兩次 `FIRST_OUTPUT_TIMEOUT`／`TOOL_BLOCKED` 或沒有 structured verdict，才經核准 failover wrapper 做一次 bounded Deep 唯讀審查。Deep 若仍無法取得可驗證結果，保存 `FALLBACK_HANDOFF_REQUIRED`，交由 native-agent Luna read-only runtime；PowerShell、MCP 與 wrapper 不得自動啟動 Luna，也不得把沒有結果寫成 PASS。任何 fallback 都必須記錄實際嘗試、狀態與 sanitized evidence，且不得取代 deterministic tests 或 Sol acceptance。
