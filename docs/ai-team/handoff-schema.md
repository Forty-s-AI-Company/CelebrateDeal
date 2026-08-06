# AI Team Handoff Schema

每個 Planner／Executor 任務結束時，**必須**輸出以下完整區塊。`NEXT_PROMPT` 必須自洽、可直接貼入新 Task 或目前 Task，不得仰賴目前對話內容。

```text
AI_TEAM_HANDOFF

CURRENT_TASK_RENAME:
<目前 Task 建議的新標題>

CURRENT_TASK_STATUS:
<COMPLETE／REWORK_REQUIRED／PARTIAL／BLOCKED／WAITING_AUTHORIZATION>

NEXT_TASK_REQUIRED:
<YES／NO>

NEXT_TASK_TITLE:
<若不需要新 Task，填 NOT_APPLICABLE>

NEXT_ROLE:
<SOL／TERRA／GEMINI／USER／NONE>

NEXT_MODEL:
<模型名稱與推理程度；不適用填 NOT_APPLICABLE>

NEXT_ACTION:
<EXECUTE_WP／AGY_QA／SOL_ACCEPTANCE_REVIEW／CONTINUE_CURRENT_WP／PLAN_REMEDIATION／REQUEST_AUTHORIZATION／STOP>

NEXT_REASON:
<簡明說明>

COPY_TO_NEW_TASK:
<YES／NO>

NEXT_PROMPT_BEGIN
<完整、可直接貼入的 Prompt>
NEXT_PROMPT_END
```

## PRELAUNCH_DEV 診斷欄位

在 `PRELAUNCH_DEV` 中，handoff 必須另外回報下列欄位；資料不可得時明確填 `NOT_STARTED`、`NOT_AVAILABLE` 或 `NOT_APPLICABLE`，不得以模糊文字取代：

```text
LAST_SUCCESSFUL_STAGE:
NEXT_COMMAND:
PROCESS_STARTED:
EXIT_CODE:
EXCEPTION_TYPE:
STDERR_SUMMARY:
ROOT_CAUSE_CONFIRMED:
ROOT_CAUSE_CATEGORY:
CURRENT_SCOPE_FILES:
PROPOSED_SCOPE_EXPANSION:
REMEDIATION_ROUND:
FULL_RUN_COUNT:
SCOPE_EXPANSION_REQUIRED:
USER_DECISION_REQUIRED:
PRODUCTION_ACCESS_REQUIRED:
```

同一 WP、同一 root cause 且 scope 可控時，`CURRENT_TASK_STATUS` 可為 `PARTIAL` 或 `BLOCKED`，並填 `NEXT_TASK_REQUIRED: NO`、`NEXT_ROLE: TERRA`、`NEXT_ACTION: CONTINUE_CURRENT_WP`、`COPY_TO_NEW_TASK: NO`；`NEXT_PROMPT` 必須是可貼回目前 Task 的完整合理、可回滾 remediation Prompt。範圍或風險改變時才填 `NEXT_TASK_REQUIRED: YES`、`NEXT_ROLE: SOL`、`NEXT_ACTION: PLAN_REMEDIATION`。只要 `NEXT_TASK_REQUIRED: YES`，`NEXT_PROMPT` 不得為空。

固定結束順序是：Terra deterministic tests → AGY QA → Sol acceptance review（僅 `ACCEPT`／`CONTINUE_CURRENT_WP`／`PLAN_REMEDIATION`）→ 更新 evidence 與 checkpoint → 產生 handoff → 驗證 handoff 必要欄位 → Git diff/status 檢查 → 僅在 `ACCEPT` 時 `goal_finalize` → 最終摘要。禁止在 `AI_TEAM_HANDOFF` 前 `goal_finalize`。

## 規則

1. `NEXT_PROMPT` 必須包含專案路徑、角色、目標、禁止事項與停止條件，並優先引用 canonical 文件，不重複所有長期規則。
2. `NEXT_TASK_REQUIRED = NO` 時：需續修則提供可貼回目前 Task 的 Prompt；只等待授權則提供授權請求文字；完全無後續時填 `NOT_APPLICABLE`。
3. 不得寫成已建立新 Task 或已修改目前 Task 標題；這些是使用者在 Codex Desktop UI 的操作。
4. `AI_TEAM_HANDOFF` 後可附人類可讀摘要，但不得缺少任何機器可讀欄位。
5. 每次輸出 `AI_TEAM_HANDOFF` 時，必須在完整區塊後額外輸出「可直接複製的 NEXT_PROMPT」：使用 fenced code block，內容必須與 `NEXT_PROMPT_BEGIN` 和 `NEXT_PROMPT_END` 之間的 Prompt 本體逐字一致，且 code block 內不得包含這兩個 marker。此規則適用於後續所有 Planner／Executor handoff。

## 價值檢查與 AGY fallback 欄位

每次 handoff 另須附上以下欄位，讓主代理能辨識「有效推進」與「工具迴圈」：

```text
VALUE_CHECK:
<本輪要改善的重要產品／安全／release 結果>
EXPECTED_MEASURABLE_OUTCOME:
<可量化的驗收結果>
ACTUAL_MEASURABLE_OUTCOME:
<實際結果；未完成填 NOT_STARTED／NOT_AVAILABLE>
LOOP_STATUS:
<NONE／LOOP_DETECTED>
AGY_FAST_STATUS:
<PASS／TOOL_BLOCKED／LOGIN_REQUIRED／NOT_STARTED>
AGY_DEEP_FALLBACK_STATUS:
<PASS／TOOL_BLOCKED／LOGIN_REQUIRED／NOT_REQUIRED／NOT_STARTED>
LUNA_HANDOFF_STATUS:
<PASS／FALLBACK_HANDOFF_REQUIRED／TOOL_BLOCKED／NOT_REQUIRED／NOT_STARTED>
```

對具有明確產品／安全／release 價值的 Work Package，`AGY_FAST_STATUS=TOOL_BLOCKED` 且已用盡兩次 Fast 嘗試時，必須先記錄 Deep fallback；Deep 仍不可用才可記錄 `FALLBACK_HANDOFF_REQUIRED`。若 `LOOP_STATUS=LOOP_DETECTED`，不得用 AGY fallback 延長同一低價值迴圈，必須停下詢問使用者並提出重新排序建議。
