@AGENTS.md

## Claude 接手說明

本專案原由 Codex 開發，現由 Claude 接手。交接盤點見 `docs/handoff-codex-to-claude.md`。

- `.ai-team/`、`.agents/`、`.codex/` 為 Codex 時期的 routing 與 adapter，保留作歷史與參考；Claude 預設以單一主代理工作，不自動啟動 AI Team、不呼叫 Codex CLI，除非使用者明確要求。
- AGENTS.md 中的安全底線、驗證規則與 Git 規則仍然有效。
