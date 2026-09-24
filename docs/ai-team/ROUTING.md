# AI Team vNext Routing

這份文件是動態路由的 canonical 說明；唯一的政策來源是
[`.ai-team/config/routing-policy.json`](../../.ai-team/config/routing-policy.json)。
本文件不再維護另一套模型順序或固定角色流程。

## 決策流程

`route_task` 先驗證結構化 signals，再依序執行：

1. 由 `risk_categories`、三種 impact、task type 與明示 risk 計算風險；Critical 類別直接提高驗證與獨立審查底線。
2. 由 task type、context size、duration 與 code surface area 計算最低 complexity floor。
3. 以 `MODEL_ROUTING` 直接選擇足以完成工作的最低成本模型。
4. 依 requested team 的能力上限決定 Lite、Standard 或 Pro；超出能力時回傳 escalation，而不是偷偷使用高階模型。
5. 只有已選模型 unavailable、quota=0、CLI failure 或 repeated failure 時，才套用 `MODEL_FALLBACK`。
6. 回傳 review plan 與 dispatch limits；router 本身永遠不 spawn agent 或執行外部模型。

Task type floor、caller complexity 與 size requirement 決定實作 complexity；risk requirement 另外決定審查與驗證，兩者不混為同一分數。Explicit low 不能降低 `cross_module`、`complex_debug`、`deep_review` 的能力底線，也不能降低 Critical 的風險底線。

輸入 precedence 為 explicit caller override > structured `task_signals` > compatibility/default inference。Legacy `difficulty` 只接受 `auto`、`trivial`、`routine`、`complex`、`critical`；其他值回 `INVALID_INPUT`，不會默認 Medium。

## Engineering routing

| 任務條件 | 直接模型 | reasoning |
| --- | --- | --- |
| 可用確定性工具完成的搜尋與分類 | 工具優先；需語意判斷時 GPT-6 Luna | low |
| 規格清楚的局部與中型 CRUD、API、UI、測試 | GPT-6 Luna | high |
| 模糊需求、困難跨模組整合、複雜 debug | GPT-6 Sol | medium；證據需要時 high |
| 大型 architecture、困難 RCA 與一致性推理 | GPT-6 Sol | medium/high |
| 重大未解問題、明確仲裁或 Sol 不足 | GPT-6 Astra | low 起；提高須註明理由 |
| 低實作 complexity 但 Payment、Auth、Security、RBAC 等 Critical risk | 明確且局部的實作可用 Luna high；困難實作直接 Sol | 必要檢查與合格 Critical 獨立審查不能省略 |

風險不會因為只改一行而消失。例如單行 Payment/Auth 修改仍會升級到 Critical path。
`ai-team-pro` 是能力上限，不是 Astra/Opus 的強制啟動開關；Pro 內的簡單 copy 仍選 Luna。

## Review routing

| review 類型 | 路由 |
| --- | --- |
| Low scope | Luna self-review；有價值時 Gemini Medium |
| 普通廣域 diff／QA | Gemini Medium/High，輸出 candidate findings |
| Medium risk 或重要 candidate finding | 視需要選一次合格的獨立審查 |
| 複雜 plan／business logic | Claude Sonnet Thinking |
| Critical security、payment、auth、billing、production data | Claude Opus Thinking，可直接跳過普通掃描 |
| Technical Arbiter | 有具體 `astra_reason` 時 Astra low 起；只有重大未解問題才啟動 |

Reviewer 統一輸出 `BLOCKER`、`MAJOR`、`MINOR`、`NIT`，每個 finding 必須包含 severity、file、line/area、issue、evidence、impact、recommended_fix、required_test、confidence。Reviewer 預設只回報，不直接改 code。

## Fallback 與 quota

Routing 與 fallback 是兩個獨立決策。Fallback chain 不得重複已失敗模型，也不得用較低能力模型假裝完成高風險工作。

| 已選工作 | fallback |
| --- | --- |
| Luna engineering | 能力不足時 Sol；不可用時依 tier 規則處理 |
| Sol engineering | 無合格替代則阻擋；有具體例外理由才考慮 Astra |
| Gemini broad review | Luna 或 Sol，依審查能力需求 |
| Gemini QA | Luna；困難 QA 可用 Sol |
| Sonnet deep review | Sol High → Astra High |
| Opus Critical review | Astra XHigh → Sol XHigh |

`quota=0` 只會跳過該 provider；unknown/null 不等於 0。Gemini 與 Claude 都不可用時，必要工作回到 Codex；agy 整體不可用也不能阻斷 native routing。Critical 若沒有任何合格模型，回傳 `NO_CAPABLE_MODEL` 或 `REVIEW_BLOCKED`，不可 skip required review。

agy failure receipt 必須保留分類：`AUTH_REQUIRED`、`HOST_PERMISSION_BLOCKED`、`AGY_NOT_INSTALLED`、`MODEL_UNAVAILABLE`、`AGY_RUNTIME_ERROR`。Host-side 已登入但 Codex sandbox 讀取 agy 狀態遭拒時，使用 `HOST_PERMISSION_BLOCKED`/`HOST_AUTH_CONTEXT_UNAVAILABLE`；不可直接推論成 `AUTH_REQUIRED`。所有上述 provider failure 都只影響外部 review/QA，必要工作仍依 `MODEL_FALLBACK` 回到足夠的 Codex 模型。

## Team tier

| invocation | 可用能力上限 | 行為 |
| --- | --- | --- |
| `ai-team-lite` | GPT-6 Luna、已驗證 Gemini Flash Medium | 小範圍低風險；預設單 Agent |
| `ai-team` | 額外允許 GPT-6 Sol、Flash High、已驗證 Sonnet | 日常正式工程 |
| `ai-team-pro` | 全部模型，含 Astra/Opus | 高風險或高複雜度；仍依任務選最低足夠模型 |
| `ai-team-style` | Lite 能力上限 | 保留視覺偏好，不建立第四套政策 |

使用者 invocation、`Switch-AiTeamMode.ps1 -List/-Status`、舊 wrapper 名稱與 MCP positional API 維持相容。Selector 只選 mode，不會熱切換目前工作或改寫 `.codex`。

## 執行與驗收證據

`route_task` 與 `Invoke-AiTeamTask.ps1 -PlanOnly` 只產生建議，不代表模型已執行。現有 wrapper 預設在 native 路由時回傳 `FALLBACK_HANDOFF_REQUIRED`，供 Codex Desktop 主代理按 handoff 執行；如明確指定 `-ExecuteNative`，還須提供當前 CLI 已驗證可用的 `-VerifiedNativeModels`，才透過 `codex exec -m/-c` 傳入模型與 effort。未驗證時回 `NATIVE_MODEL_UNVERIFIED`，不以 Desktop 顯示的能力推定本機 CLI 也已支援。子程序帶有 `AI_TEAM_CHILD=1`。成功 exit 只回 `EXECUTED_NEEDS_VALIDATION`，不會自動 READY。唯讀角色使用 read-only sandbox；寫入角色使用 workspace-write。主對話本身的模型無法由 router 熱切換，必須由 Desktop 使用者或上層執行環境設定。

Receipt 區分 `requested`、`resolved` 與 `observed`。CLI 未回報實際模型時，`observed=unknown`；子代理選 Luna 不代表主對話的消耗變成 Luna。先以 MCP `snapshot_task` 對明確列出的專案檔案產生內容摘要，將 root、files、revision 交給 `route_task`；`assess_task` 與 `goal_finalize` 會重新計算摘要，檔案變更後舊證據不能 READY。必要檢查必須有同一 `source_revision`、由 `validation_runner.py` 實際執行且 exit 0 的 JSON 收據；High/Critical 還需符合 review plan 模型與角色的獨立 review 收據。舊 wrapper 只回傳路由、handoff 或 provider 完成狀態，不能自己回 READY。

可選的效益比較：挑同一組已匿名化、可重跑且不碰正式資料的代表任務，分別以 Luna 單代理、Sol 單代理、現行路由執行；事先固定驗收條件、snapshot 與必要檢查，記錄一次驗收率、重試次數、耗時、人工介入與 provider 實際回報的 usage。不同訂閱的額度百分比不相加；沒有真實資料前不宣稱節省幅度。這是人工啟動的評估，不是日常自動多模型流程。

舊 Terra／GPT-5.6 active 設定應遷移至 Luna 或 Sol；未知模型與不支援的 model/effort 組合會拒絕，而非靜默繼續使用舊模型。`xhigh`／`max` 要有 `effort_reason`；Astra 要有 `astra_reason`，其中 `sol_insufficient` 還要附上 failure evidence。

## Limits 與安全

預設 `max_depth=1`、`max_parallel=1`、`max_dispatch=4`、每模型最多一次嘗試、automatic spawn=false。`AI_TEAM_CHILD=1`、`parent_depth>0` 或 dispatch budget 用盡時立即回傳 `BLOCKED_RECURSION`／`BUDGET_EXHAUSTED`。純 router/MCP 不呼叫 spawn、Codex CLI、agy 或自己的 MCP。

所有 provider discovery 必須以當次 `agy models` 的精確 slug 為準；未登入、CLI 不存在、輸出截斷或歧義都走 native fallback，不能猜 slug。敏感輸入、secret、Production 與正式付款永遠在 router/wrapper 邊界拒絕。

Project MCP 由 `.ai-team/scripts/Start-AiTeamMcp.ps1` 啟動。Launcher 從 repository 解析所有路徑，並可依 `.ai-team/mcp_server/requirements.txt` 重建 ignored `.ai-team/.venv`；`.codex/config.toml` 不保存使用者或 checkout 絕對路徑。

完整驗收矩陣與執行狀態見 [`docs/ai-team-vnext-plan.md`](../ai-team-vnext-plan.md) 與 [`vnext-validation.md`](vnext-validation.md)。
