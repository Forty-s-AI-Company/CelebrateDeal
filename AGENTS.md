# CelebrateDeal Agent Rules

所有回覆以自然的繁體中文撰寫。尊重既有 Next.js、Prisma、API 與資料 schema；修改 Next.js 程式前先閱讀對應的本機 Next.js 文件。

## AI Team Lite v5.3

- Codex Desktop 主代理是唯一總指揮、整合者與最終驗收者。
- `/goal` 必須由 `gpt-5.6-terra`、High 執行；若主模型不同，停止並請使用者切換。
- Planner 為 `gpt-5.6-sol`、High、唯讀；只產生一次 30～90 分鐘工作包，完成後停止。
- Explorer：`gemini-3.6-flash-high`／High／唯讀 wrapper；Analyst：`gemini-3.1-pro-high`／High／唯讀 wrapper。
- Worker：`gpt-5.6-terra`／Medium；Worker Deep：`gpt-5.6-terra`／High；同一時間只允許一個可寫代理。
- Reviewer：`gemini-3.1-pro-high`／High／唯讀 wrapper，用於高風險變更、回歸與安全審查。
- 摘要、分類、Browser QA、E2E 與快速獨立檢查使用 Gemini Fast：`gemini-3.6-flash-high`／High。
- 跨檔第二意見與複雜驗證使用 Gemini Deep：`gemini-3.1-pro-high`／High。
- `ai_team_router` MCP 只做固定路由與 Goal state；不得執行、等待或管理外部工具。
- 外部工具最多兩次；失敗標記 `TOOL_BLOCKED`，不得阻塞 Terra 或形成重試迴圈。

## Goal 與驗收

- 一個 `/goal` 只處理一個 Work Package；完成後 checkpoint、保存驗證證據、檢查 `git diff` 與 `git status`，然後停止。
- 沒有工作包時才呼叫 Planner；Planner 不參與後續實作。
- Goal state 位於 `.ai-team/state/goal-state.json`；進度記錄位於 `.ai-team/logs/goal-progress.md`。
- 子代理與外部工具都是候選證據；主 Codex 必須驗證後才採用。

## 安全與 Git

- 不讀取、輸出或傳送 `.env`、金鑰、Token、Cookie、私鑰、憑證、正式客戶資料或付款資料。
- 不得自動 commit、push、merge、部署、正式資料庫操作、真實付款／退款／寄信。
- 修改前保留既有使用者變更；不得 reset、clean、stash、checkout、rebase 或丟棄變更。
- 正式修改後執行相關測試；未執行或遭外部條件阻擋的驗證必須如實標記。

## 文件索引

- Lite 架構：`docs/ai-team/ARCHITECTURE.md`
- 路由規則：`docs/ai-team/ROUTING.md`
- Goal 協議：`docs/ai-team/GOAL-PROTOCOL.md`
- 疑難排解：`docs/ai-team/TROUBLESHOOTING.md`
- 上線與人工／工具阻擋：`docs/launch/`
