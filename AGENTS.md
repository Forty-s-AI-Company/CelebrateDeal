# CelebrateDeal Agent Rules

## 回覆與技術風格

- 所有回覆使用自然的繁體中文。
- 修改 Next.js 程式前，先閱讀對應的本機 Next.js 文件。
- 直接推進使用者目標；只有安全、授權或不可驗證的阻擋才停下詢問。

## Autonomous prelaunch mode

CelebrateDeal 目前是尚未對外營運的專案，預設採 `PRELAUNCH_DEV_AUTONOMOUS`：

- 一個長程 Goal 可以連續執行多個 Work Package，不需要每 30～90 分鐘停止。
- Terra、Sol、AGY、Luna 可依工作需要自動協作；不強制每個 WP 都走相同階段。
- 已核准 roadmap 內的下一個 WP 可在 checkpoint 後自動接續。
- Planner 可重新規劃、更新 plan metadata；Terra 可直接在同一 Goal 內實作與驗證。
- 低風險測試、文件、coverage 與本地功能修正可並行；高風險工作才需要額外 acceptance。
- Agent 可以使用本機、loopback、disposable、staging 與 sandbox 資源，只要符合安全底線與明確 scope。
- 允許建立精確 scope 的本地 checkpoint commit；不得自動 push 或合併到遠端。

## 不可放寬的安全底線

- 不讀取、輸出或傳送 `.env*`、密碼、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料。
- 不操作正式資料庫、正式付款、正式退款、正式寄信或其他正式服務；Production deployment 仍需另外明確授權。
- 不執行未核准的破壞性 migration、資料刪除、廣域 Docker cleanup 或不可逆外部操作。
- 不偽造 evidence，不把未執行、失敗或工具阻擋的測試標成 `PASS`。
- 不降低 assertion、coverage threshold、資料驗證強度；不得用 skip、exclude 或刪資料掩蓋失敗。
- 保留所有使用者既有變更；不得覆蓋未知 ownership，也不得使用 `reset`、`clean`、`stash`、`restore`、`checkout` 丟棄工作。
- 同一檔案或資料資源同一時間只允許一個 writer；不同 scope 可並行。
- 所有外部、staging、sandbox 與 disposable 操作必須保存最小化、可驗證的 sanitized evidence。

## 代理協作

- 主代理負責整合與最終判斷，但不要求固定模型或固定角色順序。
- Sol、Terra、AGY Fast、AGY Deep、Luna 可依可用性與風險自動選擇；fallback 只能如實記錄，不能冒充成功。
- 推理程度依任務難度動態選擇，以最低足夠成本完成工作：Sol `low`～`xhigh`、Terra `low`～`xhigh`、Luna `high`～`max`；其他模型設定維持不變。一般任務優先採中間值，只有真正簡單或高風險困難任務才使用範圍端點。
- `ai_team_router` 可執行已核准的本地協作，但不得繞過安全底線或擴大 scope。
- AGY Fast 失敗後可自動轉 Deep，再轉 native Luna；不可無限重試同一個失敗命令。

## 驗證與進度

- 依產品價值選擇 targeted tests、integration tests、coverage、Browser、staging 或 sandbox 驗證，不強制每輪執行全部命令。
- Coverage gate 是品質訊號；不得降低門檻，但不再阻擋功能測試或 E2E 的合理執行。
- 發現同一失敗沒有改善時，停止該路徑並改用不同診斷或產品工作；不得在同一死路無限重試。
- 每個 checkpoint 保存 scope、實際結果、證據、回滾方式與下一步；完整 handoff 只在角色或風險真正變更時輸出。
- 最終 Goal 只有在所有目標與必要 release evidence 完成後才可標記 `COMPLETE`。

## 文件優先順序

- Canonical workflow：`docs/ai-team/workflow-policy.md`
- Goal protocol：`docs/ai-team/GOAL-PROTOCOL.md`
- Routing：`docs/ai-team/ROUTING.md`
- Handoff schema：`docs/ai-team/handoff-schema.md`
- 歷史 WP 的一次性 scope 只對該 WP 有效，不得被當成全域限制。
