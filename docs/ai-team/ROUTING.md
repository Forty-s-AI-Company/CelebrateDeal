# AI Team Lite v5.4 Routing

`route_task` 只回傳 `recommendation_only`，不會執行、等待或管理外部工具。

| 任務類型 | 建議目標 |
| --- | --- |
| planning、major_planning、architecture、sol_acceptance_review | Planner／Sol：`gpt-5.6-sol`／High（唯讀） |
| agy_qa、browser_qa、e2e、ui_validation、quick_second_opinion | AGY Fast：Gemini Fast `gemini-3.6-flash-high`／High wrapper（唯讀） |
| implement、small_feature、bug_fix、complex_implementation、cross_file_fix、hard_debugging | Terra：`gpt-5.6-terra`（唯一可寫；依工作複雜度使用核准的推理等級） |

Canonical 路由僅支援 Terra scan → Sol 唯讀規劃 → Terra 實作與 deterministic tests → AGY Fast（plan + sandbox、最多兩次）唯讀 QA → Sol 唯讀 acceptance review。Explorer、Analyst、Worker Deep、Reviewer 與 Gemini Deep 不是預設路由或主流程分支；僅在使用者明確要求時，才能作為唯讀輔助證據，且不得取得寫入權限。

同一時間只允許 Terra 寫入。Sol 與 AGY Fast 均為唯讀；模型不可用時可由明確的 `.ai-team/scripts/Invoke-AiTeamReadOnlyFailover.ps1` 依核准 chain 產生 fallback handoff。Gemini Fast／Deep 之間的 wrapper fallback 仍受總嘗試上限約束；Luna（`gpt-5.6-luna`／xhigh）只作 native-agent handoff metadata，不能由 MCP 或 PowerShell 自動啟動，也不能冒充 AGY Fast PASS。

## 重要 Work Package 的 fallback chain

`agy_qa` 的實際順序為：

1. AGY Fast canonical wrapper，最多兩次。
2. 若兩次均 `FIRST_OUTPUT_TIMEOUT`、`TOOL_BLOCKED` 或沒有 structured verdict，使用核准 failover wrapper 做一次 bounded AGY Deep read-only review。
3. Deep 仍不可用時，只產生 `FALLBACK_HANDOFF_REQUIRED`，交給 native-agent Luna；不得由 PowerShell／MCP 自動啟動，也不得偽造 verdict。

此 chain 只用於有明確產品／安全／release 價值的工作；已標記 `LOOP_DETECTED` 的低價值重複 coverage 不得藉 fallback 形成新的重試迴圈。每一層結果都必須保留 sanitized 狀態，且不能替代 deterministic tests 或 Sol acceptance。
