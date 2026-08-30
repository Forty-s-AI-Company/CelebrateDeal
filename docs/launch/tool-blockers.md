# Tool Blockers

| ID | 工具 | 狀態 | 證據 | fallback |
|---|---|---|---|---|
| TB-01 | AGY CLI | 可用於 WP-04 Fast QA | `.ai-team/scripts/Invoke-AgyFast.ps1` 於 WP-04 attempt 1、exit 0 | 主 Codex；登入狀態仍不作正式憑證判定 |
| TB-02 | Gemini fast | 可用 | WP-04 Fast QA 已回傳 receipt completeness JSON，證據見 `wp-04-regression-baseline-20260727151211-6ac351eb/gemini-fast-qa.json` | Codex Reviewer／本地測試 |
| TB-03 | Gemini deep | RESOLVED（WP-06 sanitized review） | `Invoke-AgyDeep.ps1` attempt 1 回傳 Gemini 3.1 Pro High，結果見 `wp-06-migration-review-20260727163722-a1e8affb/gemini-deep-result.sanitized.json` | 主 Codex deterministic receipts |
| TB-04 | AGY Playwright MCP | TOOL_BLOCKED | 使用者層 config 最終只有空 `mcpServers` | project Playwright isolated fallback |
| TB-05 | Codex CLI Explore/Analyze | TOOL_BLOCKED | 大型一次、縮小 Explorer 一次長時間零結果後停止 | 主 Codex 本地唯讀稽核 |
| TB-06 | `git log --all` | TOOL_BLOCKED | WP-03 已診斷：5 個 checkpoint loose ref 在預設 Windows Git 下的絕對路徑皆為 260 字元，`fsck` 回報 `Filename too long`；程序層級 `core.longpaths=true` probe 可使 `git log --all -1` exit 0，但未持久套用 | branches/remotes/tags safe refs；任何持久 config 或 ref 修復均需另行授權 |
| TB-07 | Codex CLI Reviewer | TOOL_BLOCKED | 9 檔審查一次、縮成 2 檔一次，均長時間零結果後停止 | 主 Codex JSON／文件／Git 驗收 |
| TB-08 | Local Docker/PostgreSQL | RESOLVED | 使用者授權停止 temporary Windows PostgreSQL 後，Docker `celebratedeal_ci` 成為 `127.0.0.1:54329` endpoint；WP-04 完整 run 的 DB probe、11 migrations 與 cleanup 均 exit 0 | 無 |
| TB-09 | WP-12 snapshot build preflight | RESOLVED | `wp-12-bank-key-lifecycle-20260728015054-733/build-receipt.sanitized.json`：runner 以同一 `cmd setlocal` child process 注入 synthetic required names，`npm run build` exit 0 | 無 |
| TB-10 | Gemini Deep WP-13 | RESOLVED WITH REMEDIATION | Gemini Deep attempt 1 指出 bounded retry 與 tenant conditional write 防禦；已修正、final disposable rerun PASS，見 `wp-13-commission-dedup-status-20260728024622-953/gemini-deep-result.sanitized.json` | WP-14 另行審查 |

Playwright fallback 已通過，不代表 TB-04 已解除。

| TB-11 | Gemini Fast／Deep WP-14 | RESOLVED | 使用者完成 `agy models` 後，Fast PASS；Deep 的底層程序 exit 0／PASS，wrapper 對 `required_fixes` 空欄位出現 false positive。sanitized 記錄見 `.ai-team/reports/wp14-commission-accounting-20260728050645-915/gemini-fast-result.sanitized.json` 與 `gemini-deep-result.sanitized.json` | 無 |

WP-14 disposable runner 與獨立 Fast／Deep 複核均完成；TB-11 不再阻擋此工作包。

| TB-14 | Gemini Fast WP-09 wrapper result label | OBSERVED_NOT_BLOCKING | 底層 Gemini 3.6 Flash High exit 0 並回傳 `REWORK_REQUIRED` QA；wrapper regex 因 `required` 字樣誤標 `LOGIN_REQUIRED`，不是登入失敗 | 主 Codex 依 sanitized 內容與 deterministic evidence 判讀；不重試 |

| TB-12 | Gemini Fast WP-05 | TOOL_BLOCKED（non-blocking） | `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/gemini-fast-result.sanitized.json`：wrapper 在本機 Prompt 參數驗證即停止，未啟動 AGY/Gemini；依 WP 規則不重試 | deterministic targeted tests、architecture gate、lint、typecheck、diff check |

| TB-13 | Gemini Deep Reviewer（WP-07） | RESOLVED | 三次 headless wrapper 歷史嘗試均無模型輸出；使用者後以互動式唯讀 Gemini Deep 審查、只核准精確 read-only Bash command，成功回傳 `PASS`，無未解 Critical／High evidence-governance issue；證據見 `wp-07-auth-mfa-triage-20260728060121-511/gemini-deep-interactive-review.sanitized.json` | 無 |

| TB-15 | Gemini Fast WP-17 wrapper | TOOL_BLOCKED（non-blocking） | `.ai-team/reports/wp-17-mfa-recovery-concurrency-20260728184630752/gemini-fast-result.sanitized.json`：`Invoke-AgyFast.ps1` 在 AGY/Gemini 啟動前遇到本機 `ProcessStartInfo.ArgumentList` null 相容性錯誤；依 WP 規則不重試 | WP-17 deterministic PostgreSQL receipts 與主 Codex 驗收 |

| TB-16 | WP-18 coverage cross-WP DB test environment | RESOLVED | WP-19 canonical run `20260728213657260` 以互斥 `wp17-db`／`wp18-main` coverage projects 傳遞各自 schema owner flag；WP-17 107 targeted、WP-18 110 targeted、119 files／939 tests coverage、雙 marker-gated cleanup 與全部品質 gates 均 PASS。證據見 `docs/launch/wp19-coverage-synthetic-schema-20260728.md`。 | 已解除；保留此歷史根因與 receipt 指標 |

| TB-17 | Gemini Fast WP-18 wrapper | TOOL_BLOCKED（non-blocking） | `.ai-team/reports/wp-18-payout-batch-concurrency-20260728193607750/gemini-fast-result.sanitized.json`：wrapper 在模型啟動前出現本機 null ArgumentList 相容性錯誤 | 主 Codex deterministic receipts |

| TB-18 | WP-08 isolated Chromium cache | RESOLVED | runner 明確注入本機 immutable Playwright browser cache；canonical run `20260729050408559` 已通過 39 Browser tests 與全套 local gates | 無；不外推為外部或 production Browser evidence |
