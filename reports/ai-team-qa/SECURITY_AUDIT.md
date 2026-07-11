# Token Efficiency & System Security Audit Report

## 1. 審查目標
評估 CelebrateDeal 雙引擎 AI 團隊在運作時的 Token 效率設計，以及無人值守 (Unattended) 自動化操作的系統安全性。

## 2. Token 效率分析 (Token Efficiency)
1. **動態內容讀取 (Dynamic Reading)**：`orchestrator.py` 在產生 `prompt` 給 Codex/Antigravity 時，並未將 `AGENTS.md` 或龐大的程式碼庫暴力塞入 Prompt 內。它僅注入該職位的核心指令 (`<agent_instructions>`)，並要求 Agent 主動呼叫工具「讀取 AGENTS.md 與適用的 Skills」。這大幅減少了初始 Payload 大小，並善用了模型的 Context Caching 機制。
2. **聚焦式回退 (Focused Repair)**：當驗證失敗進入 Retry 時，Orchestrator 僅提供 `failure_summary` (限制在最近的 6000 字元內)，而不是傾印整個日誌，這防止了長篇大論的建置日誌撐爆 Context Window。
3. **結論**：架構上達成了優秀的 Token 效率，並成功引導 Agent 只在需要時進行探索。

## 3. 系統安全審查 (System Security)
Orchestrator 實作了多層防護，確保即便 AI 產生惡意或破壞性指令，系統依然安全：
1. **工作區隔離 (Worktree Isolation)**：所有寫入操作都被限制在 `codex/automation/<slug>` 分支與 `.worktrees/<slug>` 目錄中。即使發生毀滅性變更 (如 `git reset --hard`)，也不會影響主分支與正在開發的目錄 (`ensure_clean_base` 確保環境乾淨)。
2. **沙盒執行 (CLI Sandboxing)**：
   - Codex 強制套用 `--sandbox workspace-write`。
   - Antigravity 強制套用 `--sandbox`。
   - 阻止 Agent 逃逸至整個作業系統。
3. **驗證指令防注入 (Validation Command Whitelisting)**：`parse_validation_command()` 函式嚴格限制只能執行 `npm run <script>`，並且 `<script>` 必須存在於 `ALLOWED_VALIDATION_SCRIPTS` 內 (如 `test`, `e2e:smoke`, `lint`)。它也使用 Regex `[;&|><`$]` 徹底防堵了 Shell injection (如 `npm run lint && rm -rf /`)。
4. **供應鏈保護 (Supply Chain Protection)**：`assert_automation_change_scope()` 會在自動化合併前檢查被修改的檔案清單。若 Agent 修改了受到保護的檔案 (如 `.github/` 或 `package.json`，根據 `automation_forbidden_paths`)，Orchestrator 會拋出 `RuntimeError` 並阻擋該流程。
5. **環境變數淨化 (Environment Sanitization)**：Adapter 僅傳遞白名單內的系統環境變數 (`DEFAULT_ENV_ALLOWLIST`) 給 Agent 程序，確保正式資料庫帳密或金流憑證不會洩漏給子程序。

## 4. 結論
**狀態：通過 (Pass)**
目前的架構展現出極高的成熟度，充分體現了「防禦性自動化設計 (Defensive Automation Design)」。不僅解決了 Token 浪費的問題，其沙盒與供應鏈保護機制也確實達到了商業系統所要求的安全標準。
