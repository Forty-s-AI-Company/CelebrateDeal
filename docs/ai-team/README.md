# CelebrateDeal AI Team 文件索引

## Canonical 入口

- Planner：`prompts/planner-prompt.md`
- Executor：`prompts/executor-prompt.md`
- Workflow policy：`workflow-policy.md`
- Workflow mode：`workflow-mode.md`
- Handoff schema：`handoff-schema.md`
- Goal protocol：`GOAL-PROTOCOL.md`
- Goal state：`.ai-team/state/goal-state.json`
- Evidence：`.ai-team/reports/` 與 `docs/launch/evidence-index.md`

## 目前模式

`PRELAUNCH_DEV_AUTONOMOUS` 允許長程 Goal 連續推進、多代理協作、本機／staging／sandbox 驗證、精確 local checkpoint commit，以及依產品價值選擇測試與驗收。流程不再以固定 Work Package 時間或固定代理順序阻擋進度。

## 文件分類

| 分類 | 文件 | 用途 |
| --- | --- | --- |
| CANONICAL | `workflow-policy.md`、`handoff-schema.md`、`prompts/` | 目前協作與交接規則 |
| ACTIVE_REFERENCE | `ARCHITECTURE.md`、`ROUTING.md`、`GOAL-PROTOCOL.md`、`workflow-mode.md` | 執行架構與 Goal 行為 |
| HISTORICAL | `evidence/`、舊 WP packet | 僅記錄當時 scope，不形成全域限制 |

## 永遠有效的安全底線

禁止讀取或輸出 `.env*`、憑證、Token、Cookie、正式 Secret、正式客戶資料與付款資料；禁止未授權 Production、正式 DB、真實付款、破壞性 migration、資料刪除與 destructive Git；禁止偽造 evidence、虛報 PASS、降低 assertion／threshold 或掩蓋失敗。
