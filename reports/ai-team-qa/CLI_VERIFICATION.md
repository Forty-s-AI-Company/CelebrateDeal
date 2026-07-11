# CLI Verification Report

## 1. Codex CLI 驗證結果
- **指令存在性**：`codex` 存在。
- **版本**：`codex-cli 0.134.0`
- **Non-interactive Mode**：支援，透過 `codex exec`。
- **主要參數支援**：
  - `--model <MODEL>`：支援，可用於切換模型。
  - `--sandbox <SANDBOX_MODE>`：支援，包含 `workspace-write`, `read-only`, `danger-full-access`。
  - `--output-schema <FILE>`：支援，可確保結構化輸出。
  - `--json`：支援，可將事件以 JSONL 輸出。
  - 工作目錄 (`--cd`)：支援。
  - 狀態延續 (`--resume`)：支援。
- **Stdin / Prompt 傳遞**：若未提供 argument 或使用 `-`，會自動讀取 stdin。

## 2. Antigravity CLI 驗證結果
- **指令存在性**：`antigravity` 不存在，產生 CommandNotFoundException。但 `agy` **存在**。這是一個潛在的配置風險，若 `team-config.yaml` 優先執行 `antigravity`，可能會出現錯誤，但幸好 `team-config.yaml` 中包含 `executables: ["antigravity", "agy", "agy.exe", "antigravity-cli"]` 的 Fallback 機制，因此 Adapter 能成功捕獲 `agy`。
- **版本**：`1.1.1`
- **Non-interactive Mode**：支援，透過 `--print` 或 `-p`。
- **主要參數支援**：
  - `--model`：支援切換模型。
  - `--sandbox`：支援 Terminal 沙盒限制。
  - `--continue` / `--conversation`：支援延續 Session。
  - `--print-timeout`：支援設定超時時間（預設 5m0s）。
- **缺少的直接參數**：未明確在 `--help` 中看到 `--output-schema`（結構化輸出），可能依賴 Prompt 要求或 Adapter 自行 Parse JSON。

## 3. 對比 Adapter 配置與實際 CLI 能力
- **不一致點 (P2)**：`team-config.yaml` 首選的 `antigravity` 不在 PATH 中，依賴 `agy` 進行 Fallback。建議團隊統一別名，避免不同機器的環境變數導致失敗。
- **結論**：雙 CLI 的無頭 (Headless) 模式皆具備，能夠支撐 AI Team Orchestrator 的自動化派發。

*註解：所有 CLI 指令的 `exit code` 與 `timeout` 行為將在 Phase 5 Pipeline Resilience Test 中進行深度驗證。*
