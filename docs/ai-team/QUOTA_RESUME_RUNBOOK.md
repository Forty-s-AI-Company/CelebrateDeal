# Quota Resume Runbook

## Commands

```powershell
npm run ai:quota:status
npm run ai:quota:probe -- --provider antigravity
npm run ai:quota:supervisor
npm run ai:resume
```

Codex usage-limit messages are parsed for a future `try again at` value. Missing or expired values schedule the next probe one hour later. Antigravity is probed with `agy quota` and then `agy auth status`; a future local `Reset Time` is used directly.

## Windows Task Scheduler

## Unified unattended supervisor

Run continuously until `Ctrl+C`:

```powershell
npm run ai:supervisor
```

Run one cycle or apply explicit timing limits:

```powershell
npm run ai:auto-cycle:once
npm run ai:supervisor -- --interval-minutes 60 --max-runtime-minutes 120
```

The loop writes structured diagnostics and JSONL events below `reports/ai-team/runtime/`. It uses a single-instance lock, restart-safe state, a two GiB free-disk floor, a daily autonomous commit limit and a three-failure circuit breaker. Missing `rg`, Ollama, Codex or Antigravity is recorded in diagnostics rather than surfaced as an unhandled `WinError`.

Generate a 256-bit coordinator key inside Python and store it directly in Windows Credential Manager. The generated value is never printed, passed through a command-line argument or written to the repository:

```powershell
.\automation\store-attestation-key.ps1
python automation/windows_credentials.py status
```

Credential Manager encrypts the value at rest but does not isolate it from arbitrary code running under the same Windows identity. For staging-like unattended use, create a dedicated coordinator Windows account, store the credential while logged in as that account, restrict repository/runtime ACLs, and register the task under the same account. Codex and Antigravity provider processes should use separate restricted identities when the workstation policy allows it. This account/ACL setup is `External required`.

Remove it when rotating or decommissioning the workstation:

```powershell
.\automation\remove-attestation-key.ps1
```

Create a task that runs the unified supervisor once per hour under the development account:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\eden\Downloads\AI\CelebrateDeal\automation\run-supervisor.ps1" -Once
```

Set **Start in** to the repository root. Do not embed secrets or the attestation key in the scheduled task. The supervisor exits `0` when idle/available and `2` while quota is still unavailable; both are expected operational outcomes.

The task can also be registered explicitly when the operator is ready:

```powershell
.\automation\register-supervisor-task.ps1
```

Inspect, stop or remove it:

```powershell
Get-ScheduledTask -TaskName "CelebrateDeal-AI-Autonomous-Supervisor"
Stop-ScheduledTask -TaskName "CelebrateDeal-AI-Autonomous-Supervisor"
.\automation\unregister-supervisor-task.ps1
```

Registration is not run automatically during installation because it creates persistent operating-system state.

When the provider becomes available, a scheduler without `AI_PIPELINE_ATTESTATION_KEY` records `provider-available-awaiting-attestation` and does not resume. A CI/staging supervisor that receives the coordinator secret from approved secret storage may call resume automatically. The supervisor never creates or replaces that key. Completed provider receipts are not rerun, and workspace-write stages use an isolated task worktree.

On this workstation, `agy quota` and `agy auth status` both timed out after 10 seconds during the repo-local probe. The process was terminated cleanly and no child process remained. This is recorded as External required rather than quota available.
