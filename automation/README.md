# CelebrateDeal AI Team Orchestrator

The orchestrator now exposes a dual-CLI role pipeline while preserving the original trusted backlog/worktree executor.

## Dual CLI commands

```powershell
python automation/orchestrator.py doctor
python automation/orchestrator.py inspect
python automation/orchestrator.py smoke-codex
python automation/orchestrator.py smoke-antigravity
python automation/orchestrator.py smoke-role-handoff
python automation/orchestrator.py import-existing-qa
python automation/orchestrator.py import-qa --file reports/antigravity/qa-issues.json
python automation/orchestrator.py plan --pipeline repair
python automation/orchestrator.py plan --task-id AI-TEAM-REPAIR-001
python automation/orchestrator.py regression
python automation/orchestrator.py status
python automation/orchestrator.py release-check
```

Runtime evidence is written under `reports/ai-team/runtime`. Pipeline state uses atomic replacement in `automation/pipeline-state.json`. A passed adapter run records requested and actual model separately; where the CLI does not expose runtime identity, reports must say unverified rather than infer it.

Trusted backlog tasks use `type` or `types` to compile a domain-aware role DAG. The DAG automatically includes required specialist reviewers and QA roles, validates that every role is enabled, and fails closed for unknown domains or providers. Static files in `automation/pipelines` are reference templates; task execution and release evidence must use the compiled DAG stored in schema v2 pipeline state.

Each completed stage must have an attested receipt containing the current run ID, role, provider, attempt nonce, output artifact hashes and (for workspace-write) commit SHA, approved tree, validation log hash and staged secret-scan evidence. A downstream stage cannot start from a failed, blocked or conditional predecessor. Workspace-write stages run only through the isolated executor; the primary checkout never receives model writes directly. `release-check` revalidates artifact hashes, receipt identity, commit tree and writer ancestry.

Provider-specific smoke, handoff and release commands return exit code `2` when they are conditional or blocked. This is an expected fail-closed signal for CI and shell callers; read the JSON artifact to distinguish External required from deterministic test failure.

Stage receipts and deterministic regression evidence require `AI_PIPELINE_ATTESTATION_KEY`. Keep this coordinator-only HMAC key in CI/staging secret storage; never commit it and never expose it to child adapters. The adapter environment allowlist intentionally strips this variable. Without it, stage execution and release verification return blocked. Plan/release also bind Git HEAD, a dirty-worktree fingerprint, pipeline revision and a trusted task DAG digest.

這個 orchestrator 使用 Codex CLI non-interactive mode，從 `automation/backlog.json` 與根目錄 `qa-issues.json` 選取待處理工作，依 `team-config.yaml` 路由到對應 agent/model/reasoning 設定。

## 安全行為

- 真實執行前要求目前 worktree 乾淨。
- 每個任務建立 `codex/automation/<task-id>` 分支與 `.worktrees/<task-id>` 隔離 worktree。
- Codex 使用 `workspace-write`，不使用 bypass approvals/sandbox。
- 最多三次嘗試；驗證失敗只把精簡 log 交給修復回合。
- 不部署、不 push。通過固定政策、隔離 worktree、reviewer/QA、回歸、secret scan、attested receipt 與 release-check 的 task branch 可自動建立 scoped commit；production merge 仍維持關閉。高風險自動執行是 machine-gated，不代表可部署 production 或修改正式資料。
- 驗證命令有 allowlist；禁止 production deploy、force push、migration reset。
- Role manifest 必須位於 `automation/roles`，registry/manifest 的 role ID 與 provider 必須完全一致；未知角色、未知 provider 與路徑逸出一律拒絕。

## 使用

先確認 Codex CLI 已登入：

```powershell
codex --version
npm run ai:smoke
```

只查看下一個任務的路由與驗證：

```powershell
.\automation\run-team.ps1 -DryRun
```

執行指定任務：

```powershell
.\automation\run-team.ps1 -Task SEC-001
```

產物位於 `automation/logs` 與 `automation/reports`，兩者不提交 Git。代理設定的 model/reasoning 是 Prompt 預期值；只有 Codex runtime 明確回報時才能稱為實際使用值。已偵測 Codex CLI v0.144.1；若 requested model 仍被 runtime 明確拒絕，orchestrator 會改用 `gpt-5.4` 並在報告寫入 fallback 與 actual model evidence。

## Antigravity QA

Antigravity 可將問題寫入根目錄 `qa-issues.json`。每筆只採用 `id`、`title`、`description`、`priority`、`type` 與 `status`；`prompt`、自訂 validation 與命令一律忽略。內容會標記為 untrusted evidence。

Untrusted QA 可以在 `autonomy.auto_promote_qa=true` 時自動進入 policy promotion，但 QA 原文永遠只是 evidence。Orchestrator 會重建固定 task ID、prompt、role DAG、provider、validation、write/forbidden paths、commit policy 與 evidence source；未取得 `automatic-qa-repair-v1` promotion record 的資料仍不能建立 executable DAG。若 promoted repair task 修改高風險產品路徑，固定 forbidden paths 會阻擋，不得由 QA payload 放寬。若 trusted automation task 修改 `.github`、`.codex`、`.agents`、`automation`、`package.json`、lockfile 或 `scripts`，仍會在執行任何 npm script 前失敗，除非該 task 由可信任控制面明確設定 `allow_supply_chain_changes: true`。

## Autonomous discovery and quota resume

An empty trusted queue now triggers deterministic discovery instead of returning an error:

```powershell
npm run ai:discover
npm run ai:triage
npm run ai:auto-cycle:once
npm run ai:auto-cycle
npm run ai:status
```

Discovery captures a protected Git baseline and writes runtime evidence. Triage discards model-supplied provider, role, command, validation and scope controls, then rebuilds candidate tasks from server policy. P0/P1 and protected financial/security paths cannot enter auto-execution.

Quota-aware commands:

```powershell
npm run ai:quota:status
npm run ai:quota:probe -- --provider antigravity
npm run ai:supervisor
npm run ai:resume
```

The default `ai:auto-cycle` and `ai:supervisor` commands now run the unified unattended loop. Each cycle performs quality discovery, server-side triage, trusted backlog execution, Antigravity QA smoke/handoff/import, deterministic regression and Git commit-evidence capture. Runtime candidates never directly control a Git commit; only the isolated trusted executor can create one after scope, validation and staged-secret gates.

```powershell
npm run ai:auto-cycle
npm run ai:auto-cycle:once
npm run ai:supervisor -- --interval-minutes 60 --max-runtime-minutes 120
npm run ai:quota:supervisor
```

The supervisor is single-instance, uses a persistent restart-safe state, stops after three consecutive hard failures, checks free disk space and enforces the configured daily autonomous commit limit. Exit code `2` means a fail-closed conditional state such as quota wait or circuit-open; exit code `3` means another supervisor owns the process lock.

Codex usage-limit messages and Antigravity 429/`RESOURCE_EXHAUSTED` messages persist a resumable quota state. A future provider reset time is honored; missing or expired timestamps fall back to one probe per hour. The Windows scheduler entry point is `automation/run-supervisor.ps1`.

The Ollama fallback is intentionally narrow. Only `qwen3:8b`, `qwen2.5-coder:7b`, `qwen2.5-coder:1.5b`, `qwen2.5vl:3b` and `nomic-embed-text:latest` are allowed. Local output is stored as a report artifact and never satisfies Codex or Antigravity provider requirements.

## Windows unattended activation

The production-like local supervisor uses Windows Credential Manager for the coordinator-only attestation key and Windows Task Scheduler for hourly unattended cycles. The scheduled task intentionally runs the unified supervisor once per trigger, not the quota-only probe.

```powershell
.\automation\store-attestation-key.ps1
python automation\windows_credentials.py status

.\automation\register-supervisor-task.ps1
Get-ScheduledTask -TaskName "CelebrateDeal-AI-Autonomous-Supervisor"
```

Expected scheduler action:

```text
Execute: <absolute python.exe>
Arguments: "<repo>\automation\autonomous_supervisor.py" --once
WorkingDirectory: <repo>
```

Manual validation commands:

```powershell
npm run ai:auto-cycle:once
Get-Content reports\ai-team\runtime\autonomous-supervisor-diagnostics.json
Get-Content reports\ai-team\runtime\autonomous-supervisor-state.json
Get-Content reports\ai-team\runtime\autonomous-supervisor.jsonl -Tail 20
```

Stop or remove the unattended task:

```powershell
Stop-ScheduledTask -TaskName "CelebrateDeal-AI-Autonomous-Supervisor"
.\automation\unregister-supervisor-task.ps1
.\automation\remove-attestation-key.ps1
```

Activation notes:

- `credential-ready` means the key exists in Windows Credential Manager. The key must never be printed, committed, or forwarded to Codex/Antigravity adapters.
- Exit code `0` with supervisor status `conditional` means the local loop finished and deferred provider-specific or attested-pipeline requirements. It is not a production release approval.
- Exit code `2` remains the fail-closed signal for quota wait, provider-specific QA requirements, or release stages that have not completed.
- Exit code `3` means the single-instance lock rejected a duplicate supervisor process.
- If multiple Python launchers are installed, the PowerShell scripts select the first resolved `python` command instead of concatenating all candidates.
