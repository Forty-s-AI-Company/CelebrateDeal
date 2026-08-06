# AI Team Workflow Policy

本文件是 CelebrateDeal AI Team 的 canonical policy。與舊 Prompt、歷史執行紀錄、`workflow-mode.md` 的舊配額說明或摘要衝突時，以本文件為準；產品安全規則則採較嚴格者。預設模式為 `PRELAUNCH_DEV`，只有使用者可明確切換至 `RELEASE_HARDENING`。

所有角色都必須保留既有使用者變更，不得讀取或輸出 `.env*`、憑證或正式客戶資料；不得自行 push、merge、rebase、amend、reset、clean、stash、restore、checkout 或部署。Codex 不得聲稱已建立 Codex Desktop Task 或已修改其標題。

## Canonical flow

每個 Goal 只處理一個 30～90 分鐘、可驗收且可回滾的 Work Package，依序為：

1. **Terra scan**：唯讀確認 scope、dirty ownership、風險與既有證據。
2. **Sol plan**：Sol 唯讀產生完整、可執行的計畫與 handoff，隨即停止。
3. **Terra implement and deterministic tests**：Terra 建立或更新 control-plane packet、實作、執行適用 deterministic tests、保存 evidence 與 checkpoint。
4. **AGY QA**：Terra 必須以 Fast wrapper 做唯讀 QA。wrapper 預設自動加入 `--dangerously-skip-permissions`，避免 headless 模式卡在無法互動的權限確認；仍固定 plan + sandbox、最多兩次。`TOOL_BLOCKED` 或 `LOGIN_REQUIRED` 如實保留，且不能取代 deterministic tests。
5. **Sol acceptance review**：Sol 唯讀複審 evidence，只能給出 `ACCEPT`、`CONTINUE_CURRENT_WP` 或 `PLAN_REMEDIATION`。
6. 只有 Sol 結論為 `ACCEPT`，主代理才可在 checkpoint、handoff 驗證與 Git 檢查後呼叫 `goal_finalize`。

`ai_team_router` 永遠只提供 `recommendation_only` 路由和本機 Goal state；它不啟動模型、命令列、瀏覽器或網路。

## Staging version freshness gate（測試前必做）

任何依賴 staging 的 Browser、API、資料庫、PayUni Sandbox、callback、webhook 或 reconciliation 測試，開始前都必須先確認「目前 staging 部署版號」就是「準備驗收的最新 workspace」。只看 hostname、瀏覽器分頁或舊 receipt 不算版號證據。

1. 記錄精確的 Vercel project、staging host、deployment ID／URL、target（必須是 non-Production staging）與 `READY` build 狀態。
2. 以本次 workspace 的 branch／HEAD 加上已納入部署的 dirty ownership／source fingerprint，與 staging deployment 的 revision／digest 或可驗證的 route/build evidence 比對。
3. 若版號不是最新、版號無法證明、alias 指向舊 deployment、route/build evidence 與 workspace 不一致，立即停止測試；先將目前已核准 workspace 更新部署到同一 staging project，再重新驗證 alias、deployment ID、build `READY` 與精確測試 route。
4. 只有 freshness gate 通過後，才可執行任何 staging side effect 或外部測試。更新部署本身不是測試證據；部署失敗、登入過期、routing 不明或版本無法比對時，必須 fail closed，記錄 `DEFERRED_WAITING_STAGING_VERSION`／`LOGIN_REQUIRED`／`TOOL_BLOCKED`，不得猜測舊版可代表新版。
5. Evidence 只保存遮罩化的 project、host、deployment ID／URL、revision／digest、build／route status 與 timestamp；不得保存 `.env*`、secret、token、cookie、原始 request／response body 或客戶資料。

這個 Gate 每次 staging 測試都重新執行，即使前一個 WP 已在同一 hostname 通過；任何新部署、workspace 變更或 alias 變更後都必須重新確認。

## Planner／Sol（唯讀）

- 一次只規劃一個 Work Package；讀取必要 policy、evidence、Git 狀態與既有 control-plane packet。
- 只輸出完整可執行計畫、風險、驗收與 `AI_TEAM_HANDOFF`；**不得**覆寫 `docs/ai-team/current-work-package.md`，不得寫入 Goal state，不得執行產品測試或開始實作。
- 計畫要描述合理、可回滾的自主修復邊界，而非使用固定 remediation 次數、full run 次數、檔案數量或複製長 Prompt 作為硬性 gate。
- Sol acceptance review 只依已保存的 deterministic-test、AGY QA、Git diff/status 與 evidence 判定：`ACCEPT`、`CONTINUE_CURRENT_WP` 或 `PLAN_REMEDIATION`；不可自行修正工作區。

## Executor／Terra

- Terra 根據 Sol 的唯讀 handoff 建立或更新 control-plane packet，並只執行已核准範圍；不得自行選擇下一個 WP 或跨越 Milestone。
- 負責獲授權範圍內的實作、deterministic tests、evidence、checkpoint、AGY QA 交接與 Git diff/status 檢查；不得將未執行的測試標示為 `PASS`。
- 同一 WP、同一驗收目標、root cause 與 Git ownership 可控時，可留在目前 Task 進行合理、可回滾的修復與 targeted diagnostics。範圍或風險改變時才交由 Sol 規劃 remediation。
- 提交僅在使用者已明確授權且可安全隔離時進行；本流程不隱含 commit 授權。

## AGY QA 與驗收

- AGY 只可經明確 Fast wrapper 以唯讀 plan + sandbox 方式呼叫，最多兩次；canonical QA 必須使用 wrapper 預設的自動權限同意，避免 headless permission auto-denied。不得讀取秘密、修改工作區、啟動正式服務或取代 Terra 的 deterministic tests。
- AGY 成功時保存 sanitized QA evidence；`TOOL_BLOCKED`／`LOGIN_REQUIRED` 是事實狀態，不得偽造成 QA 通過。若 deterministic gates 已通過，非必要 QA 的工具阻擋本身不推翻結果，但仍須由 Sol acceptance review 明確評估。
- Sol acceptance review 後，`ACCEPT` 才能完成 Goal；`CONTINUE_CURRENT_WP` 留在同一 Terra Task，`PLAN_REMEDIATION` 才交回 Sol 重新規劃。

## Work Package、dirty inventory 與 Task 邊界

- 一次只能處理一個 WP；修復必須與同一根因和驗收目標直接相關，並保有可驗證、可回滾的證據。
- remediation 後必須重跑受影響的必要驗收；不得降低 assertion、跳過測試、偽造 evidence，或以不相關成功掩蓋失敗 gate。
- `PRELAUNCH_DEV` 使用 ownership-based 驗證，而非固定 dirty path 數量；`UNKNOWN = 0`、無法安全分離的 `MIXED_HUNKS = 0`，且 `PRESERVE_ONLY` 不可被覆蓋或丟棄。living plan self-hash 只可作資訊性 metadata，不能形成循環 blocker。
- 角色或 WP 明顯改變時建立新 Task；同角色、同 WP、風險可控的續修可留在目前 Task。不要強制 task 邊界或強制複製 Prompt；handoff 仍須完整且可獨立理解。

## 不可放寬的硬限制

不得連接正式資料庫、讀取正式 Secret、使用正式支付或外部正式服務、部署、付費操作、未核准破壞性 migration、降低 assertion 或 coverage threshold、新增 skip、偽造 evidence、把未執行項目標為 `PASS`、覆蓋 `PRESERVE_ONLY`、stage `UNKNOWN`，或混入無關 WP。禁止 `git add .`、`git add -A`、`git commit -a`，以及任何 push、merge、rebase、amend、reset、clean、stash、restore 或 checkout 丟棄未知變更。

## Deprecated 流程

Codex CLI、Ollama 與 heavy MCP orchestration 已不再屬於 canonical handoff 流程（no longer current canonical）。舊文件僅可作歷史參考。

## Progress-value gate 與迴圈偵測（每輪必做）

每一輪開始規劃、修改或執行命令前，主代理必須先自問並在內部紀錄：

> 這個下一步，是否會有效推進重要產品功能、產品安全、上線必要證據，或直接解除目前阻擋？

- 若答案為「否」，不得繼續執行低價值的補測、重跑或格式整理；必須重新規劃，優先處理尚未達 7/10 的產品功能缺口。
- Coverage、lint、型別或測試補強只有在能直接解除明確 release gate、驗證已完成的產品行為，或補足必要不可替代證據時才具備執行理由；不得把 coverage 百分比的小幅上升當成產品功能完成。
- 若連續兩次以上對同一 Work Package、同一根因、同一失敗命令或同一指標沒有產生可量化的功能／驗收改善，標記 `LOOP_DETECTED`，保存精確 before／after 證據，立即停止自動重試並詢問使用者是否改變方向、接受範圍或結束目前路線。
- `AGY TOOL_BLOCKED` 不得單獨觸發無限重試；最多兩次後保留事實結果，改採 deterministic evidence 或停下詢問。
- 每份 handoff 必須包含 `VALUE_CHECK`（本輪產品價值、預期可量化成果、實際結果、是否偵測迴圈）。

使用者明確要求持續推進的長程 Goal，於單一 Work Package 通過 acceptance 後可自動銜接下一個已核准範圍；但遇到 `LOOP_DETECTED`、價值檢查為否、範圍／風險改變或需要新授權時，必須停下詢問使用者，不得以流程慣性繼續。

## AGY QA fallback chain（Fast → Deep → Luna）

對重要產品功能、產品安全或必要上線證據的 Work Package，Fast QA 不是唯一的嘗試路徑。deterministic tests 完成後，依下列順序執行並保存每一段的 sanitized receipt：

1. **AGY Fast**：以 canonical Fast wrapper、plan + sandbox 執行最多兩次。兩次均為 `FIRST_OUTPUT_TIMEOUT`、`TOOL_BLOCKED` 或沒有可用 structured verdict 時，才進入下一段；不得把 timeout 當成 PASS。
2. **AGY Deep fallback**：透過明確核准的 `Invoke-AiTeamReadOnlyFailover.ps1`／`Invoke-AgyDeep.ps1`，以相同唯讀 plan + sandbox 做一次 bounded Deep 審查。若取得可驗證 verdict，記錄為 `AGY_DEEP_FALLBACK`，不得冒充 Fast PASS；若 Deep 無輸出、被權限或登入阻擋，記錄 `TOOL_BLOCKED`。
3. **Luna handoff**：Deep 仍不可用時，產生 `FALLBACK_HANDOFF_REQUIRED`，交由核准的 native-agent runtime 以唯讀方式接手。Luna 不得由 PowerShell、MCP 或 wrapper 自動啟動；沒有 native runtime 或沒有回覆時，不得宣稱通過。

這條 fallback chain 不得無限重試，也不適用於已被 `LOOP_DETECTED` 判定為低價值的重複 coverage 工作；此時應保存 Fast／fallback 事實並停下重新排序產品工作。AGY 任何層級都不能取代 deterministic tests、Sol acceptance 或正式環境／外部服務證據。
