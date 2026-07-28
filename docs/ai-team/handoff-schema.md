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
<PLAN_NEXT_WP／PLAN_REMEDIATION／PLAN_PROBE／EXECUTE_WP／CONTINUE_CURRENT_WP／REQUEST_AUTHORIZATION／STOP>

NEXT_REASON:
<簡明說明>

COPY_TO_NEW_TASK:
<YES／NO>

NEXT_PROMPT_BEGIN
<完整、可直接貼入的 Prompt>
NEXT_PROMPT_END
```

## 規則

1. `NEXT_PROMPT` 必須包含專案路徑、角色、目標、禁止事項與停止條件，並優先引用 canonical 文件，不重複所有長期規則。
2. `NEXT_TASK_REQUIRED = NO` 時：需續修則提供可貼回目前 Task 的 Prompt；只等待授權則提供授權請求文字；完全無後續時填 `NOT_APPLICABLE`。
3. 不得寫成已建立新 Task 或已修改目前 Task 標題；這些是使用者在 Codex Desktop UI 的操作。
4. `AI_TEAM_HANDOFF` 後可附人類可讀摘要，但不得缺少任何機器可讀欄位。
