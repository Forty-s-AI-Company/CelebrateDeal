# Goal Protocol

每個 `/goal` 只處理一個 30～90 分鐘 Work Package，主代理必須為 `gpt-5.6-terra`／High。

1. 沒有工作包時，先用 Planner 建立一個工作包；Planner 隨即停止。
2. 以 `goal_bootstrap` 建立 state，並把工作包分成可驗收 phase。
3. 每個 phase 完成後以 `goal_checkpoint` 記錄摘要、證據、測試與下一步。
4. 外部工具最多嘗試兩次；失敗記為 `TOOL_BLOCKED`，繼續可獨立完成的工作。
5. 中斷後用 `goal_resume` 取得第一個未完成 phase；不得重做已有有效證據的工作。
6. 所有 phase 完成且沒有未解決人工阻擋後，才可用 `goal_finalize`。
7. 更新 `docs/launch/next-work-packages.md`、`evidence-index.md` 與必要 blocker 文件，檢查 Git 差異後停止 Goal。

狀態檔：`.ai-team/state/goal-state.json`；進度檔：`.ai-team/logs/goal-progress.md`。
