# Quota Resume Runbook

## Commands

```powershell
npm run ai:quota:status
npm run ai:quota:probe -- --provider antigravity
npm run ai:supervisor
npm run ai:resume
```

Codex usage-limit messages are parsed for a future `try again at` value. Missing or expired values schedule the next probe one hour later. Antigravity is probed with `agy quota` and then `agy auth status`; a future local `Reset Time` is used directly.

## Windows Task Scheduler

Create a task that runs hourly under the development account:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\eden\Downloads\AI\CelebrateDeal\automation\run-supervisor.ps1"
```

Set **Start in** to the repository root. Do not embed secrets or the attestation key in the scheduled task. The supervisor exits `0` when idle/available and `2` while quota is still unavailable; both are expected operational outcomes.

The task can also be registered explicitly when the operator is ready:

```powershell
.\automation\register-supervisor-task.ps1
```

Registration is not run automatically during installation because it creates persistent operating-system state.

When the provider becomes available, a scheduler without `AI_PIPELINE_ATTESTATION_KEY` records `provider-available-awaiting-attestation` and does not resume. A CI/staging supervisor that receives the coordinator secret from approved secret storage may call resume automatically. The supervisor never creates or replaces that key. Completed provider receipts are not rerun, and workspace-write stages use an isolated task worktree.

On this workstation, `agy quota` and `agy auth status` both timed out after 10 seconds during the repo-local probe. The process was terminated cleanly and no child process remained. This is recorded as External required rather than quota available.
