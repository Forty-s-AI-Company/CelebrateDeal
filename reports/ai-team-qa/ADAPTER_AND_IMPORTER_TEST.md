# Adapter Implementation & QA Importer Boundary Test Report

## 1. 測試目標
審查 `adapters/` 目錄下的雙 CLI 引擎實作，並針對 `pipeline_cli.py` 內的 QA Importer 進行惡意/異常輸入的邊界測試 (Boundary Tests)，確認資料正規化 (Normalization) 與容錯能力。

## 2. Adapter 實作審查
經查閱 `base_adapter.py`, `codex_adapter.py`, `antigravity_adapter.py`，總結如下：
- **安全隔離 (Security & Redaction)**：`base_adapter.py` 實作了非常嚴格的環境變數過濾 (只允許 `DEFAULT_ENV_ALLOWLIST`)，並且使用 Regex 在 `redact()` 函式中剔除所有的 Secrets (Token, Keys, Passwords 等)，這符合高階的資安規範。
- **無頭模式 (Headless Execution)**：
  - Codex 使用 `codex exec -` 接收 stdin 作為 prompt，並要求 `--json` 與 `--output-schema`。
  - Antigravity 為了繞開互動模式，使用 `--print`，並在 prompt 內強制注入 `"Return only valid JSON. "`。
- **錯誤捕獲 (Error Handling)**：兩者皆具備超時 (Timeout) 與 `actual_model` 解析能力，且在 Antigravity 遇到 Authentication/Login 字眼時能正確阻擋。

## 3. QA Importer 邊界測試 (Boundary Test)
我們建立了一個不合規範的 QA Payload (`boundary_qa.json`)：
1. 缺少部分欄位的正常 Issue。
2. 沒有 ID 且 Severity 未知 (`UNKNOWN_PRIORITY`) 的 Issue。
3. 具有不支援的 Severity (`P4`)，且 `affected_paths` 為逗號分隔字串、`reproduction` 為換行字串的 Issue。

**執行指令**：`python automation/pipeline_cli.py import-qa --file reports/ai-team-qa/boundary_qa.json`

**測試結果 (通過)**：
1. **ID 自動推導**：沒有 ID 的 Issue 被成功賦予 fallback ID (`QA-002`)。
2. **嚴重度收斂**：未知的 `UNKNOWN_PRIORITY` 與不支援的 `P4`，皆被安全地降級並收斂至預設值 `P2`。
3. **字串轉陣列**：
   - 逗號分隔的 `affected_paths` ("src/app/page.tsx, src/components/Button.tsx") 被正確 Parse 為陣列：`["src/app/page.tsx", "src/components/Button.tsx"]`。
   - 換行符號分隔的 `reproduction` 步驟被正確切分為字串陣列。
4. **預設標記**：所有的匯入都被強制打上 `"untrusted": true` 的標籤，並給定預設的處理角色 (repair-engineer, code-reviewer)。

## 4. 結論
**狀態：通過 (Pass)**
Adapter 實作的隔離性非常高，沒有將開發環境的環境變數直接透傳給子處理程序。QA Importer 展現了強大的容錯能力，能安全地將外部非標準結構的 Markdown 或 JSON 轉換為 Orchestrator 能夠信任與處理的標準格式。
