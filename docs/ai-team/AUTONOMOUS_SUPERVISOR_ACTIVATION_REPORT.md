# CelebrateDeal AI Team 無人值守啟用驗收

日期：2026-07-12 01:45 Asia/Taipei

基準 HEAD：`534e827ca913251b34aeae0db1bd619e296fabd0`

## 結論

本機無人值守 AI Team supervisor 已可啟用為 `CONDITIONAL`。

`CONDITIONAL` 的意思是：本機 Credential Manager、Windows Task Scheduler、single-instance lock、restart/resume state、discovery、triage、auto-cycle 與 commit-evidence 都能運作；但 Antigravity provider-native QA、完整 attested pipeline regression/release-check 與外部 dashboard evidence 尚未全部完成，因此不能宣稱 production release ready。

## Credential Manager

- 初始狀態：`credential-not-found`
- 修復：`automation/store-attestation-key.ps1` 原本在多 Python 安裝環境會把多個 Python path 串在一起，已改成 `Select-Object -First 1`
- 建立後狀態：`credential-generated`，接著 `credential-ready`
- Secret 處理：未輸出 key，未寫入 repo，未傳入 Codex 或 Antigravity adapter

## Task Scheduler

任務名稱：`CelebrateDeal-AI-Autonomous-Supervisor`

狀態：`Ready`

Action：

```text
Execute: C:\Program Files\Python311\python.exe
Arguments: "C:\Users\eden\Downloads\AI\CelebrateDeal\automation\autonomous_supervisor.py" --once
WorkingDirectory: C:\Users\eden\Downloads\AI\CelebrateDeal
```

判定：排程器啟動的是統一 `autonomous_supervisor.py --once`，不是 quota-only probe。排程每小時觸發一次；每次由 supervisor 執行 discovery、triage、auto-cycle、QA handoff、regression、release-check 與 commit-evidence。

## Supervisor 啟動證據

已執行兩次：

```powershell
npm run ai:auto-cycle:once
```

兩次結果皆為：

- `status`: `conditional`
- `attestationKey.available`: `true`
- `attestationKey.source`: `windows-credential-manager`
- `quota-status`: `passed`
- `discovery`: `passed`
- `triage`: `passed`
- `auto-cycle`: `passed`
- `qa-import`: `passed`
- `commit-evidence`: `passed`
- `consecutiveFailures`: `0`

Structured log：

```text
2026-07-11T17:37:35Z cycle-started keyAvailable=true keySource=windows-credential-manager
2026-07-11T17:41:35Z cycle-finished status=conditional stepCount=10 consecutiveFailures=0
2026-07-11T17:41:42Z cycle-started keyAvailable=true keySource=windows-credential-manager
2026-07-11T17:45:35Z cycle-finished status=conditional stepCount=10 consecutiveFailures=0
```

Runtime state：

```json
{
  "lastStatus": "conditional",
  "consecutiveFailures": 0
}
```

## Single-instance / duplicate resume

手動 supervisor 執行期間，Windows Task Scheduler 也觸發了一次 supervisor。第二個 process 被 lock 擋下並寫入：

```json
{
  "status": "already-running"
}
```

判定：multi-process duplicate start 已被 single-instance lock 攔截，沒有形成併發寫入。

## Quota recovery / Ollama fallback

本輪實機沒有遇到真實 Codex 或 Antigravity 額度不足，因此沒有產生 `quota-state.json`。

已由 automation tests 覆蓋：

- Codex `You've hit your usage limit` 並解析 provider reset time
- Antigravity `HTTP 429` / `RESOURCE_EXHAUSTED`
- Antigravity `Reset Time: 2026-07-12 08:00:00 (Local Time)`
- reset time 過期或不可信時改用 hourly probe
- quota wait 時 supervisor short-circuit，不繼續執行高成本 stage
- provider 恢復但缺少 attestation key 時不得 resume
- stale pipeline binding 不得 resume
- Ollama 僅允許輕量模型處理文件與簡單報告，不能替代 provider-native stage

External required：需等真實 Codex/Antigravity 額度不足事件或手動 sandbox 模擬，才能驗證供應商實際訊息格式與 reset time 完全一致。

## 本輪發現並修復的問題

### P2：Windows 多進程 CAS lock cleanup 競態

最後一輪 supervisor discovery 曾抓到 `automation:test` 失敗：

```text
test_compare_and_swap_is_process_safe
PermissionError: [WinError 32] 程序無法存取檔案，因為檔案正由另一個程序使用。
```

原因：Windows 下另一個 process 讀取 `.lock` 檔時，持有 lock 的 process 關閉 fd 後立刻刪除檔案，仍可能遇到短暫 delete-deny。

修復：

- `automation/pipeline_engine.py` 新增 lock cleanup retry
- stale lock 清理與 finally cleanup 共用同一個 retry 邏輯

驗證：

- `test_compare_and_swap_is_process_safe` 連續 3 次通過
- `npm run automation:test`：131 tests passed
- 修復後 `npm run ai:auto-cycle:once` 回到 `conditional`，discovery passed，P0/P1/P2/P3 counts 皆為 0

## External required

- Antigravity non-interactive smoke 在本輪 timeout，Codex fallback 只能產出 `fallback-conditional`，不能滿足 provider-specific Antigravity QA。
- Antigravity 登入、quota 與 Desktop/browser QA evidence 仍需外部環境驗收。
- 完整 attested pipeline regression 尚未可跑，因目前沒有 completed attested pipeline。
- release-check 仍 deferred，需先完成 plan 到 release-manager 的 required stages。
- Production Go-live 仍需要 Cloudflare、PayUni、Resend、Sentry、PostHog、durable rate limit dashboard evidence。

## Release Gate

Decision：`CONDITIONAL`

Passed：

- Credential Manager key ready
- Task Scheduler registered and points to unified supervisor
- Multiple `ai:auto-cycle:once` runs completed; final run after CAS fix returned `conditional`
- Restart/resume state updated
- Single-instance duplicate start rejected
- Commit evidence remained controlled by isolated trusted executor policy
- Discovery no longer reports automation CAS P2 after fix

Blocked / Deferred：

- Antigravity provider-native QA
- Completed attested pipeline regression
- Release-check after required stages
- Production external service validation

## 長時間 dry-run 驗收：2026-07-12 04:47-04:59 Asia/Taipei

基準 HEAD：`dd1b2d586fbf0e828c0c5f7c42e62fde7d3e5c99`

### 啟用狀態

- Credential Manager：`credential-ready`
- Task Scheduler：`CelebrateDeal-AI-Autonomous-Supervisor` 為 `Ready`
- Scheduler action：

```text
Execute: C:\Program Files\Python311\python.exe
Arguments: "C:\Users\eden\Downloads\AI\CelebrateDeal\automation\autonomous_supervisor.py" --once
WorkingDirectory: C:\Users\eden\Downloads\AI\CelebrateDeal
```

### 每小時輪巡證據

Structured log 顯示 Task Scheduler 已自動每小時觸發 unified supervisor，不是 quota-only probe：

```text
2026-07-11T18:38:24Z cycle-started keyAvailable=true keySource=windows-credential-manager
2026-07-11T18:41:58Z cycle-finished status=conditional stepCount=10 consecutiveFailures=0
2026-07-11T19:38:24Z cycle-started keyAvailable=true keySource=windows-credential-manager
2026-07-11T19:41:48Z cycle-finished status=conditional stepCount=10 consecutiveFailures=0
2026-07-11T20:38:24Z cycle-started keyAvailable=true keySource=windows-credential-manager
2026-07-11T20:41:57Z cycle-finished status=conditional stepCount=10 consecutiveFailures=0
```

### 連續 supervisor cycle

手動執行至少兩個連續 dry-run cycle，另加一輪收尾 cycle：

```powershell
npm run ai:auto-cycle:once
npm run ai:auto-cycle:once
npm run ai:auto-cycle:once
```

結果：

- 第 1 輪：`status=conditional`，`stepCount=10`，`consecutiveFailures=0`
- 第 2 輪：`status=conditional`，`stepCount=10`，`consecutiveFailures=0`
- 收尾輪：`status=conditional`，`stepCount=10`，`consecutiveFailures=0`
- Final state：`lastStatus=conditional`，`consecutiveFailures=0`
- Final discovery counts：`P0=0`、`P1=0`、`P2=0`、`P3=0`

最後兩筆手動輪巡 structured log：

```text
2026-07-11T20:51:14Z cycle-started keyAvailable=true keySource=windows-credential-manager
2026-07-11T20:54:51Z cycle-finished status=conditional stepCount=10 consecutiveFailures=0
2026-07-11T20:56:09Z cycle-started keyAvailable=true keySource=windows-credential-manager
2026-07-11T20:59:56Z cycle-finished status=conditional stepCount=10 consecutiveFailures=0
```

### Antigravity provider-native 狀態

Provider-native Antigravity smoke 未通過，必須維持 `External required`：

```json
{
  "provider_requirement_satisfied": false,
  "capability_equivalent": false,
  "antigravity": {
    "status": "failed",
    "timed_out": true,
    "duration_seconds": 45.016,
    "error": "Non-interactive Antigravity smoke timed out; manual login or UI validation is required"
  }
}
```

Codex fallback 有執行，但不可視為 Antigravity QA pass。`qa-handoff` 仍正確回報：

```text
Codex fallback cannot satisfy provider-specific Antigravity QA.
```

### Quota recovery 狀態

本次 dry-run 沒有遇到真實 Codex 或 Antigravity 額度耗盡，因此沒有產生 `reports/ai-team/runtime/quota-state.json`。

已由 `npm run automation:test` 覆蓋 mock evidence：

- Codex usage-limit reset time parsing
- Antigravity `HTTP 429` / `RESOURCE_EXHAUSTED`
- Antigravity `Reset Time: ... (Local Time)`
- expired / far-future reset time 防護
- provider available 但缺少 coordinator key 時不得 resume
- stale pipeline binding 不得 resume
- Ollama docs-only fallback 不滿足 provider-native stage

### 本輪驗證命令

```text
npm run automation:test      PASS, 131 tests
npm run ai:validate          PASS, 11 native agents / 14 Codex roles / 10 Antigravity roles / 9 skills
npm run security:secrets     PASS, 626 tracked and untracked files scanned
npm run ai:doctor            PASS
npm run ai:auto-cycle:once   PASS as local loop, status=conditional
```

### Dry-run release gate

Decision：`CONDITIONAL`

Passed：

- Credential Manager key available from Windows Credential Manager
- Task Scheduler registered and hourly trigger observed
- Three manual supervisor cycles completed without hard failure
- `consecutiveFailures=0`
- Discovery counts `P0/P1/P2/P3=0`
- Secret scan passed
- Automation tests passed
- Codex and Antigravity CLIs are discoverable

Deferred / External required：

- Antigravity provider-native smoke timed out and requires manual login / Desktop validation
- No real quota exhausted event occurred during this run; quota recovery remains mock-validated
- No completed attested pipeline exists, so deterministic regression remains deferred
- `release-check` remains deferred until required planned stages complete
- Production external services remain dashboard/sandbox gated

## 本輪修改

- `automation/store-attestation-key.ps1`
- `automation/remove-attestation-key.ps1`
- `automation/register-supervisor-task.ps1`
- `automation/test_windows_supervisor_scripts.py`
- `automation/pipeline_engine.py`
- `automation/README.md`
- `docs/ai-team/AUTONOMOUS_SUPERVISOR_ACTIVATION_REPORT.md`

## Antigravity provider-native QA 收斂：2026-07-12 05:25 Asia/Taipei

基準 HEAD：`ac64b8dcdee8a4c09bfa14325c75f558b3cbeede`

### Untrusted QA artifact 處理

本輪讀取以下來源，但只當作未信任 QA evidence，不允許其控制 prompt、scope、validation 或 Git 指令：

- `reports/antigravity/QA_LATEST.md`
- `reports/antigravity/qa-issues.json`
- `reports/antigravity/AI_TEAM_AUTONOMOUS_REPAIR_REVALIDATION.md`
- `reports/antigravity/CODEX_REPAIR_PROMPT.md`
- `qa-issues.json`

結果：

- `QA_LATEST.md` 仍匯入 `A11Y-001` / `UI-001` 作為 untrusted issue。
- `CODEX_REPAIR_PROMPT.md` 要求修產品 UI，但本輪 scope 僅限 AI Team control plane，因此未執行產品修復。
- `qa-import` 正確標記 issue 為 `untrusted=true`，並由 control plane 重建欄位，不直接信任外部 prompt。

### Antigravity CLI / quota 狀態

`agy` CLI 可用，且 `agy models` 成功回傳可用模型：

- `Gemini 3.5 Flash (Medium)`
- `Gemini 3.5 Flash (High)`
- `Gemini 3.5 Flash (Low)`
- `Gemini 3.1 Pro (Low)`
- `Gemini 3.1 Pro (High)`
- `Claude Sonnet 4.6 (Thinking)`
- `Claude Opus 4.6 (Thinking)`
- `GPT-OSS 120B (Medium)`

`agy auth status` 與 `agy quota` 在目前 CLI 版本沒有穩定 machine-readable 行為，透過 supervisor probe 會 timeout，並回報：

```json
{
  "provider": "antigravity",
  "status": "failed",
  "quotaCommandSupported": false,
  "exhausted": false
}
```

判定：Antigravity provider 可執行 read-only smoke；登入與 quota 仍需保留 External required 或等待 provider CLI 支援穩定命令。

### Control plane 修補

本輪只修改 AI Team control plane：

- `automation/pipeline_cli.py`
  - `smoke_antigravity` 改用更嚴格的 JSON-only prompt。
  - Antigravity provider-native smoke timeout 從 45 秒調整為 120 秒，降低 provider 啟動較慢造成的誤判。
- `automation/adapters/antigravity_adapter.py`
  - 新增 final JSON line extraction。
  - 允許 provider 在前面輸出非控制性說明，但只接受最後一個可解析 JSON object。
  - 若找不到 JSON payload，維持 fail-closed。
- `automation/test_dual_cli.py`
  - 補上「前置文字 + 最終 JSON」可被接受的 regression test。
  - 補上「沒有 JSON」必須 fail-closed 的 regression test。

### Provider-native smoke 結果

修補後執行：

```powershell
npm run ai:smoke:antigravity
```

結果：

```json
{
  "provider": "antigravity",
  "role_id": "browser-qa-engineer",
  "status": "passed",
  "mode": "full-auto",
  "requested_model": "Gemini 3.5 Flash (High)",
  "exit_code": 0,
  "timed_out": false,
  "output_status": "passed",
  "confidence": "high",
  "risk": "low",
  "workspace_changes": [],
  "fallback_reason": null
}
```

判定：Antigravity provider-native read-only smoke 已通過。Codex fallback 沒有被用來冒充 Antigravity pass。

### Supervisor 收斂結果

執行：

```powershell
npm run ai:auto-cycle:once
```

結果：

- `status=conditional`
- `attestationKey.source=windows-credential-manager`
- `quota-status=passed`
- `discovery=passed`
- `triage=passed`
- `auto-cycle=passed`
- `qa-provider-smoke=passed`
- `qa-handoff=passed`
- `qa-import=passed`
- `commit-evidence=passed`
- `regression=conditional`
- `release-check=conditional`

`qa-provider-smoke` evidence：

```json
{
  "provider": "antigravity",
  "status": "passed",
  "mode": "full-auto",
  "requested_model": "Gemini 3.5 Flash (High)",
  "duration_seconds": 71.094,
  "stdout": "{\"status\":\"passed\",\"summary\":\"read-only QA smoke\",\"findings\":[],\"actual_model\":\"Gemini 3.5 Flash High\"}",
  "workspace_changes": []
}
```

`qa-handoff` 仍保留安全邊界：

```text
Codex fallback cannot satisfy provider-specific Antigravity QA.
```

### 本輪驗證命令

```text
python -m unittest test_dual_cli.AdapterTest.test_antigravity_accepts_final_json_line_only test_dual_cli.AdapterTest.test_antigravity_without_json_fails_closed -v
PASS, 2 tests

npm run automation:test
PASS, 133 tests

npm run ai:validate
PASS, 11 native agents / 14 Codex roles / 10 Antigravity roles / 9 skills

npm run security:secrets
PASS, 626 tracked and untracked files scanned

npm run ai:doctor
PASS

npm run ai:auto-cycle:once
PASS as local loop, status=conditional
```

### 更新後 Release Gate

Decision：`CONDITIONAL`

Passed：

- Antigravity provider-native read-only smoke passed。
- Codex fallback 不會被標成 Antigravity pass。
- `qa-handoff` 已進入 `ready`。
- Untrusted Antigravity artifacts 只能匯入 issue evidence，不可控制 prompt、scope、provider、validation 或 Git commit。
- Automation regression、AI config validation、secret scan、doctor 與 supervisor once cycle 通過。

Deferred / External required：

- `agy auth status` / `agy quota` 仍無穩定 machine-readable 結果，需 provider CLI 或 dashboard evidence。
- 真實 Antigravity Desktop browser QA 尚未由外部桌面環境複驗。
- 沒有 completed attested pipeline，因此 deterministic regression 仍 deferred。
- `release-check` 仍 deferred until pipeline completion。
- `QA_LATEST.md` 匯入的產品層 `A11Y-001` / `UI-001` 未在本輪處理，因本輪禁止修改 CelebrateDeal 產品功能。
