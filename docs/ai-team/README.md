# CelebrateDeal AI Team 文件索引

## Canonical 入口

- Planner 入口：[prompts/planner-prompt.md](prompts/planner-prompt.md)
- Executor 入口：[prompts/executor-prompt.md](prompts/executor-prompt.md)
- Workflow policy：[workflow-policy.md](workflow-policy.md)
- Workflow mode：[workflow-mode.md](workflow-mode.md)（目前 `PRELAUNCH_DEV`）
- Handoff schema：[handoff-schema.md](handoff-schema.md)
- Goal protocol：[GOAL-PROTOCOL.md](GOAL-PROTOCOL.md)
- Goal state：`.ai-team/state/goal-state.json`
- Evidence：`.ai-team/reports/` 與 `docs/launch/evidence-index.md`

## 五階段 canonical flow

`Terra scan → Sol 唯讀規劃 → Terra 實作與 deterministic tests → AGY Fast 唯讀 QA → Sol 唯讀 acceptance review → 主代理 checkpoint/finalize`。

Sol 只產生完整可執行計畫與 acceptance 結論，不寫 `current-work-package.md` 或 Goal state。Terra 是唯一可寫角色，負責 control-plane packet、實作、測試與證據。AGY Fast QA 預設自動同意 headless 權限提示，且維持 plan + sandbox、最多兩次；它不能取代 deterministic tests。Sol 只可回傳 `ACCEPT`、`CONTINUE_CURRENT_WP` 或 `PLAN_REMEDIATION`，僅 `ACCEPT` 可進入 finalize。

目前預設為 `PRELAUNCH_DEV`。它採 ownership、可分離 hunks 與產品保護邊界，不使用固定 dirty path count、固定 remediation／full run 配額或固定檔案數作為硬性阻擋。修復仍須合理、可回滾、有針對性驗證；正式環境、secret、付款、部署、破壞性 migration、偽造測試、覆蓋使用者變更與不可逆 Git 操作永遠不放寬。

## 文件分類

| 分類 | 文件 | 用途 |
| --- | --- | --- |
| CANONICAL | `workflow-policy.md`、`handoff-schema.md`、`prompts/planner-prompt.md`、`prompts/executor-prompt.md` | 目前交接規則與可直接使用的角色入口。 |
| ACTIVE_REFERENCE | `ARCHITECTURE.md`、`ROUTING.md`、`GOAL-PROTOCOL.md`、`workflow-mode.md` | Lite 架構、路由、Goal state 與模式背景。 |
| DEPRECATED | 無已確認需停用的 AI Team 文件。 | 舊 Prompt 與 canonical policy 衝突時不得使用。 |

已失效的 Codex CLI、Ollama 與重型 MCP orchestration 不屬於目前 canonical 流程；保留歷史資料時，應在文件開頭加上 `DEPRECATED — use docs/ai-team/workflow-policy.md`。
