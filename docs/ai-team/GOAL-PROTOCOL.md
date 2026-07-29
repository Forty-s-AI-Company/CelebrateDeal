# Goal Protocol

每個 `/goal` 只處理一個 30～90 分鐘 Work Package，主代理必須為 `gpt-5.6-terra`／High。

1. 沒有工作包時，先用 Planner 建立一個工作包；Planner 隨即停止。
2. 以 `goal_bootstrap` 建立 state，並把工作包分成可驗收 phase。
3. 每個 phase 完成後以 `goal_checkpoint` 記錄摘要、證據、測試與下一步。
4. 外部工具最多嘗試兩次；失敗記為 `TOOL_BLOCKED`，繼續可獨立完成的工作。
5. 中斷後用 `goal_resume` 取得第一個未完成 phase；不得重做已有有效證據的工作。
6. 完成實作與驗收後，先更新 evidence 與 checkpoint，產生並驗證完整 `AI_TEAM_HANDOFF`；若 `NEXT_TASK_REQUIRED = YES`，`NEXT_PROMPT` 不得為空。
7. 所有 phase 完成且沒有未解決人工阻擋後，才可在 handoff 驗證完成後使用 `goal_finalize`。
8. 更新必要的索引／blocker 文件，檢查 Git 差異後停止 Goal；不得因 finalize 自動開始下一個 WP。

狀態檔：`.ai-team/state/goal-state.json`；進度檔：`.ai-team/logs/goal-progress.md`。
