# AI Team vNext Routing

這份文件是動態路由的 canonical 說明；唯一的政策來源是
[`.ai-team/config/routing-policy.json`](../../.ai-team/config/routing-policy.json)。
本文件不再維護另一套模型順序或固定角色流程。

## CLI 模型對應（2026-10-05，更新 CLI 後更正）

Codex CLI 已由 0.145.0 更新為 0.160.0；以更新後 `app-server model/list` 為準，Luna 使用 `gpt-6-luna`、Sol 使用 `gpt-6.1-sol`、Astra 使用獨立的 `gpt-6-astra`。舊 CLI 僅列 GPT-5.6 不能代表目前帳號的最新模型能力；以後判定模型不可用前，先確認 CLI 版本與當次清單。

Claude 維持 `agy models` 已驗證的 `claude-sonnet-5-5-high`／`claude-opus-5-5-high`；High 編入 slug，effort 保留 `model-default`。先前將 Astra 對應 Sol 的臨時設定已撤除。相同 slug 的重試防護保留，但目前 Sol/Astra 為不同模型，失敗狀態不互相污染。Router effort 上限維持 max，不啟用 ultra 的自動委派。

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
| 超簡單 copy、UI、文件、局部快速工作 | GPT-6 Luna | low |
| 一般 coding/debugging、CRUD、API | GPT-6.1 Sol | low |
| 中等 complexity | GPT-6.1 Sol | medium |
| 大 context、多檔修改或 High complexity | GPT-6.1 Sol | high |
| 複雜 agent、architecture、RCA、High/Critical risk 修改 | GPT-6.1 Sol | xhigh |
| Very High complexity | GPT-6.1 Sol | max；不足時附具體理由升 Astra |
| 重大未解問題、明確仲裁或 Sol 不足 | GPT-6 Astra | low 起；提高須註明理由 |
| 低實作 complexity 但 Payment、Auth、Security、RBAC 等 Critical risk | GPT-6.1 Sol | xhigh；必要檢查與合格 Critical 獨立審查不能省略 |

風險不會因為只改一行而消失。例如單行 Payment/Auth 修改仍會升級到 Critical path。
多檔工作提高 workload/effort，機械式修改仍可維持 Low complexity。Very High 優先 Sol max，不直接選 Astra。政策產生的 xhigh/max 會記錄 `engineering_profile` 作為 `effort_reason`；明示較低 effort 不能降低政策底線，不支援的組合回報錯誤。
`ai-team-pro` 是能力上限，不是 Astra/Opus 的強制啟動開關；Pro 內的簡單 copy 仍選 Luna。

## Review routing

| review 類型 | 路由 |
| --- | --- |
| 簡單 copy／UI 自測 | 可單代理實作與確定性測試；不是 GPT 最終模型裁決 |
| 普通廣域 diff／QA | Gemini Medium/High，輸出 candidate findings |
| 一般工程最終審查／重要 findings | Claude；需保留來源與實際執行收據 |
| 複雜 plan／business logic | Claude Sonnet 5.5 High |
| Critical security、payment、auth、billing、production data | Claude Opus 5.5 High，可直接跳過普通掃描 |
| 範圍與 findings 仲裁 | Claude；非 Critical 才可由已驗證 Gemini 承接 |

Reviewer 統一輸出 `BLOCKER`、`MAJOR`、`MINOR`、`NIT`，每個 finding 必須包含 severity、file、line/area、issue、evidence、impact、recommended_fix、required_test、confidence。Reviewer 預設只回報，不直接改 code。

## Fallback 與 quota

Routing 與 fallback 是兩個獨立決策。Fallback chain 不得重複已失敗模型，也不得用較低能力模型假裝完成高風險工作。

| 已選工作 | fallback |
| --- | --- |
| Luna engineering | 能力不足時 Sol；不可用時依 tier 規則處理 |
| Sol engineering | 無合格替代則阻擋；有具體例外理由才考慮 Astra |
| Gemini broad review | Luna 或 Sol，依審查能力需求 |
| Gemini QA | Luna；困難 QA 可用 Sol |
| Sonnet final review | 已驗證 Gemini 可承接非 Critical 裁決；不能落到 GPT |
| Opus Critical review | 缺席則 REVIEW_BLOCKED，無靜默 GPT fallback |

`quota=0` 只會跳過該 provider；unknown/null 不等於 0。AGY 狀態缺省為 NOT_CHECKED，回傳 AGY_DISCOVERY_REQUIRED，不能當成 unavailable。實際 discovery／呼叫失敗才記 CALL_FAILED 與失敗分類。工程與候選 QA 可繼續使用 Codex；最終外部審查缺席時不能 READY，Critical 回傳 REVIEW_BLOCKED。

agy failure receipt 必須保留分類：`AUTH_REQUIRED`、`HOST_PERMISSION_BLOCKED`、`AGY_NOT_INSTALLED`、`MODEL_UNAVAILABLE`、`AGY_RUNTIME_ERROR`。Host-side 已登入但 Codex sandbox 讀取 agy 狀態遭拒時，使用 `HOST_PERMISSION_BLOCKED`/`HOST_AUTH_CONTEXT_UNAVAILABLE`；不可直接推論成 `AUTH_REQUIRED`。上述 provider failure 不授予 GPT 最終裁決資格；實作與測試可繼續，最終審查仍依 canonical policy。

## Team tier

| invocation | 可用能力上限 | 行為 |
| --- | --- | --- |
| `ai-team-lite` | GPT-6 Luna、已驗證 Gemini Flash Medium | 小範圍低風險；預設單 Agent |
| `ai-team` | 額外允許 GPT-6.1 Sol、Flash High、已驗證 Sonnet | 日常正式工程；一般 coding 起用 Sol low |
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

## 精確複審與裁決

review_scope_files 由既定 snapshot、review_changed_files 與 review_dependencies 計算；未經 authorized_scope_expansion 的新增來源拒絕。這只限制讀取範圍，不讓修正後沿用 stale revision 收據。MINOR／NIT 不自動阻擋或要求整輪重審；confirmed／unresolved BLOCKER／MAJOR 必須處理。爭議交外部合格 reviewer 裁決，新需求另記 scope proposal。

### Claude 訂閱 CLI 備援

AGY Claude 發生額度不足、模型缺席或呼叫失敗時，canonical `claude_cli` 政策允許獨立的訂閱 CLI transport；角色仍使用原 Sonnet／Opus 資格，不新增模型階梯。先以停用工具的最小 probe 驗證實際 `modelUsage`，再送固定快照。AGY 與 CLI 的 quota／attempt 狀態分開；未登入、CLI 未安裝、模型不符或逾時都不等於審查通過。CLI 的 alias 是 requested，終端實際 model 是 observed；未回報 effort 記 unknown。Critical 兩個 Claude transport 都失敗仍為 REVIEW_BLOCKED。`--safe-mode`、空 tools、strict MCP、停用 session persistence 為必要參數，禁止 permission bypass。
