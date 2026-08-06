# CelebrateDeal Agent Rules

所有回覆以自然的繁體中文撰寫。尊重既有 Next.js、Prisma、API 與資料 schema；修改 Next.js 程式前先閱讀對應的本機 Next.js 文件。

## AI Team Lite v5.4

目前預設 workflow mode 為 `PRELAUNCH_DEV`；只有使用者明確要求才能切換至 `RELEASE_HARDENING`。完整規則見 `docs/ai-team/workflow-mode.md`、`workflow-policy.md`、`handoff-schema.md` 與 Planner／Executor prompts。

- Codex Desktop 主代理是唯一總指揮、整合者與最終驗收者。
<!-- - `/goal` 必須由 `gpt-5.6-terra`、High 執行；若主模型不同，停止並請使用者切換。 -->
- Canonical flow：Terra scan → Sol 唯讀規劃 → Terra 實作與 deterministic tests → AGY Fast 唯讀 QA → Sol 唯讀 acceptance review → 主代理 checkpoint/finalize。
- Planner 為 `gpt-5.6-sol`、High、唯讀；只產生一次 30～90 分鐘工作包或 acceptance review，完成後停止；不得寫入 `current-work-package.md` 或 Goal state。
- Terra 是 control-plane 與工作區的唯一可寫角色；同一時間只允許一個可寫代理。實作一律由 Terra 依工作複雜度使用核准的推理等級完成。
- AGY Fast 以 plan + sandbox 與預設自動權限同意做唯讀 QA，最多兩次；這只避免 headless 權限確認，不解除 sandbox 或敏感資料限制。`TOOL_BLOCKED`／`LOGIN_REQUIRED` 必須如實保存，且不能取代 deterministic tests。
- Explorer、Analyst、Worker Deep、Reviewer 與 Gemini Deep 均非 canonical 主流程角色；只有使用者明確要求時才能作為唯讀輔助證據，且不得形成主流程分支或取得寫入權限。
- `ai_team_router` MCP 只做固定路由與 Goal state；不得執行、等待或管理外部工具。
- Sol acceptance review 僅可給出 `ACCEPT`、`CONTINUE_CURRENT_WP` 或 `PLAN_REMEDIATION`；只有 `ACCEPT` 可 finalize。

## Goal 與驗收

<!-- - 一個 `/goal` 只處理一個 Work Package；Terra 建立／更新 control-plane packet，完成後 checkpoint、保存驗證證據、檢查 `git diff` 與 `git status`，然後停止。 -->
- Terra 建立／更新 control-plane packet，完成後 checkpoint、保存驗證證據、檢查 `git diff` 與 `git status`，然後停止。
- 沒有工作包時才呼叫 Planner；Sol 不參與後續實作，但在 AGY QA 後做唯讀 acceptance review。
- Goal state 位於 `.ai-team/state/goal-state.json`；進度記錄位於 `.ai-team/logs/goal-progress.md`。
- 子代理與外部工具都是候選證據；主 Codex 必須驗證後才採用。

## 安全與 Git

- 不讀取、輸出或傳送 `.env`、金鑰、Token、Cookie、私鑰、憑證、正式客戶資料或付款資料。
- 不得自動 commit、push、merge、部署、正式資料庫操作、真實付款／退款／寄信。
- 修改前保留既有使用者變更；不得 reset、clean、stash、checkout、rebase 或丟棄變更。
- 正式修改後執行相關測試；未執行或遭外部條件阻擋的驗證必須如實標記。
- `PRELAUNCH_DEV` 以 ownership 驗證 dirty inventory，不以固定數量阻擋；living plan self-hash 不得成為循環 blocking gate。`BLOCKED` 不必然交回 Sol：同一 WP、同一根因且 scope 可控時，Terra 可採合理、可回滾修復，不以固定配額、full run 次數或檔案數為硬性 gate。

## 文件索引

- AI Team canonical workflow：`docs/ai-team/workflow-policy.md`
- AI Team handoff schema：`docs/ai-team/handoff-schema.md`
- Planner Prompt：`docs/ai-team/prompts/planner-prompt.md`
- Executor Prompt：`docs/ai-team/prompts/executor-prompt.md`
- Lite 架構：`docs/ai-team/ARCHITECTURE.md`
- 路由規則：`docs/ai-team/ROUTING.md`
- Goal 協議：`docs/ai-team/GOAL-PROTOCOL.md`
- 疑難排解：`docs/ai-team/TROUBLESHOOTING.md`
- 上線與人工／工具阻擋：`docs/launch/`

每個 Planner／Executor 任務結束時必須輸出 `AI_TEAM_HANDOFF`；不得自動開始下一個 WP，也不得聲稱已建立 Codex Desktop Task 或修改 Task 標題。角色或 WP 改變時應建立新 Task；同角色、同 WP 的小範圍續修可留在原 Task。舊 Prompt 與 `workflow-policy.md` 衝突時以後者為準，產品安全規則採較嚴格者。已失效的 Codex CLI、Ollama、heavy MCP orchestration 已不再屬於 canonical 流程（no longer current canonical）。

## 每輪重要性自檢

每輪開始前先自問：「這個下一步是否能有效推進重要功能、產品安全或必要上線證據？」若不能，立即重新規劃，不要在 coverage、重跑或格式細節上迴圈。若同一根因／命令／指標連續兩輪沒有實質改善，標記 `LOOP_DETECTED`、保存證據並停下詢問使用者；不得為了維持流程而繼續重試。詳細規則以 `docs/ai-team/workflow-policy.md` 與 `docs/ai-team/GOAL-PROTOCOL.md` 為準。
