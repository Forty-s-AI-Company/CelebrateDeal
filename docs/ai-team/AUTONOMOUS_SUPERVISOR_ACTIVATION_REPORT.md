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
