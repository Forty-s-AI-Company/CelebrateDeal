# CelebrateDeal AI Team 文件索引

## Canonical 入口

- Planner 入口：[prompts/planner-prompt.md](prompts/planner-prompt.md)
- Executor 入口：[prompts/executor-prompt.md](prompts/executor-prompt.md)
- Workflow policy：[workflow-policy.md](workflow-policy.md)
- Workflow mode：[workflow-mode.md](workflow-mode.md)（目前 `PRELAUNCH_DEV`）
- Handoff schema：[handoff-schema.md](handoff-schema.md)
- Current Work Package：[current-work-package.md](current-work-package.md)
- Goal state：`.ai-team/state/goal-state.json`
- Evidence：`.ai-team/reports/` 與 `docs/launch/evidence-index.md`

Task 標題格式為 `YYYYMMDD｜CelebrateDeal｜<WP ID 或任務主題>｜<角色>｜<狀態>`。角色或 WP 改變時建立新 Task；同角色、同 WP 的窄範圍續修可保留目前 Task。Codex 不會代替使用者操作 Codex Desktop UI。

## 執行模式

目前預設為 `PRELAUNCH_DEV`。它以 ownership、可分離 hunks 與產品保護邊界檢查變更，不使用固定 dirty path count；living plan self-hash 只是資訊性 metadata，不會形成循環 blocker。只有使用者明確要求才能切換到 `RELEASE_HARDENING`。

同一 WP、同一根因且範圍可控時，Terra 可在原 Task 進行最多 3 輪 remediation、2 次 canonical full run，並擴張至最多 8 個直接相關檔案。需要產品／架構決策、正式環境、migration 策略、跨模組變更、Git ownership 不明或超過配額時，才需交回 Sol 或使用者。

## 文件分類

| 分類 | 文件 | 用途 |
| --- | --- | --- |
| CANONICAL | `workflow-policy.md`、`handoff-schema.md`、`prompts/planner-prompt.md`、`prompts/executor-prompt.md` | 目前交接規則與可直接使用的角色入口。 |
| ACTIVE_REFERENCE | `ARCHITECTURE.md`、`ROUTING.md`、`GOAL-PROTOCOL.md`、`TROUBLESHOOTING.md`、`current-work-package.md` | Lite 架構、固定路由、Goal state 與故障處理背景。 |
| DEPRECATED | 無已確認需停用的 AI Team 文件。 | 若發現舊 Prompt 與 canonical policy 衝突，舊 Prompt 即不應再使用。 |
| ARCHIVE_CANDIDATE | 歷史 evidence、過時 Task Prompt 或已被 policy 取代的 orchestration 說明。 | 先分類與加註，不直接大量刪除。 |

已失效的 Codex CLI、Ollama 與重型 MCP orchestration 不屬於目前 canonical 流程；保留歷史資料時，應在文件開頭加上 `DEPRECATED — use docs/ai-team/workflow-policy.md`。
