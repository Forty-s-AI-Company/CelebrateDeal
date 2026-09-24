# AI Team vNext Validation

- 日期：2026-09-20
- 範圍：vNext routing、fallback、quota、AGY failure taxonomy、native adapters、portable MCP bootstrap 與完整 Node tracked-source validation。
- 安全界線：沒有啟動舊版 AI Team 修改自己；沒有讀取 `.env*`、Secret、Cookie 或正式資料；沒有繞過 Windows host/sandbox 權限。
- Canonical execution source：`.ai-team/config/routing-policy.json` 與 `.ai-team/mcp_server/routing.py`。Native skills/descriptors 只做 thin adapter/guard。

## Independent-review remediation

| Finding | 修正 | Regression evidence |
| --- | --- | --- |
| MAJOR-1 task type floor | task type、caller complexity、risk、size 分開計算 floor，final complexity 取最高值 | `cross_module`、`complex_debug`、`deep_review`、`business_review` + explicit low 均不能降級；ordinary explicit low 仍走 Luna |
| MAJOR-2 precedence/difficulty | explicit caller > structured signals > defaults；difficulty 僅接受 `auto/trivial/routine/complex/critical` | MCP + PowerShell signals-only、override、legacy mapping、invalid input 全數通過 |
| MAJOR-3 Critical detection | 擴充 bounded Auth/Permission/Security patterns | OAuth/JWT/MFA/SSO/authorization/access-control/CSRF/XSS/injection 為 Critical；session documentation/token budget 等負向案例維持 Low |
| MAJOR-4 portable MCP | `.codex/config.toml` 改用 repository launcher；ignored venv 可由 requirements 重建 | relocated-root bootstrap probe、`router_status`、`route_task` 通過；maintained config 無使用者絕對路徑 |
| MAJOR-5 Node baseline | 以 `git ls-files` 完整複製 tracked worktree，排除 `.env*` 與 ignored runtime | tracked config 存在；`npm ci`、Prisma generate、完整 `npm test` 通過；sanitized manifest 無 failures |

## AI Team checks

| 命令 | 結果 |
| --- | --- |
| `.ai-team/.venv/Scripts/python.exe -m unittest discover -s .ai-team/mcp_server -p 'test_*.py' -v` | PASS：25/25 |
| `pwsh -NoProfile -File .ai-team/scripts/Test-AiTeamRouting.ps1` | PASS：routing integration + PowerShell precedence |
| `pwsh -NoProfile -File .ai-team/scripts/Test-AiTeamResilience.ps1` | PASS：routing + resilience + AGY taxonomy |
| `pwsh -NoProfile -File .ai-team/scripts/Test-AiTeamHandoff.ps1` | PASS：handoff/docs contract |
| `pwsh -NoProfile -File .ai-team/scripts/Test-AiTeamBootstrap.ps1` | PASS：relocated launcher、MCP import、`router_status`、`route_task` |
| `pwsh -NoProfile -File .ai-team/scripts/Test-AiTeamNodeValidation.ps1` | PASS：完整 safe tracked-file set；`config/build-env.controlled.json` 存在 |
| `.codex/agents/*.toml`、`.codex/config.toml`、router JSON parse | PASS |
| PowerShell parser、stale routing scan、`git diff --check` | PASS |

Router/MCP 仍不 spawn；`AI_TEAM_CHILD`、`parent_depth`、dispatch budget、每模型 attempt 與 external attempt 上限維持。`escalation_reasons` 現在能區分 complexity、risk、task type floor、required review、model capability 與 fallback。

## Reliable Node validation

Validation runner：`.ai-team/scripts/Invoke-AiTeamNodeValidation.ps1`。

方法：

1. 由 `git ls-files --cached` 列出完整 tracked source，不維護手動 copy list。
2. 只排除 `.env*`、`node_modules` 與 `.ai-team` ignored runtime/temp/state。
3. 明確驗證 `config/build-env.controlled.json` 存在於 snapshot。
4. 執行 `npm ci --include=dev --include=optional --no-audit --no-fund`。
5. 依正式 CI 順序執行 `npm run db:generate`，再執行完整 `npm test`。
6. 將結果整理至 `docs/ai-team/vnext-node-failure-manifest.json`；manifest 不保存 raw environment、Secret 或使用者絕對路徑。

| 項目 | 結果 |
| --- | --- |
| tracked inventory | 3,954；安全複製 3,951；排除 3 個 `.env*` |
| required tracked config | PASS |
| `npm ci` | PASS |
| `npm run db:generate` | PASS |
| `npm test` | PASS：1,376 suites；4,531 passed、40 pending、0 failed |
| failure classification | VNEXT_RELATED=0、BASELINE_EXISTING=0、ENVIRONMENT_BLOCKED=0、UNDETERMINED=0 |
| `npm run lint` | PASS：0 errors、5 個既有 warnings |
| `npm run typecheck` | PASS |
| `npm run build` | ENVIRONMENT_BLOCKED：production preflight 正確拒絕缺少的 production settings；未補造或讀取 Secret |

先前「69 failed suites 全部屬於既有問題」的結論已撤回。其來源 snapshot 遺漏 tracked config，且在 Prisma generate 前執行測試，不能作為基線。上表是修正方法後的唯一有效 Node baseline。

## Native integration

- `.codex/config.toml` 不含 `C:\\Users\\...`、使用者名稱或 checkout 絕對路徑。
- `Start-AiTeamMcp.ps1` 從自身位置解析 repository root；缺少 `.ai-team/.venv` 時以 repository `requirements.txt` 建立並安裝 runtime。`mcp[cli]` 與 `tomlkit` 均固定到已驗證的精確版本，fresh bootstrap 可重現相同依賴集合。
- `.ai-team/.venv` 保持 ignored，沒有 commit virtualenv、credential 或 machine state。
- Reviewer 實際 prompt 只存在 `.ai-team/prompts/reviewer-prompt.md`；PowerShell wrapper 載入同一份 runtime source。
- Compatibility wrappers 接受 `MaxAttempts`／`AutoApprovePermissions`，但永不啟用 permission bypass，receipt 明確輸出 deprecated/ignored metadata。
- CI 明確執行 routing、resilience、handoff、bootstrap 與 tracked snapshot regression tests。

## AGY provider evidence

Host-side 使用者已人工驗證：

- `AGY_INSTALLED = VERIFIED`
- `AGY_AUTHENTICATED = VERIFIED`
- `AGY_HOST_MODEL_DISCOVERY = VERIFIED`

Codex sandbox discovery 仍為 `HOST_PERMISSION_BLOCKED`，sandbox model smoke 是 `NOT_VERIFIED`。該狀態不會被改判為 `AUTH_REQUIRED`，並會依 deterministic fallback 回到合格 Codex 模型。

## Remaining external limits

- 真正 fresh clone（新的 Git clone，而非 relocated tracked fixture）尚未由另一個 Host 執行；automated relocation/bootstrap regression 已通過。
- Production build 仍需要合法 deployment environment；本輪沒有讀取、偽造或注入 production Secret。CI/staging 仍是 production build 的正式驗證路徑。
- Codex sandbox 仍無法執行真人 AGY smoke；Host-side 安裝、登入與 model discovery 證據維持 VERIFIED。

回滾只能反向移除本輪明確 ownership 的 vNext patch；不得使用 reset、clean、stash、restore 或 checkout 丟棄其他變更。

## 2026-09-23 Luna-first 更新（本輪證據；上方紀錄屬先前版本）

本輪把 active Codex registry 限定為 GPT-6 Luna／Sol／Astra，移除 Terra 正常路由；Medium 明確規格實作用 Luna high，複雜整合用 Sol，Very High 本身不強制 Astra。Astra 需要有效 `astra_reason`。Product、UX/UI、Database、SRE 是按需 capabilities，不是固定啟動的四個代理。新增 `assess_acceptance`，用 source revision、validation runner exit 0 與獨立審查證據判定交付，不接受模型自行聲稱 PASS。

| 驗證 | 本輪結果 | 範圍 |
| --- | --- | --- |
| `python -m unittest discover -s .ai-team/mcp_server -p test_*.py -q` | PASS：36/36 | mock/pure routing、tier、風險、Astra 理由、證據 gate、TOML descriptors |
| `python -m compileall -q .ai-team/mcp_server` | PASS | Python parser |
| `python -m json.tool .ai-team/config/routing-policy.json NUL` | PASS | policy JSON parser |
| `git diff --check` | PASS，僅 CRLF 轉換警告 | tracked worktree；未追蹤檔由 Python/parser 檢查 |
| `agy models` | PASS | Codex 執行環境實際列出 `gemini-3.8-flash-medium/high`、`gemini-3.1-pro-high`、`claude-sonnet-4-6`、`claude-opus-4-6-thinking` |
| `agy --model gemini-3.8-flash-medium --mode plan --sandbox --print-timeout 30s --print=Return_OK_only` | BLOCKED：exit 0 但 `jetski: no output produced`，headless command permission `auto-denied` | 真人 provider 有回應，但沒有完成工作；不能當 review/QA PASS；未繞過權限 |
| `echo Reply OK only. \| codex exec --ephemeral --json -m gpt-6-luna -c model_reasoning_effort=low -s read-only -C <repo> -` | BLOCKED：CLI 警告本機 model metadata 找不到，使用 fallback metadata；只有 `thread.started`/`turn.started` 與 error event，未見 `turn.completed`；約 30 秒後中止 | 不能確認本機 CLI 已用 GPT-6 Luna 完成；未修改來源 |
| `pwsh -NoProfile -File .ai-team/scripts/Invoke-AiTeamTask.ps1 -Prompt copy -PlanOnly` | BLOCKED：本 Codex host 中 PowerShell 未結束且無輸出，已中止 | 本輪無法聲稱 PowerShell routing/resilience/handoff 動態通過 |

`Invoke-AiTeamTask.ps1` 預設維持 native handoff；明確 `-ExecuteNative` 且提供本機 CLI 已驗證模型清單才用 `-m`、`-c` 傳遞 model/effort，否則回 `NATIVE_MODEL_UNVERIFIED`。新增路徑已由靜態回歸檢查參數與 `observed=unknown`，但上述 PowerShell host 問題與 CLI model metadata 警告使它尚未完成真實 native smoke。Codex JSONL 必須有 `turn.completed` 且不得有 error/failed event；即使成立也只代表 `EXECUTED_NEEDS_VALIDATION`。AGY 的 exit 0 + headless 權限拒絕文字已加入 `TOOL_DENIED` 分類與 PowerShell 回歸案例；該回歸本輪未能動態執行。

本輪沒有碰產品 Node 程式碼，沒有重跑產品完整 Node suite 或 production build；工作樹原有其他未提交產品變更保持原狀。上述 BLOCKED 項是目前實際整合驗證限制，不能依上方先前版本的 PASS 推論本輪改動已全數驗證。

## 2026-09-23 執行接點與驗收收尾（覆蓋上段對本輪路由的舊結論）

上一輪的兩點推論已修正：Critical 風險不再自動把 implementation complexity 提到 High 或直接強制 Developer 用 Sol；局部且明確的 Critical 修改可由 Luna high 實作，但 Critical 獨立審查和必要檢查仍保留。上一輪的 `codex exec` 使用 PATH 上 npm CLI 0.145.0；Desktop 安裝內的 `codex.exe` 是 0.155.0-alpha.2.6。前者的 model metadata 警告不能證明 GPT-6 Luna 不支援。wrapper 已改為解析實際 `.exe`，但 `-ExecuteNative` 仍需明確的 verified-model 輸入，未驗證時不會被 fallback 靜默選用。

| 入口 | 實際執行／解析 | 可輸出的狀態 | 驗收關係 |
| --- | --- | --- | --- |
| `ai-team-lite`／`ai-team`／`ai-team-pro` skill | MCP `route_task` 或 PowerShell 相容 wrapper | routing/handoff | 不宣稱 READY；最後須呼叫 `assess_task` |
| Desktop 原生子代理 | Desktop 的 native model/effort 參數；router 提供 resolved 值 | model 工作結果 | `observed` 無 host 回報時仍是 unknown；不能以回覆代替測試 |
| `Invoke-AiTeamTask.ps1 -ExecuteNative` | 明示 verified model 後由新版 `codex.exe` 接收 `-m/-c`，JSONL 終態解析 | `EXECUTED_NEEDS_VALIDATION` 或失敗 | 不直接 READY；PowerShell host 本輪未能動態驗證此 wrapper |
| AGY 相容 wrappers | `agy models` 精確 slug、bounded process、review JSON schema | `REVIEW_COMPLETED` 或失敗 | `accepted=false`；測試由 validation runner 判定 |
| MCP Goal `goal_checkpoint`／`goal_finalize` | checkpoint 只標 phase；finalize 現在呼叫共享 `assess_acceptance` | 缺證據為 `not_finalizable`；齊全才 `completed` | 舊 Goal 完成入口不再繞過 gate |
| MCP `assess_task`／`route_cli.py assess_acceptance` | 同一 gate | `READY`／`BLOCKED` | 要求同 revision 執行收據、實際 validation runner 收據；High/Critical 再要求獨立 review 收據 |
| Node snapshot／診斷命令 | 本機驗證工具 | `SNAPSHOT_READY` 等診斷狀態 | 不代表任務 READY |

收據要求 JSON 檔存在且內容欄位與請求相符；validation 收據由新增的 `.ai-team/mcp_server/validation_runner.py` 以無 shell 的 argv 執行並寫出，失敗 exit code 不會變 PASS。MCP `snapshot_task` 對 caller 明列的專案檔案產生 SHA-256；gate 重新計算內容，檔案改變時即使 caller 沿用舊 revision 也會阻擋。只保證所列檔案；漏列的相依檔仍是 caller 的 scope 責任。這是本機流程驗證，沒有宣稱能抵禦同一工作區中惡意偽造收據的行為。

| 本輪檢查 | 結果 | 證據性質 |
| --- | --- | --- |
| `python -m unittest discover -s .ai-team/mcp_server -p test_*.py -q` | PASS：40/40 | mock/pure + CLI adapter fixture；含 Goal 正反 gate、舊入口、內容摘要失效、runner exit 7 與 timeout |
| `.ai-team/scripts/Probe-AiTeamShell.py` | BLOCKED：bundled `pwsh.EXE` 8 秒無 stdout/stderr 即 timeout；stdin 為 EOF | host 程序診斷；不能推論 PowerShell runner 本身有缺陷 |
| `agy models` | PASS | live discovery |
| AGY Flash Medium 純文字 `Reply_OK_only` | PASS：exit 0、`OK` | live 純文字；沒有檔案或 shell 權限證據 |
| AGY Flash Medium 小型函式審查 | PASS：回報 `a-b` 應為 `a+b` | live 輸入分析；未執行測試，亦未使用 wrapper JSON schema |
| `.ai-team/scripts/Probe-AiTeamNative.py` | PASS：隔離 fixture 測試先 exit 1；新版 Desktop `codex.exe` 用請求的 GPT-6 Luna high 執行，`turn.completed`、exit 0、修正 `calc.py`，測試後 exit 0 | live CLI 執行；未從 provider 取得可核對的 observed model/effort，仍記 unknown |
| PowerShell routing/resilience/handoff 動態測試 | BLOCKED：同一 `pwsh.EXE` host 啟動問題 | 不能以 Python/mock PASS 代替 |

離線 snapshot CLI → route CLI → fixture 修改 → 真正 validation runner → acceptance 的整合測試已通過，但修改步驟是 test fixture 模擬；另一次 live native fixture 證明模型能實際修正並通過測試。兩者是分開的證據，沒有把它們拼成一條未曾執行的完整 live AI Team pipeline。AGY 兩次 bounded smoke 後停止，沒有呼叫 Astra／Opus。產品 Node 執行與共用 Node/CI 設定本輪未改，故不重跑完整產品測試或 build；AI Team Python、設定與 diff 檢查仍需在最後重跑。

後續 host 診斷：`.ai-team/scripts/Probe-AiTeamShell.py` 改用檔案接收輸出並直接等待程序，排除父程序等待 pipe EOF 的假性 timeout。`cmd.exe` 立即 exit 0 並輸出 `CMD_SMOKE_OK`；Windows PowerShell 5.1、Codex bundled PowerShell 7 與 WindowsApps PowerShell 7 均在 8 秒後仍在執行、stdout/stderr 空白，已由探針終止該次測試程序。此結果證明阻擋不侷限於 AI Team runner 或特定 `pwsh.exe`，但尚未定位 Windows/PowerShell 初始化停滯的根因；PowerShell 動態測試維持 BLOCKED。

## 2026-09-23 同一工作單元 live 驗收

本輪日常路徑選定 Codex Desktop 主對話依 `ai-team-lite` thin adapter，經既有 Python `route_cli.py`、Desktop 安裝的 `codex.exe`、`validation_runner.py`，最後由同一個 `assess_acceptance` 函式判定。當前 Desktop session 沒有載入 AI Team MCP；PowerShell MCP 在本 host 啟動阻擋，因此專案 `.codex/config.toml` 暫設 `enabled=false`，不作隱藏 fallback。這次未宣稱已驗證 MCP UI 直接呼叫或 PowerShell wrapper。

同一 task/run：`luna-live-20260923-r01`／`run-01`。隔離 fixture 與完整本機收據位於 `.ai-team/tmp/luna-live-20260923-r01/`（ignored；沒有真實 SaaS 資料）。事先固定 `test_calc.py` 的兩個加法案例，修改前 `python -m unittest discover -q` exit 1。兩檔修改前快照為 `sha256:f8a2d06a1aa214b5dbec515d606160cba0b4651bc253d93e76e83b78dd9612c3`；測試檔單獨快照前後皆為 `sha256:c27ace34865e356f1bb64b7047f7159f5562d9149fe0a8287aa7141ad65d0bd1`。

`route-before.json`：Lite、低 complexity／risk、requested Luna high、resolved `gpt-6-luna` high、沒有必要 reviewer，`execution=recommendation_only`。真實執行使用 Desktop 內 `codex.exe` 0.155.0-alpha.2.6 的 `exec --ephemeral --json -m gpt-6-luna -c model_reasoning_effort=high -s workspace-write -C <fixture> -`，只要求修改 `calc.py`，程序 exit 0；`calc.py` 由 `a - b` 變為 `a + b`。`codex-events.jsonl` 有 `turn.completed`。其前段有 skill 描述縮短的 metadata warning；既有 adapter 的 `record_native_execution` 僅將此已辨識的非任務警告分開計數，其他 error／`turn.failed` 仍 BLOCKED。首次保守解析為 BLOCKED，修正解析後只重新核對同一 JSONL，**沒有第二次模型呼叫**。`execution-verified.json` 由 adapter 產生，記錄前後版本、同一 task/run、requested／resolved 與 `observed=unknown`。

修改後 `route-after.json` 保持同一 task ID，來源快照為 `sha256:d2c9425ac69d4e0257ce78c75bf45120d439c9957f41e564e54e06812563eced`。`validation_runner.py --name unit --revision <after> --output <fixture>/unit.json -- python -m unittest discover -q` 實際執行 exit 0，收據 `PASS`。`accept-request.json` 指向上述 route、execution 與 unit 收據；共用 gate 的 `accept-result.json` 為 `READY`、blockers 空。負向 `accept-missing-check-result.json` 為 `BLOCKED: required_check_unverified:unit`；以舊來源版本送入的 `accept-stale-result.json` 為 `BLOCKED: snapshot_changed` 等。功能驗收 PASS 只代表此低風險 CLI 模式；CLI 未回報 observed model/effort，主對話模型未被宣稱切換。
