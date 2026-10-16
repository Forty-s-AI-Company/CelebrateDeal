# Goal Protocol

Goal 是可持續的產品任務容器。主代理可以在同一 Goal 內完成多個 Work Package，但每個工作都必須先取得明確 scope、route decision、ownership 與可追溯 evidence。

## 任務與模型

模型不由 Goal 固定。每個 Work Package 以結構化 signals 交給 `.ai-team/mcp_server/routing.py`：risk 會覆蓋 complexity，router 直接選最低足夠模型；模型故障、quota=0 或 CLI failure 才進 fallback。`ai-team-lite`、`ai-team`、`ai-team-pro` 只代表能力上限，Pro 也不會因 invocation 而強制 Astra/Opus。

需要外部 review 時才執行一次 bounded `agy models` discovery；未登入、CLI 不存在、輸出截斷或 quota 不明都如實標記並走 Codex fallback。不存在固定的 Fast→Deep→Luna 全域階梯。

## 安全與 ownership

- 同一檔案、資料表或外部資源同一時間只有一個 writer；不相交 scope 才可並行。
- Router/MCP 不 spawn、不呼叫 Codex CLI、不呼叫自己的 MCP。`AI_TEAM_CHILD=1`、`parent_depth>0` 或 dispatch budget 用盡立即阻止 child。
- Reviewer 只輸出 BLOCKER/MAJOR/MINOR/NIT findings，不直接改 code；Developer 修正後只驗證受影響範圍，除非風險要求 full regression。
- 禁止讀取或輸出 `.env*`、Token、Cookie、私鑰、正式 Secret、正式客戶或付款資料；禁止未授權 Production、正式 DB、付款、退款、寄信與破壞性 migration。
- 測試、外部工具阻擋與 provider failure 必須保留真實狀態，不得把未執行標成 PASS。

## State 與 handoff

Goal state 位於 `.ai-team/state/goal-state.json`，進度可寫入 `.ai-team/logs/goal-progress.md`。路由與 handoff 至少記錄 requested/effective team、selected model、reasoning、fallback events、review plan、dispatch/depth limits 與下一步。

合法狀態包括 `IN_PROGRESS`、`WAITING_AUTHORIZATION`、`BLOCKED_ENVIRONMENT`、`COMPLETE`。若必要 review 受阻，使用 `REVIEW_BLOCKED` 或 `FALLBACK_HANDOFF_REQUIRED`，不以跳過審查偽造完成。只有所有必要 deterministic、integration、staging/sandbox（若適用）與安全 evidence 齊全，才能標 `COMPLETE`。

## 停止與回復

同一命令或根因沒有改善時停止重試，改用明確 fallback 或記錄 blocked。讀取最後 checkpoint 後從未完成的 scope 繼續，不建立重複 Goal，也不使用 reset、clean、stash、restore 或 checkout 丟棄既有變更。

完整模型與 fallback 矩陣見 [`ROUTING.md`](ROUTING.md)，handoff 欄位見 [`handoff-schema.md`](handoff-schema.md)。
