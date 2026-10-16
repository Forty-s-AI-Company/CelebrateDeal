# AI Team Troubleshooting

## Router input 或設定錯誤

先檢查 `.ai-team/config/routing-policy.json` 是否為有效 JSON，再使用 `route_cli.py` 的 `route` action。`risk_categories` 必須是已知 array，數值必須是有限且非負，`parent_depth`、`dispatch_count` 與 `code_surface_area` 不接受負數、bool 或字串。敏感輸入直接拒絕，不把整個 repository 塞進 task summary。

`difficulty` 僅接受 `auto/trivial/routine/complex/critical`。MCP 與 PowerShell 都使用 explicit caller > structured signals > default 的 precedence；未知 difficulty 或其他 invalid signal 必須修正 caller，不會靜默降級。

## MCP bootstrap

`.codex/config.toml` 透過 `.ai-team/scripts/Start-AiTeamMcp.ps1` 啟動。Launcher 會從自身位置解析 repository root；`.ai-team/.venv` 不存在或缺少 dependencies 時，依 `.ai-team/mcp_server/requirements.txt` 重建。可先執行：

```powershell
pwsh -NoProfile -File .ai-team/scripts/Start-AiTeamMcp.ps1 -BootstrapOnly
```

此 probe 只載入本地設定並驗證 `router_status`／`route_task`，不讀 `.env*`、不呼叫 AGY、不啟動 Agent。

## 模型 unavailable 與 quota

Routing 先選模型，只有 selected model unavailable、quota=0、CLI failure 或 repeated failure 才 fallback。`null`、缺欄位與 provider 未知不是 quota=0；不能重試同一失敗 slug。

| 工作 | fallback |
| --- | --- |
| Luna engineering | Sol（Luna unavailable 或已有能力不足證據）；不逐格重試 effort |
| Sol engineering | 無自動能力降級；Astra 只在有明確例外理由時使用 |
| Gemini broad review | Luna／Sol，依原任務能力底線 |
| Gemini QA | Luna；困難 QA 可用 Sol |
| Sonnet deep review | Sol High → Astra High |
| Opus Critical review | Astra XHigh → Sol XHigh |

Critical 工作若所有合格模型都 unavailable，回傳 `NO_CAPABLE_MODEL` 或 `REVIEW_BLOCKED`；不可降到 Gemini/Luna，也不可 skip required review。

## agy discovery

需要外部 review/QA 時才執行一次 bounded `agy models`。只有清單中精確出現的 slug 才能呼叫。錯誤必須區分：

| 分類 | 意義 | 行為 |
| --- | --- | --- |
| `AUTH_REQUIRED` | agy 明確回報未登入或需要 sign-in | 保留 auth 狀態，走 Codex fallback |
| `HOST_PERMISSION_BLOCKED` | Codex/Windows 對 agy log、crash、cache 或 process 回傳 Access Denied/EPERM/EACCES | 不改判為未登入；走 Codex fallback |
| `AGY_NOT_INSTALLED` | `Get-Command agy` 找不到 executable | 走 Codex fallback |
| `MODEL_UNAVAILABLE` | discovery 清單沒有所需模型或 provider 回報 model not found | 走 Codex fallback |
| `AGY_RUNTIME_ERROR` | 其他 agy CLI/process failure | 保留 bounded failure，走 Codex fallback |

`agy` 已在 Host-side 驗證登入時，Codex sandbox 的 Access Denied 只能記為 `HOST_PERMISSION_BLOCKED` 或 `HOST_AUTH_CONTEXT_UNAVAILABLE`，不能宣稱 `AUTH_REQUIRED`。未登入、CLI 不存在、輸出截斷、歧義或 quota 不明仍要如實記錄，不得猜測 slug，也不得無限重試。

Gemini 只提供廣域 candidate findings/QA；重大架構、Payment、Auth、RBAC、Security、Migration 與資料完整性決策必須交給 Sonnet、Opus、Astra 或 Codex fallback 的合格路徑。

## Review response

stdout/exit 0 不等於 review 成功。必須通過共用 schema，輸出 `summary` 與 `findings`；每個 finding 要有 severity、file、line/area、issue、evidence、impact、recommended_fix、required_test、confidence。缺欄位、malformed JSON、截斷或空 output 都是 bounded failure，不可標 `REVIEW_COMPLETED`。

## Recursion 與 budget

`AI_TEAM_CHILD=1`、`parent_depth>0`、`dispatch_count>=max_dispatch` 或 child process 未取得可強制 guard 時，不得啟動下一層 Team。policy 預設最大深度 1、平行 1、總 dispatch 4、automatic spawn=false；結果應為 `BLOCKED_RECURSION` 或 `BUDGET_EXHAUSTED`。Router/MCP 永遠不 spawn，wrapper 只執行一次 bounded external process。

## Process 與證據

timeout、空 stdout/stderr、auth failure、非零 exit 與 cleanup 都要保留 sanitized receipt。不得讀取 `.env*`、輸出 secrets、使用 permission bypass 或用 skip/exclude 掩蓋失敗。若 protected `.agents`、`.codex`、`.git` 無法寫入，標示環境阻擋並保留待辦，不換工具繞過。

執行順序與 C01–C30 驗收矩陣見 [`ai-team-vnext-plan.md`](../ai-team-vnext-plan.md)；本輪實際證據見 [`vnext-validation.md`](vnext-validation.md)。
