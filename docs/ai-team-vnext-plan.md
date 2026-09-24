# AI Team vNext Implementation Plan

- 文件版本：1.0，2026-09-19。
- 規劃者與設計核定：本對話的 GPT-6 Astra 主 Agent。
- 文件定位：本次 AI Team 重構的正式實作交接文件。先前只有對話中的計畫，這是第一次完整落檔。
- 狀態：設計已定，可依本文件接續實作；程式只有部分草稿，尚未通過整體驗收。
- 適用專案：CelebrateDeal。
- 實作者：Implementation Engineer。從既有未提交變更接手，不重新設計架構。
- 本文件不宣稱已完成部署、模型實測、原生派工整合或所有測試。

## 1. 任務範圍與執行限制

將現有 AI Team 改為任務導向的動態模型路由，保留 `ai-team-lite`、`ai-team`、`ai-team-pro` invocation。`ai-team-style` 保留為 Lite 的視覺工作相容入口。

執行本次重構的主 Agent 必須獨立工作，不啟動現有 AI Team skill、Router Manager、Planner 或 Reviewer 來決定、實作或驗收它們自己的架構。可在隔離測試中 import 純函式、啟動本地測試用 MCP 和 synthetic wrapper；不得把新路由接入本次工作或呼叫真人帳號模型代做重構。

本文件是已核定的目標規格；工作樹中的半成品只是待修正素材。發現草稿不符本文件時應修正草稿。需要超出本文件的架構改動時，記錄 `PLAN_CONFLICT`，交 Terra／Sol／Astra 判斷，不自行另建 orchestration framework。

維持原有安全底線：不讀取或輸出 `.env*`、憑證、正式 Secret、正式客戶或付款資料；不操作正式資料庫、金流、退款、寄信或 Production deployment；不丟棄既有變更、不降低 assertions／coverage、不虛報 PASS。不得繞過 sandbox 或唯讀目錄限制。

## 2. 已完成調查與接手基準

### 2.1 調查方式與邊界

前一輪已用 repository-wide `rg` 掃描檔名與 AI Team、agent/subagent、model、reasoning、fallback、quota、agy、Gemini、Claude、prompt、risk 等內容，另外檢查 `.gitignore` 忽略但仍實際存在的 `.codex/agents/*.toml`。排除 `.git` 內部、dependency、生成 bundle 與敏感檔案內容。

讀取過 runtime、六份模式 JSON、PowerShell wrappers、MCP tests、CI、根目錄 AGENTS、現有兩個 skill、canonical docs 與 prompts。歷史 WP、evidence 和 archive 只作來源分類，不把當時規則視為現在有效規格。產品程式中的 quota／agent 字詞不屬於 AI Team runtime，不修改。

### 2.2 原有執行鏈

| 元件 | 原有行為與問題 |
| --- | --- |
| `.codex/config.toml` | 註冊 `ai_team_router` MCP，七個工具；command 指向 `.ai-team/.venv/Scripts/python.exe`，調查時該 interpreter 不存在 |
| `.ai-team/mcp_server/server.py` | recommendation-only MCP，管理 Goal state；固定 ROUTES 與 JSON 部分覆寫並存，沒有完整 risk／quota classifier |
| `.ai-team/config/router*.json` | 複製 planner、worker、review、reasoning、fallback；Lite／Standard／Pro 各自固定模型，容易漂移 |
| `Switch-AiTeamMode.ps1` | 複製模式設定，另用文字替換改 Codex config／worker TOML；可能把目前工作切換成固定模型 |
| `Invoke-AgyFast.ps1` | 寫死 Gemini Flash High，可重試，曾預設加入 permission bypass |
| `Invoke-AgyDeep.ps1` | 寫死 `gemini-3.1-pro-high`，不符合這次模型配置 |
| `Invoke-AgyPlanReview.ps1` | 寫死 Sonnet slug；程序成功即標 PASS；quota 不足可跳過 |
| `Invoke-AiTeamReadOnlyFailover.ps1` | 固定 Fast／Deep／Luna 階梯，能力與風險不參與判斷；部分模式的 profile 名稱不相容 |
| `.codex/agents/*.toml` | 存在被 Git 忽略的 native descriptor；Explorer／Analyst 仍是 `gpt-5.4-mini`／`gpt-5.4`，Worker 文本有編碼損壞；需核對實際載入來源 |
| `.agents/skills/*`、AGENTS、docs/prompts | 重複固定模型、reasoning 與 fallback；高風險 review 可否跳過、Planner 工作邊界彼此衝突 |
| Python／PowerShell tests | 多數綁定舊固定模型；handoff checker 還要求目前文件已不具備的舊流程欄位 |
| `.github/workflows/ci.yml` | push／PR 已有 ESLint、typecheck、coverage 與 AI Team tests；Python step 只跑 `test_server.py`，尚未涵蓋新 `test_routing.py` |

舊 MCP 本身不 spawn 或連網，這項安全特性應保留。沒有證據顯示已發生 recursive self-call，但 wrapper／prompt／native 派工缺乏統一防護，不能以「目前沒發生」代替 guard。

### 2.3 工作樹已存在的半成品

以下檔案在文件建立前已修改或新增，不可盲目重建或回復：

- 六份 selector：`router.json`、`router.low.json`、`router.high.json`、`router.pro.json`、`router.style.json`、`router.astra-standard.json`。
- 新增 `.ai-team/config/routing-policy.json`。
- MCP：已修改 `server.py`、`test_server.py`；新增 `routing.py`、`route_cli.py`、`test_routing.py`。
- PowerShell：已修改 `Invoke-AgyFast.ps1`、`Invoke-AgyDeep.ps1`、`Invoke-AgyPlanReview.ps1`、`Invoke-AiTeamReadOnlyFailover.ps1`、`Invoke-AiTeamProcess.ps1`、`Switch-AiTeamMode.ps1`、`Test-AiTeamResilience.ps1`。
- 新增 `Invoke-AiTeamTask.ps1`、`Test-AiTeamRouting.ps1`。
- `.codex/config.toml` 有任務開始前就存在的空白行變更，必須保留，不能當作本次實作成果。

### 2.4 真實驗證狀態

1. 首次 Python suite：19 個 test methods，18 通過、1 失敗。12 個 acceptance subcases 當輪通過；失敗為英文 `copy edit` 未識別成文案，模式 template 測試收到 Terra。
2. `copy edit` 的 keyword 已修改，但沒有完成修改後的整套重跑，不能宣稱修復已驗證。
3. PowerShell integration test 失敗：`Invoke-AiTeamTask.ps1` 的 child guard 在 `AI_TEAM_CHILD=1` 且 TaskSignals 沒有 `parent_depth` 時讀取不存在的 property；顯示 `The property 'parent_depth' cannot be found`，並使 recursion assertion 失敗。
4. `agy models` 曾實際執行，回報未登入；沒有取得目前帳號有效模型清單，沒有完成 Gemini／Claude 真人模型呼叫驗收。
5. `.agents` 寫入已被權限拒絕；本工作階段 `.agents`、`.codex`、`.git` 為唯讀且不允許提權。skill、native config 尚未同步，也沒有 checkpoint commit。
6. 一般系統 Python 原先缺 `anyio`；前輪為測試將 requirements 安裝到 ignored `.ai-team/runtime/python-deps`。它只是本機測試依賴，不能冒充正式 MCP runtime 已可用。
7. 本次文件補寫不修程式、不重跑產品測試；上述均為先前已觀察的結果。

## 3. 核定架構

採一份共用 policy、一個純函式 router、一個薄 MCP adapter、一個共用外部 wrapper。不得建立三套獨立路由或把模型階梯複製到 prompts。

```text
使用者 invocation／Host Task
  → 模式 selector + 任務 signals + runtime availability/quota
  → routing.py：validate → classify → MODEL_ROUTING → MODEL_FALLBACK
  → route decision：model/effort/team/review requirements/limits/reasons
     ├─ MCP route_task：只回建議，由既有 Codex host 消費
     ├─ native model：host 執行或明確 handoff，wrapper 不啟動 Codex CLI
     └─ agy review/QA：Invoke-AiTeamTask → discovery → bounded read-only process
        → validated findings／Codex handoff／honest failure receipt
```

責任界線：

- Router／Manager 邏輯職位預設 Luna；已提供結構化 signals 時直接用 deterministic router，不為計算規則另花一次 LLM 呼叫。
- Python MCP 維持短時間、純本機、無外部 process。保留 Goal API，不新增 autonomous execution tool。
- 外部 wrapper 僅執行被選定的 agy 唯讀工作，且先確認實際 slug。Codex recommendation 交還 host。
- `review_plan` 是必要驗收工作，不代表每項都自動 spawn。主 Agent 管理 scope、分工與最終整合。
- Gemini findings 是候選問題。重大技術決策由具資格的 reviewer／Astra 與主 Agent 依 evidence 完成。
- 不修改、重啟或熱切換目前重構工作使用的模型、MCP 連線與 agent 設定。runtime activation 放在全部 gate 通過後。

## 4. 資料合約

### 4.1 任務輸入

保留 `route_task(task_summary, task_type="", difficulty="auto")` 的 positional 呼叫，新增 optional `task_signals`、`runtime`、`team`，不移除既有入口。

| 欄位 | 型別／單位 | 行為 |
| --- | --- | --- |
| `task_summary` | 非空文字，最多 20,000 字元 | 敏感輸入拒絕；不把整個 repository 貼入 |
| `task_type` | 正規化 enum／相容 alias | 明確類型優先；未提供才用 keyword 輔助 |
| `complexity` | `auto/low/medium/high/very_high` | 不可壓低已知 task-type capability floor |
| `risk` | `low/medium/high/critical` | 與 impact、category 證據取較高值 |
| `risk_categories` | 去重的 enum array | 不接受未知值或字串冒充 array |
| `context_size` | 估計輸入 token 數 | 非負有限數；不是字元數，也不是模型 context window 規格 |
| `expected_duration` | 預估分鐘 | 非負有限數 |
| `code_surface_area` | 預期修改／審查的檔案數 | 非負整數 |
| `production_impact` | risk enum | 可獨立提升 risk，不授權操作 Production |
| `security_impact` | risk enum | 同上 |
| `data_integrity_impact` | risk enum | 同上 |
| `important_findings` | boolean | 已有重要候選 finding 時要求 senior review |
| `parent_depth` | 非負整數 | host 提供；child 不可重新啟動 Team |
| `dispatch_count` | 非負整數 | host 持有的累計值，不能由 child 自行重設 |

舊 `difficulty` 相容：`trivial→low`、`routine→medium`、`complex→high`、`critical→very_high`。這只是 complexity 輸入，不能使 critical risk 降級。未知 legacy 值應清楚回報 invalid，不默默選廉價模型。

### 4.2 Runtime 輸入

- `agy_available`：`true/false/unknown`；未知不直接呼叫 agy。
- `agy_models`：邏輯 key 至實際 discovery slug 的 mapping。
- `discovered_slugs`：本次成功 inventory 中的原始 slug；mapping 必須是其子集。
- `models[key或slug].available`：host／provider 實際可用性。
- `models[key或slug].quota_remaining`、`quota.codex/gemini/claude`：非負有限值或 unknown；0 才代表耗盡。不得將 null／缺值解釋為 0 或無限額度。
- `models[key或slug].failure`：限定 fallback reason。
- `attempted_models`：本工作已嘗試的邏輯 key；禁止重複使用失敗模型。
- `child_process`：外部執行環境的 guard signal。

Host 能取得 Codex account usage 與模型清單時，使用 read-only 能力取得 sanitized availability。只能取得 account 共用 quota 時按共用額度處理，不捏造每模型額度。沒有模型級資料時推薦結果須標示 runtime-dependent，實際 dispatch 前由 host 核實。

### 4.3 輸出

至少包含 `status`、`execution`、`signals`、`requested_team`、`team`、`escalated`、`selected_model`、實際 `model_key/model/provider/reasoning_effort`、`fallback_events`、`fallback_chain`、`review_plan`、`limits`、`handoff`。

既有常用 `target/task_type/difficulty/model/provider/reasoning_effort/execution` 保留可讀性；新增欄位不應破壞呼叫端。實作時查找所有 repository consumers，更新依賴舊巢狀 config 的程式。舊 response 有歧義的 PASS 語意不能保留。

狀態明確區分：`planned`、`NO_CAPABLE_MODEL`、`REVIEW_BLOCKED`、`BLOCKED_RECURSION`、`BUDGET_EXHAUSTED`、`INVALID_INPUT`。wrapper 使用 `PLANNED`、`REVIEW_COMPLETED`、`FALLBACK_HANDOFF_REQUIRED` 等 receipt；handoff 必須 `completed=false`，不能回報已完成工作。

## 5. Risk／complexity classifier

### 5.1 Risk 類別

| Category | 分數 | 直接 Critical |
| --- | ---: | --- |
| Payment／refund／payout | +3 | 是 |
| Billing | +3 | 是 |
| Auth | +3 | 是 |
| RBAC／Permission | +3 | 是 |
| Security | +3 | 是 |
| Production data | +3 | 是 |
| Database migration | +3 | 是，先採保守規則 |
| Revenue sharing | +3 | 是 |
| Webhook | +2 | 否；與 Payment／Auth 結合立即 Critical |
| Concurrency | +2 | 否 |
| Cross-module architecture | +2 | 否 |
| Breaking API | +2 | 否 |
| Large refactor | +2 | 否 |
| Dependency upgrade | +1 | 否 |
| UI-only／Copy-only | +0 | 否；不抵銷其他風險 |

規則順序：驗證輸入 → 取得明示與可辨識的 category → 每類只計一次 → Critical category 優先 → risk 與三個 impacts 取最高 → 其餘 score 1–3 至少 Medium、4 以上至少 High。分數只作訊號，不能抵銷 category 或人工標註的更高 risk。

keyword 只是相容用的輔助，不能宣稱能理解所有安全語境。優先接受 host 依變更檔案、diff 與實際 scope 給的結構化 category。`auth review`／`security_review` 類型也要強制 Critical。錯字、copy、單行標籤不得壓過 payment/auth category。

### 5.2 Complexity

| 等級 | 預設任務 | Engineering 模型 |
| --- | --- | --- |
| Low | copy、CSS／小 UI、format、簡單測試修正、repo lookup、release checklist | Luna |
| Medium | CRUD、一般 API／Feature／component／refactor、普通分析／規劃 | Terra |
| High | cross-module、complex debug、核心 business logic、複雜 state／concurrency | Sol |
| Very high | 大型 architecture、重大 migration 設計、陌生且深度 RCA、重大技術爭議 | Astra |

task_type 的最低能力要求不可被 `complexity=low` 蓋掉。`plan` 最低 Terra；低風險一般查找不因角色叫 Analyst 就自動 Astra。大型架構由 Planner／Astra 處理；Technical Arbiter 僅在明確爭議或重大未解問題時啟動。

Size 上調門檻沿用草稿作為可測試的政策值，不冒充模型官方能力限制：context ≥20,000／80,000 tokens、duration ≥30／120 分鐘、surface ≥4／12 檔，分別至少 Medium／High。Size 單獨不強制 Astra，需搭配 task type 或明示 Very high。門檻存一份 JSON，不散落到 wrappers。

## 6. MODEL_ROUTING

採最便宜且足夠的能力。以下表由 task risk／type 決定，不從第一個模型逐個試用。

| 條件／角色 | 直接選擇 | reasoning／限制 |
| --- | --- | --- |
| Manager、簡單 Explorer、release checklist | Luna | Low；純分類可直接跑 deterministic router |
| 一般 Planner | Terra | Medium |
| 複雜 Planner／Developer | Sol | High |
| 大型架構／高風險重大設計 | Astra | High；必要仲裁用 XHigh |
| Low complexity + Low risk Developer | Luna | Low |
| Medium complexity + Low／Medium risk Developer | Terra | Medium |
| High complexity Developer | Sol | High |
| High risk Developer | 至少 Sol | High，附 High review requirements |
| Critical risk Developer | 至少 Sol；Very high 用 Astra | High，附 Critical review requirements |
| Low review | Luna／Terra self-review | 小任務不另開 Reviewer Agent |
| 普通廣域 review | Gemini Medium／High | 小 scope／Low 用 Medium；大型或 Medium 以上用 High |
| Medium risk review | Gemini High | 重要 finding 才轉 Sonnet 驗證 |
| Deep／business／plan review | Sonnet Thinking | 限縮 context；不可拿 Claude 掃整個 repo |
| High risk review | Gemini High 候選掃描 + Sonnet 深度判斷 | 工作不同；不自動複製兩份相同 review |
| Critical security/payment/auth 等 review | Opus Thinking | 可直接跳過普通掃描；失敗走 Critical fallback |
| QA | Gemini Medium；大 context／高複雜度用 High | 僅 QA evidence，重大決策仍需適格 review |
| Technical Arbiter | Astra XHigh | 僅明確模型衝突或重大未解問題 |

日常 native reasoning：Low 任務 low、Medium 任務 medium、High／Very high 或 High／Critical risk high。Senior fallback Sol／Astra 使用 high；Critical fallback Astra／Sol 使用 xhigh。不得重新鎖定所有 Luna high/max。

Gemini effort 與已 discovery 的 Medium／High 型號一致。Claude 使用該 Thinking 型號支援的預設思考方式；未確認 CLI adapter 支援前，不強塞 `--effort`。

## 7. Team tier 與 escalation

| Team | 正常可用模型 | 行為 |
| --- | --- | --- |
| `ai-team-lite` | Luna、Terra、Gemini Medium | 小範圍／低風險，預設主 Agent 單獨完成 |
| `ai-team` | Luna、Terra、Sol、Gemini Medium/High、Sonnet | 日常工程，按需要挑角色 |
| `ai-team-pro` | 全部，含 Astra／Opus | 提供最高能力權限；簡單任務仍 Luna |

`team=auto`：選滿足本次 task + required review 的最低 tier。一般 CRUD 即 Standard。手動 Pro 不強制升級模型。

沿用使用者授權的自動任務升級：Lite 收到 Critical 或超過能力的任務時，輸出 `requested_team=ai-team-lite`、`team=ai-team-pro`、`escalated=true` 和具體原因，先完成這次任務的 tier 升級，才可執行超出 Lite 的模型。不得宣稱「仍在 Lite」卻偷偷呼叫 Opus。

每次任務重新計算，低風險任務可回到低能力模型。不得由路由推薦永久改寫 `router.json`。`Switch-AiTeamMode` 僅在使用者明確切換時改預設 selector，不寫 `.codex` 或 hot-switch 目前工作。

`style` 保留 invocation 與 UI 設計偏好，能力限制沿用 Lite；`router.astra-standard.json` 保留為 Pro 相容 selector，不增加第四套模型政策。

## 8. MODEL_FALLBACK 與 quota

只有 selected model unavailable、quota exhausted、CLI failure、model unavailable、repeated failure 才進 fallback。每個失敗保留 sanitized reason；不把任務 routing 與模型故障混為一條固定階梯。

| 已選工作 | Fallback 順序 | 禁止行為 |
| --- | --- | --- |
| Luna 工程 | Terra → Sol → Astra | 不重複同一失敗模型；越 tier 要記錄升級 |
| Terra 工程 | Sol → Astra | 不把一般工程任意降成不具能力的模型 |
| Sol 複雜工程 | Astra | 不降到 Luna |
| Astra 必要架構／仲裁 | 無足夠模型時 `NO_CAPABLE_MODEL` | 不為了永不失敗而假稱低階可接管 |
| Gemini 普通廣域 review | Terra High → Sol High | 不自動消耗 Claude；不逐一重試 Gemini slug |
| Gemini QA | Terra → Luna | 只完成 QA scope；Critical acceptance 仍由 Critical reviewer |
| Sonnet 深度 review | Sol High → Astra High | Opus 不是普通 Sonnet fallback |
| Opus Critical review | Astra XHigh → Sol XHigh | 不降成 Gemini 最終裁判，不 skip required review |

Gemini 候選需要深度驗證時是新 senior-review 工作：值得且可用才選 Sonnet；Sonnet 不可用再 Sol／Astra。不要用「Gemini 壞掉」作為啟動 Sonnet 的唯一理由。

Provider quota=0 應跳過該 provider 所有受限型號；Codex 共用 quota=0 不能由 Luna 換 Terra 假裝避開帳號限制。所有足夠模型不可用時誠實回報；只要 Codex 對應模型可用，agy 整體不可用不能阻斷規劃、實作、review、QA、release 的 native handoff 路徑。

agy discovery：

1. 真正需要外部 reviewer 且該 provider 未知／有額度時，執行一次 bounded `agy models`。
2. 成功且輸出完整才建立 mapping；只有成功清單中存在的精確 slug 可以呼叫。
3. 預期語義類型為 Gemini 3.8 Flash Medium/High、Claude Sonnet 4.6 Thinking、Claude Opus 4.6 Thinking。實際 slug 優先。
4. 不確定、歧義、未登入、CLI 不存在、輸出截斷均視為 discovery unavailable，走 native fallback。未驗證型號不得「猜了再試」。
5. 不以 regex 接受任意近似名稱冒充已確認的能力。若清單格式與 fixture 不同，保存 sanitized 例子後補 parser／test；無法可靠映射時維持 fallback。
6. 單次 wrapper 內重用 inventory；quota error 立即更新本次 provider 狀態，避免同 provider 反覆試用。不建額外常駐 quota service。

## 9. 防 recursion／派工浪費

- MCP／pure router 絕不呼叫 spawn、外部模型、Codex CLI 或自己的 MCP tool。
- wrapper 只呼叫一次 router adapter 決策，再 bounded 執行外部程序；所有 child 加 `AI_TEAM_CHILD=1`。child 進入 wrapper 立即 `BLOCKED_RECURSION`，須在 property 存取與外部 discovery 前判斷。
- `parent_depth>0` 拒絕 child 重新啟動 Team。native handoff `may_spawn=false`；prompt 明示不得再次呼叫 Team／派生 agents。
- 自動 spawn 預設關閉。主 Agent 自己能做就不開子代理；必要的 native handoff 由既有 host 派工，不能當成 wrapper 已執行。
- 政策上限：child 深度 1、同時最多 2 個 native agents、每個 task 最多 4 次 dispatch、每模型最多 1 次、每 wrapper 最多 2 次外部模型 attempt。上限只是天花板，不能湊滿。
- Host 必須持有 task 累計 dispatch／active count、最小 context、唯一工作與 file ownership；不信任 child 提供的重設計數。兩位 writer scope 必須不相交。
- 純 recommendation API 不具有對 host 的系統級強制權，`max_parallel_agents` JSON 也不等於已實際 enforcement。若無法驗證 host guard，維持 native auto-spawn 關閉，結果明示 handoff required；禁止宣稱已實作全局 scheduler。
- 相同 scope、revision、review intent 已有結果就重用；重要 finding 交 senior 驗證，不讓兩個高階模型重掃同一份全 repo。修正後只重驗受影響 scope，必要時才 full regression。

已知第一個 bug 的最小修正：`Invoke-AiTeamTask.ps1` 的條件需拆成明確分支，先查 `AI_TEAM_CHILD`，再 `ContainsKey('parent_depth')` 才讀值。不能依賴目前混合 `-or`／`-and` 的求值順序，也不能為了通過測試關掉 StrictMode。

## 10. Review 合約與結果處理

所有 Reviewer 使用相同 JSON：

```json
{
  "summary": "具體的審查結論",
  "findings": [
    {
      "severity": "MAJOR",
      "file": "path/to/file.ts",
      "area": "line 42 或明確函式範圍",
      "issue": "問題",
      "evidence": "可核對的程式／重現證據",
      "impact": "實際影響",
      "recommended_fix": "建議修正",
      "required_test": "需要的驗證",
      "confidence": 0.9
    }
  ]
}
```

Severity 僅 `BLOCKER/MAJOR/MINOR/NIT`。confidence 為 0..1 有限數；必填字串不可空；最多 100 findings。`area` 統一承載 line／area。禁止大量無實質影響的風格意見。

Review validator 檢查格式、缺欄位、錯型別、截斷與敏感輸出；不得回傳 raw stderr／provider failure log。既有 `codex-result.schema.json` 若有其他 consumers，保留其結果 envelope；新增獨立 `review-result.schema.json` 表達此 review 合約，避免破壞其他結果格式。

Exit code 0 只代表程序結束。有效 review 才可 `REVIEW_COMPLETED`；有 BLOCKER／MAJOR、Gemini candidate 或空 findings 都不能自動設 `accepted=true`。Reviewer 唯讀，修正交 Developer；主 Agent 在必要 review、測試和 evidence 完成後才做 acceptance。

Required review 無足夠模型時 `REVIEW_BLOCKED`。其他可獨立工程工作可繼續，但不可用 deterministic tests 冒充已完成必要 Critical review。

## 11. 逐檔實作清單

表中「已有草稿」表示需審查與補完，不代表通過驗收。

| 檔案 | 狀態／要做什麼 | 保留／移除 |
| --- | --- | --- |
| `.ai-team/config/routing-policy.json` | 已有草稿；補齊單一模型 registry、risk 表、routing／fallback 表、reasoning、limits、validation | 保留 Git／Production 安全政策；移除 skip-review 階梯 |
| `.ai-team/config/router.json` | 已改 selector；驗證 version、mode/id 一致、固定 policy reference | 保留預設 Lite，不因測試切換真實模式 |
| `.ai-team/config/router.low.json` | Lite selector | 不複製模型表 |
| `.ai-team/config/router.high.json` | Standard selector | 保留 high／高階 alias，文件說明日常標準工程 |
| `.ai-team/config/router.pro.json` | Pro selector | 移除固定 Astra Worker／Planner |
| `.ai-team/config/router.style.json` | Style 相容 selector，使用 Lite 能力政策 | 保留視覺偏好，不保留獨立高階階梯 |
| `.ai-team/config/router.astra-standard.json` | Pro 相容 selector | 不再生成額外 policy |
| `.ai-team/mcp_server/routing.py` | 已有草稿；補分類 floor、型別／finite validation、review routes、quota、fallback、guards | 保持純函式；移除重複硬編模型名稱；決策原因可測 |
| `.ai-team/mcp_server/route_cli.py` | 已有草稿；JSON stdin adapter、sanitized errors、bounded input | 不讀 secrets、不 spawn 模型 |
| `.ai-team/mcp_server/server.py` | 已接 router；維持七個 MCP API，補相容輸入輸出與 malformed input 處理 | 保留 Goal lifecycle，不讓新 setting 接管本次執行 |
| `.ai-team/mcp_server/test_routing.py` | 已有草稿；補完整矩陣、caps、availability、schema、邊界與錯型別 | 不降低現有 assertions |
| `.ai-team/mcp_server/test_server.py` | 已換部分測試；補 native MCP signature/serialized result／Goal regression | 保留 Goal 不覆寫及未完成不可 finalize |
| `.ai-team/mcp_server/schemas/review-result.schema.json` | 新增本文件 review JSON schema 與 validator 一致性測試 | 舊 codex-result envelope 不無故刪除 |
| `.ai-team/scripts/Invoke-AiTeamTask.ps1` | 已有草稿；第一步修 child guard；接共用 route、bounded discovery、runtime failure、findings validator、receipts | 不得 permission bypass；native handoff 明確未完成 |
| `.ai-team/scripts/Invoke-AiTeamProcess.ps1` | 已加 stdin／child marker；驗證 subprocess timeout、輸出收集、cleanup、資源釋放與 argument quoting | 保留既有 blank-line／timeout／auth 分類測試；不把 provider review 文字誤判執行故障 |
| `.ai-team/scripts/Invoke-AgyFast.ps1` | 薄相容層，轉 broad review，必要時依明確 TaskType 轉 QA | 保留 Prompt／timeout 等既有參數；不固定 slug |
| `.ai-team/scripts/Invoke-AgyDeep.ps1` | 薄相容層，轉 deep review | 名稱保留；不保留舊 Gemini Pro 綁定 |
| `.ai-team/scripts/Invoke-AgyPlanReview.ps1` | 薄相容層，轉 plan review | Critical prompt 自動提高 review；不 skip quota |
| `.ai-team/scripts/Invoke-AiTeamReadOnlyFailover.ps1` | 保留 gemini_fast／gemini_deep role alias，走同一 router | 不再用另一份 profile ladder |
| `.ai-team/scripts/Switch-AiTeamMode.ps1` | 草稿已只改 selector；測 alias／status／list／atomic replace | 不再讀寫 native model／worker TOML |
| `.ai-team/scripts/Test-AiTeamRouting.ps1` | 已有 synthetic fixture；修完 guard 後重跑並加 quota、budget／compatibility 邊界 | 只用隔離 fixture，不呼叫真人模型、不改真實 selector |
| `.ai-team/scripts/Test-AiTeamResilience.ps1` | 草稿已更新 config assertions；保留並重跑 process reliability cases | 不移除 timeout／auth／sensitive-input 防護 |
| `.ai-team/scripts/Test-AiTeamHandoff.ps1` | 更新仍綁舊模型、READY_FOR_TERRA、舊計畫欄位的 assertions | 改驗新合約與實際 canonical docs；保留 secret/link/Markdown 檢查，不能直接停跑 |
| `AGENTS.md` | 收斂模型、role、mode、fallback 規則，引用 canonical routing；說明 self-modification guard | 保留安全、secret-aware runner、ownership、中文與 checkpoint 要求 |
| `docs/ai-team/ROUTING.md` | 輸入單位、決策矩陣、risk override、fallback、quota／limits 與範例 | 連到唯一 JSON 與本 Plan，不再另維護衝突階梯 |
| `docs/ai-team/ARCHITECTURE.md` | 更新共用 router／host／wrapper 邊界 | 移除固定 Luna high／Gemini 最終規劃者描述 |
| `docs/ai-team/workflow-policy.md` | 任務決定角色；高風險 review 不 skip；精確 stage 已知 scope | 保留安全、價值排序與長程 Goal |
| `docs/ai-team/GOAL-PROTOCOL.md` | 去固定模型，澄清 handoff／review blocked／Goal completion | 不改既有 state 成已完成 |
| `docs/ai-team/workflow-mode.md` | 對齊 task tier 與 prelaunch/release 行為的分工 | 保留 Production 獨立授權 |
| `docs/ai-team/handoff-schema.md` | 加 route/tier/fallback/required review／guard 狀態；修 PASS 歧義 | 保留可用舊欄位、精簡 handoff 與 next action |
| `docs/ai-team/TROUBLESHOOTING.md` | 按 unavailable／quota／invalid response／limits 故障排查 | 移除 Fast→Deep→Luna 固定全域規則 |
| `docs/ai-team/README.md` | 加本 Plan、runtime／tests／migration 索引與啟用條件 | historical 明確標示，不重寫歷史 evidence |
| `docs/ai-team/prompts/planner-prompt.md` | role-neutral Planner，引用共享規範與 route decision | 移除固定 Sol、duplicated safety、quota skip；避免全 repo context |
| `docs/ai-team/prompts/executor-prompt.md` | Developer 按 handoff/model/ownership 做修正與驗證 | 移除固定 Luna high、嵌入固定 fallback |
| `docs/ai-team/prompts/reviewer-prompt.md` | 新增共用唯讀 Reviewer prompt／finding schema 引用 | wrapper 與 native review 共用，避免再次复制長 prompt |
| `.agents/skills/ai-team-lite/SKILL.md` | 薄 Lite entry：引用 policy、選 selector、呼叫 route；先檢 recursion | 移除整套模型複製與自行多 Agent 啟動 |
| `.agents/skills/ai-team/SKILL.md` | 新增薄 Standard invocation 入口；若本機另有正式入口則對齊來源 | 不再從 Lite skill 暗中模擬整套固定團隊 |
| `.agents/skills/ai-team-pro/SKILL.md` | 新增薄 Pro invocation 入口 | 簡單 task 不固定 Astra／Opus |
| `.agents/skills/ai-team-style/SKILL.md` | 與 Lite 共用路由，只保留視覺偏好 | 不另複製模型政策 |
| `.codex/config.toml` | 保留七個 MCP tool 與既有 approval boundary，修正到實際存在的專案 interpreter；移除若有的固定全局 Team model | 不套無法查證的 host config keys；保留原有使用者空白行變更 |
| `.codex/agents/explorer.toml` | 小探索 default Luna、唯讀、不 spawn | 去 gpt-5.4-mini |
| `.codex/agents/analyst.toml` | 普通分析 default Terra、唯讀；複雜由 route 選 Sol | 去 gpt-5.4 與「Luna 為最高升級」 |
| `.codex/agents/planner.toml` | default Terra、唯讀、按本次 scope 規劃 | 去固定單次 30–90 分鐘限制；仍禁止自己啟動 Team |
| `.codex/agents/worker.toml` | default Terra；修 UTF-8 損壞；小任務／高階任務由 host 按 route override | 清除固定 Luna high 文案；保留單 writer |
| `.codex/agents/worker-deep.toml` | default Sol high，限定 scope | 符合新的複雜工程能力分工 |
| `.codex/agents/reviewer.toml` | native普通 fallback default Terra high、read-only、共用 findings | Critical 不用這個固定 default 偷降級；由 host dispatch 合格模型 |
| `.gitignore` | 在 native descriptors 更新可寫且確認 ownership 後，移除這六個精確 ignore 條目，讓後續 clone 不回到舊角色 | 繼續 ignore secrets／runtime／logs／state／archive；不廣域 unignore |
| `.github/workflows/ci.yml` | Python 改 discovery 包含全部 test_*.py；跑 resilience／routing／handoff；所有 native nonzero exit 都明確失敗 | 保留 push ESLint／typecheck／unit coverage，禁止新增自動 Production deploy |

對 native roles 的限制：若目前 host 的自訂 agent_type 不允許 model override，不要假傳 override。使用該 host 支援的 generic worker／default 類型配明確 model、reasoning 與 scoped instructions；唯讀保證需由 host sandbox／權限提供，prompt 不能冒充真正 sandbox。若無法满足角色權限與模型要求，回報 handoff blocked，不另起 shell Codex 規避。

## 12. Compatibility 與移除範圍

保留：三套主要 Team 名稱、style 與中英文 mode aliases、Switch `-List/-Status`、四個舊 wrapper 檔名與可用參數、七個 MCP tool、Goal lifecycle、production safety、既有 process runner 韌性。

相容參數 `MaxAttempts` 可接受但有效每模型 attempt 不超過 1；`AutoApprovePermissions` 不得重新打開 permission bypass，應回傳清楚的 deprecated／ignored metadata，不可假裝已套用。未知或無法相容的輸入回清楚錯誤，不默默降級。

移除目前有效 runtime 的 `codex-6-Astra` 假 slug、`gemini-3.1-pro-high` 舊路由、GPT-5.4 系列角色 default、固定 Luna high/max、Pro 固定 Astra、Sonnet→Opus 普通 fallback、critical skip_review。Codex slug 統一 `gpt-5.6-luna`／`gpt-5.6-terra`／`gpt-5.6-sol`／`gpt-6-astra`。

歷史 evidence 中的模型名稱是真實歷史，不刪、不改成新模型；不得大量修改 WP scripts 或產品程式來消除無關文字命中。舊 ignored archive 不在 maintained runtime 中啟用。

## 13. 測試與驗收矩陣

下面每列需要可重現 assertion，不能只依賴 prompt 文字或人工目視。

| ID | 情境 | 必須結果 |
| --- | --- | --- |
| C01 | 中文文案／英文 copy edit／小 UI、Low risk | auto→Lite，Luna low，無外部模型、無自動 spawn |
| C02 | 普通 CRUD/API | auto→Standard，Terra medium |
| C03 | 跨模組複雜 Feature | Standard，Sol high；明示 low 不能覆蓋 task floor |
| C04 | 大型 architecture | Pro，Astra；不是普通 Feature 預設 |
| C05 | 普通大型 diff review，Gemini 可用 | Gemini High，candidate-only |
| C06 | 複雜 business/plan review | Sonnet；不可用則 Sol high，再 Astra high |
| C07 | Payment/Auth/Security review | Pro Critical，直接 Opus；不先跑普通 review 階梯 |
| C08 | Claude quota=0／unavailable | Sonnet→Sol high；Opus→Astra xhigh→Sol xhigh |
| C09 | Gemini quota=0／unavailable | broad review→Terra high→Sol high；QA→Terra→Luna |
| C10 | agy 不存在／未登入／整體不可用 | native 可用時各種必要角色仍可規劃、handoff；不得 falsely completed |
| C11 | Pro 執行簡單 copy/UI | Luna；無 Astra／Opus 強制啟動 |
| C12 | 一行 Payment/Auth edit，complexity=low | risk=critical；實作至少 Sol，review Opus／Astra |
| C13 | Gemini 與 Claude 同時 quota=0 | 全部 external 選擇 fallback Codex；不重試 unavailable providers |
| C14 | Critical 所有合格模型皆不可用 | NO_CAPABLE_MODEL／REVIEW_BLOCKED；不 skip、不降至 Gemini／Luna |
| C15 | `AI_TEAM_CHILD=1` 且無 parent_depth | 無 property error；立即 BLOCKED_RECURSION；0 次 discovery/model dispatch |
| C16 | parent_depth>0、dispatch_count≥4 | 拒絕；負數／錯型別也拒絕 |
| C17 | attempted_models 重複／fallback cycle | 失敗模型不再執行；chain 無重複、無循環 |
| C18 | host 未提供可強制的 spawn guard | automatic spawn 維持 false；handoff 不冒充全局 enforcement |
| C19 | stdout PASS／exit 0 但缺 findings／malformed JSON／截斷 | 非 REVIEW_COMPLETED；bounded failure→fallback |
| C20 | BLOCKER／MAJOR finding、空 findings | 格式可接受，不能自動 acceptance；重要 candidate 有 senior escalation |
| C21 | 每種 critical category + copy 標籤 | category 覆蓋 low complexity；category 去重，不重算同類分數 |
| C22 | 三個 impacts／三個 sizes 邊界、NaN、Infinity、bool、wrong type | 級別按門檻；不合法輸入拒絕 |
| C23 | agy 清單含實際不同分隔符 slug／未知／歧義／截斷 | 精確使用可靠發現值；無法辨識則 fallback，不猜名稱 |
| C24 | 已知 quota=0 | 不呼叫該 provider 做低價值重試；不能把 unknown/null 視為0 |
| C25 | Mode aliases／四個 wrappers／舊 MCP positional args | 保留可用 invocation；mode switch 只改隔離 selector |
| C26 | 缺 profile／invalid mode／config injection | 明確錯誤，禁止 selector 注入任意 policy／executable |
| C27 | 敏感輸入／provider failure output | 不啟動模型，不把原始診斷存 evidence |
| C28 | timeout、blank stdout/stderr、auth failure、child cleanup | 保留現有 process 韌性 assertions，全數通過 |
| C29 | Goal lifecycle／已有 active state／未完成 finalize | 舊行為不回歸 |
| C30 | active docs／skills／native descriptors | 無衝突固定模型規則；原始歷史 evidence 不納入此門檻 |

Synthetic tests 不使用真人 provider，不依賴 .env，也不修改目前 selector／Goal state。PowerShell fixture 只拷必要 runtime；清理前驗證精確 temp 路徑。

必要 native dispatch host 若有測試 harness，補 active count≤2、總 dispatch≤4、child 無再派工、相同 writer scope 拒絕等測試。若只有 recommendation 層可測，報告清楚限制，保持 automatic spawn 關閉。

## 14. 實作順序與升級界線

1. **接手與證據**：讀完本 Plan，保存本輪 starting `git status`；確認 protected paths 權限、現有草稿 diff 與 requirements。不得把既有變更加入不相關 commit。
2. **先修現有失敗**：修 PowerShell child guard；重跑 Python suite 和 isolated routing test。修 `copy edit` 辨識與 task-type floor，不改需求來配合既有 bug。
3. **補純 router 合約**：validation、risk／complexity、team escalation、quota unknown、fallback、review requirements、reasoning。以矩陣逐項驗證。
4. **補 runtime 整合**：wrapper 參數相容、discovery、failure classification、review schema、可重用 reviewer prompt、bounded subprocess、native handoff；不得熱啟用。
5. **規範與原生入口同步**：按逐檔表更新 AGENTS／docs／skills／TOML；查所有 callers；修 MCP interpreter 路徑的實際可用性；核對 generic agent 與 model override 能力。
6. **CI 與完整驗證**：更新 CI discovery 與 exit code gate，執行下面命令，保存 sanitized evidence。
7. **交付**：所有必要項目完整才能稱 vNext 可用；未通過的原生／外部整合如實列 Remaining Issues。輸出 Changed／Implemented／Tests／Deviations／Remaining Issues。

Luna 可直接做：既定格式文件同步、selector 整理、明確 property guard 修正、按矩陣補測試、薄 wrapper／CI wiring。跨 Python／PowerShell 合約、host sandbox／dispatch 整合、runtime 權限和深度風險判定若無法正確處理，標 `NEEDS_TERRA`；複雜 fallback 正確性與跨模組根因標 `NEEDS_SOL`；架構更改或重要未解取捨標 `NEEDS_ASTRA`。不得啟動舊 AI Team 自動「升級自己」。

## 15. 驗證命令、evidence 與啟用條件

按實際 interpreter 執行，不能只做語法檢查就宣稱 runtime 可用：

```powershell
python -m unittest discover -s .ai-team/mcp_server -p 'test_*.py' -v
python -m compileall -q .ai-team/mcp_server
pwsh -NoProfile -File .ai-team/scripts/Test-AiTeamResilience.ps1
pwsh -NoProfile -File .ai-team/scripts/Test-AiTeamHandoff.ps1
git diff --check
```

`Test-AiTeamResilience.ps1` 已預計內含 `Test-AiTeamRouting.ps1`；確認只有一次執行，避免無理由重跑。所有變更 PowerShell 檔另用 parser 檢查。CI Python 改 unittest discovery，並在每個 native command 後明確檢查 `$LASTEXITCODE`，避免前一個測試失敗被後一個成功掩蓋。

本地測試依賴未準備時可建專案 ignored venv 安裝 `.ai-team/mcp_server/requirements.txt`。若使用現有 ignored `python-deps`，只設定該測試 process 的 PYTHONPATH，勿讀取整個環境、勿改使用者全局 Python。

使用者亦要求 lint／typecheck／tests／build。CI 已有 `npm run lint`、`npm run typecheck`、`npm run test:coverage`，不能移除。本地執行前檢查 script 是否會自動讀 `.env*` 或需要外部／DB；此專案 `npm run build` 包含 production preflight，不能在未知環境直接執行。

需要產品檢查時使用既有經檢查的 no-dotenv／isolated runner 或不含敏感檔的最小 disposable checkout；不得讀取／移動原始 .env 來避開限制。若安全環境不具備，記錄 `NOT_RUN_ENVIRONMENT_BLOCKED` 與原因，不偽造 PASS。AI Team 專屬驗證可完成後照實交付部分狀態，但必要 activation gate 未達仍不可標整體完成。

新增 `docs/ai-team/vnext-validation.md` 保存：scope、命令、exit code、test 數、各 C01–C30 結果、provider discovery 狀態、native host 整合狀態、blocked paths、精確 rollback 與下一步。只保留 sanitized 摘要，不貼 raw provider logs。

啟用要求：pure tests、wrapper integration、process resilience、handoff checks、模型／prompt／skill／native 設定一致性全部通過；host 和 interpreter 可用；required review 與 dispatch guard 語意已驗證；無未揭露阻擋。agy 未登入可用 Codex fallback 運作，但 Gemini／Claude 真實呼叫必須標 `NOT_VERIFIED`，不可寫外部實測通過。

## 16. 權限、commit 與回滾

目前 `.agents`／`.codex`／`.git` 唯讀是環境權限，不是模型能力不足。禁止換工具或 encoding 規避。Implementation Agent 應完成可寫且已授權的部分；需要 protected-file 修改時保存精確 patch／待辦，並在報告標明未套用。不把「已生成 patch」說成「已同步 skill」。

若後續工作階段權限允許，先核對 path、ownership 和檔案內容，再套精確修改。六個 ignored native descriptors 在確認後才納入版本控制；若角色其實由 repository 外來源載入，記錄該限制，不擅自修改全局使用者設定。

最終 commit 僅在驗證完成且 `.git` 可寫時建立語義化 checkpoint。stage 本次精確檔案，保留無關／使用者既有變更。不可為了 clean status 使用全目錄 add、reset、clean、stash 或 restore；若根規則要求 `git add .` 與保留未知 ownership 衝突，以保留資料和精確 scope 為準。本文件補寫階段只新增此文檔，不要求替未完成程式建立完成 commit。

回滾以本輪精確 patch／commit 為界，只反向移除已確認 ownership 的 hunks，不改歷史 evidence、不重置整個 dirty tree。測試應改 fixture selector，絕不能為了回滾測試而修改真實 active model。

## 17. Luna／Implementation Engineer 接手指令

```text
請完整讀取 docs/ai-team-vnext-plan.md。
你是 Implementation Engineer，依此版本 1.0 設計接續工作，不另作架構重設。
本 Plan 是 GPT-6 Astra 在本對話正式落檔的實作交接；現有工作樹含未驗收草稿。
不要啟動 ai-team-lite／ai-team／ai-team-pro 來重構自己，不覆蓋既有變更。
先讀第 2 節現況與失敗，再按第 14 節順序完成第 11 節逐檔清單。
第一個修正點是 Invoke-AiTeamTask.ps1 的 parent_depth／AI_TEAM_CHILD guard；
修正後執行隔離 routing tests，不關 StrictMode、不改 assertion 掩蓋問題。
按 C01–C30 驗收 routing、fallback、quota、recursion、兼容性和 review semantics。
受保護目錄無法寫入時如實記錄，不繞過；必要升級標 NEEDS_TERRA／SOL／ASTRA。
最後依 Changed／Implemented／Tests／Deviations／Remaining Issues 回報。
只有所有必要 integration gate 通過，才稱 vNext 已可用。
```
