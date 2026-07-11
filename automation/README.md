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

Each completed stage must have a receipt containing the current run ID, role, provider, output artifact and SHA-256 digest. A downstream stage cannot start from a failed, blocked or conditional predecessor, and `release-check` verifies the artifact hashes again. Workspace-write stages are never resumed in the primary checkout: they stop at `awaiting-human-approval` until an isolated approved worktree is supplied.

Provider-specific smoke, handoff and release commands return exit code `2` when they are conditional or blocked. This is an expected fail-closed signal for CI and shell callers; read the JSON artifact to distinguish External required from deterministic test failure.

Stage receipts and deterministic regression evidence require `AI_PIPELINE_ATTESTATION_KEY`. Keep this coordinator-only HMAC key in CI/staging secret storage; never commit it and never expose it to child adapters. The adapter environment allowlist intentionally strips this variable. Without it, stage execution and release verification return blocked. Plan/release also bind Git HEAD, a dirty-worktree fingerprint, pipeline revision and a trusted task DAG digest.

這個 orchestrator 使用 Codex CLI non-interactive mode，從 `automation/backlog.json` 與根目錄 `qa-issues.json` 選取待處理工作，依 `team-config.yaml` 路由到對應 agent/model/reasoning 設定。

## 安全行為

- 真實執行前要求目前 worktree 乾淨。
- 每個任務建立 `codex/automation/<task-id>` 分支與 `.worktrees/<task-id>` 隔離 worktree。
- Codex 使用 `workspace-write`，不使用 bypass approvals/sandbox。
- 最多三次嘗試；驗證失敗只把精簡 log 交給修復回合。
- 不部署、不 push、不 merge。Database、auth、payment、billing、webhook 變更一律標記 manual merge required。
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

產物位於 `automation/logs` 與 `automation/reports`，兩者不提交 Git。代理設定的 model/reasoning 是 Prompt 預期值；只有 Codex runtime 明確回報時才能稱為實際使用值。目前 Codex CLI v0.134.0 無法執行 gpt-5.6-terra/sol，若 CLI 明確回傳版本不支援，orchestrator 會改用 `gpt-5.4` 並在報告寫入 `runtimeModel`。升級 CLI 後會優先使用代理設定模型。

## Antigravity QA

Antigravity 可將問題寫入根目錄 `qa-issues.json`。每筆只採用 `id`、`title`、`description`、`priority`、`type` 與 `status`；`prompt`、自訂 validation 與命令一律忽略。內容會標記為 untrusted evidence。

Untrusted QA 只會被登錄為 `awaiting-approval` 報告，不會送入 Codex、不建立 worktree、不取得 workspace-write，也不執行 npm validation。人工審閱後，將可信任的修復目標另寫入 `automation/backlog.json`，下一次 orchestrator 才會執行。若 trusted automation task 修改 `.github`、`.codex`、`.agents`、`automation`、`package.json`、lockfile 或 `scripts`，仍會在執行任何 npm script 前失敗，除非該 backlog task 由人工明確設定 `allow_supply_chain_changes: true`。
